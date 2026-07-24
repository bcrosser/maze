import type {ItemInstance, WorldItemState} from '../entities/item-types';
import type {MonsterState} from '../entities/monster-types';
import type {PendingHazardState, TrapState} from '../entities/trap-types';
import type {LevelObjectivePlacement, ObjectiveId} from '../overworld/level-objectives';
import type {LevelServicePlacement} from '../overworld/level-service-sites';
import {MAZE_GENERATOR_ID} from '../overworld/maze-generator';
import type {Coordinate, MazeGrid} from '../overworld/maze-types';
import {getReinforcementDelayMs} from '../overworld/reinforcement-schedule';

export const CAMPAIGN_SCHEMA_VERSION = 4;
export const STARTING_MONEY = 40;
export const OVERWORLD_CONTENT_GENERATOR_ID = 'overworld-content-v1' as const;
export const RESOURCE_KEYS = ['health', 'scrap', 'toolCharge'] as const;
export const WORLD_SYSTEM_KEYS = [
    'powerRouting',
    'securityAlert',
    'airspaceControl',
    'structuralStability'
] as const;
export const ENCOUNTER_KINDS = [
    'pipe',
    'lock',
    'shooter',
    'platformer',
    'circuit',
    'horsemaster',
    'zapper',
    'casino-heist'
] as const;
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

export interface PlayerStatus {
    readonly kind:
        | 'poison'
        | 'fire-ward'
        | 'ice-ward'
        | 'lightning-ward'
        | 'guard'
        | 'rooted'
        | 'map-reveal';
    readonly remainingTurns: number;
    readonly charges: number;
}

export interface PlayerProgress {
    readonly health: number;
    readonly maxHealth: number;
    readonly money: number;
    readonly scrap: number;
    readonly miningPower: number;
    readonly toolCharge: number;
    readonly installedModuleIds: readonly string[];
    readonly backpack: readonly ItemInstance[];
    readonly equippedWeapon: ItemInstance | null;
    readonly equippedUtility: ItemInstance | null;
    readonly bowAmmo: number;
    readonly quickSlotItemIds: readonly [string | null, string | null, string | null];
    readonly statuses: readonly PlayerStatus[];
    readonly weaponRecoveryActions: 0 | 1;
}

export interface WorldSystems {
    readonly powerRouting: number;
    readonly securityAlert: number;
    readonly airspaceControl: number;
    readonly structuralStability: number;
}

export interface PendingDefeatChoice {
    readonly turn: number;
    readonly cause: 'monster' | 'trap' | 'volatile' | 'encounter';
    readonly featherInstanceId: string;
}

export interface OverworldState {
    readonly levelId: string;
    readonly seed: number;
    readonly generatorId: typeof MAZE_GENERATOR_ID;
    readonly contentGeneratorId: typeof OVERWORLD_CONTENT_GENERATOR_ID;
    readonly contentOrigin: 'native-v2' | 'migrated-v1';
    readonly levelContentInitialized: boolean;
    readonly maze: MazeGrid;
    readonly playerPosition: Coordinate;
    readonly turn: number;
    readonly reinforcementCountdownMs: number;
    readonly reinforcementOrdinal: number;
    readonly items: readonly WorldItemState[];
    readonly monsters: readonly MonsterState[];
    readonly traps: readonly TrapState[];
    readonly pendingHazards: readonly PendingHazardState[];
    readonly objectives: readonly LevelObjectivePlacement[];
    readonly serviceSites: readonly LevelServicePlacement[];
    readonly pipeShortcutWall: Coordinate | null;
    readonly sanctuaryPosition: Coordinate;
    readonly sanctuaryServiceClaims: readonly ObjectiveId[];
    readonly levelDeathCount: number;
    readonly mercyDropUsed: boolean;
    readonly pendingDefeatChoice: PendingDefeatChoice | null;
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

export interface ActiveEncounterRecord {
    readonly levelId: string;
    readonly objectiveId: ObjectiveId;
    readonly triggerId: string;
    readonly encounterKind: EncounterKind;
    readonly attemptOrdinal: number;
    readonly runId: string;
    readonly seed: number;
}

export interface PendingLevelReward {
    readonly levelId: string;
    readonly seed: number;
    readonly armoryOffer: ItemInstance;
}

export interface CampaignState {
    readonly schemaVersion: typeof CAMPAIGN_SCHEMA_VERSION;
    readonly campaignSeed: number;
    readonly act: ActNumber;
    readonly player: PlayerProgress;
    readonly worldSystems: WorldSystems;
    readonly flags: readonly string[];
    readonly overworld: OverworldState;
    readonly activeEncounter: ActiveEncounterRecord | null;
    readonly pendingLevelReward: PendingLevelReward | null;
    readonly appliedEncounterRunIds: readonly string[];
    readonly encounterHistory: readonly EncounterHistoryEntry[];
}

export interface InitialCampaignOptions {
    readonly campaignSeed: number;
    readonly maze: MazeGrid;
    readonly overworldSeed?: number;
    readonly levelId?: string;
}

function assertUint32(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
        throw new Error(`${label} must be an unsigned 32-bit integer.`);
    }
}

export function createInitialCampaignState(options: InitialCampaignOptions): CampaignState {
    assertUint32(options.campaignSeed, 'Campaign seed');
    const overworldSeed = options.overworldSeed ?? options.campaignSeed;
    assertUint32(overworldSeed, 'Overworld seed');
    const levelId = options.levelId ?? 'level-1';

    return {
        schemaVersion: CAMPAIGN_SCHEMA_VERSION,
        campaignSeed: options.campaignSeed,
        act: 1,
        player: {
            health: 10,
            maxHealth: 10,
            money: STARTING_MONEY,
            scrap: 0,
            miningPower: 0,
            toolCharge: 0,
            installedModuleIds: [],
            backpack: [{
                id: 'campaign/starter-potion',
                baseTypeId: 'health-potion',
                quality: 'common',
                affixIds: [],
                rolledChoiceIds: [],
                quantity: 1,
                charges: null
            }],
            equippedWeapon: null,
            equippedUtility: null,
            bowAmmo: 0,
            quickSlotItemIds: ['campaign/starter-potion', null, null],
            statuses: [],
            weaponRecoveryActions: 0
        },
        worldSystems: {
            powerRouting: 50,
            securityAlert: 0,
            airspaceControl: 50,
            structuralStability: 50
        },
        flags: [],
        overworld: {
            levelId,
            seed: overworldSeed,
            generatorId: MAZE_GENERATOR_ID,
            contentGeneratorId: OVERWORLD_CONTENT_GENERATOR_ID,
            contentOrigin: 'native-v2',
            levelContentInitialized: false,
            maze: options.maze,
            playerPosition: {x: 1, y: 1},
            turn: 0,
            reinforcementCountdownMs: getReinforcementDelayMs(overworldSeed, 0),
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
        },
        activeEncounter: null,
        pendingLevelReward: null,
        appliedEncounterRunIds: [],
        encounterHistory: []
    };
}
