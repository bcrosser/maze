import type {CampaignState, EncounterKind} from '../campaign/campaign-state';
import {Mulberry32Random, shuffle} from '../random/random-source';
import {deriveSeed} from '../random/seed-derivation';
import type {Coordinate} from './maze-types';

export const OBJECTIVE_IDS = [
    'pipe',
    'lock',
    'space',
    'platformer',
    'circuit',
    'horsemaster',
    'zapper',
    'casino-heist'
] as const;
export type ObjectiveId = (typeof OBJECTIVE_IDS)[number];
export type ObjectiveStatus = 'locked' | 'available' | 'completed';
/** Minimum roster size and the persisted size used by saves made before scaling. */
export const LEVEL_OBJECTIVE_COUNT = 4;
export const LEGACY_MAX_LEVEL_OBJECTIVE_COUNT = 6;
export const MAX_LEVEL_OBJECTIVE_COUNT = OBJECTIVE_IDS.length;
export const CASINO_HEIST_UNLOCK_FLAG = 'casino-heist-unlocked';

export interface ObjectiveDefinition {
    readonly id: ObjectiveId;
    readonly label: string;
    readonly kind: EncounterKind;
    readonly triggerId: string;
    readonly definitionId: string;
    readonly completionFlag: string;
    readonly prerequisiteId: ObjectiveId | null;
    readonly unlockFlag?: string;
    readonly iconFrame: number;
}

export interface LevelObjectivePlacement {
    readonly objectiveId: ObjectiveId;
    readonly triggerId: string;
    readonly position: Coordinate;
}

export const OBJECTIVE_DEFINITIONS = Object.freeze([
    Object.freeze({
        id: 'pipe',
        label: 'Pipe',
        kind: 'pipe',
        triggerId: 'coolant-terminal',
        definitionId: 'coolant-routing',
        completionFlag: 'coolant-routing-restored',
        prerequisiteId: null,
        iconFrame: 0
    }),
    Object.freeze({
        id: 'lock',
        label: 'Lock',
        kind: 'lock',
        triggerId: 'archive-lock',
        definitionId: 'archive-lock',
        completionFlag: 'archive-lock-opened',
        prerequisiteId: null,
        iconFrame: 1
    }),
    Object.freeze({
        id: 'space',
        label: 'Space',
        kind: 'shooter',
        triggerId: 'hangar-uplink',
        definitionId: 'orbital-corridor',
        completionFlag: 'orbital-corridor-cleared',
        prerequisiteId: null,
        iconFrame: 2
    }),
    Object.freeze({
        id: 'platformer',
        label: 'Platformer',
        kind: 'platformer',
        triggerId: 'maintenance-elevator',
        definitionId: 'sublevel-nine',
        completionFlag: 'sublevel-nine-stabilized',
        prerequisiteId: null,
        iconFrame: 3
    }),
    Object.freeze({
        id: 'circuit',
        label: 'Circuit Crush',
        kind: 'circuit',
        triggerId: 'circuit-crush-console',
        definitionId: 'circuit-crush',
        completionFlag: 'circuit-crush-completed',
        prerequisiteId: null,
        iconFrame: 4
    }),
    Object.freeze({
        id: 'horsemaster',
        label: 'Horsemaster',
        kind: 'horsemaster',
        triggerId: 'ultra-horse-crossing',
        definitionId: 'horsemaster',
        completionFlag: 'ultra-horse-gym-reached',
        prerequisiteId: null,
        iconFrame: 5
    }),
    Object.freeze({
        id: 'zapper',
        label: 'Zapper',
        kind: 'zapper',
        triggerId: 'nanotech-blaster-bench',
        definitionId: 'zapper',
        completionFlag: 'zapper-shift-completed',
        prerequisiteId: null,
        iconFrame: 6
    }),
    Object.freeze({
        id: 'casino-heist',
        label: 'Casino Heist',
        kind: 'casino-heist',
        triggerId: 'casino-getaway-route',
        definitionId: 'casino-heist',
        completionFlag: 'casino-heist-completed',
        prerequisiteId: null,
        unlockFlag: CASINO_HEIST_UNLOCK_FLAG,
        iconFrame: 7
    })
] as const satisfies readonly ObjectiveDefinition[]);

export const OBJECTIVE_BY_ID = Object.freeze(Object.fromEntries(
    OBJECTIVE_DEFINITIONS.map(definition => [definition.id, definition])
) as Record<ObjectiveId, ObjectiveDefinition>);

/**
 * Levels 1-4 offer four games, then the roster grows by one per level until
 * level 8 offers all eight. The dedicated seed namespace keeps the roster
 * stable even if placement retries or other content generators consume a
 * different number of random values.
 */
