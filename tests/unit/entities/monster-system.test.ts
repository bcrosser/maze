import {describe, expect, it} from 'vitest';

import {createInitialCampaignState, type CampaignState} from '../../../src/domain/campaign/campaign-state';
import {
    advanceMonsterTurn,
    spawnInitialMonsters
} from '../../../src/domain/entities/monster-system';
import type {MaterialId} from '../../../src/domain/materials/materials';
import type {MazeGrid} from '../../../src/domain/overworld/maze-types';
import {Mulberry32Random} from '../../../src/domain/random/random-source';

function createOpenCampaign(): CampaignState {
    const layout: readonly (readonly (MaterialId | null)[])[] = [
        ['stone', 'stone', 'stone', 'stone', 'stone'],
        ['stone', null, null, null, 'stone'],
        ['stone', null, null, null, 'stone'],
        ['stone', null, null, null, 'stone'],
        ['stone', 'stone', 'stone', 'stone', 'stone']
    ];
    const maze: MazeGrid = layout.map(row => row.map(materialId => materialId === null
        ? {kind: 'passage', materialId: null} as const
        : {kind: 'wall', materialId} as const));
    return createInitialCampaignState({campaignSeed: 5, maze});
}

describe('overworld monster system', () => {
    it('spawns deterministic, unique monsters away from reserved positions', () => {
        const campaign = createOpenCampaign();
        const first = spawnInitialMonsters(
            campaign.overworld.maze,
            new Mulberry32Random(8),
            [{x: 1, y: 2}]
        );
        const second = spawnInitialMonsters(
            campaign.overworld.maze,
            new Mulberry32Random(8),
            [{x: 1, y: 2}]
        );
        const positions = first.map(monster => `${monster.position.x},${monster.position.y}`);

        expect(first).toEqual(second);
        expect(new Set(positions).size).toBe(first.length);
        expect(positions).not.toContain('1,1');
        expect(positions).not.toContain('1,2');
    });

    it('moves the ember hound one breadth-first step toward the player', () => {
        const campaign = createOpenCampaign();
        const prepared: CampaignState = {
            ...campaign,
            overworld: {
                ...campaign.overworld,
                turn: 2,
                monstersInitialized: true,
                monsters: [{
                    id: 'hound',
                    typeId: 'ember-hound',
                    position: {x: 3, y: 1},
                    lastMoveTurn: 0,
                    lastAttackTurn: Number.MIN_SAFE_INTEGER
                }]
            }
        };
        const result = advanceMonsterTurn(prepared, new Mulberry32Random(1));

        expect(result.state.overworld.monsters[0]?.position).toEqual({x: 2, y: 1});
        expect(result.events).toContainEqual({kind: 'monster-moved', monsterId: 'hound'});
    });

    it('adds one ember-hound damage beside a hot wall', () => {
        const campaign = createOpenCampaign();
        const maze = campaign.overworld.maze.map(row => [...row]);
        maze[2]![1] = {kind: 'wall', materialId: 'fire'};
        const prepared: CampaignState = {
            ...campaign,
            overworld: {
                ...campaign.overworld,
                maze,
                turn: 2,
                monstersInitialized: true,
                monsters: [{
                    id: 'hound',
                    typeId: 'ember-hound',
                    position: {x: 1, y: 1},
                    lastMoveTurn: 2,
                    lastAttackTurn: Number.MIN_SAFE_INTEGER
                }]
            }
        };
        const result = advanceMonsterTurn(prepared, new Mulberry32Random(1));

        expect(result.state.player.health).toBe(7);
        expect(result.events).toContainEqual({
            kind: 'player-damaged',
            monsterId: 'hound',
            typeId: 'ember-hound',
            amount: 3,
            message: 'Ember Hound dealt 3 damage.'
        });
    });

    it('uses encounter-return grace before monsters resume', () => {
        const campaign = createOpenCampaign();
        const prepared: CampaignState = {
            ...campaign,
            overworld: {...campaign.overworld, resumeGraceTurns: 1}
        };
        const result = advanceMonsterTurn(prepared, new Mulberry32Random(1));

        expect(result.state.overworld.resumeGraceTurns).toBe(0);
        expect(result.state.overworld.monsters).toEqual(prepared.overworld.monsters);
        expect(result.events).toEqual([]);
    });
});