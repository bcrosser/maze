import {describe, expect, it} from 'vitest';

import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import {selectLevelObjectiveIds} from '../../../src/domain/overworld/level-objectives';
import {placeLevelObjectives} from '../../../src/domain/overworld/objective-placement';
import {
    placeLevelServiceSites,
    SERVICE_SITE_MINIMUM_SEPARATION
} from '../../../src/domain/overworld/service-site-placement';
import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {deriveSeed} from '../../../src/domain/random/seed-derivation';

function createLevel(seed: number, levelNumber = 1, forceShop = false) {
    const maze = generateMaze({
        size: 21,
        topologyRandom: new Mulberry32Random(deriveSeed(seed, 'maze-topology')),
        materialRandom: new Mulberry32Random(deriveSeed(seed, 'wall-materials'))
    });
    const objectives = placeLevelObjectives(
        maze,
        new Mulberry32Random(deriveSeed(seed, 'objectives')),
        [],
        selectLevelObjectiveIds(seed, levelNumber)
    ).objectives;
    const sites = placeLevelServiceSites(
        maze,
        `level-${seed + 1}`,
        objectives,
        new Mulberry32Random(deriveSeed(seed, 'services')),
        {forceShop}
    );
    return {maze, objectives, sites};
}

describe('optional service-site placement', () => {
    it('always places both optional card games on distinct reachable passages', () => {
        for (let seed = 0; seed < 100; seed++) {
            const {maze, objectives, sites} = createLevel(seed);
            expect(sites.some(site => site.kind === 'blackjack')).toBe(true);
            expect(sites.some(site => site.kind === 'holdem')).toBe(true);
            expect(new Set(sites.map(site => `${site.position.x},${site.position.y}`)).size)
                .toBe(sites.length);
            for (const site of sites) {
                expect(maze[site.position.y]?.[site.position.x]?.kind).toBe('passage');
                expect(objectives.some(objective =>
                    objective.position.x === site.position.x &&
                    objective.position.y === site.position.y
                )).toBe(false);
            }
        }
    });

    it('keeps the placement stable for the same level seed', () => {
        expect(createLevel(77).sites).toEqual(createLevel(77).sites);
    });

    it('places services without collisions beside four- through eight-game rosters', () => {
        for (const levelNumber of [4, 5, 6, 7, 8]) {
            for (let seed = 20; seed < 30; seed++) {
                const {objectives, sites} = createLevel(seed, levelNumber);
                const occupied = new Set(objectives.map(objective =>
                    `${objective.position.x},${objective.position.y}`
                ));
                expect(objectives).toHaveLength(levelNumber);
                expect(sites.some(site => site.kind === 'blackjack')).toBe(true);
                expect(sites.some(site => site.kind === 'holdem')).toBe(true);
                expect(sites.every(site =>
                    !occupied.has(`${site.position.x},${site.position.y}`)
                )).toBe(true);
            }
        }
    });

    it('allows shops to appear on some levels and be absent on others', () => {
        const shopResults = Array.from({length: 100}, (_, seed) =>
            createLevel(seed).sites.some(site => site.kind === 'shop')
        );
        expect(shopResults).toContain(true);
        expect(shopResults).toContain(false);
    });

    it('forces a shop when a selected locked activity needs a purchase route', () => {
        for (let seed = 0; seed < 25; seed++) {
            expect(createLevel(seed, 8, true).sites.some(site =>
                site.kind === 'shop'
            )).toBe(true);
        }
    });

    it('normally separates services from objectives by the preferred graph floor', () => {
        // The placement search relaxes only on unusually cramped layouts. A normal
        // generated level has enough room to preserve the preferred spacing.
        const {maze, objectives, sites} = createLevel(12);
        const positions = [
            ...objectives.map(objective => objective.position),
            ...sites.map(site => site.position)
        ];
        for (let left = 0; left < positions.length; left++) {
            const start = positions[left]!;
            const distances = new Map<string, number>();
            const queue = [{...start, distance: 0}];
            distances.set(`${start.x},${start.y}`, 0);
            for (let index = 0; index < queue.length; index++) {
                const current = queue[index]!;
                for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
                    const x = current.x + dx;
                    const y = current.y + dy;
                    const key = `${x},${y}`;
                    if (maze[y]?.[x]?.kind !== 'passage' || distances.has(key)) continue;
                    distances.set(key, current.distance + 1);
                    queue.push({x, y, distance: current.distance + 1});
                }
            }
            for (let right = left + 1; right < positions.length; right++) {
                expect(distances.get(`${positions[right]!.x},${positions[right]!.y}`))
                    .toBeGreaterThanOrEqual(SERVICE_SITE_MINIMUM_SEPARATION);
            }
        }
    });
});