export function getLevelObjectiveSelectionCount(levelNumber: number): number {
    if (!Number.isSafeInteger(levelNumber) || levelNumber < 1) {
        throw new Error('Level number must be a positive safe integer.');
    }
    return Math.max(
        LEVEL_OBJECTIVE_COUNT,
        Math.min(MAX_LEVEL_OBJECTIVE_COUNT, levelNumber)
    );
}

export function getLevelObjectiveRequirementCount(levelNumber: number): number {
    if (!Number.isSafeInteger(levelNumber) || levelNumber < 1) {
        throw new Error('Level number must be a positive safe integer.');
    }
    return Math.min(MAX_LEVEL_OBJECTIVE_COUNT, levelNumber);
}

/**
 * Initialized rosters from the six-game release retain its old 4/5/6 scaling.
 * New content must otherwise match the current level-scaled roster exactly.
 */
export function isCompatibleLevelObjectiveCount(
    levelNumber: number,
    objectiveCount: number
): boolean {
    if (!Number.isSafeInteger(objectiveCount) || objectiveCount < 0) return false;
    const legacyMaximum = Math.min(
        LEGACY_MAX_LEVEL_OBJECTIVE_COUNT,
        getLevelObjectiveSelectionCount(levelNumber)
    );
    return objectiveCount === getLevelObjectiveSelectionCount(levelNumber) ||
        (
            objectiveCount >= LEVEL_OBJECTIVE_COUNT &&
            objectiveCount <= legacyMaximum
        );
}

export function getPersistedLevelObjectiveRequirementCount(
    levelNumber: number,
    objectiveCount: number
): number {
    return Math.min(
        getLevelObjectiveRequirementCount(levelNumber),
        objectiveCount
    );
}

export function selectLevelObjectiveIds(
    levelSeed: number,
    levelNumber = 1
): readonly ObjectiveId[] {
    if (!Number.isSafeInteger(levelSeed) || levelSeed < 0 || levelSeed > 0xffff_ffff) {
        throw new Error('Level seed must be an unsigned 32-bit integer.');
    }
    const selectionCount = getLevelObjectiveSelectionCount(levelNumber);
    return Object.freeze(
        shuffle(
            OBJECTIVE_IDS,
            new Mulberry32Random(deriveSeed(levelSeed, 'objective-roster'))
        ).slice(0, selectionCount)
    );
}

export function getObjectiveStatus(
    flags: readonly string[],
    objectiveId: ObjectiveId
): ObjectiveStatus {
    const definition = OBJECTIVE_BY_ID[objectiveId];
    if (flags.includes(definition.completionFlag)) return 'completed';
    if (definition.unlockFlag && !flags.includes(definition.unlockFlag)) return 'locked';
    if (definition.prerequisiteId === null) return 'available';
    return flags.includes(OBJECTIVE_BY_ID[definition.prerequisiteId].completionFlag)
        ? 'available'
        : 'locked';
}

export function requiresCasinoHeistShop(
    flags: readonly string[],
    placements: readonly LevelObjectivePlacement[]
): boolean {
    return placements.some(placement => placement.objectiveId === 'casino-heist') &&
        getObjectiveStatus(flags, 'casino-heist') === 'locked';
}

export function getCurrentObjective(state: CampaignState): ObjectiveDefinition | null {
    const levelMatch = /^level-(\d+)$/.exec(state.overworld.levelId);
    const parsedLevelNumber = levelMatch ? Number(levelMatch[1]) : 1;
    const levelNumber =
        Number.isSafeInteger(parsedLevelNumber) && parsedLevelNumber > 0
            ? parsedLevelNumber
            : 1;
    const completedSelected = state.overworld.objectives.filter(placement =>
        getObjectiveStatus(state.flags, placement.objectiveId) === 'completed'
    ).length;
    const requiredCount = getPersistedLevelObjectiveRequirementCount(
        levelNumber,
        state.overworld.objectives.length
    );
    if (requiredCount > 0 && completedSelected >= requiredCount) {
        return null;
    }
    for (const placement of state.overworld.objectives) {
        if (getObjectiveStatus(state.flags, placement.objectiveId) === 'available') {
            return OBJECTIVE_BY_ID[placement.objectiveId];
        }
    }
    return null;
}

export function getObjectivePlacement(
    placements: readonly LevelObjectivePlacement[],
    objectiveId: ObjectiveId
): LevelObjectivePlacement {
    const placement = placements.find(candidate => candidate.objectiveId === objectiveId);
    if (!placement) throw new Error(`Missing ${objectiveId} objective placement.`);
    return placement;
}
