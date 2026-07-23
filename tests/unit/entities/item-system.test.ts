import {describe, expect, it} from 'vitest';

import {createInitialCampaignState, type CampaignState} from '../../../src/domain/campaign/campaign-state';
import {collectItemAtPlayer, spawnInitialItems} from '../../../src/domain/entities/item-system';
import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import {Mulberry32Random} from '../../../src/domain/random/random-source';

function createCampaign(): CampaignState {
    const maze = generateMaze({size: 21, random: new Mulberry32Random(10)});
    return createInitialCampaignState({campaignSeed: 10, maze});
}

describe('overworld item system', () => {
    it('spawns deterministic, unique items away from reserved cells', () => {
        const campaign = createCampaign();
        const reserved = [{x: 1, y: 3}];
        const first = spawnInitialItems(
            campaign.overworld.maze,
            new Mulberry32Random(22),
            reserved
        );
        const second = spawnInitialItems(
            campaign.overworld.maze,
            new Mulberry32Random(22),
            reserved
        );
        const positions = first.map(item => `${item.position.x},${item.position.y}`);

        expect(first).toEqual(second);
        expect(first).toHaveLength(4);
        expect(new Set(positions).size).toBe(first.length);
        expect(positions).not.toContain('1,1');
        expect(positions).not.toContain('19,19');
        expect(positions).not.toContain('1,3');
    });

    it('restores at most four health and consumes the potion', () => {
        const campaign = createCampaign();
        const prepared: CampaignState = {
            ...campaign,
            player: {...campaign.player, health: 5},
            overworld: {
                ...campaign.overworld,
                itemsInitialized: true,
                items: [{id: 'potion', typeId: 'health-potion', position: {x: 1, y: 1}}]
            }
        };
        const result = collectItemAtPlayer(prepared);

        expect(result.state.player.health).toBe(9);
        expect(result.state.overworld.items).toHaveLength(0);
        expect(result.event?.message).toBe('Health Potion restored 4 health.');
    });

    it('grants persistent mining power and six charges', () => {
        const campaign = createCampaign();
        const prepared: CampaignState = {
            ...campaign,
            overworld: {
                ...campaign.overworld,
                itemsInitialized: true,
                items: [{id: 'pick', typeId: 'mining-pick', position: {x: 1, y: 1}}]
            }
        };
        const result = collectItemAtPlayer(prepared);

        expect(result.state.player.miningPower).toBe(2);
        expect(result.state.player.toolCharge).toBe(6);
        expect(result.state.overworld.items).toHaveLength(0);
        expect(result.event?.message).toBe('Mining Pick granted 6 mining charges.');
    });
});