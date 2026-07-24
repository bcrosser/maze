import {randomInteger, shuffle, type RandomSource} from '../../domain/random/random-source';
import type {DifficultyPreset} from '../../encounters/contracts';

export const LOCK_LEVELS = [0, 1, 2, 3] as const;
export type LockLevel = (typeof LOCK_LEVELS)[number];

export type LockFeedback =
    | 'idle'
    | 'springy'
    | 'loose'
    | 'binding'
    | 'jammed'
    | 'set'
    | 'turn-ready'
    | 'set-all-pins-first'
    | 'opened'
    | 'failed'
    // Kept for source compatibility with the version 0.2 probe API.
    | 'slipping';

export type LockStatus = 'active' | 'opened' | 'failed';
export type LockFailureReason = 'alarm' | 'integrity' | null;

export interface LockPuzzleConfig {
    readonly difficulty: DifficultyPreset;
    readonly levelTier?: number;
    readonly pinCount?: number;
}

export interface ResolvedLockPuzzleConfig {
    readonly difficulty: DifficultyPreset;
    readonly levelTier: number;
    readonly pinCount: number;
    readonly maximumIntegrity: number;
    readonly alarmWindowMs: number;
    readonly tensionBandWidth: number;
    readonly setTolerance: number;
}

export interface LockTensionBand {
    readonly center: number;
    readonly minimum: number;
    readonly maximum: number;
}

export interface LockPin {
    readonly targetHeight: number;
    readonly height: number;
    readonly set: boolean;
    readonly bindingRank: number;
}

export interface PinTensionLock {
    readonly config: ResolvedLockPuzzleConfig;
    readonly pins: readonly LockPin[];
    readonly bindingOrder: readonly number[];
    readonly tensionBands: readonly LockTensionBand[];
    readonly setHistory: readonly number[];
    readonly selectedPinIndex: number;
    readonly pickHeight: number;
    readonly tension: number;
    readonly integrity: number;
    readonly alarm: number;
    readonly activeElapsedMs: number;
    readonly jams: number;
    readonly slipsOrSpringyAttempts: number;
    readonly droppedPins: number;
    readonly feedback: LockFeedback;
    readonly status: LockStatus;
    readonly failureReason: LockFailureReason;
    readonly paused: boolean;
    readonly cylinderRotation: number;
    /**
     * Compatibility value for version 0.2 callers. It identifies the nearest
     * coarse tension stop for the first band; game logic uses tensionBands.
     */
    readonly requiredTension: Exclude<LockLevel, 0>;
    /** Compatibility counters. Scoring does not use these values. */
    readonly turns: number;
    readonly mistakes: number;
}

export interface ReleaseLockPickResult {
    readonly state: PinTensionLock;
    readonly feedback: LockFeedback;
    readonly completed: boolean;
}

export type ProbeLockResult = ReleaseLockPickResult;

const BASE_CONFIGS: Readonly<Record<DifficultyPreset, {
    readonly pinCount: number;
    readonly maximumIntegrity: number;
    readonly alarmWindowMs: number;
    readonly tensionBandWidth: number;
    readonly setTolerance: number;
}>> = Object.freeze({
    story: Object.freeze({
        pinCount: 4,
        maximumIntegrity: 7,
        alarmWindowMs: 120_000,
        tensionBandWidth: 0.24,
        setTolerance: 0.08
    }),
    standard: Object.freeze({
        pinCount: 5,
        maximumIntegrity: 5,
        alarmWindowMs: 90_000,
        tensionBandWidth: 0.18,
        setTolerance: 0.06
    }),
    expert: Object.freeze({
        pinCount: 6,
        maximumIntegrity: 4,
        alarmWindowMs: 70_000,
        tensionBandWidth: 0.13,
        setTolerance: 0.05
    })
});

const COARSE_TENSION_CENTERS = [1 / 6, 1 / 2, 5 / 6] as const;
const MINIMUM_TARGET_HEIGHT = 0.3;
const MAXIMUM_TARGET_HEIGHT = 0.86;
const TIME_SUBSTEP_MS = 16;

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, places = 6): number {
    const scale = 10 ** places;
    return Math.round(value * scale) / scale;
}

function assertNormalized(value: number, label: string): void {
    if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
}

function randomUnit(random: RandomSource): number {
    const value = random.next();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new Error('RandomSource.next() must return a number in [0, 1).');
    }
    return value;
}

