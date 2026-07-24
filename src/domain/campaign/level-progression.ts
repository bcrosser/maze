import {
    getLevelObjectiveRequirementCount,
    getPersistedLevelObjectiveRequirementCount,
    isCompatibleLevelObjectiveCount,
    OBJECTIVE_BY_ID,
    OBJECTIVE_DEFINITIONS
} from '../overworld/level-objectives';
import {generateMaze} from '../overworld/maze-generator';
import {getReinforcementDelayMs} from '../overworld/reinforcement-schedule';
import {Mulberry32Random} from '../random/random-source';
import {deriveSeed} from '../random/seed-derivation';
import type {CampaignState} from './campaign-state';

export const MAX_MAZE_SIZE = 99;
export const MAX_CAMPAIGN_LEVEL = 8;
export const CAMPAIGN_VICTORY_FLAG = 'campaign-victory';

export const LEVEL_ONE_EXIT_REQUIREMENT_COUNT = 1;

export interface LevelExitStatus {
    readonly ready: boolean;
    readonly completed: number;
    readonly total: number;
    readonly nextLabel: string | null;
}

const LEVEL_SCOPED_FLAGS = new Set([
    ...OBJECTIVE_DEFINITIONS.map(definition => definition.completionFlag),
    'coolant-terminal-filed-a-complaint',
    'archive-lock-scratched',
    'raider-patrol-alerted',
    'sublevel-nine-awaits-repairs'
]);

export function getCampaignLevelNumber(state: CampaignState): number {
    const match = /^level-(\d+)$/.exec(state.overworld.levelId);
    if (!match) return 1;
    const level = Number(match[1]);
    return Number.isSafeInteger(level) && level > 0 ? level : 1;
}

export function getLevelTier(state: CampaignState): number {
    return Math.min(5, Math.floor((getCampaignLevelNumber(state) - 1) / 2));
}

function isLevelScopedFlag(flag: string): boolean {
    return LEVEL_SCOPED_FLAGS.has(flag) || flag.startsWith('memory-cartridges-');
}

export function advanceCampaignLevel(state: CampaignState): CampaignState {
    // Completed level-six campaigns from the six-game release remain terminal
    // when loaded after the campaign expands to eight levels.
    if (state.flags.includes(CAMPAIGN_VICTORY_FLAG)) {
        if (state.pendingLevelReward === null) return state;
        return {...state, pendingLevelReward: null};
    }
    if (getCampaignLevelNumber(state) >= MAX_CAMPAIGN_LEVEL) {
        return {
            ...state,
            flags: [...state.flags, CAMPAIGN_VICTORY_FLAG],
            pendingLevelReward: null
        };
    }

    const nextLevel = getCampaignLevelNumber(state) + 1;
    const nextSize = Math.min(state.overworld.maze.length + 4, MAX_MAZE_SIZE);
    const nextSeed = deriveSeed(
        state.campaignSeed,
        `level:${state.overworld.generatorId}`,
        nextLevel
    );
    const maze = generateMaze({
        size: nextSize,
        topologyRandom: new Mulberry32Random(deriveSeed(nextSeed, 'maze-topology')),
        materialRandom: new Mulberry32Random(deriveSeed(nextSeed, 'wall-materials'))
    });

    return {
        ...state,
        flags: state.flags.filter(flag => !isLevelScopedFlag(flag)),
        activeEncounter: null,
        pendingLevelReward: null,
        overworld: {
            ...state.overworld,
            levelId: `level-${nextLevel}`,
            seed: nextSeed,
            contentOrigin: 'native-v2',
            levelContentInitialized: false,
            maze,
            playerPosition: {x: 1, y: 1},
            turn: 0,
            reinforcementCountdownMs: getReinforcementDelayMs(nextSeed, 0),
            reinforcementOrdinal: 0,
            items: [],
            monsters: [],
            traps: [],
            pendingHazards: [],
            objectives: [],
            serviceSites: [],
            pipeShortcutWall: null,
            sanctuaryPosition: {x: 1, y: 1},
            sanctuaryServiceClaims: [],
            levelDeathCount: 0,
            mercyDropUsed: false,
            pendingDefeatChoice: null,
            triggerStates: {},
            resumeGraceTurns: 0
        }
    };
}

export function getLevelExitStatus(state: CampaignState): LevelExitStatus {
    const requirements = state.overworld.objectives.map(placement => {
        const definition = OBJECTIVE_BY_ID[placement.objectiveId];
        return {flag: definition.completionFlag, label: definition.label};
    });
    const levelNumber = getCampaignLevelNumber(state);
    const requiredCount = requirements.length > 0
        ? getPersistedLevelObjectiveRequirementCount(levelNumber, requirements.length)
        : getLevelObjectiveRequirementCount(levelNumber);
    const completedSelected = requirements.filter(requirement =>
        state.flags.includes(requirement.flag)
    ).length;
    const ready =
        isCompatibleLevelObjectiveCount(levelNumber, requirements.length) &&
        completedSelected >= requiredCount;
    const nextRequirement = ready
        ? undefined
        : requirements.find(requirement => !state.flags.includes(requirement.flag));
    return {
        ready,
        completed: Math.min(completedSelected, requiredCount),
        total: requiredCount,
        nextLabel: nextRequirement?.label ?? null
    };
}
