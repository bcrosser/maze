import {describe, expect, it} from 'vitest';

import {
    createInitialCampaignState,
    type CampaignState
} from '../../../src/domain/campaign/campaign-state';
import {createItemInstance} from '../../../src/domain/entities/item-types';
import {initializeLevelContent} from '../../../src/domain/overworld/level-content-generator';
import {
    CASINO_HEIST_UNLOCK_FLAG,
    getObjectiveStatus,
    getLevelObjectiveSelectionCount,
    OBJECTIVE_BY_ID,
    OBJECTIVE_DEFINITIONS
} from '../../../src/domain/overworld/level-objectives';
import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import {PASSAGE_CELL, type MazeCell} from '../../../src/domain/overworld/maze-types';
import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {deriveSeed} from '../../../src/domain/random/seed-derivation';
import {campaignStateSchema} from '../../../src/save/campaign-state.schema';

function createCampaign(seed = 2_401, levelId = 'level-1'): CampaignState {
    const maze = generateMaze({size: 21, random: new Mulberry32Random(seed)});
    return createInitialCampaignState({campaignSeed: seed, levelId, maze});
}

function createInitializedCampaign(
    seed = 2_401,
    levelId = 'level-1'
): CampaignState {
    return initializeLevelContent(createCampaign(seed, levelId));
}

function replaceMazeCells(
    state: CampaignState,
    replacements: readonly {
        readonly x: number;
        readonly y: number;
        readonly cell: MazeCell;
    }[]
): CampaignState {
    const maze = state.overworld.maze.map(row => [...row]);
    for (const replacement of replacements) {
        maze[replacement.y]![replacement.x] = replacement.cell;
    }
    return {...state, overworld: {...state.overworld, maze}};
}

function activeObjectiveCampaign(state = createInitializedCampaign()): CampaignState {
    const placement = state.overworld.objectives.find(objective =>
        getObjectiveStatus(state.flags, objective.objectiveId) === 'available'
    )!;
    const definition = OBJECTIVE_BY_ID[placement.objectiveId];
    const attemptOrdinal = state.encounterHistory.filter(entry =>
        entry.triggerId === definition.triggerId
    ).length;
    return {
        ...state,
        overworld: {...state.overworld, playerPosition: placement.position},
        activeEncounter: {
            levelId: state.overworld.levelId,
            objectiveId: definition.id,
            triggerId: definition.triggerId,
            encounterKind: definition.kind,
            attemptOrdinal,
            runId: `${state.overworld.levelId}/${definition.triggerId}/${attemptOrdinal}`,
            seed: deriveSeed(
                state.overworld.seed,
                definition.id === 'space' ? 'space-attempt' : `${definition.id}-attempt`,
                attemptOrdinal
            )
        }
    };
}

function pendingDefeatCampaign(state = createInitializedCampaign()): CampaignState {
    const feather = createItemInstance('test/revival-feather', 'revival-feather');
    return {
        ...state,
        player: {
            ...state.player,
            health: 0,
            backpack: [...state.player.backpack, feather]
        },
        overworld: {
            ...state.overworld,
            pendingDefeatChoice: {
                turn: state.overworld.turn,
                cause: 'monster',
                featherInstanceId: feather.id
            }
        }
    };
}

function pendingRewardCampaign(state = createInitializedCampaign()): CampaignState {
    const shortcut = state.overworld.pipeShortcutWall;
    const opened = shortcut
        ? replaceMazeCells(state, [{
            x: shortcut.x,
            y: shortcut.y,
            cell: PASSAGE_CELL
        }])
        : state;
    const sanctuaryObjective = opened.overworld.objectives.at(-1)!;
    const exit = {
        x: opened.overworld.maze.length - 2,
        y: opened.overworld.maze.length - 2
    };
    return {
        ...opened,
        flags: OBJECTIVE_DEFINITIONS.map(definition => definition.completionFlag),
        overworld: {
            ...opened.overworld,
            playerPosition: exit,
            pipeShortcutWall: null,
            sanctuaryPosition: sanctuaryObjective.position
        },
        pendingLevelReward: {
            levelId: opened.overworld.levelId,
            seed: deriveSeed(opened.overworld.seed, 'level-reward', 0),
            armoryOffer: createItemInstance(
                `${opened.overworld.levelId}/armory-reward`,
                'sword',
                {quality: 'uncommon', affixIds: ['keen']}
            )
        }
    };
}

function expectValid(state: CampaignState): void {
    const result = campaignStateSchema.safeParse(state);
    if (!result.success) {
        throw new Error(result.error.issues.map(issue => issue.message).join('\n'));
    }
}

function expectInvalid(state: CampaignState, message: string): void {
    const result = campaignStateSchema.safeParse(state);
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected campaign validation to fail.');
    expect(result.error.issues.some(issue => issue.message.includes(message))).toBe(true);
}

