import {
    randomInteger,
    type RandomSource
} from '../../domain/random/random-source';

export const CIRCUIT_COLORS = [
    'cyan',
    'magenta',
    'amber',
    'lime',
    'violet'
] as const;

export const CIRCUIT_SPECIALS = [
    'none',
    'row',
    'column',
    'burst',
    'color'
] as const;

export type CircuitColor = (typeof CIRCUIT_COLORS)[number];
export type CircuitSpecial = (typeof CIRCUIT_SPECIALS)[number];
export type CircuitTerminalStatus = 'active' | 'success' | 'failure';
export type CircuitFailureReason = 'moves-exhausted' | null;

export interface CircuitChip {
    readonly id: number;
    readonly color: CircuitColor;
    readonly special: CircuitSpecial;
}

export interface CircuitSwap {
    readonly fromIndex: number;
    readonly toIndex: number;
}

export interface CircuitHint {
    readonly swap: CircuitSwap;
    readonly projectedBlockersCleared: number;
    readonly projectedChipsCleared: number;
    readonly projectedCascades: number;
    readonly projectedSpecialsCreated: number;
}

export interface CircuitBoosterCharges {
    readonly extraMoves: number;
    readonly hints: number;
    readonly pulses: number;
    readonly shuffles: number;
}

export type CircuitBoosterAction =
    | {readonly kind: 'extra-moves'}
    | {readonly kind: 'hint'}
    | {readonly kind: 'pulse'; readonly cellIndex: number}
    | {readonly kind: 'shuffle'};

export interface CircuitPuzzleConfig {
    readonly size?: 7 | 8;
    readonly moveBudget?: number;
    readonly witnessMoves?: number;
    readonly extraMoveAmount?: number;
    readonly boosterCharges?: Partial<CircuitBoosterCharges>;
    readonly maxGenerationAttempts?: number;
    readonly attemptNumber?: number;
}

export interface ResolvedCircuitPuzzleConfig {
    readonly size: 7 | 8;
    readonly moveBudget: number;
    readonly witnessMoves: number;
    readonly extraMoveAmount: number;
    readonly initialBoosterCharges: CircuitBoosterCharges;
    readonly maxGenerationAttempts: number;
}

export interface CircuitSolvabilityCertificate {
    readonly swaps: readonly CircuitSwap[];
    readonly requiredMoves: number;
    readonly moveBudget: number;
    readonly finalSignature: string;
    readonly verified: boolean;
}

export interface CircuitInitialSnapshot {
    readonly chips: readonly CircuitChip[];
    readonly blockers: readonly number[];
    readonly randomState: number;
    readonly nextChipId: number;
}

export type CircuitEventKind =
    | 'generated'
    | 'invalid-swap'
    | 'swap-resolved'
    | 'success'
    | 'failure'
    | 'no-move-shuffle'
    | 'booster-extra-moves'
    | 'booster-hint'
    | 'booster-pulse'
    | 'booster-shuffle'
    | 'booster-unavailable'
    | 'ignored';

export interface CircuitModelEvent {
    readonly kind: CircuitEventKind;
    readonly fromIndex: number | null;
    readonly toIndex: number | null;
    readonly affectedIndices: readonly number[];
    readonly blockersCleared: number;
    readonly cascades: number;
    readonly specialsCreated: number;
    readonly specialKindsCreated: readonly Exclude<CircuitSpecial, 'none'>[];
    readonly specialsActivated: number;
    readonly recoveredNoMoves: boolean;
    readonly message: string;
}

export interface CircuitPuzzleState {
    readonly config: ResolvedCircuitPuzzleConfig;
    readonly width: number;
    readonly height: number;
    readonly chips: readonly CircuitChip[];
    /** Zero means clear; positive values are remaining short-circuit layers. */
    readonly blockers: readonly number[];
    readonly blockersRemaining: number;
    readonly movesRemaining: number;
    readonly movesSpent: number;
    readonly score: number;
    readonly totalCascades: number;
    readonly totalChipsCleared: number;
    readonly totalSpecialsCreated: number;
    readonly totalSpecialsActivated: number;
    readonly noMoveRecoveries: number;
    readonly boosterCharges: CircuitBoosterCharges;
    readonly lastHint: CircuitHint | null;
    readonly terminalStatus: CircuitTerminalStatus;
    readonly failureReason: CircuitFailureReason;
    readonly generationSeed: number;
    readonly generationAttempt: number;
    readonly attemptNumber: number;
    readonly randomState: number;
    readonly nextChipId: number;
    readonly certificate: CircuitSolvabilityCertificate;
    readonly initialSnapshot: CircuitInitialSnapshot;
    readonly lastEvent: CircuitModelEvent;
}

export interface CircuitValidationResult {
    readonly valid: boolean;
    readonly reasons: readonly string[];
    readonly automaticMatchCount: number;
    readonly legalMoveCount: number;
}

export interface CircuitWitnessValidation {
    readonly valid: boolean;
    readonly completed: boolean;
    readonly movesUsed: number;
    readonly finalSignature: string;
    readonly message: string;
}

interface MatchRun {
    readonly orientation: 'horizontal' | 'vertical';
    readonly indices: readonly number[];
}

interface MatchGroup {
    readonly indices: readonly number[];
    readonly runs: readonly MatchRun[];
}

interface SpecialCreation {
    readonly index: number;
    readonly special: Exclude<CircuitSpecial, 'none'>;
}

interface ResolutionCursor {
    readonly randomState: number;
    readonly nextChipId: number;
}

interface ClearCycleResult extends ResolutionCursor {
    readonly chips: readonly CircuitChip[];
    readonly affectedIndices: readonly number[];
    readonly chipsRemoved: number;
    readonly specialsCreated: number;
    readonly specialKindsCreated: readonly Exclude<CircuitSpecial, 'none'>[];
    readonly specialsActivated: number;
}

interface BoardResolution extends ResolutionCursor {
    readonly valid: boolean;
    readonly chips: readonly CircuitChip[];
    readonly affectedIndices: readonly number[];
    readonly chipsRemoved: number;
    readonly cascades: number;
    readonly specialsCreated: number;
    readonly specialKindsCreated: readonly Exclude<CircuitSpecial, 'none'>[];
    readonly specialsActivated: number;
    readonly recoveredNoMoves: boolean;
}

