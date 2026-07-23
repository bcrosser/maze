import type {MazeGrid, Coordinate} from '../overworld/maze-types';
import type {ItemState} from '../entities/item-types';
import type {MonsterState} from '../entities/monster-types';

export const CAMPAIGN_SCHEMA_VERSION = 1;
export const RESOURCE_KEYS = ['health', 'scrap', 'toolCharge'] as const;
export const WORLD_SYSTEM_KEYS = [
    'powerRouting',
    'securityAlert',
    'airspaceControl',
    'structuralStability'
] as const;
export const ENCOUNTER_KINDS = ['pipe', 'lock', 'shooter', 'platformer'] as const;
export const ENCOUNTER_STATUSES = ['success', 'failure', 'abandoned'] as const;
export const PERFORMANCE_GRADES = ['s', 'a', 'b', 'c', 'none'] as const;
export const TRIGGER_STATES = ['available', 'resolved', 'disabled'] as const;

export type ActNumber = 1 | 2 | 3 | 4;
export type ResourceKey = (typeof RESOURCE_KEYS)[number];
export type WorldSystemKey = (typeof WORLD_SYSTEM_KEYS)[number];
export type EncounterKind = (typeof ENCOUNTER_KINDS)[number];
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];
export type PerformanceGrade = (typeof PERFORMANCE_GRADES)[number];
export type TriggerState = (typeof TRIGGER_STATES)[number];

export interface PlayerProgress {
    readonly health: number;
    readonly maxHealth: number;
    readonly scrap: number;
    readonly miningPower: number;
    readonly toolCharge: number;
    readonly installedModuleIds: readonly string[];
}

export interface WorldSystems {
    readonly powerRouting: number;
    readonly securityAlert: number;
    readonly airspaceControl: number;
    readonly structuralStability: number;
}

export interface OverworldState {
    readonly levelId: string;
    readonly seed: number;
    readonly maze: MazeGrid;
    readonly playerPosition: Coordinate;
    readonly turn: number;
    readonly itemsInitialized: boolean;
    readonly items: readonly ItemState[];
    readonly monstersInitialized: boolean;
    readonly monsters: readonly MonsterState[];
    readonly triggerStates: Readonly<Record<string, TriggerState>>;
    readonly resumeGraceTurns: number;
}

export interface EncounterHistoryEntry {
    readonly runId: string;
    readonly definitionId: string;
    readonly triggerId: string;
    readonly kind: EncounterKind;
    readonly status: EncounterStatus;
    readonly grade: PerformanceGrade;
    readonly score: number;
    readonly elapsedMs: number;
}

export interface CampaignState {
    readonly schemaVersion: typeof CAMPAIGN_SCHEMA_VERSION;
    readonly campaignSeed: number;
    readonly act: ActNumber;
    readonly player: PlayerProgress;
    readonly worldSystems: WorldSystems;
    readonly flags: readonly string[];
    readonly overworld: OverworldState;
    readonly appliedEncounterRunIds: readonly string[];
    readonly encounterHistory: readonly EncounterHistoryEntry[];
}

export interface InitialCampaignOptions {
    readonly campaignSeed: number;
    readonly maze: MazeGrid;
    readonly overworldSeed?: number;
    readonly levelId?: string;
}

export function createInitialCampaignState(options: InitialCampaignOptions): CampaignState {
    if (!Number.isSafeInteger(options.campaignSeed)) {
        throw new Error('Campaign seed must be a safe integer.');
    }
    const overworldSeed = options.overworldSeed ?? options.campaignSeed;
    if (!Number.isSafeInteger(overworldSeed)) {
        throw new Error('Overworld seed must be a safe integer.');
    }

    return {
        schemaVersion: CAMPAIGN_SCHEMA_VERSION,
        campaignSeed: options.campaignSeed,
        act: 1,
        player: {
            health: 10,
            maxHealth: 10,
            scrap: 0,
            miningPower: 0,
            toolCharge: 0,
            installedModuleIds: []
        },
        worldSystems: {
            powerRouting: 50,
            securityAlert: 0,
            airspaceControl: 50,
            structuralStability: 50
        },
        flags: [],
        overworld: {
            levelId: options.levelId ?? 'act-1-zone-1',
            seed: overworldSeed,
            maze: options.maze,
            playerPosition: {x: 1, y: 1},
            turn: 0,
            itemsInitialized: false,
            items: [],
            monstersInitialized: false,
            monsters: [],
            triggerStates: {},
            resumeGraceTurns: 0
        },
        appliedEncounterRunIds: [],
        encounterHistory: []
    };
}