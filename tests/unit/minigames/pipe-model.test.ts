import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    createIntroPipeBoard,
    getPipeConnections,
    rotatePipeTile,
    tracePipeFlow,
    type PipeBoard
} from '../../../src/minigames/pipe/pipe-model';

function createSolvedBoard(): PipeBoard {
    return {
        width: 4,
        height: 2,
        turns: 0,
        tiles: [
            {kind: 'empty', rotation: 0, locked: false},
            {kind: 'empty', rotation: 0, locked: false},
            {kind: 'empty', rotation: 0, locked: false},
            {kind: 'empty', rotation: 0, locked: false},
            {kind: 'source', rotation: 0, locked: true},
            {kind: 'straight', rotation: 1, locked: false},
            {kind: 'straight', rotation: 1, locked: false},
            {kind: 'sink', rotation: 0, locked: true}
        ]
    };
}

describe('pipe flow model', () => {
    it('traces a complete source-to-sink route', () => {
        const result = tracePipeFlow(createSolvedBoard());

        expect(result.completed).toBe(true);
        expect(result.poweredTileIndices).toEqual([4, 5, 6, 7]);
        expect(result.leakingTileIndices).toEqual([]);
    });

    it('breaks the route when a piece rotates and counts the turn', () => {
        const board = createSolvedBoard();
        const rotated = rotatePipeTile(board, 5);
        const result = tracePipeFlow(rotated);

        expect(rotated.turns).toBe(1);
        expect(board.tiles[5]?.rotation).toBe(1);
        expect(rotated.tiles[5]?.rotation).toBe(2);
        expect(result.completed).toBe(false);
        expect(result.leakingTileIndices).toContain(4);
    });

    it('rotates connection geometry consistently', () => {
        expect(getPipeConnections({kind: 'corner', rotation: 0, locked: false}))
            .toEqual(['up', 'right']);
        expect(getPipeConnections({kind: 'corner', rotation: 2, locked: false}))
            .toEqual(['down', 'left']);
    });

    it('creates a deterministic, initially unsolved intro board', () => {
        const first = createIntroPipeBoard(new Mulberry32Random(1234));
        const second = createIntroPipeBoard(new Mulberry32Random(1234));

        expect(first).toEqual(second);
        expect(tracePipeFlow(first).completed).toBe(false);
    });

    it('does not rotate locked source and sink tiles', () => {
        const board = createSolvedBoard();

        expect(rotatePipeTile(board, 4)).toBe(board);
        expect(rotatePipeTile(board, 7)).toBe(board);
    });

    it('solves the migration encounter with the documented route', () => {
        let board = createIntroPipeBoard(new Mulberry32Random(20_260_724));
        const solvedRotations = new Map([
            [5, 1],
            [6, 2],
            [10, 0]
        ] as const);

        for (const [tileIndex, solvedRotation] of solvedRotations) {
            while (board.tiles[tileIndex]?.rotation !== solvedRotation) {
                board = rotatePipeTile(board, tileIndex);
            }
        }

        expect(tracePipeFlow(board).completed).toBe(true);
    });
});