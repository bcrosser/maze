import {describe, expect, it} from 'vitest';

import {
    createInitialCampaignState,
    type CampaignState
} from '../../../src/domain/campaign/campaign-state';
import {calculateMonsterMoneyDrop} from '../../../src/domain/economy/economy';
import {initializeLevelContent} from '../../../src/domain/overworld/level-content-generator';
import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import {getPassageDistances} from '../../../src/domain/overworld/objective-placement';
import {
    advanceOverworldReinforcements,
    createReinforcementMonster,
    getReinforcementMonsterCap,
    REINFORCEMENT_LANDMARK_SAFE_DISTANCE,
    REINFORCEMENT_PLAYER_SAFE_DISTANCE
} from '../../../src/domain/overworld/reinforcements';
import {
    getReinforcementDelayMs,
    MAX_REINFORCEMENT_DELAY_MS,
    MIN_REINFORCEMENT_DELAY_MS
} from '../../../src/domain/overworld/reinforcement-schedule';
import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {campaignStateSchema} from '../../../src/save/campaign-state.schema';

function campaign(seed = 73): CampaignState {
    const maze = generateMaze({size: 21, random: new Mulberry32Random(seed)});
    return initializeLevelContent(createInitialCampaignState({
        campaignSeed: seed,
        overworldSeed: seed,
        maze
    }));
}

function key(position: {readonly x: number; readonly y: number}): string {
    return `${position.x},${position.y}`;
}

