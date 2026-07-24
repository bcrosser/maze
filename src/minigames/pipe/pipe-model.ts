import {
    randomInteger,
    shuffle,
    type RandomSource
} from '../../domain/random/random-source';

export const PIPE_DIRECTIONS = ['up', 'right', 'down', 'left'] as const;
export const PIPE_TILE_KINDS = [
    'empty',
    'obstacle',
    'source',
    'sink',
    'straight',
    'corner'
] as const;
export const PIPE_PIECE_KINDS = ['straight', 'corner'] as const;
export const PIPE_DIFFICULTIES = ['story', 'standard', 'expert'] as const;
export const PIPE_FINISHED_FLOW_MULTIPLIER = 4;

export type PipeDirection = (typeof PIPE_DIRECTIONS)[number];
export type PipeTileKind = (typeof PIPE_TILE_KINDS)[number];
export type PipePieceKind = (typeof PIPE_PIECE_KINDS)[number];
export type PipeDifficulty = (typeof PIPE_DIFFICULTIES)[number];
export type PipeRotation = 0 | 1 | 2 | 3;
export type PipeTerminalStatus = 'active' | 'success' | 'failure';
export type PipeFailureReason =
    | 'empty'
    | 'mismatch'
    | 'obstacle'
    | 'edge'
    | 'pressure-loop';

export interface PipeTile {
    readonly kind: PipeTileKind;
    readonly rotation: PipeRotation;
    readonly locked: boolean;
}

export interface PipeBoard {
    readonly width: number;
    readonly height: number;
    readonly tiles: readonly PipeTile[];
    readonly turns: number;
}

export interface PipeQueuePiece {
    readonly id: string;
    readonly kind: PipePieceKind;
    readonly rotation: PipeRotation;
    readonly role: 'required' | 'decoy' | 'recovery';
}

export interface PipeWitnessPlacement {
    readonly queueIndex: number;
    readonly cellIndex: number;
}

export interface PipeWitness {
    readonly placements: readonly PipeWitnessPlacement[];
    readonly cadenceMs: number;
    readonly completionTimeMs: number;
}

export interface PipePuzzleConfig {
    readonly difficulty: PipeDifficulty;
    readonly graceMs?: number;
    readonly stepMs?: number;
    readonly witnessCadenceMs?: number;
    readonly maxGenerationAttempts?: number;
}

export interface ResolvedPipePuzzleConfig {
    readonly difficulty: PipeDifficulty;
    readonly width: number;
    readonly height: number;
    readonly routeMinimum: number;
    readonly routeMaximum: number;
    readonly obstacleMinimum: number;
    readonly obstacleMaximum: number;
    readonly maximumDecoyShare: number;
    readonly graceMs: number;
    readonly stepMs: number;
    readonly witnessCadenceMs: number;
    readonly maxGenerationAttempts: number;
}

export interface PipeModelEvent {
    readonly kind:
        | 'none'
        | 'placed'
        | 'overwritten'
        | 'blocked'
        | 'flow-advanced'
        | 'success'
        | 'failure'
        | 'paused'
        | 'resumed'
        | 'placement-finished'
        | 'retried';
    readonly cellIndex: number | null;
    readonly message: string;
}

export interface PipePuzzleState extends PipeBoard {
    readonly config: ResolvedPipePuzzleConfig;
    readonly initialTiles: readonly PipeTile[];
    readonly sourceIndex: number;
    readonly sinkIndex: number;
    readonly routeIndices: readonly number[];
    readonly obstacleIndices: readonly number[];
    readonly queue: readonly PipeQueuePiece[];
    readonly queueIndex: number;
    readonly witness: PipeWitness;
    readonly generationAttempt: number;
    readonly flowClockMs: number;
    readonly flowStepsResolved: number;
    readonly frontIndex: number;
    readonly frontIncomingDirection: PipeDirection | null;
    readonly wetTileIndices: readonly number[];
    readonly visitedConnections: readonly string[];
    readonly terminalStatus: PipeTerminalStatus;
    readonly failureReason: PipeFailureReason | null;
    readonly overwrites: number;
    readonly activeElapsedMs: number;
    readonly paused: boolean;
    readonly placementFinished: boolean;
    readonly lastEvent: PipeModelEvent;
}

export interface PipeTerminalState {
    readonly status: PipeTerminalStatus;
    readonly reason: PipeFailureReason | null;
}

export interface PipeFlowVisualState {
    readonly graceProgress: number;
    readonly graceRemainingMs: number;
    readonly connectionProgress: number;
    readonly connectionRemainingMs: number;
    readonly frontIndex: number;
    readonly outgoingDirection: PipeDirection | null;
}

const DIRECTION_VECTORS = Object.freeze({
    up: Object.freeze({x: 0, y: -1}),
    right: Object.freeze({x: 1, y: 0}),
    down: Object.freeze({x: 0, y: 1}),
    left: Object.freeze({x: -1, y: 0})
} as const satisfies Record<PipeDirection, {readonly x: number; readonly y: number}>);

