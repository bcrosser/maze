import {randomInteger, type RandomSource} from '../../domain/random/random-source';

export const PIPE_DIRECTIONS = ['up', 'right', 'down', 'left'] as const;
export const PIPE_TILE_KINDS = ['empty', 'source', 'sink', 'straight', 'corner'] as const;

export type PipeDirection = (typeof PIPE_DIRECTIONS)[number];
export type PipeTileKind = (typeof PIPE_TILE_KINDS)[number];
export type PipeRotation = 0 | 1 | 2 | 3;

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

export interface PipeFlowResult {
    readonly completed: boolean;
    readonly poweredTileIndices: readonly number[];
    readonly leakingTileIndices: readonly number[];
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

function rotateDirection(direction: PipeDirection, rotation: PipeRotation): PipeDirection {
    const directionIndex = PIPE_DIRECTIONS.indexOf(direction);
    return PIPE_DIRECTIONS[(directionIndex + rotation) % PIPE_DIRECTIONS.length]!;
}

function createTile(kind: PipeTileKind, rotation: PipeRotation, locked = false): PipeTile {
    return Object.freeze({kind, rotation, locked});
}

export function getPipeConnections(tile: PipeTile): readonly PipeDirection[] {
    let baseConnections: readonly PipeDirection[];
    switch (tile.kind) {
        case 'empty':
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

export function rotatePipeTile(board: PipeBoard, tileIndex: number): PipeBoard {
    const tile = board.tiles[tileIndex];
    if (!tile || tile.locked || tile.kind === 'empty') return board;

    const nextRotation = ((tile.rotation + 1) % 4) as PipeRotation;
    const nextTiles = [...board.tiles];
    nextTiles[tileIndex] = createTile(tile.kind, nextRotation, tile.locked);
    return {...board, tiles: nextTiles, turns: board.turns + 1};
}

export function tracePipeFlow(board: PipeBoard): PipeFlowResult {
    if (board.width <= 0 || board.height <= 0 || board.tiles.length !== board.width * board.height) {
        throw new Error('Pipe board dimensions do not match its tile count.');
    }

    const sourceIndices = board.tiles
        .map((tile, index) => tile.kind === 'source' ? index : -1)
        .filter(index => index >= 0);
    if (sourceIndices.length !== 1) throw new Error('Pipe board must contain exactly one source.');

    const powered = new Set<number>(sourceIndices);
    const leaks = new Set<number>();
    const queue = [...sourceIndices];
    let completed = false;

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
        const tileIndex = queue[queueIndex]!;
        const tile = board.tiles[tileIndex]!;
        if (tile.kind === 'sink') completed = true;
        const tileX = tileIndex % board.width;
        const tileY = Math.floor(tileIndex / board.width);

        for (const direction of getPipeConnections(tile)) {
            const vector = DIRECTION_VECTORS[direction];
            const targetX = tileX + vector.x;
            const targetY = tileY + vector.y;
            if (targetX < 0 || targetX >= board.width || targetY < 0 || targetY >= board.height) {
                leaks.add(tileIndex);
                continue;
            }

            const targetIndex = targetY * board.width + targetX;
            const targetTile = board.tiles[targetIndex]!;
            const targetConnections = getPipeConnections(targetTile);
            if (!targetConnections.includes(OPPOSITE_DIRECTIONS[direction])) {
                leaks.add(tileIndex);
                continue;
            }
            if (powered.has(targetIndex)) continue;
            powered.add(targetIndex);
            queue.push(targetIndex);
        }
    }

    return {
        completed,
        poweredTileIndices: [...powered].sort((left, right) => left - right),
        leakingTileIndices: [...leaks].sort((left, right) => left - right)
    };
}

export function createIntroPipeBoard(random: RandomSource): PipeBoard {
    const layout: readonly {kind: PipeTileKind; solvedRotation: PipeRotation; locked?: boolean}[] = [
        {kind: 'empty', solvedRotation: 0},
        {kind: 'corner', solvedRotation: 1},
        {kind: 'straight', solvedRotation: 0},
        {kind: 'empty', solvedRotation: 0},
        {kind: 'source', solvedRotation: 0, locked: true},
        {kind: 'straight', solvedRotation: 1},
        {kind: 'corner', solvedRotation: 2},
        {kind: 'empty', solvedRotation: 0},
        {kind: 'empty', solvedRotation: 0},
        {kind: 'corner', solvedRotation: 3},
        {kind: 'corner', solvedRotation: 0},
        {kind: 'sink', solvedRotation: 0, locked: true},
        {kind: 'straight', solvedRotation: 1},
        {kind: 'empty', solvedRotation: 0},
        {kind: 'corner', solvedRotation: 2},
        {kind: 'empty', solvedRotation: 0}
    ];

    let board: PipeBoard = {
        width: 4,
        height: 4,
        turns: 0,
        tiles: layout.map(definition => createTile(
            definition.kind,
            definition.locked
                ? definition.solvedRotation
                : randomInteger(random, 4) as PipeRotation,
            definition.locked ?? false
        ))
    };

    if (tracePipeFlow(board).completed) board = rotatePipeTile(board, 5);
    return board;
}