interface StableBoardResult extends ResolutionCursor {
    readonly chips: readonly CircuitChip[];
    readonly attempts: number;
}

interface WitnessBuildResult extends ResolutionCursor {
    readonly finalChips: readonly CircuitChip[];
    readonly swaps: readonly CircuitSwap[];
    readonly blockerIndices: readonly number[];
}

const DEFAULT_BOOSTER_CHARGES: CircuitBoosterCharges = Object.freeze({
    extraMoves: 1,
    hints: 3,
    pulses: 2,
    shuffles: 1
});

const MAXIMUM_CASCADE_DEPTH = 64;
const RANDOM_RANGE = 0x1_0000_0000;

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function assertNonNegativeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer.`);
    }
}

function resolveConfig(config: CircuitPuzzleConfig): ResolvedCircuitPuzzleConfig {
    const size = config.size ?? 8;
    const witnessMoves = config.witnessMoves ?? 6;
    const moveBudget = config.moveBudget ?? 18;
    const extraMoveAmount = config.extraMoveAmount ?? 5;
    const maxGenerationAttempts = config.maxGenerationAttempts ?? 96;
    const suppliedCharges = config.boosterCharges ?? {};
    const initialBoosterCharges: CircuitBoosterCharges = {
        extraMoves: suppliedCharges.extraMoves ?? DEFAULT_BOOSTER_CHARGES.extraMoves,
        hints: suppliedCharges.hints ?? DEFAULT_BOOSTER_CHARGES.hints,
        pulses: suppliedCharges.pulses ?? DEFAULT_BOOSTER_CHARGES.pulses,
        shuffles: suppliedCharges.shuffles ?? DEFAULT_BOOSTER_CHARGES.shuffles
    };

    if (size !== 7 && size !== 8) {
        throw new Error('Circuit Crush boards must be 7x7 or 8x8.');
    }
    if (!Number.isSafeInteger(witnessMoves) || witnessMoves < 3 || witnessMoves > 12) {
        throw new Error('Circuit witness length must be between 3 and 12 moves.');
    }
    if (!Number.isSafeInteger(moveBudget) || moveBudget < witnessMoves || moveBudget > 99) {
        throw new Error('Circuit move budget must cover the witness and be at most 99.');
    }
    if (!Number.isSafeInteger(extraMoveAmount) || extraMoveAmount < 1 || extraMoveAmount > 20) {
        throw new Error('Circuit extra-move boosters must add between 1 and 20 moves.');
    }
    if (!Number.isSafeInteger(maxGenerationAttempts)
        || maxGenerationAttempts < 1
        || maxGenerationAttempts > 1_024) {
        throw new Error('Circuit generation attempts must be between 1 and 1024.');
    }
    for (const [label, value] of Object.entries(initialBoosterCharges)) {
        assertNonNegativeInteger(value, `Circuit ${label} charge count`);
        if (value > 20) throw new Error(`Circuit ${label} charge count must be at most 20.`);
    }

    return {
        size,
        moveBudget,
        witnessMoves,
        extraMoveAmount,
        initialBoosterCharges,
        maxGenerationAttempts
    };
}

class CircuitRandomCursor {
    state: number;
    nextChipId: number;

    constructor(state: number, nextChipId: number) {
        this.state = state >>> 0;
        this.nextChipId = nextChipId;
    }

    nextUnit(): number {
        this.state = (this.state + 0x6d2b79f5) >>> 0;
        let value = this.state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / RANDOM_RANGE;
    }

    nextInteger(maximumExclusive: number): number {
        return Math.floor(this.nextUnit() * maximumExclusive);
    }

    createChip(color?: CircuitColor, special: CircuitSpecial = 'none'): CircuitChip {
        const resolvedColor = color ?? CIRCUIT_COLORS[this.nextInteger(CIRCUIT_COLORS.length)]!;
        const chip = {
            id: this.nextChipId,
            color: resolvedColor,
            special
        } satisfies CircuitChip;
        this.nextChipId += 1;
        return chip;
    }
}

function mixSeed(seed: number, salt: number): number {
    let value = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return (value ^ (value >>> 15)) >>> 0;
}

function inBounds(index: number, cellCount: number): boolean {
    return Number.isSafeInteger(index) && index >= 0 && index < cellCount;
}

export function areCircuitCellsAdjacent(
    firstIndex: number,
    secondIndex: number,
    width: number,
    height: number
): boolean {
    const cellCount = width * height;
    if (!inBounds(firstIndex, cellCount) || !inBounds(secondIndex, cellCount)) return false;
    const firstX = firstIndex % width;
    const firstY = Math.floor(firstIndex / width);
    const secondX = secondIndex % width;
    const secondY = Math.floor(secondIndex / width);
    return Math.abs(firstX - secondX) + Math.abs(firstY - secondY) === 1;
}

function findMatchRuns(
    chips: readonly CircuitChip[],
    width: number,
    height: number
): readonly MatchRun[] {
    const runs: MatchRun[] = [];

    for (let y = 0; y < height; y++) {
        let startX = 0;
        while (startX < width) {
            const color = chips[y * width + startX]!.color;
            let endX = startX + 1;
            while (endX < width && chips[y * width + endX]!.color === color) endX += 1;
            if (endX - startX >= 3) {
                const indices: number[] = [];
                for (let x = startX; x < endX; x++) indices.push(y * width + x);
                runs.push({orientation: 'horizontal', indices});
            }
            startX = endX;
        }
    }

    for (let x = 0; x < width; x++) {
        let startY = 0;
        while (startY < height) {
            const color = chips[startY * width + x]!.color;
            let endY = startY + 1;
            while (endY < height && chips[endY * width + x]!.color === color) endY += 1;
            if (endY - startY >= 3) {
                const indices: number[] = [];
                for (let y = startY; y < endY; y++) indices.push(y * width + x);
                runs.push({orientation: 'vertical', indices});
            }
            startY = endY;
        }
    }

    return runs;
}

function findMatchGroups(
    chips: readonly CircuitChip[],
    width: number,
    height: number
): readonly MatchGroup[] {
    const runs = findMatchRuns(chips, width, height);
    if (runs.length === 0) return [];

    const parent = new Map<number, number>();
    const findRoot = (index: number): number => {
        const initialParent = parent.get(index);
        if (initialParent === undefined) {
            parent.set(index, index);
            return index;
        }
        if (initialParent === index) return index;
        const root = findRoot(initialParent);
        parent.set(index, root);
        return root;
    };
    const union = (first: number, second: number): void => {
        const firstRoot = findRoot(first);
        const secondRoot = findRoot(second);
        if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
    };

    for (const run of runs) {
        const first = run.indices[0]!;
        findRoot(first);
        for (const index of run.indices.slice(1)) union(first, index);
    }

    const groups = new Map<number, {indices: Set<number>; runs: MatchRun[]}>();
    for (const run of runs) {
        const root = findRoot(run.indices[0]!);
        const group = groups.get(root) ?? {indices: new Set<number>(), runs: []};
        for (const index of run.indices) group.indices.add(index);
        group.runs.push(run);
        groups.set(root, group);
    }

    return [...groups.values()]
        .map(group => ({
            indices: [...group.indices].sort((first, second) => first - second),
            runs: group.runs
        }))
        .sort((first, second) => first.indices[0]! - second.indices[0]!);
}

export function getCircuitMatchedIndices(state: CircuitPuzzleState): readonly number[] {
    const matched = new Set<number>();
    for (const run of findMatchRuns(state.chips, state.width, state.height)) {
        for (const index of run.indices) matched.add(index);
    }
    return [...matched].sort((first, second) => first - second);
}

function swappedChips(
    chips: readonly CircuitChip[],
    firstIndex: number,
    secondIndex: number
): readonly CircuitChip[] {
    const swapped = [...chips];
    const first = swapped[firstIndex]!;
    swapped[firstIndex] = swapped[secondIndex]!;
    swapped[secondIndex] = first;
    return swapped;
}

function isLegalSwapOnBoard(
    chips: readonly CircuitChip[],
    width: number,
    height: number,
    swap: CircuitSwap
): boolean {
    if (!areCircuitCellsAdjacent(swap.fromIndex, swap.toIndex, width, height)) return false;
    const first = chips[swap.fromIndex]!;
    const second = chips[swap.toIndex]!;
    if (first.special !== 'none' || second.special !== 'none') return true;
    return findMatchRuns(
        swappedChips(chips, swap.fromIndex, swap.toIndex),
        width,
        height
    ).length > 0;
}

function getLegalSwapsOnBoard(
    chips: readonly CircuitChip[],
    width: number,
    height: number
): readonly CircuitSwap[] {
    const swaps: CircuitSwap[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const fromIndex = y * width + x;
            if (x + 1 < width) {
                const swap = {fromIndex, toIndex: fromIndex + 1};
                if (isLegalSwapOnBoard(chips, width, height, swap)) swaps.push(swap);
            }
            if (y + 1 < height) {
                const swap = {fromIndex, toIndex: fromIndex + width};
                if (isLegalSwapOnBoard(chips, width, height, swap)) swaps.push(swap);
            }
        }
    }
    return swaps;
}

export function getCircuitLegalSwaps(state: CircuitPuzzleState): readonly CircuitSwap[] {
    if (state.terminalStatus !== 'active') return [];
    return getLegalSwapsOnBoard(state.chips, state.width, state.height);
}

function wouldCreateRun(
    chips: readonly CircuitChip[],
    index: number,
    candidate: CircuitColor,
    width: number
): boolean {
    const x = index % width;
    const y = Math.floor(index / width);
    const horizontal = x >= 2
        && chips[index - 1]?.color === candidate
        && chips[index - 2]?.color === candidate;
    const vertical = y >= 2
        && chips[index - width]?.color === candidate
        && chips[index - width * 2]?.color === candidate;
    return horizontal || vertical;
}

function createMatchFreeBoard(
    cursor: CircuitRandomCursor,
    width: number,
    height: number
): readonly CircuitChip[] {
    const chips: CircuitChip[] = [];
    for (let index = 0; index < width * height; index++) {
        const candidates = CIRCUIT_COLORS.filter(
            color => !wouldCreateRun(chips, index, color, width)
        );
        const color = candidates[cursor.nextInteger(candidates.length)]!;
        chips.push(cursor.createChip(color));
    }
    return chips;
}

function createStablePlayableBoard(
    randomState: number,
    nextChipId: number,
    width: number,
    height: number,
    maximumAttempts = 512
): StableBoardResult {
    const cursor = new CircuitRandomCursor(randomState, nextChipId);
    for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
        const chips = createMatchFreeBoard(cursor, width, height);
        if (getLegalSwapsOnBoard(chips, width, height).length > 0) {
            return {
                chips,
                randomState: cursor.state,
                nextChipId: cursor.nextChipId,
                attempts: attempt
            };
        }
    }
    throw new Error('Unable to generate a stable Circuit Crush board with a legal move.');
}

function chooseCreationAnchor(
    group: MatchGroup,
    preferredIndices: readonly number[],
    special: Exclude<CircuitSpecial, 'none'>
): number {
    if (special === 'burst') {
        const horizontal = new Set(
            group.runs
                .filter(run => run.orientation === 'horizontal')
                .flatMap(run => run.indices)
        );
        const intersection = group.runs
            .filter(run => run.orientation === 'vertical')
            .flatMap(run => run.indices)
            .find(index => horizontal.has(index));
        if (intersection !== undefined) return intersection;
    }
    for (const index of preferredIndices) {
        if (group.indices.includes(index)) return index;
    }
    return group.indices[Math.floor(group.indices.length / 2)]!;
}

function getSpecialCreations(
    groups: readonly MatchGroup[],
    preferredIndices: readonly number[]
): readonly SpecialCreation[] {
    const creations: SpecialCreation[] = [];
    for (const group of groups) {
        const hasHorizontal = group.runs.some(run => run.orientation === 'horizontal');
        const hasVertical = group.runs.some(run => run.orientation === 'vertical');
        const longestRun = Math.max(...group.runs.map(run => run.indices.length));
        let special: Exclude<CircuitSpecial, 'none'> | null = null;
        if (hasHorizontal && hasVertical) {
            special = 'burst';
        } else if (longestRun >= 5) {
            special = 'color';
        } else if (longestRun >= 4) {
            special = group.runs[0]!.orientation === 'horizontal' ? 'row' : 'column';
        }
        if (special !== null) {
            creations.push({
                index: chooseCreationAnchor(group, preferredIndices, special),
                special
            });
        }
    }
    return creations;
}

function addIndex(
    affected: Set<number>,
    queue: number[],
    index: number,
    cellCount: number
): void {
    if (index < 0 || index >= cellCount || affected.has(index)) return;
    affected.add(index);
    queue.push(index);
}

function resolveClearCycle(
    chips: readonly CircuitChip[],
    width: number,
    height: number,
    initialAffected: ReadonlySet<number>,
    creations: readonly SpecialCreation[],
    colorOverrides: ReadonlyMap<number, CircuitColor | 'all'>,
    cursor: CircuitRandomCursor
): ClearCycleResult {
    const cellCount = width * height;
    const creationIndices = new Set(creations.map(creation => creation.index));
    const affected = new Set(initialAffected);
    const queue = [...affected];
    let specialsActivated = 0;

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
        const index = queue[queueIndex]!;
        if (creationIndices.has(index)) continue;
        const chip = chips[index]!;
        if (chip.special === 'none') continue;
        specialsActivated += 1;
        const x = index % width;
        const y = Math.floor(index / width);
        if (chip.special === 'row') {
            for (let targetX = 0; targetX < width; targetX++) {
                addIndex(affected, queue, y * width + targetX, cellCount);
            }
        } else if (chip.special === 'column') {
            for (let targetY = 0; targetY < height; targetY++) {
                addIndex(affected, queue, targetY * width + x, cellCount);
            }
        } else if (chip.special === 'burst') {
            for (let offsetY = -1; offsetY <= 1; offsetY++) {
                for (let offsetX = -1; offsetX <= 1; offsetX++) {
                    const targetX = x + offsetX;
                    const targetY = y + offsetY;
                    if (targetX >= 0 && targetX < width && targetY >= 0 && targetY < height) {
                        addIndex(affected, queue, targetY * width + targetX, cellCount);
                    }
                }
            }
        } else {
            const override = colorOverrides.get(index);
            if (override === 'all') {
                for (let target = 0; target < cellCount; target++) {
                    addIndex(affected, queue, target, cellCount);
                }
            } else {
                const targetColor = override ?? chip.color;
                for (let target = 0; target < cellCount; target++) {
                    if (chips[target]!.color === targetColor) {
                        addIndex(affected, queue, target, cellCount);
                    }
                }
            }
        }
    }

    const working: Array<CircuitChip | null> = [...chips];
    for (const index of affected) {
        if (!creationIndices.has(index)) working[index] = null;
    }
    for (const creation of creations) {
        working[creation.index] = cursor.createChip(
            chips[creation.index]!.color,
            creation.special
        );
    }

    for (let x = 0; x < width; x++) {
        const survivors: CircuitChip[] = [];
        for (let y = height - 1; y >= 0; y--) {
            const chip = working[y * width + x];
            if (chip !== null && chip !== undefined) survivors.push(chip);
        }
        for (let y = height - 1, survivorIndex = 0; y >= 0; y--, survivorIndex++) {
            working[y * width + x] = survivors[survivorIndex] ?? cursor.createChip();
        }
    }

    return {
        chips: working as readonly CircuitChip[],
        affectedIndices: [...affected].sort((first, second) => first - second),
        chipsRemoved: affected.size - creations.length,
        specialsCreated: creations.length,
        specialKindsCreated: creations.map(creation => creation.special),
        specialsActivated,
        randomState: cursor.state,
        nextChipId: cursor.nextChipId
    };
}

function resolveBoardAfterInitialCycle(
    initialChips: readonly CircuitChip[],
    width: number,
    height: number,
    cursor: CircuitRandomCursor,
    firstAffected: ReadonlySet<number>,
    firstCreations: readonly SpecialCreation[],
    colorOverrides: ReadonlyMap<number, CircuitColor | 'all'>
): BoardResolution {
    let chips = initialChips;
    const allAffected = new Set<number>();
    let chipsRemoved = 0;
    let cascades = 0;
    let specialsCreated = 0;
    const specialKindsCreated: Array<Exclude<CircuitSpecial, 'none'>> = [];
    let specialsActivated = 0;
    let cycleAffected = firstAffected;
    let cycleCreations = firstCreations;
    let cycleOverrides = colorOverrides;

    while (cycleAffected.size > 0 && cascades < MAXIMUM_CASCADE_DEPTH) {
        const cycle = resolveClearCycle(
            chips,
            width,
            height,
            cycleAffected,
            cycleCreations,
            cycleOverrides,
            cursor
        );
        chips = cycle.chips;
        for (const index of cycle.affectedIndices) allAffected.add(index);
        chipsRemoved += cycle.chipsRemoved;
        specialsCreated += cycle.specialsCreated;
        specialKindsCreated.push(...cycle.specialKindsCreated);
        specialsActivated += cycle.specialsActivated;
        cascades += 1;

        const groups = findMatchGroups(chips, width, height);
        cycleAffected = new Set(groups.flatMap(group => group.indices));
        cycleCreations = getSpecialCreations(groups, []);
        cycleOverrides = new Map();
    }

    if (cascades >= MAXIMUM_CASCADE_DEPTH
        && findMatchRuns(chips, width, height).length > 0) {
        const stable = createStablePlayableBoard(
            cursor.state,
            cursor.nextChipId,
            width,
            height
        );
        chips = stable.chips;
        cursor.state = stable.randomState;
        cursor.nextChipId = stable.nextChipId;
    }

    let recoveredNoMoves = false;
    if (getLegalSwapsOnBoard(chips, width, height).length === 0) {
        const stable = createStablePlayableBoard(
            cursor.state,
            cursor.nextChipId,
            width,
            height
        );
        chips = stable.chips;
        cursor.state = stable.randomState;
        cursor.nextChipId = stable.nextChipId;
        recoveredNoMoves = true;
    }

    return {
        valid: true,
        chips,
        affectedIndices: [...allAffected].sort((first, second) => first - second),
        chipsRemoved,
        cascades,
        specialsCreated,
        specialKindsCreated,
        specialsActivated,
        recoveredNoMoves,
        randomState: cursor.state,
        nextChipId: cursor.nextChipId
    };
}

function resolveSwapOnBoard(
    chips: readonly CircuitChip[],
    width: number,
    height: number,
    swap: CircuitSwap,
    cursorState: ResolutionCursor
): BoardResolution {
    if (!isLegalSwapOnBoard(chips, width, height, swap)) {
        return {
            valid: false,
            chips,
            affectedIndices: [],
            chipsRemoved: 0,
            cascades: 0,
            specialsCreated: 0,
            specialKindsCreated: [],
            specialsActivated: 0,
            recoveredNoMoves: false,
            ...cursorState
        };
    }

    const cursor = new CircuitRandomCursor(cursorState.randomState, cursorState.nextChipId);
    const swapped = swappedChips(chips, swap.fromIndex, swap.toIndex);
    const firstChip = swapped[swap.fromIndex]!;
    const secondChip = swapped[swap.toIndex]!;
    const swappedSpecial = firstChip.special !== 'none' || secondChip.special !== 'none';

    if (swappedSpecial) {
        const affected = new Set([swap.fromIndex, swap.toIndex]);
        const overrides = new Map<number, CircuitColor | 'all'>();
        if (firstChip.special === 'color') {
            overrides.set(
                swap.fromIndex,
                secondChip.special === 'color' ? 'all' : secondChip.color
            );
        }
        if (secondChip.special === 'color') {
            overrides.set(
                swap.toIndex,
                firstChip.special === 'color' ? 'all' : firstChip.color
            );
        }
        return resolveBoardAfterInitialCycle(
            swapped,
            width,
            height,
            cursor,
            affected,
            [],
            overrides
        );
    }

    const groups = findMatchGroups(swapped, width, height);
    return resolveBoardAfterInitialCycle(
        swapped,
        width,
        height,
        cursor,
        new Set(groups.flatMap(group => group.indices)),
        getSpecialCreations(groups, [swap.toIndex, swap.fromIndex]),
        new Map()
    );
}

function resolvePulseOnBoard(
    chips: readonly CircuitChip[],
    width: number,
    height: number,
    cellIndex: number,
    cursorState: ResolutionCursor
): BoardResolution {
    const x = cellIndex % width;
    const y = Math.floor(cellIndex / width);
    const affected = new Set<number>();
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
            const targetX = x + offsetX;
            const targetY = y + offsetY;
            if (targetX >= 0 && targetX < width && targetY >= 0 && targetY < height) {
                affected.add(targetY * width + targetX);
            }
        }
    }
    return resolveBoardAfterInitialCycle(
        chips,
        width,
        height,
        new CircuitRandomCursor(cursorState.randomState, cursorState.nextChipId),
        affected,
        [],
        new Map()
    );
}

function countRemainingBlockers(blockers: readonly number[]): number {
    return blockers.reduce((total, strength) => total + (strength > 0 ? 1 : 0), 0);
}

function clearAffectedBlockers(
    blockers: readonly number[],
    affectedIndices: readonly number[]
): {readonly blockers: readonly number[]; readonly cleared: number} {
    const next = [...blockers];
    let cleared = 0;
    for (const index of affectedIndices) {
        if (next[index]! > 0) {
            next[index] = Math.max(0, next[index]! - 1);
            if (next[index] === 0) cleared += 1;
        }
    }
    return {blockers: next, cleared};
}

function emptyEvent(kind: CircuitEventKind, message: string): CircuitModelEvent {
    return {
        kind,
        fromIndex: null,
        toIndex: null,
        affectedIndices: [],
        blockersCleared: 0,
        cascades: 0,
        specialsCreated: 0,
        specialKindsCreated: [],
        specialsActivated: 0,
        recoveredNoMoves: false,
        message
    };
}

function boardResolutionSignature(
    chips: readonly CircuitChip[],
    blockers: readonly number[],
    randomState: number
): string {
    return JSON.stringify({
        chips: chips.map(chip => [chip.color, chip.special]),
        blockers,
        randomState: randomState >>> 0
    });
}

export function canonicalCircuitSignature(state: CircuitPuzzleState): string {
    return boardResolutionSignature(state.chips, state.blockers, state.randomState);
}

function chooseWitnessCandidate(
    chips: readonly CircuitChip[],
    width: number,
    height: number,
    cursorState: ResolutionCursor,
    previouslyAffected: ReadonlySet<number>,
    tieSeed: number
): {readonly swap: CircuitSwap; readonly resolution: BoardResolution; readonly newIndices: readonly number[]} | null {
    const candidates = getLegalSwapsOnBoard(chips, width, height)
        .map(swap => {
            const resolution = resolveSwapOnBoard(chips, width, height, swap, cursorState);
            const newIndices = resolution.affectedIndices.filter(
                index => !previouslyAffected.has(index)
            );
            return {swap, resolution, newIndices};
        })
        .filter(candidate => candidate.newIndices.length > 0)
        .sort((first, second) => {
            const newDifference = second.newIndices.length - first.newIndices.length;
            if (newDifference !== 0) return newDifference;
            const cascadeDifference = second.resolution.cascades - first.resolution.cascades;
            if (cascadeDifference !== 0) return cascadeDifference;
            const firstRank = mixSeed(
                tieSeed,
                first.swap.fromIndex * width * height + first.swap.toIndex
            );
            const secondRank = mixSeed(
                tieSeed,
                second.swap.fromIndex * width * height + second.swap.toIndex
            );
            return firstRank - secondRank;
        });
    return candidates[0] ?? null;
}

function buildWitness(
    initialChips: readonly CircuitChip[],
    width: number,
    height: number,
    initialCursor: ResolutionCursor,
    moveCount: number,
    seed: number
): WitnessBuildResult | null {
    let chips = initialChips;
    let cursorState = initialCursor;
    const swaps: CircuitSwap[] = [];
    const blockerIndices: number[] = [];
    const previouslyAffected = new Set<number>();

    for (let moveIndex = 0; moveIndex < moveCount; moveIndex++) {
        const candidate = chooseWitnessCandidate(
            chips,
            width,
            height,
            cursorState,
            previouslyAffected,
            mixSeed(seed, moveIndex)
        );
        if (candidate === null) return null;

        const sortedNewIndices = [...candidate.newIndices].sort(
            (first, second) => mixSeed(seed ^ moveIndex, first)
                - mixSeed(seed ^ moveIndex, second)
        );
        blockerIndices.push(sortedNewIndices[0]!);
        for (const index of candidate.resolution.affectedIndices) {
            previouslyAffected.add(index);
        }
        swaps.push(candidate.swap);
        chips = candidate.resolution.chips;
        cursorState = {
            randomState: candidate.resolution.randomState,
            nextChipId: candidate.resolution.nextChipId
        };
    }

    return {
        finalChips: chips,
        swaps,
        blockerIndices,
        ...cursorState
    };
}

function createReplayState(state: CircuitPuzzleState): CircuitPuzzleState {
    return {
        ...state,
        chips: state.initialSnapshot.chips,
        blockers: state.initialSnapshot.blockers,
        blockersRemaining: countRemainingBlockers(state.initialSnapshot.blockers),
        movesRemaining: state.config.moveBudget,
        movesSpent: 0,
        score: 0,
        totalCascades: 0,
        totalChipsCleared: 0,
        totalSpecialsCreated: 0,
        totalSpecialsActivated: 0,
        noMoveRecoveries: 0,
        boosterCharges: state.config.initialBoosterCharges,
        lastHint: null,
        terminalStatus: 'active',
        failureReason: null,
        randomState: state.initialSnapshot.randomState,
        nextChipId: state.initialSnapshot.nextChipId,
        lastEvent: emptyEvent('generated', 'CERTIFICATE REPLAY')
    };
}

export function validateCircuitWitness(state: CircuitPuzzleState): CircuitWitnessValidation {
    let replay = createReplayState(state);
    for (const swap of state.certificate.swaps) {
        if (replay.terminalStatus !== 'active') break;
        replay = applyCircuitSwap(replay, swap.fromIndex, swap.toIndex);
    }
    const finalSignature = canonicalCircuitSignature(replay);
    const completed = replay.terminalStatus === 'success';
    const valid = completed
        && replay.movesSpent === state.certificate.requiredMoves
        && replay.movesSpent <= state.certificate.moveBudget
        && finalSignature === state.certificate.finalSignature;
    return {
        valid,
        completed,
        movesUsed: replay.movesSpent,
        finalSignature,
        message: valid
            ? `Certified in ${replay.movesSpent} moves.`
            : 'Stored Circuit Crush witness did not reproduce its certified result.'
    };
}

export function createCircuitPuzzle(
    random: RandomSource,
    config: CircuitPuzzleConfig = {}
): CircuitPuzzleState {
    const resolved = resolveConfig(config);
    const attemptNumber = config.attemptNumber ?? 1;
    if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
        throw new Error('Circuit attempt number must be a positive safe integer.');
    }
    const generationSeed = randomInteger(random, RANDOM_RANGE);

    for (
        let generationAttempt = 1;
        generationAttempt <= resolved.maxGenerationAttempts;
        generationAttempt++
    ) {
        const attemptSeed = mixSeed(generationSeed, generationAttempt);
        const stable = createStablePlayableBoard(
            attemptSeed,
            1,
            resolved.size,
            resolved.size
        );
        const witness = buildWitness(
            stable.chips,
            resolved.size,
            resolved.size,
            {
                randomState: stable.randomState,
                nextChipId: stable.nextChipId
            },
            resolved.witnessMoves,
            attemptSeed
        );
        if (witness === null) continue;

        const blockers = Array<number>(resolved.size * resolved.size).fill(0);
        for (const index of witness.blockerIndices) blockers[index] = 1;
        const emptyBlockers = blockers.map(() => 0);
        const certificate: CircuitSolvabilityCertificate = {
            swaps: witness.swaps,
            requiredMoves: witness.swaps.length,
            moveBudget: resolved.moveBudget,
            finalSignature: boardResolutionSignature(
                witness.finalChips,
                emptyBlockers,
                witness.randomState
            ),
            verified: false
        };
        const snapshot: CircuitInitialSnapshot = {
            chips: stable.chips,
            blockers,
            randomState: stable.randomState,
            nextChipId: stable.nextChipId
        };
        const provisional: CircuitPuzzleState = {
            config: resolved,
            width: resolved.size,
            height: resolved.size,
            chips: stable.chips,
            blockers,
            blockersRemaining: witness.blockerIndices.length,
            movesRemaining: resolved.moveBudget,
            movesSpent: 0,
            score: 0,
            totalCascades: 0,
            totalChipsCleared: 0,
            totalSpecialsCreated: 0,
            totalSpecialsActivated: 0,
            noMoveRecoveries: 0,
            boosterCharges: resolved.initialBoosterCharges,
            lastHint: null,
            terminalStatus: 'active',
            failureReason: null,
            generationSeed,
            generationAttempt,
            attemptNumber,
            randomState: stable.randomState,
            nextChipId: stable.nextChipId,
            certificate,
            initialSnapshot: snapshot,
            lastEvent: emptyEvent(
                'generated',
                `CIRCUIT ONLINE · CLEAR ${witness.blockerIndices.length} SHORTS`
            )
        };
        const validation = validateCircuitWitness(provisional);
        if (!validation.valid) continue;
        return {
            ...provisional,
            certificate: {...certificate, verified: true}
        };
    }

    throw new Error(
        `Unable to certify a Circuit Crush board after ${resolved.maxGenerationAttempts} attempts.`
    );
}

export function applyCircuitSwap(
    state: CircuitPuzzleState,
    fromIndex: number,
    toIndex: number
): CircuitPuzzleState {
    if (state.terminalStatus !== 'active') {
        return {
            ...state,
            lastEvent: emptyEvent('ignored', 'ATTEMPT ALREADY COMPLETE')
        };
    }
    const swap = {fromIndex, toIndex};
    const resolution = resolveSwapOnBoard(
        state.chips,
        state.width,
        state.height,
        swap,
        {randomState: state.randomState, nextChipId: state.nextChipId}
    );
    if (!resolution.valid) {
        return {
            ...state,
            lastHint: null,
            lastEvent: {
                ...emptyEvent('invalid-swap', 'NO CIRCUIT FORMED · MOVE PRESERVED'),
                fromIndex,
                toIndex
            }
        };
    }

    const blockerResult = clearAffectedBlockers(state.blockers, resolution.affectedIndices);
    const blockersRemaining = countRemainingBlockers(blockerResult.blockers);
    const movesRemaining = Math.max(0, state.movesRemaining - 1);
    const terminalStatus: CircuitTerminalStatus = blockersRemaining === 0
        ? 'success'
        : movesRemaining === 0
            ? 'failure'
            : 'active';
    const failureReason: CircuitFailureReason =
        terminalStatus === 'failure' ? 'moves-exhausted' : null;
    const eventKind: CircuitEventKind = terminalStatus === 'success'
        ? 'success'
        : terminalStatus === 'failure'
            ? 'failure'
            : 'swap-resolved';
    const scoreGain = resolution.chipsRemoved * 25
        + blockerResult.cleared * 250
        + Math.max(0, resolution.cascades - 1) * 100
        + resolution.specialsCreated * 125
        + resolution.specialsActivated * 100;

    return {
        ...state,
        chips: resolution.chips,
        blockers: blockerResult.blockers,
        blockersRemaining,
        movesRemaining,
        movesSpent: state.movesSpent + 1,
        score: state.score + scoreGain,
        totalCascades: state.totalCascades + resolution.cascades,
        totalChipsCleared: state.totalChipsCleared + resolution.chipsRemoved,
        totalSpecialsCreated: state.totalSpecialsCreated + resolution.specialsCreated,
        totalSpecialsActivated: state.totalSpecialsActivated + resolution.specialsActivated,
        noMoveRecoveries: state.noMoveRecoveries + (resolution.recoveredNoMoves ? 1 : 0),
        lastHint: null,
        terminalStatus,
        failureReason,
        randomState: resolution.randomState,
        nextChipId: resolution.nextChipId,
        lastEvent: {
            kind: eventKind,
            fromIndex,
            toIndex,
            affectedIndices: resolution.affectedIndices,
            blockersCleared: blockerResult.cleared,
            cascades: resolution.cascades,
            specialsCreated: resolution.specialsCreated,
            specialKindsCreated: resolution.specialKindsCreated,
            specialsActivated: resolution.specialsActivated,
            recoveredNoMoves: resolution.recoveredNoMoves,
            message: terminalStatus === 'success'
                ? 'ALL SHORT CIRCUITS CLEARED'
                : terminalStatus === 'failure'
                    ? 'OUT OF MOVES'
                    : resolution.recoveredNoMoves
                        ? 'NO SIGNAL PATHS · BOARD REROUTED'
                        : blockerResult.cleared > 0
                            ? `SHORT CIRCUITS -${blockerResult.cleared}`
                            : `CASCADE x${resolution.cascades}`
        }
    };
}

function projectHint(state: CircuitPuzzleState, swap: CircuitSwap): CircuitHint {
    const resolution = resolveSwapOnBoard(
        state.chips,
        state.width,
        state.height,
        swap,
        {randomState: state.randomState, nextChipId: state.nextChipId}
    );
    const blockers = new Set(
        state.blockers
            .map((strength, index) => strength > 0 ? index : -1)
            .filter(index => index >= 0)
    );
    return {
        swap,
        projectedBlockersCleared: resolution.affectedIndices
            .filter(index => blockers.has(index)).length,
        projectedChipsCleared: resolution.chipsRemoved,
        projectedCascades: resolution.cascades,
        projectedSpecialsCreated: resolution.specialsCreated
    };
}

export function getCircuitHint(state: CircuitPuzzleState): CircuitHint | null {
    if (state.terminalStatus !== 'active') return null;
    const hints = getCircuitLegalSwaps(state)
        .map(swap => projectHint(state, swap))
        .sort((first, second) => {
            const blockerDifference =
                second.projectedBlockersCleared - first.projectedBlockersCleared;
            if (blockerDifference !== 0) return blockerDifference;
            const clearDifference =
                second.projectedChipsCleared - first.projectedChipsCleared;
            if (clearDifference !== 0) return clearDifference;
            const cascadeDifference =
                second.projectedCascades - first.projectedCascades;
            if (cascadeDifference !== 0) return cascadeDifference;
            const specialDifference =
                second.projectedSpecialsCreated - first.projectedSpecialsCreated;
            if (specialDifference !== 0) return specialDifference;
            return first.swap.fromIndex - second.swap.fromIndex
                || first.swap.toIndex - second.swap.toIndex;
        });
    return hints[0] ?? null;
}

function consumeBooster(
    charges: CircuitBoosterCharges,
    key: keyof CircuitBoosterCharges
): CircuitBoosterCharges {
    return {...charges, [key]: Math.max(0, charges[key] - 1)};
}

function unavailableBooster(state: CircuitPuzzleState, message: string): CircuitPuzzleState {
    return {
        ...state,
        lastEvent: emptyEvent('booster-unavailable', message)
    };
}

function shuffledState(
    state: CircuitPuzzleState,
    eventKind: 'booster-shuffle' | 'no-move-shuffle',
    consumeCharge: boolean
): CircuitPuzzleState {
    const stable = createStablePlayableBoard(
        state.randomState,
        state.nextChipId,
        state.width,
        state.height
    );
    return {
        ...state,
        chips: stable.chips,
        randomState: stable.randomState,
        nextChipId: stable.nextChipId,
        noMoveRecoveries: state.noMoveRecoveries + (eventKind === 'no-move-shuffle' ? 1 : 0),
        boosterCharges: consumeCharge
            ? consumeBooster(state.boosterCharges, 'shuffles')
            : state.boosterCharges,
        lastHint: null,
        lastEvent: emptyEvent(
            eventKind,
            eventKind === 'booster-shuffle'
                ? 'CIRCUIT BOARD REROUTED'
                : 'NO SIGNAL PATHS · BOARD REROUTED'
        )
    };
}

export function ensureCircuitPlayable(state: CircuitPuzzleState): CircuitPuzzleState {
    if (state.terminalStatus !== 'active'
        || getLegalSwapsOnBoard(state.chips, state.width, state.height).length > 0) {
        return state;
    }
    return shuffledState(state, 'no-move-shuffle', false);
}

export function activateCircuitBooster(
    state: CircuitPuzzleState,
    action: CircuitBoosterAction
): CircuitPuzzleState {
    if (state.terminalStatus !== 'active') {
        return {
            ...state,
            lastEvent: emptyEvent('ignored', 'ATTEMPT ALREADY COMPLETE')
        };
    }

    if (action.kind === 'extra-moves') {
        if (state.boosterCharges.extraMoves <= 0) {
            return unavailableBooster(state, 'NO OVERCLOCK CHARGES');
        }
        return {
            ...state,
            movesRemaining: state.movesRemaining + state.config.extraMoveAmount,
            boosterCharges: consumeBooster(state.boosterCharges, 'extraMoves'),
            lastEvent: emptyEvent(
                'booster-extra-moves',
                `OVERCLOCK +${state.config.extraMoveAmount} MOVES`
            )
        };
    }

    if (action.kind === 'hint') {
        if (state.boosterCharges.hints <= 0) {
            return unavailableBooster(state, 'NO TRACE CHARGES');
        }
        const hint = getCircuitHint(state);
        return {
            ...state,
            boosterCharges: consumeBooster(state.boosterCharges, 'hints'),
            lastHint: hint,
            lastEvent: {
                ...emptyEvent(
                    'booster-hint',
                    hint === null
                        ? 'NO TRACE FOUND'
                        : `TRACE ${hint.swap.fromIndex} → ${hint.swap.toIndex}`
                ),
                fromIndex: hint?.swap.fromIndex ?? null,
                toIndex: hint?.swap.toIndex ?? null
            }
        };
    }

    if (action.kind === 'shuffle') {
        if (state.boosterCharges.shuffles <= 0) {
            return unavailableBooster(state, 'NO REROUTE CHARGES');
        }
        return shuffledState(state, 'booster-shuffle', true);
    }

    if (state.boosterCharges.pulses <= 0) {
        return unavailableBooster(state, 'NO PULSE CHARGES');
    }
    if (!inBounds(action.cellIndex, state.width * state.height)) {
        return unavailableBooster(state, 'PULSE TARGET OUT OF RANGE');
    }
    const resolution = resolvePulseOnBoard(
        state.chips,
        state.width,
        state.height,
        action.cellIndex,
        {randomState: state.randomState, nextChipId: state.nextChipId}
    );
    const blockerResult = clearAffectedBlockers(state.blockers, resolution.affectedIndices);
    const blockersRemaining = countRemainingBlockers(blockerResult.blockers);
    const terminalStatus: CircuitTerminalStatus =
        blockersRemaining === 0 ? 'success' : 'active';
    return {
        ...state,
        chips: resolution.chips,
        blockers: blockerResult.blockers,
        blockersRemaining,
        score: state.score
            + resolution.chipsRemoved * 25
            + blockerResult.cleared * 250
            + resolution.specialsActivated * 100,
        totalCascades: state.totalCascades + resolution.cascades,
        totalChipsCleared: state.totalChipsCleared + resolution.chipsRemoved,
        totalSpecialsCreated: state.totalSpecialsCreated + resolution.specialsCreated,
        totalSpecialsActivated: state.totalSpecialsActivated + resolution.specialsActivated,
        noMoveRecoveries: state.noMoveRecoveries + (resolution.recoveredNoMoves ? 1 : 0),
        boosterCharges: consumeBooster(state.boosterCharges, 'pulses'),
        lastHint: null,
        terminalStatus,
        failureReason: null,
        randomState: resolution.randomState,
        nextChipId: resolution.nextChipId,
        lastEvent: {
            kind: terminalStatus === 'success' ? 'success' : 'booster-pulse',
            fromIndex: action.cellIndex,
            toIndex: null,
            affectedIndices: resolution.affectedIndices,
            blockersCleared: blockerResult.cleared,
            cascades: resolution.cascades,
            specialsCreated: resolution.specialsCreated,
            specialKindsCreated: resolution.specialKindsCreated,
            specialsActivated: resolution.specialsActivated,
            recoveredNoMoves: resolution.recoveredNoMoves,
            message: terminalStatus === 'success'
                ? 'ALL SHORT CIRCUITS CLEARED'
                : `TARGETED PULSE · SHORTS -${blockerResult.cleared}`
        }
    };
}

export function retryCircuitPuzzle(
    state: CircuitPuzzleState,
    random: RandomSource
): CircuitPuzzleState {
    return createCircuitPuzzle(random, {
        size: state.config.size,
        moveBudget: state.config.moveBudget,
        witnessMoves: state.config.witnessMoves,
        extraMoveAmount: state.config.extraMoveAmount,
        boosterCharges: state.config.initialBoosterCharges,
        maxGenerationAttempts: state.config.maxGenerationAttempts,
        attemptNumber: state.attemptNumber + 1
    });
}

export function validateCircuitPuzzle(state: CircuitPuzzleState): CircuitValidationResult {
    const reasons: string[] = [];
    const expectedCellCount = state.width * state.height;
    if (state.width !== state.height || (state.width !== 7 && state.width !== 8)) {
        reasons.push('Board dimensions must be square and either 7x7 or 8x8.');
    }
    if (state.chips.length !== expectedCellCount
        || state.blockers.length !== expectedCellCount) {
        reasons.push('Chip and blocker arrays must match the board dimensions.');
    }
    if (state.blockersRemaining !== countRemainingBlockers(state.blockers)) {
        reasons.push('Blocker telemetry does not match the blocker overlay.');
    }
    const automaticMatchCount = state.chips.length === expectedCellCount
        ? findMatchRuns(state.chips, state.width, state.height)
            .reduce((total, run) => total + run.indices.length, 0)
        : 0;
    if (state.terminalStatus === 'active' && automaticMatchCount > 0) {
        reasons.push('An active board contains an unresolved automatic match.');
    }
    const legalMoveCount = state.chips.length === expectedCellCount
        ? getLegalSwapsOnBoard(state.chips, state.width, state.height).length
        : 0;
    if (state.terminalStatus === 'active' && legalMoveCount === 0) {
        reasons.push('An active board has no legal swap.');
    }
    if (state.terminalStatus === 'success' && state.blockersRemaining !== 0) {
        reasons.push('A successful board still contains short circuits.');
    }
    if (state.terminalStatus === 'failure'
        && (state.movesRemaining !== 0 || state.blockersRemaining === 0)) {
        reasons.push('Failure is only valid at zero moves with blockers remaining.');
    }
    if (state.certificate.requiredMoves > state.certificate.moveBudget) {
        reasons.push('The solvability certificate exceeds the move budget.');
    }
    return {
        valid: reasons.length === 0,
        reasons,
        automaticMatchCount,
        legalMoveCount
    };
}

export function getCircuitProgress(state: CircuitPuzzleState): number {
    const initialBlockers = countRemainingBlockers(state.initialSnapshot.blockers);
    if (initialBlockers === 0) return 1;
    return clamp(1 - state.blockersRemaining / initialBlockers, 0, 1);
}