const OPPOSITE_DIRECTIONS = Object.freeze({
    up: 'down',
    right: 'left',
    down: 'up',
    left: 'right'
} as const satisfies Record<PipeDirection, PipeDirection>);

const BASE_CONFIGS = Object.freeze({
    story: Object.freeze({
        width: 5,
        height: 5,
        routeMinimum: 7,
        routeMaximum: 9,
        obstacleMinimum: 1,
        obstacleMaximum: 2,
        maximumDecoyShare: 0.25,
        graceMs: 0,
        stepMs: 10_000
    }),
    standard: Object.freeze({
        width: 6,
        height: 6,
        routeMinimum: 10,
        routeMaximum: 14,
        obstacleMinimum: 3,
        obstacleMaximum: 5,
        maximumDecoyShare: 0.35,
        graceMs: 0,
        stepMs: 8_000
    }),
    expert: Object.freeze({
        width: 6,
        height: 6,
        routeMinimum: 14,
        routeMaximum: 18,
        obstacleMinimum: 5,
        obstacleMaximum: 7,
        maximumDecoyShare: 0.45,
        graceMs: 0,
        stepMs: 6_000
    })
} as const);

const EMPTY_EVENT: PipeModelEvent = Object.freeze({
    kind: 'none',
    cellIndex: null,
    message: ''
});

const EMPTY_WITNESS: PipeWitness = Object.freeze({
    placements: Object.freeze([]),
    cadenceMs: 1_000,
    completionTimeMs: 0
});