function resolveLevelTier(levelTier: number | undefined): number {
    if (levelTier === undefined) return 0;
    if (!Number.isSafeInteger(levelTier)) {
        throw new Error('Lock level tier must be a safe integer.');
    }
    return clamp(levelTier, 0, 5);
}

export function resolveLockPuzzleConfig(config: LockPuzzleConfig): ResolvedLockPuzzleConfig {
    const base = BASE_CONFIGS[config.difficulty];
    const levelTier = resolveLevelTier(config.levelTier);
    const tierRatio = levelTier / 5;
    const tierPin = levelTier >= 3 && config.difficulty !== 'expert' ? 1 : 0;
    const pinCount = config.pinCount ?? base.pinCount + tierPin;

    if (!Number.isSafeInteger(pinCount) || pinCount < 4 || pinCount > 6) {
        throw new Error('Pin-tension locks require between four and six pins.');
    }

    return {
        difficulty: config.difficulty,
        levelTier,
        pinCount,
        maximumIntegrity: base.maximumIntegrity,
        // At tier five the alarm fills exactly 20% faster.
        alarmWindowMs: round(base.alarmWindowMs / (1 + 0.2 * tierRatio)),
        tensionBandWidth: round(base.tensionBandWidth * (1 - 0.2 * tierRatio)),
        setTolerance: base.setTolerance
    };
}

function createTensionBand(center: number, width: number): LockTensionBand {
    const halfWidth = width / 2;
    const clampedCenter = clamp(center, halfWidth, 1 - halfWidth);
    return {
        center: round(clampedCenter),
        minimum: round(clampedCenter - halfWidth),
        maximum: round(clampedCenter + halfWidth)
    };
}

function coarseTensionLevel(center: number): Exclude<LockLevel, 0> {
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < COARSE_TENSION_CENTERS.length; index++) {
        const distance = Math.abs(center - COARSE_TENSION_CENTERS[index]!);
        if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = index;
        }
    }
    return (closestIndex + 1) as Exclude<LockLevel, 0>;
}

function createTensionBands(
    random: RandomSource,
    pinCount: number,
    width: number
): readonly LockTensionBand[] {
    const firstCenter = COARSE_TENSION_CENTERS[randomInteger(random, COARSE_TENSION_CENTERS.length)]!;
    const bands: LockTensionBand[] = [createTensionBand(firstCenter, width)];
    let previousCenter = firstCenter;

    for (let index = 1; index < pinCount; index++) {
        const magnitude = 0.025 + randomUnit(random) * 0.035;
        let direction = randomUnit(random) < 0.5 ? -1 : 1;
        const halfWidth = width / 2;
        if (previousCenter + direction * magnitude < halfWidth ||
            previousCenter + direction * magnitude > 1 - halfWidth) {
            direction *= -1;
        }
        previousCenter = clamp(previousCenter + direction * magnitude, halfWidth, 1 - halfWidth);
        bands.push(createTensionBand(previousCenter, width));
    }

    return bands;
}

export function createLockPuzzle(
    random: RandomSource,
    config: LockPuzzleConfig
): PinTensionLock {
    const resolved = resolveLockPuzzleConfig(config);
    const bindingOrder = shuffle(
        Array.from({length: resolved.pinCount}, (_, index) => index),
        random
    );
    const rankByPin = new Map(bindingOrder.map((pinIndex, rank) => [pinIndex, rank]));
    const targetHeightBands = shuffle(
        Array.from({length: resolved.pinCount}, (_, index) => index),
        random
    );
    const pins = Array.from({length: resolved.pinCount}, (_, pinIndex): LockPin => ({
        targetHeight: round(
            MINIMUM_TARGET_HEIGHT +
            (
                (
                    targetHeightBands[pinIndex]! +
                    0.35 +
                    randomUnit(random) * 0.3
                ) / resolved.pinCount
            ) *
            (MAXIMUM_TARGET_HEIGHT - MINIMUM_TARGET_HEIGHT)
        ),
        height: 0,
        set: false,
        bindingRank: rankByPin.get(pinIndex) ?? 0
    }));
    const tensionBands = createTensionBands(
        random,
        resolved.pinCount,
        resolved.tensionBandWidth
    );

    return {
        config: resolved,
        pins,
        bindingOrder,
        tensionBands,
        setHistory: [],
        selectedPinIndex: bindingOrder[0] ?? 0,
        pickHeight: 0,
        tension: 0,
        integrity: resolved.maximumIntegrity,
        alarm: 0,
        activeElapsedMs: 0,
        jams: 0,
        slipsOrSpringyAttempts: 0,
        droppedPins: 0,
        feedback: 'idle',
        status: 'active',
        failureReason: null,
        paused: false,
        cylinderRotation: 0,
        requiredTension: coarseTensionLevel(tensionBands[0]?.center ?? 0.5),
        turns: 0,
        mistakes: 0
    };
}

