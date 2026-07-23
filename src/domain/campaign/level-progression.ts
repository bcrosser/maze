import {generateMaze} from '../overworld/maze-generator';
import {Mulberry32Random} from '../random/random-source';
import type {CampaignState} from './campaign-state';

export const MAX_MAZE_SIZE = 99;

export const LEVEL_EXIT_REQUIREMENTS = Object.freeze([
    Object.freeze({flag: 'coolant-routing-restored', label: 'Pipe'}),
    Object.freeze({flag: 'archive-lock-opened', label: 'Lock'}),
    Object.freeze({flag: 'orbital-corridor-cleared', label: 'Flight'}),
    Object.freeze({flag: 'sublevel-nine-stabilized', label: 'Platform'})
]);

export interface LevelExitStatus {
    readonly ready: boolean;
    readonly completed: number;
    readonly total: number;
    readonly nextLabel: string | null;
}

const LEVEL_SCOPED_FLAGS = new Set([
    'coolant-routing-restored',
    'coolant-terminal-filed-a-complaint',
    'archive-lock-opened',
    'archive-lock-scratched',
    'orbital-corridor-cleared',
    'raider-patrol-alerted',
    'sublevel-nine-stabilized',
    'sublevel-nine-awaits-repairs'
]);

export function getCampaignLevelNumber(state: CampaignState): number {
    const match = /^level-(\d+)$/.exec(state.overworld.levelId);
    if (!match) return 1;
    const level = Number(match[1]);
    return Number.isSafeInteger(level) && level > 0 ? level : 1;
}

function isLevelScopedFlag(flag: string): boolean {
    return LEVEL_SCOPED_FLAGS.has(flag) || flag.startsWith('memory-cartridges-');
}

export function advanceCampaignLevel(state: CampaignState): CampaignState {
    const nextLevel = getCampaignLevelNumber(state) + 1;
    const nextSize = Math.min(state.overworld.maze.length + 4, MAX_MAZE_SIZE);
    const nextSeed = (state.campaignSeed ^ Math.imul(nextLevel, 0x9e3779b1)) >>> 0;
    const maze = generateMaze({size: nextSize, random: new Mulberry32Random(nextSeed)});

    return {
        ...state,
        flags: state.flags.filter(flag => !isLevelScopedFlag(flag)),
        overworld: {
            ...state.overworld,
            levelId: `level-${nextLevel}`,
            seed: nextSeed,
            maze,
            playerPosition: {x: 1, y: 1},
            turn: 0,
            itemsInitialized: false,
            items: [],
            monstersInitialized: false,
            monsters: [],
            triggerStates: {},
            resumeGraceTurns: 2
        }
    };
}

export function getLevelExitStatus(state: CampaignState): LevelExitStatus {
    const nextRequirement = LEVEL_EXIT_REQUIREMENTS.find(requirement =>
        !state.flags.includes(requirement.flag)
    );
    const completed = LEVEL_EXIT_REQUIREMENTS.filter(requirement =>
        state.flags.includes(requirement.flag)
    ).length;
    return {
        ready: completed === LEVEL_EXIT_REQUIREMENTS.length,
        completed,
        total: LEVEL_EXIT_REQUIREMENTS.length,
        nextLabel: nextRequirement?.label ?? null
    };
}