interface GeneratedLayout {
    readonly tiles: readonly PipeTile[];
    readonly sourceIndex: number;
    readonly sinkIndex: number;
    readonly routeIndices: readonly number[];
    readonly obstacleIndices: readonly number[];
    readonly queue: readonly PipeQueuePiece[];
    readonly witnessPlacements: readonly PipeWitnessPlacement[];
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function rotateDirection(direction: PipeDirection, rotation: PipeRotation): PipeDirection {
    const directionIndex = PIPE_DIRECTIONS.indexOf(direction);
    return PIPE_DIRECTIONS[(directionIndex + rotation) % PIPE_DIRECTIONS.length]!;
}

function createTile(kind: PipeTileKind, rotation: PipeRotation, locked = false): PipeTile {
    return Object.freeze({kind, rotation, locked});
}

function createPieceTile(piece: PipeQueuePiece): PipeTile {
    return createTile(piece.kind, piece.rotation);
}

function resolveConfig(config: PipePuzzleConfig): ResolvedPipePuzzleConfig {
    const base = BASE_CONFIGS[config.difficulty];
    const graceMs = config.graceMs ?? base.graceMs;
    const stepMs = config.stepMs ?? base.stepMs;
    const witnessCadenceMs = config.witnessCadenceMs ?? 1_000;
    const maxGenerationAttempts = config.maxGenerationAttempts ?? 64;
    if (!Number.isFinite(graceMs) || graceMs < 0) {
        throw new Error('Pipe grace must be a finite non-negative duration.');
    }
    if (!Number.isFinite(stepMs) || stepMs <= 0) {
        throw new Error('Pipe flow step must be a finite positive duration.');
    }
    if (!Number.isFinite(witnessCadenceMs) || witnessCadenceMs <= 0) {
        throw new Error('Pipe witness cadence must be a finite positive duration.');
    }
    if (!Number.isSafeInteger(maxGenerationAttempts) || maxGenerationAttempts <= 0) {
        throw new Error('Pipe generation attempt count must be a positive safe integer.');
    }
    return Object.freeze({
        difficulty: config.difficulty,
        width: base.width,
        height: base.height,
        routeMinimum: base.routeMinimum,
        routeMaximum: base.routeMaximum,
        obstacleMinimum: base.obstacleMinimum,
        obstacleMaximum: base.obstacleMaximum,
        maximumDecoyShare: base.maximumDecoyShare,
        graceMs,
        stepMs,
        witnessCadenceMs,
        maxGenerationAttempts
    });
}

function directionBetween(
    fromIndex: number,
    toIndex: number,
    width: number
): PipeDirection {
    const fromX = fromIndex % width;
    const fromY = Math.floor(fromIndex / width);
    const toX = toIndex % width;
    const toY = Math.floor(toIndex / width);
    if (toX === fromX && toY === fromY - 1) return 'up';
    if (toX === fromX + 1 && toY === fromY) return 'right';
    if (toX === fromX && toY === fromY + 1) return 'down';
    if (toX === fromX - 1 && toY === fromY) return 'left';
    throw new Error('Pipe route contains non-adjacent cells.');
}

function rotationForSingleConnection(
    kind: 'source' | 'sink',
    direction: PipeDirection
): PipeRotation {
    const baseDirection: PipeDirection = kind === 'source' ? 'right' : 'left';
    const baseIndex = PIPE_DIRECTIONS.indexOf(baseDirection);
    const targetIndex = PIPE_DIRECTIONS.indexOf(direction);
    return ((targetIndex - baseIndex + 4) % 4) as PipeRotation;
}

function pieceForConnections(
    first: PipeDirection,
    second: PipeDirection,
    id: string,
    role: PipeQueuePiece['role']
): PipeQueuePiece {
    const connections = new Set<PipeDirection>([first, second]);
    if (connections.size !== 2 || first === OPPOSITE_DIRECTIONS[second]) {
        const rotation: PipeRotation =
            connections.has('left') || connections.has('right') ? 1 : 0;
        return Object.freeze({id, kind: 'straight', rotation, role});
    }

    let rotation: PipeRotation;
    if (connections.has('up') && connections.has('right')) rotation = 0;
    else if (connections.has('right') && connections.has('down')) rotation = 1;
    else if (connections.has('down') && connections.has('left')) rotation = 2;
    else rotation = 3;
    return Object.freeze({id, kind: 'corner', rotation, role});
}

function randomPiece(
    random: RandomSource,
    id: string,
    role: PipeQueuePiece['role']
): PipeQueuePiece {
    return Object.freeze({
        id,
        kind: randomInteger(random, 2) === 0 ? 'straight' : 'corner',
        rotation: randomInteger(random, 4) as PipeRotation,
        role
    });
}

type Edge = 0 | 1 | 2 | 3;

function indexOnEdge(
    edge: Edge,
    offset: number,
    width: number,
    height: number
): number {
    switch (edge) {
        case 0:
            return offset;
        case 1:
            return offset * width + width - 1;
        case 2:
            return (height - 1) * width + offset;
        case 3:
            return offset * width;
    }
}

function isOnEdge(index: number, edge: Edge, width: number, height: number): boolean {
    const x = index % width;
    const y = Math.floor(index / width);
    switch (edge) {
        case 0:
            return y === 0;
        case 1:
            return x === width - 1;
        case 2:
            return y === height - 1;
        case 3:
            return x === 0;
    }
}

function isCorner(index: number, width: number, height: number): boolean {
    const x = index % width;
    const y = Math.floor(index / width);
    return (x === 0 || x === width - 1) && (y === 0 || y === height - 1);
}

function distanceToEdge(index: number, edge: Edge, width: number, height: number): number {
    const x = index % width;
    const y = Math.floor(index / width);
    switch (edge) {
        case 0:
            return y;
        case 1:
            return width - 1 - x;
        case 2:
            return height - 1 - y;
        case 3:
            return x;
    }
}

function neighborIndices(index: number, width: number, height: number): number[] {
    const x = index % width;
    const y = Math.floor(index / width);
    const result: number[] = [];
    if (y > 0) result.push(index - width);
    if (x < width - 1) result.push(index + 1);
    if (y < height - 1) result.push(index + width);
    if (x > 0) result.push(index - 1);
    return result;
}

function countTurns(route: readonly number[], width: number): number {
    let turns = 0;
    let previousDirection: PipeDirection | null = null;
    for (let index = 1; index < route.length; index++) {
        const direction = directionBetween(route[index - 1]!, route[index]!, width);
        if (previousDirection !== null && direction !== previousDirection) turns++;
        previousDirection = direction;
    }
    return turns;
}

function findRandomRoute(
    random: RandomSource,
    width: number,
    height: number,
    targetLength: number
): readonly number[] | null {
    const startEdge = randomInteger(random, 4) as Edge;
    const targetEdgeOffset = 1 + randomInteger(random, 3);
    const targetEdge = ((startEdge + targetEdgeOffset) % 4) as Edge;
    const startSpan = startEdge % 2 === 0 ? width : height;
    const startOffset = 1 + randomInteger(random, startSpan - 2);
    const startIndex = indexOnEdge(startEdge, startOffset, width, height);
    const route = [startIndex];
    const visited = new Set<number>(route);
    let exploredNodes = 0;

    const search = (): boolean => {
        exploredNodes++;
        if (exploredNodes > 30_000) return false;
        const current = route[route.length - 1]!;
        const remainingSteps = targetLength - route.length;
        if (remainingSteps === 0) {
            return isOnEdge(current, targetEdge, width, height)
                && countTurns(route, width) >= 2;
        }
        if (distanceToEdge(current, targetEdge, width, height) > remainingSteps) return false;

        const candidates = shuffle(
            neighborIndices(current, width, height).filter(candidate => {
                if (visited.has(candidate)) return false;
                const reachesTargetEdge = isOnEdge(candidate, targetEdge, width, height);
                if (remainingSteps === 1) {
                    return reachesTargetEdge && !isCorner(candidate, width, height);
                }
                return !reachesTargetEdge;
            }),
            random
        );
        for (const candidate of candidates) {
            route.push(candidate);
            visited.add(candidate);
            if (search()) return true;
            visited.delete(candidate);
            route.pop();
        }
        return false;
    };

    return search() ? Object.freeze([...route]) : null;
}

function makeLayout(
    random: RandomSource,
    config: ResolvedPipePuzzleConfig
): GeneratedLayout | null {
    const routeLength = config.routeMinimum
        + randomInteger(random, config.routeMaximum - config.routeMinimum + 1);
    const route = findRandomRoute(random, config.width, config.height, routeLength);
    if (route === null) return null;

    const sourceIndex = route[0]!;
    const sinkIndex = route[route.length - 1]!;
    const routeSet = new Set(route);
    const offRoute = shuffle(
        Array.from(
            {length: config.width * config.height},
            (_, index) => index
        ).filter(index => !routeSet.has(index)),
        random
    );
    const obstacleCount = config.obstacleMinimum
        + randomInteger(random, config.obstacleMaximum - config.obstacleMinimum + 1);
    if (offRoute.length < obstacleCount) return null;
    const obstacleIndices = Object.freeze(offRoute.slice(0, obstacleCount).sort((a, b) => a - b));
    const obstacleSet = new Set(obstacleIndices);
    const dumpIndices = offRoute.filter(index => !obstacleSet.has(index));

    const tiles: PipeTile[] = Array.from(
        {length: config.width * config.height},
        () => createTile('empty', 0)
    );
    tiles[sourceIndex] = createTile(
        'source',
        rotationForSingleConnection(
            'source',
            directionBetween(sourceIndex, route[1]!, config.width)
        ),
        true
    );
    tiles[sinkIndex] = createTile(
        'sink',
        rotationForSingleConnection(
            'sink',
            directionBetween(sinkIndex, route[route.length - 2]!, config.width)
        ),
        true
    );
    for (const obstacleIndex of obstacleIndices) {
        tiles[obstacleIndex] = createTile('obstacle', 0, true);
    }

    const required: {readonly piece: PipeQueuePiece; readonly cellIndex: number}[] = [];
    for (let routeIndex = 1; routeIndex < route.length - 1; routeIndex++) {
        const cellIndex = route[routeIndex]!;
        const toPrevious = directionBetween(cellIndex, route[routeIndex - 1]!, config.width);
        const toNext = directionBetween(cellIndex, route[routeIndex + 1]!, config.width);
        required.push({
            piece: pieceForConnections(
                toPrevious,
                toNext,
                `route-${routeIndex}`,
                'required'
            ),
            cellIndex
        });
    }

    const maximumDecoys = Math.min(
        dumpIndices.length,
        Math.floor(required.length * config.maximumDecoyShare
            / (1 - config.maximumDecoyShare))
    );
    const minimumDecoys = maximumDecoys === 0 ? 0 : Math.max(1, Math.floor(maximumDecoys / 2));
    const decoyCount = minimumDecoys
        + randomInteger(random, maximumDecoys - minimumDecoys + 1);
    const decoysAfter = Array.from({length: required.length}, () => 0);
    for (let decoyIndex = 0; decoyIndex < decoyCount; decoyIndex++) {
        const slot = randomInteger(random, Math.max(1, required.length - 1));
        decoysAfter[slot] = decoysAfter[slot]! + 1;
    }

    const queue: PipeQueuePiece[] = [];
    const witnessPlacements: PipeWitnessPlacement[] = [];
    let dumpCursor = 0;
    for (let requiredIndex = 0; requiredIndex < required.length; requiredIndex++) {
        const entry = required[requiredIndex]!;
        witnessPlacements.push({
            queueIndex: queue.length,
            cellIndex: entry.cellIndex
        });
        queue.push(entry.piece);
        for (let decoyIndex = 0; decoyIndex < decoysAfter[requiredIndex]!; decoyIndex++) {
            witnessPlacements.push({
                queueIndex: queue.length,
                cellIndex: dumpIndices[dumpCursor]!
            });
            queue.push(randomPiece(random, `decoy-${dumpCursor}`, 'decoy'));
            dumpCursor++;
        }
    }

    if (config.difficulty !== 'expert') {
        const uniquePieces = new Map<string, PipeQueuePiece>();
        for (const entry of required) {
            const key = `${entry.piece.kind}:${entry.piece.rotation}`;
            if (!uniquePieces.has(key)) uniquePieces.set(key, entry.piece);
        }
        for (const [key, piece] of uniquePieces) {
            queue.push(Object.freeze({
                id: `recovery-${key}`,
                kind: piece.kind,
                rotation: piece.rotation,
                role: 'recovery'
            }));
        }
    }

    return Object.freeze({
        tiles: Object.freeze(tiles),
        sourceIndex,
        sinkIndex,
        routeIndices: route,
        obstacleIndices,
        queue: Object.freeze(queue),
        witnessPlacements: Object.freeze(witnessPlacements)
    });
}

function createState(
    layout: GeneratedLayout,
    config: ResolvedPipePuzzleConfig,
    generationAttempt: number,
    witness: PipeWitness
): PipePuzzleState {
    return {
        width: config.width,
        height: config.height,
        tiles: layout.tiles,
        turns: 0,
        config,
        initialTiles: layout.tiles,
        sourceIndex: layout.sourceIndex,
        sinkIndex: layout.sinkIndex,
        routeIndices: layout.routeIndices,
        obstacleIndices: layout.obstacleIndices,
        queue: layout.queue,
        queueIndex: 0,
        witness,
        generationAttempt,
        flowClockMs: config.graceMs === 0 ? 0 : -config.graceMs,
        flowStepsResolved: 0,
        frontIndex: layout.sourceIndex,
        frontIncomingDirection: null,
        wetTileIndices: Object.freeze([layout.sourceIndex]),
        visitedConnections: Object.freeze([]),
        terminalStatus: 'active',
        failureReason: null,
        overwrites: 0,
        activeElapsedMs: 0,
        paused: false,
        placementFinished: false,
        lastEvent: EMPTY_EVENT
    };
}

function nextOutgoingDirection(state: PipePuzzleState): PipeDirection | null {
    const tile = state.tiles[state.frontIndex]!;
    const connections = getPipeConnections(tile);
    if (state.frontIncomingDirection === null) return connections[0] ?? null;
    return connections.find(direction => direction !== state.frontIncomingDirection) ?? null;
}

function failFlow(
    state: PipePuzzleState,
    reason: PipeFailureReason,
    cellIndex: number
): PipePuzzleState {
    return {
        ...state,
        terminalStatus: 'failure',
        failureReason: reason,
        lastEvent: {
            kind: 'failure',
            cellIndex,
            message: reason === 'pressure-loop' ? 'PRESSURE LOOP' : `LEAK: ${reason.toUpperCase()}`
        }
    };
}

function resolveOneFlowStep(state: PipePuzzleState): PipePuzzleState {
    if (state.terminalStatus !== 'active') return state;
    const outgoing = nextOutgoingDirection(state);
    if (outgoing === null) return failFlow(state, 'empty', state.frontIndex);
    const vector = DIRECTION_VECTORS[outgoing];
    const x = state.frontIndex % state.width;
    const y = Math.floor(state.frontIndex / state.width);
    const targetX = x + vector.x;
    const targetY = y + vector.y;
    if (targetX < 0 || targetX >= state.width || targetY < 0 || targetY >= state.height) {
        return failFlow(state, 'edge', state.frontIndex);
    }

    const targetIndex = targetY * state.width + targetX;
    const targetTile = state.tiles[targetIndex]!;
    if (targetTile.kind === 'empty') return failFlow(state, 'empty', targetIndex);
    if (targetTile.kind === 'obstacle') return failFlow(state, 'obstacle', targetIndex);
    const reciprocalDirection = OPPOSITE_DIRECTIONS[outgoing];
    if (!getPipeConnections(targetTile).includes(reciprocalDirection)) {
        return failFlow(state, 'mismatch', targetIndex);
    }

    const connectionKey = state.frontIndex < targetIndex
        ? `${state.frontIndex}:${targetIndex}`
        : `${targetIndex}:${state.frontIndex}`;
    if (
        state.visitedConnections.includes(connectionKey)
        || (state.wetTileIndices.includes(targetIndex) && targetIndex !== state.sinkIndex)
    ) {
        return failFlow(state, 'pressure-loop', targetIndex);
    }

    const nextWet = Object.freeze([...state.wetTileIndices, targetIndex]);
    const nextConnections = Object.freeze([...state.visitedConnections, connectionKey]);
    if (targetIndex === state.sinkIndex) {
        return {
            ...state,
            frontIndex: targetIndex,
            frontIncomingDirection: reciprocalDirection,
            wetTileIndices: nextWet,
            visitedConnections: nextConnections,
            terminalStatus: 'success',
            failureReason: null,
            lastEvent: {
                kind: 'success',
                cellIndex: targetIndex,
                message: 'FLOW STABLE'
            }
        };
    }
    return {
        ...state,
        frontIndex: targetIndex,
        frontIncomingDirection: reciprocalDirection,
        wetTileIndices: nextWet,
        visitedConnections: nextConnections,
        lastEvent: {
            kind: 'flow-advanced',
            cellIndex: targetIndex,
            message: 'LIQUID ADVANCED'
        }
    };
}

function advanceClock(
    state: PipePuzzleState,
    deltaMs: number,
    countAsActiveTime: boolean,
    activeTimeScale = 1
): PipePuzzleState {
    let next = state;
    let remainingMs = deltaMs;
    const epsilon = 0.000_001;
    while (remainingMs > epsilon && next.terminalStatus === 'active') {
        const nextBoundary = next.flowClockMs < 0
            ? 0
            : (next.flowStepsResolved + 1) * next.config.stepMs;
        const untilBoundary = Math.max(0, nextBoundary - next.flowClockMs);
        const consumedMs = untilBoundary <= epsilon
            ? 0
            : Math.min(remainingMs, untilBoundary);
        if (consumedMs > 0) {
            next = {
                ...next,
                flowClockMs: next.flowClockMs + consumedMs,
                activeElapsedMs: next.activeElapsedMs +
                    (countAsActiveTime ? consumedMs * activeTimeScale : 0)
            };
            remainingMs -= consumedMs;
        }

        const atFlowBoundary = next.flowClockMs >= 0
            && next.flowClockMs + epsilon
                >= (next.flowStepsResolved + 1) * next.config.stepMs;
        if (atFlowBoundary) {
            next = {
                ...next,
                flowStepsResolved: next.flowStepsResolved + 1
            };
            next = resolveOneFlowStep(next);
            continue;
        }

        if (consumedMs <= epsilon) {
            const rest = remainingMs;
            next = {
                ...next,
                flowClockMs: next.flowClockMs + rest,
                activeElapsedMs: next.activeElapsedMs +
                    (countAsActiveTime ? rest * activeTimeScale : 0)
            };
            remainingMs = 0;
        }
    }
    return next;
}

function validateWitness(
    state: PipePuzzleState,
    placements: readonly PipeWitnessPlacement[]
): PipeWitness | null {
    let replay = state;
    for (const placement of placements) {
        if (replay.queueIndex !== placement.queueIndex) return null;
        replay = placeQueuedPiece(replay, placement.cellIndex);
        if (
            replay.lastEvent.kind !== 'placed'
            && replay.lastEvent.kind !== 'overwritten'
        ) return null;
        replay = advancePipeFlow(replay, state.config.witnessCadenceMs);
        if (replay.terminalStatus === 'failure') return null;
    }
    const maximumResolutionTime = state.config.graceMs
        + state.routeIndices.length * state.config.stepMs
        + state.config.stepMs;
    replay = advancePipeFlow(replay, maximumResolutionTime);
    if (replay.terminalStatus !== 'success') return null;
    return Object.freeze({
        placements,
        cadenceMs: state.config.witnessCadenceMs,
        completionTimeMs: replay.activeElapsedMs
    });
}

function createFallbackLayout(
    random: RandomSource,
    config: ResolvedPipePuzzleConfig
): GeneratedLayout {
    const width = config.width;
    const route = config.difficulty === 'story'
        ? [10, 11, 12, 7, 8, 3, 2]
        : config.difficulty === 'standard'
            ? [12, 13, 14, 8, 9, 10, 16, 22, 23, 29, 28, 34]
            : [12, 13, 14, 8, 9, 10, 16, 22, 21, 20, 19, 25, 31, 32, 33, 34];
    const routeSet = new Set(route);
    const obstacleCount = config.obstacleMinimum;
    const offRoute = shuffle(
        Array.from({length: config.width * config.height}, (_, index) => index)
            .filter(index => !routeSet.has(index)),
        random
    );
    const obstacleIndices = Object.freeze(offRoute.slice(0, obstacleCount).sort((a, b) => a - b));
    const obstacleSet = new Set(obstacleIndices);
    const tiles = Array.from(
        {length: config.width * config.height},
        () => createTile('empty', 0)
    );
    const sourceIndex = route[0]!;
    const sinkIndex = route[route.length - 1]!;
    tiles[sourceIndex] = createTile(
        'source',
        rotationForSingleConnection('source', directionBetween(sourceIndex, route[1]!, width)),
        true
    );
    tiles[sinkIndex] = createTile(
        'sink',
        rotationForSingleConnection(
            'sink',
            directionBetween(sinkIndex, route[route.length - 2]!, width)
        ),
        true
    );
    for (const obstacleIndex of obstacleIndices) {
        tiles[obstacleIndex] = createTile('obstacle', 0, true);
    }
    const queue: PipeQueuePiece[] = [];
    const placements: PipeWitnessPlacement[] = [];
    for (let routeIndex = 1; routeIndex < route.length - 1; routeIndex++) {
        const cellIndex = route[routeIndex]!;
        const piece = pieceForConnections(
            directionBetween(cellIndex, route[routeIndex - 1]!, width),
            directionBetween(cellIndex, route[routeIndex + 1]!, width),
            `fallback-${routeIndex}`,
            'required'
        );
        placements.push({queueIndex: queue.length, cellIndex});
        queue.push(piece);
        if (
            routeIndex % 3 === 0
            && offRoute.some(index => !obstacleSet.has(index))
        ) {
            const dumpIndex = offRoute.find(index => !obstacleSet.has(index))!;
            placements.push({queueIndex: queue.length, cellIndex: dumpIndex});
            queue.push(randomPiece(random, `fallback-decoy-${routeIndex}`, 'decoy'));
            obstacleSet.add(dumpIndex);
        }
    }
    if (config.difficulty !== 'expert') {
        const uniquePieces = new Map<string, PipeQueuePiece>();
        for (const piece of queue) {
            if (piece.role !== 'required') continue;
            const key = `${piece.kind}:${piece.rotation}`;
            if (!uniquePieces.has(key)) uniquePieces.set(key, piece);
        }
        for (const [key, piece] of uniquePieces) {
            queue.push(Object.freeze({
                id: `fallback-recovery-${key}`,
                kind: piece.kind,
                rotation: piece.rotation,
                role: 'recovery'
            }));
        }
    }
    return {
        tiles: Object.freeze(tiles),
        sourceIndex,
        sinkIndex,
        routeIndices: Object.freeze(route),
        obstacleIndices,
        queue: Object.freeze(queue),
        witnessPlacements: Object.freeze(placements)
    };
}

/**
 * Creates a complete deterministic Pipe encounter. The returned route is a
 * validation witness; callers should not reveal it during play.
 */
export function createPipePuzzle(
    random: RandomSource,
    puzzleConfig: PipePuzzleConfig
): PipePuzzleState {
    const config = resolveConfig(puzzleConfig);
    for (let attempt = 0; attempt < config.maxGenerationAttempts; attempt++) {
        const layout = makeLayout(random, config);
        if (layout === null) continue;
        const provisional = createState(layout, config, attempt, EMPTY_WITNESS);
        const witness = validateWitness(provisional, layout.witnessPlacements);
        if (witness !== null) return createState(layout, config, attempt, witness);
    }

    const fallback = createFallbackLayout(random, config);
    const provisional = createState(
        fallback,
        config,
        config.maxGenerationAttempts,
        EMPTY_WITNESS
    );
    const witness = validateWitness(provisional, fallback.witnessPlacements);
    if (witness === null) throw new Error('Built-in Pipe fallback failed validation.');
    return createState(fallback, config, config.maxGenerationAttempts, witness);
}

/**
 * Places the queue head exactly as supplied. There is deliberately no rotation
 * operation on PipePuzzleState.
 */
export function placeQueuedPiece(
    state: PipePuzzleState,
    cellIndex: number
): PipePuzzleState {
    if (!Number.isSafeInteger(cellIndex) || cellIndex < 0 || cellIndex >= state.tiles.length) {
        return {
            ...state,
            lastEvent: {kind: 'blocked', cellIndex, message: 'OUTSIDE BOARD'}
        };
    }
    if (state.terminalStatus !== 'active') {
        return {
            ...state,
            lastEvent: {kind: 'blocked', cellIndex, message: 'FLOW RESOLVED'}
        };
    }
    if (state.paused) {
        return {
            ...state,
            lastEvent: {kind: 'blocked', cellIndex, message: 'PAUSED'}
        };
    }
    if (state.placementFinished) {
        return {
            ...state,
            lastEvent: {kind: 'blocked', cellIndex, message: 'PLACEMENT LOCKED'}
        };
    }
    const piece = state.queue[state.queueIndex];
    if (piece === undefined) {
        return {
            ...state,
            lastEvent: {kind: 'blocked', cellIndex, message: 'QUEUE EMPTY'}
        };
    }
    const previousTile = state.tiles[cellIndex]!;
    if (previousTile.locked || previousTile.kind === 'source' || previousTile.kind === 'sink') {
        return {
            ...state,
            lastEvent: {kind: 'blocked', cellIndex, message: 'FIXED CELL'}
        };
    }
    if (previousTile.kind === 'obstacle') {
        return {
            ...state,
            lastEvent: {kind: 'blocked', cellIndex, message: 'OBSTRUCTED'}
        };
    }
    if (state.wetTileIndices.includes(cellIndex)) {
        return {
            ...state,
            lastEvent: {kind: 'blocked', cellIndex, message: 'WET PIPE LOCKED'}
        };
    }

    const overwritten = previousTile.kind !== 'empty';
    const tiles = [...state.tiles];
    tiles[cellIndex] = createPieceTile(piece);
    let next: PipePuzzleState = {
        ...state,
        tiles: Object.freeze(tiles),
        turns: state.turns + 1,
        queueIndex: state.queueIndex + 1,
        overwrites: state.overwrites + (overwritten ? 1 : 0),
        lastEvent: {
            kind: overwritten ? 'overwritten' : 'placed',
            cellIndex,
            message: overwritten ? 'OVERWRITE · FLOW +1' : 'PIPE PLACED'
        }
    };
    if (overwritten) {
        const placementEvent = next.lastEvent;
        next = advanceClock(next, next.config.stepMs, false);
        if (next.terminalStatus === 'active') next = {...next, lastEvent: placementEvent};
    }
    return next;
}

/**
 * Advances all supplied elapsed time without dropping frame-stall excess.
 */
export function advancePipeFlow(
    state: PipePuzzleState,
    deltaMs: number
): PipePuzzleState {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
        throw new Error('Pipe flow delta must be a finite non-negative duration.');
    }
    if (deltaMs === 0 || state.paused || state.terminalStatus !== 'active') return state;
    const flowMultiplier = state.placementFinished ? PIPE_FINISHED_FLOW_MULTIPLIER : 1;
    return advanceClock(
        state,
        deltaMs * flowMultiplier,
        true,
        1 / flowMultiplier
    );
}