describe('overworld monster reinforcements', () => {
    it('derives a reproducible inclusive 30–60 second delay for every ordinal', () => {
        const delays = Array.from({length: 128}, (_, ordinal) =>
            getReinforcementDelayMs(991, ordinal)
        );

        expect(delays).toEqual(Array.from({length: 128}, (_, ordinal) =>
            getReinforcementDelayMs(991, ordinal)
        ));
        expect(Math.min(...delays)).toBeGreaterThanOrEqual(MIN_REINFORCEMENT_DELAY_MS);
        expect(Math.max(...delays)).toBeLessThanOrEqual(MAX_REINFORCEMENT_DELAY_MS);
        expect(delays.every(delay => delay % 1_000 === 0)).toBe(true);
        expect(new Set(delays).size).toBeGreaterThan(20);
    });

    it('persists an initialized seeded countdown in a new campaign', () => {
        const state = createInitialCampaignState({
            campaignSeed: 17,
            overworldSeed: 901,
            maze: generateMaze({size: 21, random: new Mulberry32Random(901)})
        });

        expect(state.overworld.reinforcementOrdinal).toBe(0);
        expect(state.overworld.reinforcementCountdownMs)
            .toBe(getReinforcementDelayMs(901, 0));
        expect(campaignStateSchema.safeParse(state).success).toBe(true);
    });

    it('creates the same stable monster, features, drop, and fair reachable position', () => {
        const state = campaign(211);
        const ordinal = 14;
        const first = createReinforcementMonster(state, ordinal);
        const second = createReinforcementMonster(state, ordinal);

        expect(first).not.toBeNull();
        expect(second).toEqual(first);
        expect(first?.id).toBe(`${state.overworld.levelId}/reinforcement-${ordinal + 1}`);
        if (!first) throw new Error('Expected a reinforcement candidate.');

        const fromPlayer = getPassageDistances(
            state.overworld.maze,
            state.overworld.playerPosition
        );
        expect(fromPlayer.get(key(first.position)))
            .toBeGreaterThanOrEqual(REINFORCEMENT_PLAYER_SAFE_DISTANCE);

        const landmarks = [
            {x: state.overworld.maze.length - 2, y: state.overworld.maze.length - 2},
            state.overworld.sanctuaryPosition,
            ...state.overworld.objectives.map(objective => objective.position),
            ...state.overworld.serviceSites.map(site => site.position)
        ];
        for (const landmark of landmarks) {
            expect(getPassageDistances(state.overworld.maze, landmark).get(key(first.position)))
                .toBeGreaterThan(REINFORCEMENT_LANDMARK_SAFE_DISTANCE);
        }
        expect(state.overworld.maze[first.position.y]?.[first.position.x]?.kind)
            .toBe('passage');
        expect(state.overworld.items.some(item => key(item.position) === key(first.position)))
            .toBe(false);
        expect(state.overworld.traps.some(trap => key(trap.position) === key(first.position)))
            .toBe(false);
        if (first.drop) expect(first.drop.id).toBe(`${first.id}/drop`);
    });

    it('advances active time, spawns at due time, and saves the next schedule', () => {
        const original = campaign(307);
        const state: CampaignState = {
            ...original,
            overworld: {
                ...original.overworld,
                monsters: [],
                reinforcementCountdownMs: 1_500,
                reinforcementOrdinal: 0
            }
        };

        const waiting = advanceOverworldReinforcements(state, 1_499.5);
        expect(waiting.spawnedMonsters).toEqual([]);
        expect(waiting.state.overworld.reinforcementCountdownMs).toBe(0.5);

        const due = advanceOverworldReinforcements(waiting.state, 0.5);
        expect(due.spawnedMonsters).toHaveLength(1);
        expect(due.spawnedMonsters[0]?.id).toBe(`${state.overworld.levelId}/reinforcement-1`);
        expect(due.state.overworld.reinforcementOrdinal).toBe(1);
        expect(due.state.overworld.reinforcementCountdownMs)
            .toBe(getReinforcementDelayMs(state.overworld.seed, 1));
        expect(due.spawnPending).toBe(false);
        expect(campaignStateSchema.safeParse(due.state).success).toBe(true);
    });

    it('holds a due reinforcement pending at the cap and releases it after a kill', () => {
        const original = campaign(401);
        const template = original.overworld.monsters[0]!;
        const capped: CampaignState = {
            ...original,
            overworld: {
                ...original.overworld,
                reinforcementCountdownMs: 25,
                monsters: Array.from(
                    {length: getReinforcementMonsterCap(original)},
                    (_, index) => ({...template, id: `test/capped-${index}`})
                )
            }
        };

        const pending = advanceOverworldReinforcements(capped, 25);
        expect(pending.spawnedMonsters).toEqual([]);
        expect(pending.spawnPending).toBe(true);
        expect(pending.state.overworld.reinforcementCountdownMs).toBe(0);
        expect(pending.state.overworld.reinforcementOrdinal).toBe(0);

        const afterKill: CampaignState = {
            ...pending.state,
            overworld: {
                ...pending.state.overworld,
                monsters: pending.state.overworld.monsters.slice(1)
            }
        };
        const released = advanceOverworldReinforcements(afterKill, 0);
        expect(released.spawnedMonsters).toHaveLength(1);
        expect(released.state.overworld.monsters)
            .toHaveLength(getReinforcementMonsterCap(original));
        expect(released.state.overworld.reinforcementOrdinal).toBe(1);
        expect(released.spawnPending).toBe(false);
    });

    it('can repeatedly replace defeated monsters with unique IDs and cash rewards', () => {
        const original = campaign(503);
        let state: CampaignState = {
            ...original,
            overworld: {
                ...original.overworld,
                monsters: [],
                reinforcementCountdownMs: 0
            }
        };
        const ids = new Set<string>();

        for (let kill = 0; kill < 12; kill++) {
            const result = advanceOverworldReinforcements(state, 0);
            const monster = result.spawnedMonsters[0];
            expect(monster).toBeDefined();
            if (!monster) throw new Error('Expected a replacement monster.');
            expect(ids.has(monster.id)).toBe(false);
            expect(calculateMonsterMoneyDrop(monster)).toBeGreaterThan(0);
            ids.add(monster.id);
            state = {
                ...result.state,
                overworld: {
                    ...result.state.overworld,
                    monsters: result.state.overworld.monsters.filter(
                        candidate => candidate.id !== monster.id
                    ),
                    reinforcementCountdownMs: 0
                }
            };
        }

        expect(ids.size).toBe(12);
        expect(state.overworld.reinforcementOrdinal).toBe(12);
    });

    it('does not advance while the overworld content is inactive', () => {
        const maze = generateMaze({size: 21, random: new Mulberry32Random(607)});
        const state = createInitialCampaignState({campaignSeed: 607, maze});
        const result = advanceOverworldReinforcements(state, 60_000);

        expect(result.state).toBe(state);
        expect(result.spawnedMonsters).toEqual([]);
    });

    it('rejects invalid elapsed time instead of corrupting the persisted clock', () => {
        const state = campaign(701);

        expect(() => advanceOverworldReinforcements(state, -1))
            .toThrow('finite non-negative');
        expect(() => advanceOverworldReinforcements(state, Number.NaN))
            .toThrow('finite non-negative');
    });
});
