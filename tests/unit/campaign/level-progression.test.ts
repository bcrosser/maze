import {describe, expect, it} from 'vitest';

import {createInitialCampaignState} from '../../../src/domain/campaign/campaign-state';
import {
    advanceCampaignLevel,
    CAMPAIGN_VICTORY_FLAG,
    getCampaignLevelNumber,
    getLevelExitStatus,
    MAX_CAMPAIGN_LEVEL
} from '../../../src/domain/campaign/level-progression';
import {createItemInstance} from '../../../src/domain/entities/item-types';
import {
    CASINO_HEIST_UNLOCK_FLAG,
    getLevelObjectiveRequirementCount,
    getLevelObjectiveSelectionCount,
    getCurrentObjective,
    getObjectiveStatus,
    OBJECTIVE_BY_ID,
    OBJECTIVE_IDS,
    type ObjectiveId
} from '../../../src/domain/overworld/level-objectives';
import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import {Mulberry32Random} from '../../../src/domain/random/random-source';

const SELECTED_OBJECTIVES = ['pipe', 'lock', 'space', 'platformer'] as const;

function withRoster(
    levelNumber: number,
    objectiveIds: readonly ObjectiveId[] = OBJECTIVE_IDS.slice(
        0,
        getLevelObjectiveSelectionCount(levelNumber)
    )
) {
    const state = createCampaign();
    return {
        ...state,
        flags: [],
        overworld: {
            ...state.overworld,
            levelId: `level-${levelNumber}`,
            objectives: objectiveIds.map((objectiveId, index) => ({
                objectiveId,
                triggerId: OBJECTIVE_BY_ID[objectiveId].triggerId,
                position: {x: 3 + index * 2, y: 3}
            }))
        }
    };
}

