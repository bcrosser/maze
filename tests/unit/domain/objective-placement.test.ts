import {describe, expect, it} from 'vitest';

import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import {
    LEVEL_OBJECTIVE_COUNT,
    MAX_LEVEL_OBJECTIVE_COUNT,
    OBJECTIVE_IDS
} from '../../../src/domain/overworld/level-objectives';
import {placeLevelObjectives} from '../../../src/domain/overworld/objective-placement';
import {Mulberry32Random} from '../../../src/domain/random/random-source';

function generated(seed: number) {
    return generateMaze({
        size: 21,
        topologyRandom: new Mulberry32Random(seed),
        materialRandom: new Mulberry32Random(seed ^ 0x55aa)
    });
}

describe('placeLevelObjectives', () => {
    it('places four stable, unique, reachable objective sites and a Pipe wall shortcut', () => {
        const maze = generated(42);
        const roster = ['pipe', 'lock', 'space', 'platformer'] as const;
        const first = placeLevelObjectives(maze, new Mulberry32Random(99), [], roster);
        const second = placeLevelObjectives(maze, new Mulberry32Random(99), [], roster);

        expect(second).toEqual(first);
        expect(first.objectives).toHaveLength(LEVEL_OBJECTIVE_COUNT);
        expect(new Set(first.objectives.map(objective => objective.objectiveId)).size)
            .toBe(LEVEL_OBJECTIVE_COUNT);
        expect(first.objectives.every(objective =>
            OBJECTIVE_IDS.includes(objective.objectiveId)
        )).toBe(true);
        expect(new Set(first.objectives.map(objective =>
            `${objective.position.x},${objective.position.y}`
        )).size).toBe(4);
        for (const objective of first.objectives) {
            expect(maze[objective.position.y]?.[objective.position.x]?.kind).toBe('passage');
        }
        expect(first.pipeShortcutWall).not.toBeNull();
        const shortcut = first.pipeShortcutWall!;
        expect(maze[shortcut.y]?.[shortcut.x]?.kind).toBe('wall');
        expect(shortcut.x % 2).not.toBe(shortcut.y % 2);
    });

    it('always chooses a valid edge wall across a seed corpus', () => {
        for (let seed = 0; seed < 128; seed++) {
            const maze = generated(seed);
            const placement = placeLevelObjectives(
                maze,
                new Mulberry32Random(seed ^ 0xa5a5),
                [],
                ['pipe', 'lock', 'space', 'platformer']
            );
            const shortcut = placement.pipeShortcutWall!;
            const horizontal =
                maze[shortcut.y]?.[shortcut.x - 1]?.kind === 'passage' &&
                maze[shortcut.y]?.[shortcut.x + 1]?.kind === 'passage';
            const vertical =
                maze[shortcut.y - 1]?.[shortcut.x]?.kind === 'passage' &&
                maze[shortcut.y + 1]?.[shortcut.x]?.kind === 'passage';

            expect(shortcut.x % 2).not.toBe(shortcut.y % 2);
            expect(horizontal || vertical).toBe(true);
        }
    });

    it('does not reserve an unclaimable shortcut when Pipe is not selected', () => {
        const placement = placeLevelObjectives(
            generated(18),
            new Mulberry32Random(24),
            [],
            ['lock', 'space', 'platformer', 'circuit']
        );

        expect(placement.pipeShortcutWall).toBeNull();
    });

    it('varies placement across seeds', () => {
        const maze = generated(7);
        const signatures = new Set(Array.from({length: 20}, (_, seed) =>
            placeLevelObjectives(maze, new Mulberry32Random(seed)).objectives
                .map(objective => `${objective.objectiveId}:${objective.position.x},${objective.position.y}`)
                .join('|')
        ));
        expect(signatures.size).toBeGreaterThan(15);
    });

    it('places an explicitly selected four-game roster without adding unselected games', () => {
        const selected = ['circuit', 'horsemaster', 'pipe', 'space'] as const;
        const placement = placeLevelObjectives(
            generated(17),
            new Mulberry32Random(23),
            [],
            selected
        );

        expect(placement.objectives.map(objective => objective.objectiveId)).toEqual(selected);
        expect(placement.objectives.some(objective =>
            objective.objectiveId === 'lock' || objective.objectiveId === 'platformer'
        )).toBe(false);
    });

    it('accepts level-scaled rosters from four through all eight games', () => {
        const maze = generated(71);
        for (
            let count = LEVEL_OBJECTIVE_COUNT;
            count <= MAX_LEVEL_OBJECTIVE_COUNT;
            count++
        ) {
            const selected = OBJECTIVE_IDS.slice(0, count);
            const placement = placeLevelObjectives(
                maze,
                new Mulberry32Random(900 + count),
                [],
                selected
            );
            expect(placement.objectives.map(objective => objective.objectiveId))
                .toEqual(selected);
            expect(new Set(placement.objectives.map(objective =>
                `${objective.position.x},${objective.position.y}`
            )).size).toBe(count);
        }
    });

    it('rejects undersized gameplay mazes', () => {
        const maze = generateMaze({size: 5, random: new Mulberry32Random(1)});
        expect(() => placeLevelObjectives(maze, new Mulberry32Random(1))).toThrow(/21/);
    });
});