describe('campaignStateSchema semantic validation', () => {
    it('accepts legitimate uninitialized, initialized, active, defeat, and reward states', () => {
        expectValid(createCampaign());
        expectValid(createInitializedCampaign());
        expectValid(activeObjectiveCampaign());
        expectValid(pendingDefeatCampaign());
        expectValid(pendingRewardCampaign());
    });

    it('validates level-scaled rosters while grandfathering persisted 4/5/6-game levels', () => {
        for (const levelNumber of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
            const state = createInitializedCampaign(
                2_500 + levelNumber,
                `level-${levelNumber}`
            );
            expect(state.overworld.objectives).toHaveLength(
                getLevelObjectiveSelectionCount(levelNumber)
            );
            expectValid(state);
        }

        const levelSix = createInitializedCampaign(2_606, 'level-6');
        const legacyFour = {
            ...levelSix,
            overworld: {
                ...levelSix.overworld,
                objectives: levelSix.overworld.objectives.slice(0, 4)
            }
        };
        expectValid(legacyFour);
        expectValid(pendingRewardCampaign(levelSix));
        expectValid(pendingRewardCampaign(legacyFour));

        expectInvalid({
            ...levelSix,
            overworld: {...levelSix.overworld, levelId: 'level-5'}
        }, 'requires 5 distinct objectives');
    });

    it('requires a shop route while a selected Casino Heist is locked', () => {
        const levelEight = createInitializedCampaign(2_608, 'level-8');
        const withoutShop = {
            ...levelEight,
            overworld: {
                ...levelEight.overworld,
                serviceSites: levelEight.overworld.serviceSites.filter(site =>
                    site.kind !== 'shop'
                )
            }
        };

        expectInvalid(withoutShop, 'requires a shop purchase route');
        expectValid({
            ...withoutShop,
            flags: [CASINO_HEIST_UNLOCK_FLAG]
        });
    });

    it('persists non-negative money and optional non-objective service sites', () => {
        const initialized = createInitializedCampaign();
        const reserved = new Set([
            '1,1',
            `${initialized.overworld.maze.length - 2},${initialized.overworld.maze.length - 2}`,
            ...initialized.overworld.objectives.map(objective =>
                `${objective.position.x},${objective.position.y}`
            )
        ]);
        const passages = initialized.overworld.maze.flatMap((row, y) =>
            row.flatMap((cell, x) =>
                cell.kind === 'passage' && !reserved.has(`${x},${y}`) ? [{x, y}] : []
            )
        );
        const withSites: CampaignState = {
            ...initialized,
            player: {...initialized.player, money: 73},
            overworld: {
                ...initialized.overworld,
                serviceSites: [
                    {id: 'level-1/service/shop', kind: 'shop', position: passages[0]!},
                    {id: 'level-1/service/blackjack', kind: 'blackjack', position: passages[1]!}
                ]
            }
        };
        expectValid(withSites);
        expectInvalid(
            {...initialized, player: {...initialized.player, money: -1}},
            '>=0'
        );
        expectInvalid({
            ...withSites,
            overworld: {
                ...withSites.overworld,
                serviceSites: [
                    withSites.overworld.serviceSites[0]!,
                    {
                        id: 'level-1/service/another-shop',
                        kind: 'shop',
                        position: passages[2]!
                    }
                ]
            }
        }, 'at most one service site of each kind');
    });

    it('requires a solid perimeter and one connected passage component', () => {
        const initial = createCampaign();
        const openPerimeter = replaceMazeCells(initial, [{
            x: 1,
            y: 0,
            cell: PASSAGE_CELL
        }]);
        expectInvalid(openPerimeter, 'perimeter must be solid');

        const isolated = replaceMazeCells(initial, [
            {x: 3, y: 2, cell: {kind: 'wall', materialId: 'stone'}},
            {x: 4, y: 3, cell: {kind: 'wall', materialId: 'stone'}},
            {x: 3, y: 4, cell: {kind: 'wall', materialId: 'stone'}},
            {x: 2, y: 3, cell: {kind: 'wall', materialId: 'stone'}}
        ]);
        expectInvalid(isolated, 'Every maze passage must be reachable');
    });

    it('requires all uninitialized native content, including hazards, to be empty', () => {
        const initial = createCampaign();
        const origin = {x: 1, y: 1};
        const targetPositions = [
            origin,
            {x: 2, y: 1},
            {x: 1, y: 2}
        ].filter(position =>
            initial.overworld.maze[position.y]?.[position.x]?.kind === 'passage'
        );
        expectInvalid({
            ...initial,
            overworld: {
                ...initial.overworld,
                pendingHazards: [{
                    id: 'test/uninitialized-hazard',
                    typeId: 'volatile-explosion',
                    origin,
                    targetPositions,
                    executeAfterTurn: 1
                }]
            }
        }, 'Uninitialized native content must be empty');
    });

    it('validates objective registry triggers while allowing ordinary objectives immediately', () => {
        const state = createInitializedCampaign();
        expectInvalid({
            ...state,
            overworld: {
                ...state.overworld,
                objectives: state.overworld.objectives.map((objective, index) =>
                    index === 0 ? {...objective, triggerId: 'wrong-trigger'} : objective
                )
            }
        }, 'trigger ID does not match');

        expectValid({
            ...state,
            flags: [OBJECTIVE_BY_ID.lock.completionFlag]
        });

        expectInvalid({
            ...state,
            overworld: {
                ...state.overworld,
                triggerStates: {[OBJECTIVE_BY_ID.pipe.triggerId]: 'available'}
            }
        }, 'completion flags');
    });

    it('validates the protected Pipe shortcut against completion and maze topology', () => {
        const state = Array.from({length: 64}, (_, seed) =>
            createInitializedCampaign(2_401 + seed)
        ).find(candidate => candidate.overworld.objectives.some(
            objective => objective.objectiveId === 'pipe'
        ))!;
        expectInvalid({
            ...state,
            overworld: {...state.overworld, pipeShortcutWall: null}
        }, 'requires a protected shortcut wall');

        expectInvalid({
            ...state,
            flags: [OBJECTIVE_BY_ID.pipe.completionFlag]
        }, 'cannot retain a protected shortcut wall');

        expectInvalid({
            ...state,
            overworld: {...state.overworld, pipeShortcutWall: {x: 1, y: 1}}
        }, 'valid interior wall connector');
    });

    it('rejects static entity collisions and objective reservation violations', () => {
        const state = createInitializedCampaign();
        const firstItem = state.overworld.items[0]!;
        expectInvalid({
            ...state,
            overworld: {
                ...state.overworld,
                items: state.overworld.items.map((item, index) =>
                    index === 1 ? {...item, position: firstItem.position} : item
                )
            }
        }, 'World item positions must be unique');

        const objective = state.overworld.objectives[0]!;
        expectInvalid({
            ...state,
            overworld: {
                ...state.overworld,
                monsters: state.overworld.monsters.map((monster, index) =>
                    index === 0 ? {...monster, position: objective.position} : monster
                )
            }
        }, 'Monsters cannot overlap objectives');

        expectInvalid({
            ...state,
            overworld: {
                ...state.overworld,
                objectives: state.overworld.objectives.map((placement, index) =>
                    index === 0 ? {...placement, position: {x: 1, y: 1}} : placement
                )
            }
        }, 'cannot occupy the maze spawn or exit');
    });

    it('enforces equipment slot categories', () => {
        const state = createInitializedCampaign();
        expectInvalid({
            ...state,
            player: {
                ...state.player,
                equippedWeapon: createItemInstance('test/not-a-weapon', 'health-potion')
            }
        }, 'requires a weapon item');

        expectInvalid({
            ...state,
            player: {
                ...state.player,
                equippedUtility: createItemInstance('test/not-a-utility', 'sword')
            }
        }, 'requires a utility item');
    });

    it('cross-validates active encounter identity, seed, ordinal, and player position', () => {
        const active = activeObjectiveCampaign();
        expectInvalid({
            ...active,
            activeEncounter: {
                ...active.activeEncounter!,
                seed: (active.activeEncounter!.seed + 1) >>> 0
            }
        }, 'does not match the current objective attempt');

        expectInvalid({
            ...active,
            overworld: {...active.overworld, playerPosition: {x: 1, y: 1}}
        }, 'requires the player at its persisted objective');
    });

    it('requires pending defeat to match zero health and an exact owned Feather', () => {
        const state = createInitializedCampaign();
        expectInvalid({
            ...state,
            overworld: {
                ...state.overworld,
                pendingDefeatChoice: {
                    turn: state.overworld.turn,
                    cause: 'monster',
                    featherInstanceId: 'missing-feather'
                }
            }
        }, 'requires zero player health');

        expectInvalid({
            ...state,
            player: {...state.player, health: 0}
        }, 'Zero health requires a persisted defeat choice');
    });

    it('requires pending reward to match level completion, exit, seed, and Armory category', () => {
        const pending = pendingRewardCampaign();
        expectInvalid({
            ...pending,
            overworld: {...pending.overworld, playerPosition: {x: 1, y: 1}}
        }, 'does not match the completed current level');

        expectInvalid({
            ...pending,
            pendingLevelReward: {
                ...pending.pendingLevelReward!,
                armoryOffer: createItemInstance(
                    `${pending.overworld.levelId}/armory-reward`,
                    'lantern',
                    {quality: 'uncommon', affixIds: ['surveyor']}
                )
            }
        }, 'must be one rolled equipment item');
    });
});