function createCampaign() {
    const maze = generateMaze({size: 21, random: new Mulberry32Random(7)});
    const initial = createInitialCampaignState({campaignSeed: 7, maze});
    return {
        ...initial,
        player: {...initial.player, money: 73, miningPower: 2, toolCharge: 6, scrap: 17},
        flags: ['coolant-routing-restored', 'archive-lock-opened', 'kept-across-levels'],
        overworld: {
            ...initial.overworld,
            levelContentInitialized: true,
            objectives: SELECTED_OBJECTIVES.map((objectiveId, index) => ({
                objectiveId,
                triggerId: OBJECTIVE_BY_ID[objectiveId].triggerId,
                position: {x: 3 + index * 2, y: 3}
            })),
            serviceSites: [{
                id: 'level-1/service/shop',
                kind: 'shop' as const,
                position: {x: 3, y: 3}
            }],
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
        expect(next.overworld.levelContentInitialized).toBe(false);
        expect(next.overworld.items).toEqual([]);
        expect(next.overworld.monsters).toEqual([]);
        expect(next.overworld.traps).toEqual([]);
        expect(next.overworld.objectives).toEqual([]);
        expect(next.overworld.serviceSites).toEqual([]);
        expect(next.overworld.triggerStates).toEqual({});
        expect(next.player.miningPower).toBe(2);
        expect(next.player.toolCharge).toBe(6);
        expect(next.player.scrap).toBe(17);
        expect(next.player.money).toBe(73);
        expect(next.flags).toEqual(['kept-across-levels']);
    });

    it('can repeat the same content structure across higher levels', () => {
        const levelTwo = advanceCampaignLevel(createCampaign());
        const levelThree = advanceCampaignLevel(levelTwo);

        expect(getCampaignLevelNumber(levelThree)).toBe(3);
        expect(levelThree.overworld.maze).toHaveLength(29);
        expect(levelThree.overworld.seed).not.toBe(levelTwo.overworld.seed);
    });

    it('caps progression at level eight and records victory idempotently', () => {
        expect(MAX_CAMPAIGN_LEVEL).toBe(8);
        const levelEight = {
            ...withRoster(MAX_CAMPAIGN_LEVEL),
            flags: ['kept-across-levels'],
            pendingLevelReward: {
                levelId: 'level-8',
                seed: 123,
                armoryOffer: createItemInstance('level-8/legacy-reward', 'sword')
            }
        };

        const completed = advanceCampaignLevel(levelEight);

        expect(getCampaignLevelNumber(completed)).toBe(MAX_CAMPAIGN_LEVEL);
        expect(completed.overworld).toBe(levelEight.overworld);
        expect(completed.pendingLevelReward).toBeNull();
        expect(completed.flags).toEqual([
            'kept-across-levels',
            CAMPAIGN_VICTORY_FLAG
        ]);

        const repeated = advanceCampaignLevel(completed);
        expect(repeated).toBe(completed);
        expect(repeated.flags.filter(flag => flag === CAMPAIGN_VICTORY_FLAG)).toHaveLength(1);
    });

    it('keeps a completed legacy level-six campaign terminal', () => {
        const legacyVictory = {
            ...withRoster(6),
            flags: [CAMPAIGN_VICTORY_FLAG],
            pendingLevelReward: null
        };

        expect(advanceCampaignLevel(legacyVictory)).toBe(legacyVictory);
        expect(getCampaignLevelNumber(advanceCampaignLevel(legacyVictory))).toBe(6);
    });

    it('requires any one selected game on level one and ignores unselected completion flags', () => {
        const locked = getLevelExitStatus({
            ...createCampaign(),
            flags: [OBJECTIVE_BY_ID.circuit.completionFlag]
        });
        const ready = getLevelExitStatus({
            ...createCampaign(),
            flags: [OBJECTIVE_BY_ID.space.completionFlag]
        });

        expect(locked).toEqual({ready: false, completed: 0, total: 1, nextLabel: 'Pipe'});
        expect(ready).toEqual({ready: true, completed: 1, total: 1, nextLabel: null});
    });

    it('requires one additional selected completion per level through level eight', () => {
        for (const levelNumber of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
            const state = withRoster(levelNumber);
            const required = getLevelObjectiveRequirementCount(levelNumber);
            const incompleteFlags = state.overworld.objectives
                .slice(0, required - 1)
                .map(objective =>
                    OBJECTIVE_BY_ID[objective.objectiveId].completionFlag
                );
            const completeFlags = state.overworld.objectives
                .slice(0, required)
                .map(objective =>
                    OBJECTIVE_BY_ID[objective.objectiveId].completionFlag
                );

            expect(getLevelExitStatus({...state, flags: incompleteFlags})).toEqual({
                ready: false,
                completed: required - 1,
                total: required,
                nextLabel: OBJECTIVE_BY_ID[
                    state.overworld.objectives[required - 1]!.objectiveId
                ].label
            });
            expect(getLevelExitStatus({...state, flags: completeFlags})).toEqual({
                ready: true,
                completed: required,
                total: required,
                nextLabel: null
            });
        }
    });

    it('grandfathers persisted four-game higher-level saves without reroll or deadlock', () => {
        const legacyLevelSix = withRoster(6, SELECTED_OBJECTIVES);
        const completeFlags = legacyLevelSix.overworld.objectives.map(objective =>
            OBJECTIVE_BY_ID[objective.objectiveId].completionFlag
        );

        expect(getLevelExitStatus(legacyLevelSix)).toEqual({
            ready: false,
            completed: 0,
            total: 4,
            nextLabel: 'Pipe'
        });
        expect(getLevelExitStatus({...legacyLevelSix, flags: completeFlags})).toEqual({
            ready: true,
            completed: 4,
            total: 4,
            nextLabel: null
        });
    });

    it('makes every selected game available and chooses current objectives from the roster only', () => {
        const state = {...createCampaign(), flags: []};
        for (const objective of state.overworld.objectives) {
            expect(getObjectiveStatus(state.flags, objective.objectiveId)).toBe('available');
        }
        expect(getCurrentObjective(state)?.id).toBe('pipe');

        const afterPipe = {
            ...state,
            flags: [OBJECTIVE_BY_ID.pipe.completionFlag]
        };
        expect(getCurrentObjective(afterPipe)).toBeNull();
        expect(getObjectiveStatus(afterPipe.flags, 'lock')).toBe('available');
        const levelTwo = withRoster(2);
        const levelTwoAfterPipe = {
            ...levelTwo,
            flags: [OBJECTIVE_BY_ID.pipe.completionFlag]
        };
        expect(getCurrentObjective(levelTwoAfterPipe)?.id).toBe('lock');
        expect(getCurrentObjective({
            ...levelTwoAfterPipe,
            flags: [
                OBJECTIVE_BY_ID.pipe.completionFlag,
                OBJECTIVE_BY_ID.lock.completionFlag
            ]
        })).toBeNull();
        expect(getCurrentObjective({
            ...state,
            overworld: {
                ...state.overworld,
                objectives: state.overworld.objectives.filter(objective =>
                    objective.objectiveId !== 'pipe'
                )
            }
        })?.id).toBe('lock');
    });

    it('keeps Casino Heist locked until the durable car-acquired flag is set', () => {
        expect(getObjectiveStatus([], 'casino-heist')).toBe('locked');
        expect(getObjectiveStatus(
            [CASINO_HEIST_UNLOCK_FLAG],
            'casino-heist'
        )).toBe('available');
        expect(getObjectiveStatus(
            [
                CASINO_HEIST_UNLOCK_FLAG,
                OBJECTIVE_BY_ID['casino-heist'].completionFlag
            ],
            'casino-heist'
        )).toBe('completed');
    });
});