export function createLockPuzzleForFamily(
    random: RandomSource,
    lockFamily: string,
    config: LockPuzzleConfig
): PinTensionLock {
    if (lockFamily !== 'pin-tension') {
        throw new Error(`Unsupported lock family: ${lockFamily}.`);
    }
    return createLockPuzzle(random, config);
}

/**
 * Backward-compatible factory name. New code should pass a full configuration
 * to createLockPuzzle.
 */
export function createPinTensionLock(
    random: RandomSource,
    pinCount?: number
): PinTensionLock {
    return createLockPuzzle(random, {
        difficulty: 'standard',
        ...(pinCount === undefined ? {} : {pinCount})
    });
}

export function getCurrentBindingPinIndex(state: PinTensionLock): number | null {
    for (const pinIndex of state.bindingOrder) {
        if (!state.pins[pinIndex]?.set) return pinIndex;
    }
    return null;
}

export function getCurrentTensionBand(state: PinTensionLock): LockTensionBand | null {
    const bindingPin = getCurrentBindingPinIndex(state);
    if (bindingPin === null) return null;
    const rank = state.pins[bindingPin]?.bindingRank;
    return rank === undefined ? null : state.tensionBands[rank] ?? null;
}

function tensionPosition(
    tension: number,
    band: LockTensionBand
): 'low' | 'valid' | 'high' {
    if (tension < band.minimum) return 'low';
    if (tension > band.maximum) return 'high';
    return 'valid';
}

function previewFeedback(
    state: PinTensionLock,
    pinIndex: number
): LockFeedback {
    const pin = state.pins[pinIndex];
    if (!pin) throw new Error(`Unknown lock pin index: ${pinIndex}.`);
    if (pin.set) return 'set';

    const band = getCurrentTensionBand(state);
    const bindingPin = getCurrentBindingPinIndex(state);
    if (!band || bindingPin === null) return 'turn-ready';

    const position = tensionPosition(state.tension, band);
    if (position === 'high') return 'jammed';
    if (pinIndex !== bindingPin) return 'springy';
    if (position === 'low') return 'loose';
    return 'binding';
}

export function setLockTension(
    state: PinTensionLock,
    tension: number
): PinTensionLock {
    assertNormalized(tension, 'Lock tension');
    if (state.status !== 'active') return state;
    const nextTension = round(clamp(tension, 0, 1));
    if (state.tension === nextTension) return state;
    const nextState = {
        ...state,
        tension: nextTension,
        turns: state.turns + 1
    };
    return {
        ...nextState,
        feedback: previewFeedback(nextState, nextState.selectedPinIndex)
    };
}

export function moveLockPick(
    state: PinTensionLock,
    pinIndex: number,
    height: number
): PinTensionLock {
    assertNormalized(height, 'Lock pick height');
    const pin = state.pins[pinIndex];
    if (!pin) throw new Error(`Unknown lock pin index: ${pinIndex}.`);
    if (state.status !== 'active') return state;

    const pickHeight = pin.set ? pin.targetHeight : round(clamp(height, 0, 1));
    const pins = [...state.pins];
    pins[pinIndex] = pin.set ? pin : {...pin, height: pickHeight};
    const nextState = {
        ...state,
        pins,
        selectedPinIndex: pinIndex,
        pickHeight
    };
    return {...nextState, feedback: previewFeedback(nextState, pinIndex)};
}

function resetPin(
    pins: readonly LockPin[],
    pinIndex: number
): readonly LockPin[] {
    const pin = pins[pinIndex];
    if (!pin || pin.set) return pins;
    const nextPins = [...pins];
    nextPins[pinIndex] = {...pin, height: 0};
    return nextPins;
}

