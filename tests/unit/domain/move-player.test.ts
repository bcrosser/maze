import {describe, expect, it} from 'vitest';

import {createInitialCampaignState, type CampaignState} from '../../../src/domain/campaign/campaign-state';
import type {MaterialId} from '../../../src/domain/materials/materials';
import type {MazeGrid} from '../../../src/domain/overworld/maze-types';
import {moveOverworldPlayer} from '../../../src/domain/overworld/move-player';

function createTestCampaign(): CampaignState {
    const layout: readonly (readonly (MaterialId | null)[])[] = [
        ['stone', 'stone', 'stone', 'stone', 'stone'],
        ['stone', null, 'stone', null, 'stone'],
        ['stone', null, 'wood', null, 'stone'],
        ['stone', null, null, null, 'stone'],
        ['stone', 'stone', 'stone', 'stone', 'stone']
    ];
    const maze: MazeGrid = layout.map(row => row.map(materialId => materialId === null
        ? {kind: 'passage', materialId: null} as const
        : {kind: 'wall', materialId} as const));
    return createInitialCampaignState({campaignSeed: 7, maze});
}

describe('moveOverworldPlayer', () => {
    it('moves through an open passage', () => {
        const result = moveOverworldPlayer(createTestCampaign(), 'down');

        expect(result.event.kind).toBe('moved');
        expect(result.state.overworld.playerPosition).toEqual({x: 1, y: 2});
    });

    it('mines a supported mineral and consumes one tool charge', () => {
        const campaign = createTestCampaign();
        const prepared: CampaignState = {
            ...campaign,
            player: {...campaign.player, miningPower: 2, toolCharge: 3}
        };
        const result = moveOverworldPlayer(prepared, 'right');

        expect(result.event).toEqual({
            kind: 'mined',
            materialId: 'stone',
            message: 'Mined through Stone.'
        });
        expect(result.state.player.toolCharge).toBe(2);
        expect(result.state.overworld.playerPosition).toEqual({x: 2, y: 1});
        expect(result.state.overworld.maze[1]?.[2]?.kind).toBe('passage');
    });

    it('explains when a material cannot be mined', () => {
        const campaign = createTestCampaign();
        const positioned: CampaignState = {
            ...campaign,
            overworld: {...campaign.overworld, playerPosition: {x: 1, y: 2}}
        };
        const result = moveOverworldPlayer(positioned, 'right');

        expect(result.state).toBe(positioned);
        expect(result.event).toEqual({
            kind: 'blocked',
            message: 'Wood cannot be mined with this pick.'
        });
    });

    it('does not allow mining through the perimeter', () => {
        const campaign = createTestCampaign();
        const prepared: CampaignState = {
            ...campaign,
            player: {...campaign.player, miningPower: 2, toolCharge: 3}
        };
        const result = moveOverworldPlayer(prepared, 'up');

        expect(result.state).toBe(prepared);
        expect(result.event).toEqual({kind: 'blocked'});
    });
});