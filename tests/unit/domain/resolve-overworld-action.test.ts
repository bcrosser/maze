import {describe, expect, it} from 'vitest';

import {
    createInitialCampaignState,
    type CampaignState
} from '../../../src/domain/campaign/campaign-state';
import {
    CAMPAIGN_VICTORY_FLAG,
    MAX_CAMPAIGN_LEVEL
} from '../../../src/domain/campaign/level-progression';
import {createItemInstance} from '../../../src/domain/entities/item-types';
import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import {initializeLevelContent} from '../../../src/domain/overworld/level-content-generator';
import {
    DIRECTION_VECTORS,
    type DirectionId
} from '../../../src/domain/overworld/move-player';
import {
    CASINO_HEIST_UNLOCK_FLAG,
    OBJECTIVE_BY_ID,
    OBJECTIVE_DEFINITIONS
} from '../../../src/domain/overworld/level-objectives';
import {resolveOverworldAction} from '../../../src/domain/overworld/resolve-overworld-action';
import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {campaignStateSchema} from '../../../src/save/campaign-state.schema';

function campaign(seed = 22, levelId = 'level-1') {
    const maze = generateMaze({
        size: 21,
        topologyRandom: new Mulberry32Random(seed),
        materialRandom: new Mulberry32Random(seed + 1)
    });
    return initializeLevelContent(createInitialCampaignState({
        campaignSeed: seed,
        overworldSeed: seed,
        levelId,
        maze
    }));
}

function openDirection(state: CampaignState): {
    readonly direction: DirectionId;
    readonly position: {readonly x: number; readonly y: number};
} {
    for (const [direction, vector] of Object.entries(DIRECTION_VECTORS) as [
        DirectionId,
        {readonly x: number; readonly y: number}
    ][]) {
        const position = {
            x: state.overworld.playerPosition.x + vector.x,
            y: state.overworld.playerPosition.y + vector.y
        };
        if (state.overworld.maze[position.y]?.[position.x]?.kind === 'passage') {
            return {direction, position};
        }
    }
    throw new Error('Expected an open direction from spawn.');
}

