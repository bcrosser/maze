import {describe, expect, it} from 'vitest';

import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {placeIntroTrigger} from '../../../src/encounters/place-intro-trigger';

describe('placeIntroTrigger', () => {
    it('places a reachable terminal one step from spawn with an interior wall reward', () => {
        const maze = generateMaze({size: 21, random: new Mulberry32Random(20_260_723)});
        const placement = placeIntroTrigger(maze, {x: 1, y: 1});

        expect(Math.abs(placement.position.x - 1) + Math.abs(placement.position.y - 1)).toBe(1);
        expect(maze[placement.position.y]?.[placement.position.x]?.kind).toBe('passage');
        expect(maze[placement.benefitWallPosition.y]?.[placement.benefitWallPosition.x]?.kind)
            .toBe('wall');
        expect(placement.benefitWallPosition.x).toBeGreaterThan(0);
        expect(placement.benefitWallPosition.y).toBeGreaterThan(0);
        expect(placement.nearbyMaterialIds.length).toBeGreaterThan(0);
        expect(placement.nearbyMaterialTags.length).toBeGreaterThan(0);
    });
});