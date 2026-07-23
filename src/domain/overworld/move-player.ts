import type {CampaignState} from '../campaign/campaign-state';
import {MATERIALS} from '../materials/materials';
import {PASSAGE_CELL, type MazeCell} from './maze-types';

export const DIRECTION_IDS = ['up', 'down', 'left', 'right'] as const;
export type DirectionId = (typeof DIRECTION_IDS)[number];

export const DIRECTION_VECTORS = Object.freeze({
    up: Object.freeze({x: 0, y: -1}),
    down: Object.freeze({x: 0, y: 1}),
    left: Object.freeze({x: -1, y: 0}),
    right: Object.freeze({x: 1, y: 0})
} as const satisfies Record<DirectionId, {readonly x: number; readonly y: number}>);

export type OverworldMoveEvent =
    | {readonly kind: 'moved'}
    | {readonly kind: 'mined'; readonly materialId: keyof typeof MATERIALS; readonly message: string}
    | {readonly kind: 'blocked'; readonly message?: string};

export interface OverworldMoveResult {
    readonly state: CampaignState;
    readonly event: OverworldMoveEvent;
}

function isPerimeter(x: number, y: number, size: number): boolean {
    return x === 0 || y === 0 || x === size - 1 || y === size - 1;
}

function moveTo(state: CampaignState, x: number, y: number): CampaignState {
    return {
        ...state,
        overworld: {
            ...state.overworld,
            playerPosition: {x, y},
            turn: state.overworld.turn + 1
        }
    };
}

function mineAndMove(state: CampaignState, x: number, y: number): CampaignState {
    const nextRow = [...state.overworld.maze[y]!];
    nextRow[x] = PASSAGE_CELL;
    const nextMaze: (readonly MazeCell[])[] = [...state.overworld.maze];
    nextMaze[y] = nextRow;

    return {
        ...state,
        player: {
            ...state.player,
            toolCharge: state.player.toolCharge - 1
        },
        overworld: {
            ...state.overworld,
            maze: nextMaze,
            playerPosition: {x, y},
            turn: state.overworld.turn + 1
        }
    };
}

export function moveOverworldPlayer(
    state: CampaignState,
    directionId: DirectionId
): OverworldMoveResult {
    const direction = DIRECTION_VECTORS[directionId];
    const targetX = state.overworld.playerPosition.x + direction.x;
    const targetY = state.overworld.playerPosition.y + direction.y;
    const targetCell = state.overworld.maze[targetY]?.[targetX];

    if (!targetCell) return {state, event: {kind: 'blocked'}};
    if (targetCell.kind === 'passage') {
        return {state: moveTo(state, targetX, targetY), event: {kind: 'moved'}};
    }
    if (isPerimeter(targetX, targetY, state.overworld.maze.length)) {
        return {state, event: {kind: 'blocked'}};
    }

    const material = MATERIALS[targetCell.materialId];
    const materialTags: readonly string[] = material.tags;
    if (!materialTags.includes('mineral') || !('hardness' in material)) {
        return {
            state,
            event: {kind: 'blocked', message: `${material.name} cannot be mined with this pick.`}
        };
    }
    if (state.player.toolCharge === 0) {
        return {
            state,
            event: {kind: 'blocked', message: 'A mining pick is required to break mineral walls.'}
        };
    }
    if (material.hardness > state.player.miningPower) {
        return {
            state,
            event: {
                kind: 'blocked',
                message: `${material.name} requires mining power ${material.hardness}.`
            }
        };
    }

    return {
        state: mineAndMove(state, targetX, targetY),
        event: {
            kind: 'mined',
            materialId: targetCell.materialId,
            message: `Mined through ${material.name}.`
        }
    };
}