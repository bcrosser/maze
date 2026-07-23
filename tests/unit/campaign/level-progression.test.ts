import {describe, expect, it} from 'vitest';

import {createInitialCampaignState} from '../../../src/domain/campaign/campaign-state';
import {
    advanceCampaignLevel,
    getCampaignLevelNumber,
    getLevelExitStatus
} from '../../../src/domain/campaign/level-progression';
import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import {Mulberry32Random} from '../../../src/domain/random/random-source';

function createCampaign() {
    const maze = generateMaze({size: 21, random: new Mulberry32Random(7)});
    const initial = createInitialCampaignState({campaignSeed: 7, maze});
    return {
        ...initial,
        player: {...initial.player, miningPower: 2, toolCharge: 6, scrap: 17},
        flags: ['coolant-routing-restored', 'archive-lock-opened', 'kept-across-levels'],
        overworld: {
            ...initial.overworld,
            itemsInitialized: true,
            monstersInitialized: true,
            triggerStates: {'coolant-terminal': 'resolved' as const}
        }
    };
}

describe('campaign level progression', () => {
    it('grows and resets the level while preserving player progression', () => {
        const next = advanceCampaignLevel(createCampaign());

        expect(getCampaignLevelNumber(next)).toBe(2);
        expect(next.overworld.maze).toHaveLength(25);
        expect(next.overworld.playerPosition).toEqual({x: 1, y: 1});
        expect(next.overworld.itemsInitialized).toBe(false);
        expect(next.overworld.monstersInitialized).toBe(false);
        expect(next.overworld.triggerStates).toEqual({});
        expect(next.player.miningPower).toBe(2);
        expect(next.player.toolCharge).toBe(6);
        expect(next.player.scrap).toBe(17);
        expect(next.flags).toEqual(['kept-across-levels']);
    });

    it('can repeat the same content structure across higher levels', () => {
        const levelTwo = advanceCampaignLevel(createCampaign());
        const levelThree = advanceCampaignLevel(levelTwo);

        expect(getCampaignLevelNumber(levelThree)).toBe(3);
        expect(levelThree.overworld.maze).toHaveLength(29);
        expect(levelThree.overworld.seed).not.toBe(levelTwo.overworld.seed);
    });

    it('requires all four integrated games before the exit is ready', () => {
        const locked = getLevelExitStatus(createCampaign());
        const ready = getLevelExitStatus({
            ...createCampaign(),
            flags: [
                'coolant-routing-restored',
                'archive-lock-opened',
                'orbital-corridor-cleared',
                'sublevel-nine-stabilized'
            ]
        });

        expect(locked).toEqual({ready: false, completed: 2, total: 4, nextLabel: 'Flight'});
        expect(ready).toEqual({ready: true, completed: 4, total: 4, nextLabel: null});
    });
});