/**
 * Locks the placed layout and accelerates the visible coolant simulation.
 * Success and failure are still decided by the ordinary joint-by-joint flow
 * rules; this action never grants completion by itself.
 */
export function finishPipePlacement(state: PipePuzzleState): PipePuzzleState {
    if (state.terminalStatus !== 'active' || state.placementFinished) return state;
    if (state.paused) {
        return {
            ...state,
            lastEvent: {kind: 'blocked', cellIndex: null, message: 'PAUSED'}
        };
    }
    if (state.turns === 0) {
        return {
            ...state,
            lastEvent: {
                kind: 'blocked',
                cellIndex: null,
                message: 'PLACE A PIPE FIRST'
            }
        };
    }
    return {
        ...state,
        placementFinished: true,
        lastEvent: {
            kind: 'placement-finished',
            cellIndex: null,
            message: `PLACEMENT LOCKED · FLOW ×${PIPE_FINISHED_FLOW_MULTIPLIER}`
        }
    };
}

export function setPipePaused(state: PipePuzzleState, paused: boolean): PipePuzzleState {
    if (state.paused === paused || state.terminalStatus !== 'active') return state;
    return {
        ...state,
        paused,
        lastEvent: {
            kind: paused ? 'paused' : 'resumed',
            cellIndex: null,
            message: paused ? 'PAUSED' : 'FLOW RESUMED'
        }
    };
}

