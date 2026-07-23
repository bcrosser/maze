import {describe, expect, it} from 'vitest';

import {MATERIAL_IDS} from '../../../src/domain/materials/materials';
import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import type {MazeGrid} from '../../../src/domain/overworld/maze-types';
import {Mulberry32Random} from '../../../src/domain/random/random-source';

const DIRECTIONS = [
    {x: 0, y: -1},
    {x: 0, y: 1},
    {x: -1, y: 0},
    {x: 1, y: 0}
] as const;

function createMaze(seed: number): MazeGrid {
    return generateMaze({size: 21, random: new Mulberry32Random(seed)});
}

function countReachablePassages(maze: MazeGrid): number {
    const queue = [{x: 1, y: 1}];
    const visited = new Set(['1,1']);

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
        const current = queue[queueIndex]!;
        for (const direction of DIRECTIONS) {
            const x = current.x + direction.x;
            const y = current.y + direction.y;
            if (maze[y]?.[x]?.kind !== 'passage') continue;
            const key = `${x},${y}`;
            if (visited.has(key)) continue;
            visited.add(key);
            queue.push({x, y});
        }
    }

    return visited.size;
}

describe('generateMaze', () => {
    it('reproduces the same maze from the same seed', () => {
        expect(createMaze(19_840_523)).toEqual(createMaze(19_840_523));
    });

    it('creates a connected passage network with a solid perimeter', () => {
        const maze = createMaze(90210);
        const passageCount = maze.flat().filter(cell => cell.kind === 'passage').length;

        expect(countReachablePassages(maze)).toBe(passageCount);
        expect(maze[1]?.[1]?.kind).toBe('passage');
        expect(maze[19]?.[19]?.kind).toBe('passage');

        for (let index = 0; index < maze.length; index++) {
            expect(maze[0]?.[index]?.kind).toBe('wall');
            expect(maze[maze.length - 1]?.[index]?.kind).toBe('wall');
            expect(maze[index]?.[0]?.kind).toBe('wall');
            expect(maze[index]?.[maze.length - 1]?.kind).toBe('wall');
        }
    });

    it('assigns every registered material on the initial maze size', () => {
        const materialIds = new Set(
            createMaze(77)
                .flat()
                .filter(cell => cell.kind === 'wall')
                .map(cell => cell.materialId)
        );

        expect(materialIds).toEqual(new Set(MATERIAL_IDS));
    });

    it('rejects sizes that cannot form the odd-cell maze lattice', () => {
        expect(() => generateMaze({size: 20, random: new Mulberry32Random(1)}))
            .toThrow('Maze size must be an odd safe integer of at least 5.');
    });
});