function dropLatestSetPin(state: PinTensionLock): {
    readonly pins: readonly LockPin[];
    readonly setHistory: readonly number[];
    readonly dropped: boolean;
} {
    const droppedIndex = state.setHistory.at(-1);
    if (droppedIndex === undefined) {
        return {pins: state.pins, setHistory: state.setHistory, dropped: false};
    }
    const pin = state.pins[droppedIndex];
    if (!pin) return {pins: state.pins, setHistory: state.setHistory, dropped: false};
    const pins = [...state.pins];
    pins[droppedIndex] = {...pin, height: 0, set: false};
    return {
        pins,
        setHistory: state.setHistory.slice(0, -1),
        dropped: true
    };
}

function shouldDropPin(difficulty: DifficultyPreset, jamCount: number): boolean {
    if (difficulty === 'story') return false;
    if (difficulty === 'expert') return true;
    return jamCount % 2 === 0;
}

function withFailureIfNeeded(state: PinTensionLock): PinTensionLock {
    if (state.integrity <= 0) {
        return {
            ...state,
            integrity: 0,
            feedback: 'failed',
            status: 'failed',
            failureReason: 'integrity'
        };
    }
    if (state.alarm >= 100) {
        return {
            ...state,
            alarm: 100,
            feedback: 'failed',
            status: 'failed',
            failureReason: 'alarm'
        };
    }
    return state;
}

export function releaseLockPick(state: PinTensionLock): ReleaseLockPickResult {
    if (state.status !== 'active') {
        return {
            state,
            feedback: state.feedback,
            completed: state.status === 'opened'
        };
    }

    const pinIndex = state.selectedPinIndex;
    const pin = state.pins[pinIndex];
    if (!pin) throw new Error(`Unknown lock pin index: ${pinIndex}.`);
    if (pin.set) {
        return {
            state: {...state, feedback: 'set'},
            feedback: 'set',
            completed: false
        };
    }

    const bindingPin = getCurrentBindingPinIndex(state);
    const band = getCurrentTensionBand(state);
    if (bindingPin === null || !band) {
        const ready = {...state, feedback: 'turn-ready' as const};
        return {state: ready, feedback: ready.feedback, completed: false};
    }

    const position = tensionPosition(state.tension, band);
    let nextState: PinTensionLock;
    let feedback: LockFeedback;

    // Resolution precedence is deliberately explicit and mutually exclusive.
    if (position === 'high') {
        const jams = state.jams + 1;
        const drop = shouldDropPin(state.config.difficulty, jams)
            ? dropLatestSetPin(state)
            : {pins: state.pins, setHistory: state.setHistory, dropped: false};
        nextState = {
            ...state,
            pins: resetPin(drop.pins, pinIndex),
            setHistory: drop.setHistory,
            integrity: state.integrity - 1,
            alarm: Math.min(100, state.alarm + 15),
            jams,
            droppedPins: state.droppedPins + (drop.dropped ? 1 : 0),
            feedback: 'jammed',
            pickHeight: 0,
            turns: state.turns + 1,
            mistakes: state.mistakes + 1
        };
        feedback = 'jammed';
    } else if (pinIndex !== bindingPin) {
        nextState = {
            ...state,
            pins: resetPin(state.pins, pinIndex),
            alarm: Math.min(100, state.alarm + 3),
            slipsOrSpringyAttempts: state.slipsOrSpringyAttempts + 1,
            feedback: 'springy',
            pickHeight: 0,
            turns: state.turns + 1,
            mistakes: state.mistakes + 1
        };
        feedback = 'springy';
    } else if (position === 'low') {
        nextState = {
            ...state,
            pins: resetPin(state.pins, pinIndex),
            alarm: Math.min(100, state.alarm + 3),
            slipsOrSpringyAttempts: state.slipsOrSpringyAttempts + 1,
            feedback: 'loose',
            pickHeight: 0,
            turns: state.turns + 1,
            mistakes: state.mistakes + 1
        };
        feedback = 'loose';
    } else if (
        Math.abs(pin.height - pin.targetHeight) <= state.config.setTolerance + Number.EPSILON * 8
    ) {
        const pins = [...state.pins];
        pins[pinIndex] = {...pin, height: pin.targetHeight, set: true};
        const allSet = pins.every(candidate => candidate.set);
        const nextBindingPin = allSet
            ? pinIndex
            : state.bindingOrder.find(candidate => !pins[candidate]?.set) ?? pinIndex;
        nextState = {
            ...state,
            pins,
            setHistory: [...state.setHistory, pinIndex],
            selectedPinIndex: nextBindingPin,
            feedback: allSet ? 'turn-ready' : 'set',
            pickHeight: allSet ? pin.targetHeight : 0,
            turns: state.turns + 1,
            cylinderRotation: round((state.setHistory.length + 1) / state.pins.length * 0.2)
        };
        feedback = allSet ? 'turn-ready' : 'set';
    } else {
        nextState = {
            ...state,
            pins: resetPin(state.pins, pinIndex),
            feedback: 'binding',
            pickHeight: 0,
            turns: state.turns + 1
        };
        feedback = 'binding';
    }

    nextState = withFailureIfNeeded(nextState);
    return {
        state: nextState,
        feedback: nextState.status === 'failed' ? 'failed' : feedback,
        completed: false
    };
}