export function retryPipePuzzle(state: PipePuzzleState): PipePuzzleState {
    const layout: GeneratedLayout = {
        tiles: state.initialTiles,
        sourceIndex: state.sourceIndex,
        sinkIndex: state.sinkIndex,
        routeIndices: state.routeIndices,
        obstacleIndices: state.obstacleIndices,
        queue: state.queue,
        witnessPlacements: state.witness.placements
    };
    return {
        ...createState(layout, state.config, state.generationAttempt, state.witness),
        lastEvent: {kind: 'retried', cellIndex: null, message: 'PUZZLE RETRIED'}
    };
}

export function getPipeTerminalState(state: PipePuzzleState): PipeTerminalState {
    return Object.freeze({status: state.terminalStatus, reason: state.failureReason});
}

export function getPipeFlowVisualState(state: PipePuzzleState): PipeFlowVisualState {
    const graceRemainingMs = Math.max(0, -state.flowClockMs);
    const graceProgress = state.config.graceMs === 0
        ? 1
        : clamp((state.config.graceMs - graceRemainingMs) / state.config.graceMs, 0, 1);
    const connectionProgress = state.flowClockMs < 0
        ? 0
        : clamp(
            (state.flowClockMs - state.flowStepsResolved * state.config.stepMs)
                / state.config.stepMs,
            0,
            1
        );
    const connectionRemainingMs = state.terminalStatus === 'active'
        ? Math.max(
            0,
            (state.flowStepsResolved + 1) * state.config.stepMs - state.flowClockMs
        )
        : 0;
    return Object.freeze({
        graceProgress,
        graceRemainingMs,
        connectionProgress,
        connectionRemainingMs,
        frontIndex: state.frontIndex,
        outgoingDirection: state.terminalStatus === 'active'
            ? nextOutgoingDirection(state)
            : null
    });
}