describe('resolveOverworldAction', () => {
    it('does not consume a turn for a blocked move', () => {
        const state = campaign();
        const result = resolveOverworldAction(state, {kind: 'move', direction: 'up'});
        expect(result.consumedTurn).toBe(false);
        expect(result.state).toBe(state);
    });

    it('always leaves the fallback melee attack available', () => {
        const base = campaign();
        const monster = {
            ...base.overworld.monsters[0]!,
            position: {x: 1, y: 2},
            spawnPosition: {x: 1, y: 2},
            health: 1,
            maxHealth: 1
        };
        const state = {
            ...base,
            overworld: {...base.overworld, monsters: [monster]}
        };
        const result = resolveOverworldAction(state, {kind: 'move', direction: 'down'});
        expect(result.consumedTurn).toBe(true);
        expect(result.state.overworld.monsters).toHaveLength(0);
        expect(result.state.overworld.playerPosition).toEqual({x: 1, y: 2});
        const defeated = result.events.find(event => event.kind === 'monster-defeated');
        expect(defeated).toMatchObject({
            kind: 'monster-defeated',
            monsterId: monster.id,
            moneyDropped: expect.any(Number)
        });
        expect(result.state.player.money).toBe(
            state.player.money + (defeated?.kind === 'monster-defeated'
                ? defeated.moneyDropped
                : 0)
        );
    });

    it('stores a full-health potion instead of consuming it', () => {
        const base = campaign();
        const potion = base.overworld.items.find(item =>
            item.instance.baseTypeId === 'health-potion'
        )!;
        const state = {
            ...base,
            overworld: {
                ...base.overworld,
                playerPosition: potion.position,
                monsters: [],
                traps: []
            }
        };
        const result = resolveOverworldAction(state, {kind: 'wait'});
        expect(result.state.player.health).toBe(10);
        expect(result.state.player.backpack.some(item =>
            item.baseTypeId === 'health-potion'
        )).toBe(true);
    });

    it('collects coin items into the money wallet rather than scrap', () => {
        const base = campaign();
        const coin = createItemInstance('test/coins', 'coin', {quantity: 3});
        const state = {
            ...base,
            player: {...base.player, money: 5, scrap: 2},
            overworld: {
                ...base.overworld,
                items: [{instance: coin, position: base.overworld.playerPosition}],
                monsters: [],
                traps: []
            }
        };

        const result = resolveOverworldAction(state, {kind: 'wait'});

        expect(result.state.player).toMatchObject({money: 8, scrap: 2});
        expect(result.state.overworld.items).toHaveLength(0);
    });

    it('permanently unlocks Casino Heist when a maze car is collected', () => {
        const base = campaign();
        const car = createItemInstance('test/getaway-car', 'car', {quality: 'rare'});
        const state = {
            ...base,
            overworld: {
                ...base.overworld,
                items: [{instance: car, position: base.overworld.playerPosition}],
                monsters: [],
                traps: []
            }
        };

        const result = resolveOverworldAction(state, {kind: 'wait'});

        expect(result.state.player.backpack).toContainEqual(car);
        expect(result.state.flags).toContain(CASINO_HEIST_UNLOCK_FLAG);
        expect(result.state.overworld.items).toHaveLength(0);
    });

    it('keeps equipment and Orb pickup choices non-mutating until the final move', () => {
        const base = campaign();
        const open = openDirection(base);
        const sword = {
            id: 'choice-sword',
            baseTypeId: 'sword' as const,
            quality: 'uncommon' as const,
            affixIds: ['keen' as const],
            rolledChoiceIds: [],
            quantity: 1,
            charges: null
        };
        const equipmentState: CampaignState = {
            ...base,
            overworld: {
                ...base.overworld,
                items: [{instance: sword, position: open.position}],
                monsters: [],
                traps: []
            }
        };
        const prompt = resolveOverworldAction(
            equipmentState,
            {kind: 'move', direction: open.direction}
        );
        expect(prompt.consumedTurn).toBe(false);
        expect(prompt.state).toBe(equipmentState);
        expect(prompt.events[0]).toMatchObject({
            kind: 'choice-required',
            itemId: sword.id
        });

        const equipped = resolveOverworldAction(equipmentState, {
            kind: 'move',
            direction: open.direction,
            pickup: {itemId: sword.id, choice: 'equip'}
        });
        expect(equipped.consumedTurn).toBe(true);
        expect(equipped.state.overworld.playerPosition).toEqual(open.position);
        expect(equipped.state.player.equippedWeapon?.id).toBe(sword.id);
        expect(equipped.state.overworld.items).toHaveLength(0);

        const orb = {
            id: 'choice-orb',
            baseTypeId: 'mystery-orb' as const,
            quality: 'common' as const,
            affixIds: [],
            rolledChoiceIds: ['mend' as const, 'salvage' as const, 'tools' as const],
            quantity: 1,
            charges: null
        };
        const orbState: CampaignState = {
            ...base,
            player: {...base.player, health: 6},
            overworld: {
                ...base.overworld,
                items: [{instance: orb, position: open.position}],
                monsters: [],
                traps: []
            }
        };
        const orbPrompt = resolveOverworldAction(
            orbState,
            {kind: 'move', direction: open.direction}
        );
        expect(orbPrompt.state).toBe(orbState);
        expect(orbPrompt.events[0]?.kind).toBe('choice-required');
        const mended = resolveOverworldAction(orbState, {
            kind: 'move',
            direction: open.direction,
            pickup: {itemId: orb.id, choice: 'mend'}
        });
        expect(mended.state.player.health).toBe(10);
        expect(mended.state.overworld.items).toHaveLength(0);
    });

    it('reveals a Spike Plate for a full decision before it can deal damage', () => {
        const base = campaign();
        const state = {
            ...base,
            overworld: {
                ...base.overworld,
                items: [],
                monsters: [],
                traps: [{
                    id: 'spike',
                    typeId: 'spike-plate' as const,
                    position: base.overworld.playerPosition,
                    owner: 'world' as const,
                    revealed: false,
                    disabled: false,
                    phase: 0,
                    nextPhaseTurn: 0
                }]
            }
        };
        const revealed = resolveOverworldAction(state, {kind: 'wait'});
        expect(revealed.state.player.health).toBe(10);
        expect(revealed.state.overworld.traps[0]?.revealed).toBe(true);

        const triggered = resolveOverworldAction(revealed.state, {kind: 'wait'});
        expect(triggered.state.player.health).toBe(8);
    });

    it('lets a player-owned Snare root a monster without rooting the player', () => {
        const base = campaign();
        const monster = {
            ...base.overworld.monsters[0]!,
            variantIds: [],
            position: base.overworld.monsters[0]!.position,
            spawnPosition: base.overworld.monsters[0]!.position,
            nextMoveTurn: 999,
            nextAttackTurn: 999
        };
        const state = {
            ...base,
            overworld: {
                ...base.overworld,
                items: [],
                monsters: [monster],
                traps: [{
                    id: 'player-snare',
                    typeId: 'snare' as const,
                    position: monster.position,
                    owner: 'player' as const,
                    revealed: true,
                    disabled: false,
                    phase: 0,
                    nextPhaseTurn: 0
                }]
            }
        };
        const result = resolveOverworldAction(state, {kind: 'wait'});
        expect(result.state.player.statuses.some(status => status.kind === 'rooted')).toBe(false);
        expect(result.state.overworld.monsters[0]?.statuses).toContainEqual({
            kind: 'rooted',
            remainingTurns: 3
        });
        expect(result.state.overworld.traps[0]?.disabled).toBe(true);
    });

    it('runs complex traps through warning, trigger, and cooldown phases', () => {
        const base = campaign();
        const state = {
            ...base,
            overworld: {
                ...base.overworld,
                items: [],
                monsters: [],
                traps: [{
                    id: 'gas',
                    typeId: 'gas-vent' as const,
                    position: base.overworld.playerPosition,
                    owner: 'world' as const,
                    revealed: true,
                    disabled: false,
                    phase: 0,
                    nextPhaseTurn: 1
                }]
            }
        };
        const warned = resolveOverworldAction(state, {kind: 'wait'});
        expect(warned.state.overworld.traps[0]).toMatchObject({
            phase: 1,
            nextPhaseTurn: 2
        });
        expect(warned.state.player.statuses.some(status => status.kind === 'poison')).toBe(false);

        const fired = resolveOverworldAction(warned.state, {kind: 'wait'});
        expect(fired.state.overworld.traps[0]).toMatchObject({
            phase: 0,
            nextPhaseTurn: 6
        });
        expect(fired.state.player.statuses).toContainEqual({
            kind: 'poison',
            remainingTurns: 2,
            charges: 0
        });
    });

    it('applies Venomous attacks and persisted Regenerating recovery', () => {
        const base = campaign();
        const adjacentMonster = {
            ...base.overworld.monsters[0]!,
            variantIds: ['venomous' as const],
            position: {x: 1, y: 2},
            spawnPosition: {x: 1, y: 2},
            nextMoveTurn: 999,
            nextAttackTurn: 999,
            intent: {
                kind: 'melee' as const,
                targetPositions: [base.overworld.playerPosition],
                damage: 1,
                executeOnTurn: 1
            }
        };
        const attacked = resolveOverworldAction({
            ...base,
            overworld: {
                ...base.overworld,
                sanctuaryPosition: {
                    x: base.overworld.maze.length - 2,
                    y: base.overworld.maze.length - 2
                },
                items: [],
                traps: [],
                monsters: [adjacentMonster]
            }
        }, {kind: 'wait'});
        expect(attacked.state.player.statuses).toContainEqual({
            kind: 'poison',
            remainingTurns: 2,
            charges: 0
        });

        const regenerating = {
            ...adjacentMonster,
            id: 'regenerator',
            variantIds: ['regenerating' as const],
            position: base.overworld.monsters[0]!.position,
            spawnPosition: base.overworld.monsters[0]!.position,
            health: 1,
            maxHealth: 3,
            intent: null,
            nextMoveTurn: 999,
            nextAttackTurn: 999
        };
        let state: CampaignState = {
            ...base,
            overworld: {
                ...base.overworld,
                items: [],
                traps: [],
                monsters: [regenerating]
            }
        };
        for (let turn = 0; turn < 3; turn++) {
            state = resolveOverworldAction(state, {kind: 'wait'}).state;
        }
        expect(state.overworld.monsters[0]?.health).toBe(2);
        expect(state.overworld.monsters[0]?.undamagedTurns).toBe(0);
    });

    it('keeps an unspent charged status valid while a Sentry Eye takes turns', () => {
        const base = campaign();
        const sentryEye = {
            ...base.overworld.monsters[0]!,
            id: 'status-regression-sentry-eye',
            typeId: 'floating-eye' as const,
            variantIds: [],
            position: {x: 1, y: 3},
            spawnPosition: {x: 1, y: 3},
            nextMoveTurn: Number.MAX_SAFE_INTEGER,
            nextAttackTurn: 999,
            intent: {
                kind: 'ranged' as const,
                targetPositions: [base.overworld.playerPosition],
                damage: 2,
                executeOnTurn: 1
            }
        };
        let state: CampaignState = {
            ...base,
            player: {
                ...base.player,
                statuses: [{kind: 'fire-ward', remainingTurns: 1, charges: 1}]
            },
            overworld: {
                ...base.overworld,
                items: [],
                traps: [],
                monsters: [sentryEye]
            }
        };

        state = resolveOverworldAction(state, {kind: 'wait'}).state;
        const open = openDirection(state);
        const moved = resolveOverworldAction(state, {
            kind: 'move',
            direction: open.direction
        });
        state = moved.state;

        expect(moved.consumedTurn).toBe(true);
        expect(state.overworld.playerPosition).toEqual(open.position);
        expect(state.player.statuses).toContainEqual({
            kind: 'fire-ward',
            remainingTurns: 0,
            charges: 1
        });
        expect(() => campaignStateSchema.parse(state)).not.toThrow();
    });

    it('applies Guard and Shield to each ordered incoming hit', () => {
        const base = campaign();
        const monsterTemplate = base.overworld.monsters[0]!;
        const attackers = ['first', 'second'].map((id, index) => ({
            ...monsterTemplate,
            id,
            typeId: 'moss-slime' as const,
            variantIds: [],
            position: {x: 3 + index * 2, y: 1},
            spawnPosition: {x: 3 + index * 2, y: 1},
            nextMoveTurn: 999,
            nextAttackTurn: 999,
            intent: {
                kind: 'melee' as const,
                targetPositions: [base.overworld.playerPosition],
                damage: 1,
                executeOnTurn: 1
            }
        }));
        const shielded = resolveOverworldAction({
            ...base,
            player: {
                ...base.player,
                equippedUtility: {
                    id: 'shield',
                    baseTypeId: 'shield',
                    quality: 'common',
                    affixIds: [],
                    rolledChoiceIds: [],
                    quantity: 1,
                    charges: null
                }
            },
            overworld: {
                ...base.overworld,
                sanctuaryPosition: {
                    x: base.overworld.maze.length - 2,
                    y: base.overworld.maze.length - 2
                },
                items: [],
                traps: [],
                monsters: attackers
            }
        }, {kind: 'wait'});
        expect(shielded.state.player.health).toBe(8);

        const guarded = resolveOverworldAction({
            ...base,
            player: {
                ...base.player,
                statuses: [{kind: 'guard', remainingTurns: 99, charges: 1}]
            },
            overworld: {
                ...base.overworld,
                sanctuaryPosition: {
                    x: base.overworld.maze.length - 2,
                    y: base.overworld.maze.length - 2
                },
                items: [],
                traps: [],
                monsters: attackers
            }
        }, {kind: 'wait'});
        expect(guarded.state.player.health).toBe(9);
        expect(guarded.state.player.statuses.some(status => status.kind === 'guard')).toBe(false);
    });

    it('consumes a matching Ward before armor and records a lethal trap cause', () => {
        const base = campaign();
        const fireAttacker = {
            ...base.overworld.monsters[0]!,
            id: 'fire-attacker',
            typeId: 'ember-hound' as const,
            variantIds: [],
            position: {x: 3, y: 1},
            spawnPosition: {x: 3, y: 1},
            nextMoveTurn: 999,
            nextAttackTurn: 999,
            intent: {
                kind: 'melee' as const,
                targetPositions: [base.overworld.playerPosition],
                damage: 2,
                executeOnTurn: 1
            }
        };
        const warded = resolveOverworldAction({
            ...base,
            player: {
                ...base.player,
                statuses: [{kind: 'fire-ward', remainingTurns: 99, charges: 2}]
            },
            overworld: {
                ...base.overworld,
                sanctuaryPosition: {
                    x: base.overworld.maze.length - 2,
                    y: base.overworld.maze.length - 2
                },
                items: [],
                traps: [],
                monsters: [fireAttacker]
            }
        }, {kind: 'wait'});
        expect(warded.state.player.health).toBe(10);
        expect(warded.state.player.statuses).toContainEqual({
            kind: 'fire-ward',
            remainingTurns: 98,
            charges: 1
        });

        const feather = {
            id: 'test-feather',
            baseTypeId: 'revival-feather' as const,
            quality: 'common' as const,
            affixIds: [],
            rolledChoiceIds: [],
            quantity: 1,
            charges: null
        };
        const trapped = resolveOverworldAction({
            ...base,
            player: {...base.player, health: 2, backpack: [feather]},
            overworld: {
                ...base.overworld,
                items: [],
                monsters: [],
                traps: [{
                    id: 'lethal-spike',
                    typeId: 'spike-plate' as const,
                    position: base.overworld.playerPosition,
                    owner: 'world' as const,
                    revealed: true,
                    disabled: false,
                    phase: 0,
                    nextPhaseTurn: 0
                }]
            }
        }, {kind: 'wait'});
        expect(trapped.state.player.health).toBe(0);
        expect(trapped.state.overworld.pendingDefeatChoice?.cause).toBe('trap');
    });

    it('uses a Feather in place, clearing only negative statuses and delaying adjacent intent', () => {
        const base = campaign();
        const feather = {
            id: 'exact-feather',
            baseTypeId: 'revival-feather' as const,
            quality: 'common' as const,
            affixIds: [],
            rolledChoiceIds: [],
            quantity: 1,
            charges: null
        };
        const adjacentMonster = {
            ...base.overworld.monsters[0]!,
            position: {x: 1, y: 2},
            spawnPosition: {x: 1, y: 2},
            nextMoveTurn: 0,
            nextAttackTurn: 0,
            intent: {
                kind: 'melee' as const,
                targetPositions: [base.overworld.playerPosition],
                damage: 2,
                executeOnTurn: base.overworld.turn
            }
        };
        const result = resolveOverworldAction({
            ...base,
            player: {
                ...base.player,
                health: 0,
                backpack: [feather],
                statuses: [
                    {kind: 'poison', remainingTurns: 2, charges: 0},
                    {kind: 'rooted', remainingTurns: 1, charges: 0},
                    {kind: 'map-reveal', remainingTurns: 10, charges: 0},
                    {kind: 'guard', remainingTurns: 99, charges: 1}
                ]
            },
            overworld: {
                ...base.overworld,
                monsters: [adjacentMonster],
                pendingDefeatChoice: {
                    turn: base.overworld.turn,
                    cause: 'monster',
                    featherInstanceId: feather.id
                }
            }
        }, {kind: 'resolve-defeat', choice: 'feather'});
        expect(result.state.player.health).toBe(3);
        expect(result.state.player.statuses.map(status => status.kind)).toEqual([
            'map-reveal',
            'guard'
        ]);
        expect(result.state.overworld.monsters[0]?.intent).toBeNull();
        expect(result.state.overworld.monsters[0]?.nextAttackTurn)
            .toBeGreaterThanOrEqual(base.overworld.turn + 2);
    });

    it('claims one sanctuary entitlement as a paid hostile-world turn', () => {
        const base = campaign();
        const objective = base.overworld.objectives[0]!;
        const originalSanctuary = base.overworld.sanctuaryPosition;
        const result = resolveOverworldAction({
            ...base,
            flags: [OBJECTIVE_BY_ID[objective.objectiveId].completionFlag],
            player: {...base.player, health: 5, scrap: 2},
            overworld: {
                ...base.overworld,
                playerPosition: objective.position,
                monsters: [],
                traps: [],
                items: []
            }
        }, {
            kind: 'claim-sanctuary-service',
            objectiveId: objective.objectiveId,
            service: 'heal'
        });
        expect(result.consumedTurn).toBe(true);
        expect(result.state.player).toMatchObject({health: 7, scrap: 0});
        expect(result.state.overworld.sanctuaryServiceClaims)
            .toEqual([objective.objectiveId]);
        expect(result.state.overworld.sanctuaryPosition).toEqual(originalSanctuary);
    });

    it('persists a deterministic exit reward and resolves it as a zero-turn level transition', () => {
        const base = campaign();
        const exit = {
            x: base.overworld.maze.length - 2,
            y: base.overworld.maze.length - 2
        };
        const completed = resolveOverworldAction({
            ...base,
            flags: OBJECTIVE_DEFINITIONS.map(definition => definition.completionFlag),
            overworld: {
                ...base.overworld,
                playerPosition: exit,
                monsters: [],
                traps: [],
                items: []
            }
        }, {kind: 'wait'});
        expect(completed.consumedTurn).toBe(true);
        expect(completed.state.pendingLevelReward).toMatchObject({
            levelId: 'level-1'
        });

        const rewarded = resolveOverworldAction(completed.state, {
            kind: 'choose-level-reward',
            choice: 'repair'
        });
        expect(rewarded.consumedTurn).toBe(false);
        expect(rewarded.state.overworld.levelId).toBe('level-2');
        expect(rewarded.state.pendingLevelReward).toBeNull();
        expect(rewarded.state.overworld.levelContentInitialized).toBe(true);
    });

    it('keeps the reward transition through level seven before entering level eight', () => {
        const base = campaign(23, 'level-7');
        const exit = {
            x: base.overworld.maze.length - 2,
            y: base.overworld.maze.length - 2
        };
        const completed = resolveOverworldAction({
            ...base,
            flags: base.overworld.objectives.map(objective =>
                OBJECTIVE_BY_ID[objective.objectiveId].completionFlag
            ),
            overworld: {
                ...base.overworld,
                playerPosition: exit,
                monsters: [],
                traps: [],
                items: []
            }
        }, {kind: 'wait'});

        expect(completed.state.pendingLevelReward).toMatchObject({levelId: 'level-7'});
        expect(completed.state.flags).not.toContain(CAMPAIGN_VICTORY_FLAG);

        const rewarded = resolveOverworldAction(completed.state, {
            kind: 'choose-level-reward',
            choice: 'supply'
        });
        expect(rewarded.state.overworld.levelId).toBe(`level-${MAX_CAMPAIGN_LEVEL}`);
        expect(rewarded.state.pendingLevelReward).toBeNull();
        expect(rewarded.state.flags).not.toContain(CAMPAIGN_VICTORY_FLAG);
    });

    it('records persistent victory at the ready level-eight exit without offering a reward', () => {
        const base = campaign(24, `level-${MAX_CAMPAIGN_LEVEL}`);
        const exit = {
            x: base.overworld.maze.length - 2,
            y: base.overworld.maze.length - 2
        };
        const ready = {
            ...base,
            flags: base.overworld.objectives.map(objective =>
                OBJECTIVE_BY_ID[objective.objectiveId].completionFlag
            ),
            overworld: {
                ...base.overworld,
                playerPosition: exit,
                monsters: [],
                traps: [],
                items: []
            }
        };

        const completed = resolveOverworldAction(ready, {kind: 'wait'});
        expect(completed.state.overworld.levelId).toBe('level-8');
        expect(completed.state.pendingLevelReward).toBeNull();
        expect(completed.state.flags).toContain(CAMPAIGN_VICTORY_FLAG);

        const repeated = resolveOverworldAction(completed.state, {kind: 'wait'});
        expect(repeated.state.overworld.levelId).toBe('level-8');
        expect(repeated.state.pendingLevelReward).toBeNull();
        expect(
            repeated.state.flags.filter(flag => flag === CAMPAIGN_VICTORY_FLAG)
        ).toHaveLength(1);
    });

    it('continues a legacy pending level-six reward into the expanded campaign', () => {
        const base = campaign(25, 'level-6');
        const exit = {
            x: base.overworld.maze.length - 2,
            y: base.overworld.maze.length - 2
        };
        const state = {
            ...base,
            flags: base.overworld.objectives.map(objective =>
                OBJECTIVE_BY_ID[objective.objectiveId].completionFlag
            ),
            pendingLevelReward: {
                levelId: 'level-6',
                seed: 25,
                armoryOffer: createItemInstance('level-6/legacy-reward', 'sword')
            },
            overworld: {
                ...base.overworld,
                playerPosition: exit,
                monsters: [],
                traps: [],
                items: []
            }
        };

        const completed = resolveOverworldAction(state, {
            kind: 'choose-level-reward',
            choice: 'repair'
        });
        expect(completed.consumedTurn).toBe(false);
        expect(completed.state.overworld.levelId).toBe('level-7');
        expect(completed.state.pendingLevelReward).toBeNull();
        expect(completed.state.flags).not.toContain(CAMPAIGN_VICTORY_FLAG);
    });
});