/**
 * Compatibility helper for the old tap-to-cycle API. It now performs a real
 * pick move and release, so all modern alarm and binding-order rules apply.
 */
export function probeLockPin(state: PinTensionLock, pinIndex: number): ProbeLockResult {
    const pin = state.pins[pinIndex];
    if (!pin) throw new Error(`Unknown lock pin index: ${pinIndex}.`);
    const nextHeight = pin.set ? pin.targetHeight : round((pin.height + 1 / 3) % (4 / 3));
    const result = releaseLockPick(moveLockPick(state, pinIndex, nextHeight));
    return {
        ...result,
        feedback: result.feedback === 'loose' ? 'slipping' : result.feedback
    };
}

export function setLockPaused(state: PinTensionLock, paused: boolean): PinTensionLock {
    if (state.status !== 'active' || state.paused === paused) return state;
    return {...state, paused};
}

export function advanceLockTime(
    state: PinTensionLock,
    deltaMs: number
): PinTensionLock {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
        throw new Error('Lock time delta must be a finite non-negative number.');
    }
    if (deltaMs === 0 || state.paused || state.status !== 'active') return state;

    let remainingMs = deltaMs;
    let elapsedMs = state.activeElapsedMs;
    const alarmPerMs = 100 / state.config.alarmWindowMs;
    const actionAlarm = Math.min(
        100,
        state.jams * 15 + state.slipsOrSpringyAttempts * 3
    );
    let alarm = Math.min(100, actionAlarm + elapsedMs * alarmPerMs);

    while (remainingMs > 0 && alarm < 100) {
        const substepMs = Math.min(TIME_SUBSTEP_MS, remainingMs);
        const untilAlarmMs = (100 - alarm) / alarmPerMs;
        const consumedMs = Math.min(substepMs, untilAlarmMs);
        elapsedMs += consumedMs;
        // Re-derive from total active time so batching frames cannot accumulate
        // floating-point drift differently from one large clock advance.
        alarm = Math.min(100, actionAlarm + elapsedMs * alarmPerMs);
        remainingMs -= consumedMs;
    }

    return withFailureIfNeeded({
        ...state,
        activeElapsedMs: round(elapsedMs),
        alarm: round(alarm)
    });
}

export function turnLockCylinder(state: PinTensionLock): PinTensionLock {
    if (state.status !== 'active') return state;
    if (!state.pins.every(pin => pin.set)) {
        return {...state, feedback: 'set-all-pins-first'};
    }
    return {
        ...state,
        feedback: 'opened',
        status: 'opened',
        cylinderRotation: 1
    };
}

export function gradeLock(state: PinTensionLock): 's' | 'a' | 'b' | 'c' | 'none' {
    if (state.status !== 'opened') return 'none';
    if (state.integrity >= 4 && state.alarm < 25 && state.activeElapsedMs < 45_000) return 's';
    if (state.integrity >= 3 && state.alarm < 50) return 'a';
    if (state.integrity >= 1 && state.alarm < 80) return 'b';
    return 'c';
}

export function scoreLock(state: PinTensionLock): number {
    if (state.status !== 'opened') return 0;
    return Math.max(
        500,
        4_000 -
        Math.floor(state.activeElapsedMs / 25) -
        350 * state.jams -
        100 * state.slipsOrSpringyAttempts -
        250 * state.droppedPins
    );
}