export function getPipeGrade(
    state: PipePuzzleState
): 's' | 'a' | 'b' | 'c' | 'none' {
    if (state.terminalStatus !== 'success') return 'none';
    if (
        state.overwrites === 0
        && state.activeElapsedMs <= state.witness.completionTimeMs * 1.1
    ) return 's';
    if (state.overwrites <= 1) return 'a';
    if (state.overwrites <= 3) return 'b';
    return 'c';
}

export function getPipeScore(state: PipePuzzleState): number {
    if (state.terminalStatus !== 'success') return 0;
    return Math.max(
        500,
        5_000
            - Math.floor(Math.max(
                0,
                state.activeElapsedMs - state.witness.completionTimeMs
            ) / 10)
            - 600 * state.overwrites
    );
}

export function getPipeConnections(tile: PipeTile): readonly PipeDirection[] {
    let baseConnections: readonly PipeDirection[];
    switch (tile.kind) {
        case 'empty':
        case 'obstacle':
            return [];
        case 'source':
            baseConnections = ['right'];
            break;
        case 'sink':
            baseConnections = ['left'];
            break;
        case 'straight':
            baseConnections = ['up', 'down'];
            break;
        case 'corner':
            baseConnections = ['up', 'right'];
            break;
    }
    return baseConnections.map(direction => rotateDirection(direction, tile.rotation));
}
