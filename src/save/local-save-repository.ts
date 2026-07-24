import {z} from 'zod';

import {
    CAMPAIGN_SCHEMA_VERSION,
    STARTING_MONEY,
    createInitialCampaignState,
    type CampaignState
} from '../domain/campaign/campaign-state';
import {createItemInstance} from '../domain/entities/item-types';
import {MONSTER_DEFINITIONS, type MonsterState} from '../domain/entities/monster-types';
import {MATERIAL_IDS} from '../domain/materials/materials';
import {OBJECTIVE_DEFINITIONS} from '../domain/overworld/level-objectives';
import {
    getPassageDistances,
    placeLevelObjectives
} from '../domain/overworld/objective-placement';
import {getReinforcementDelayMs} from '../domain/overworld/reinforcement-schedule';
import {Mulberry32Random} from '../domain/random/random-source';
import {deriveSeed} from '../domain/random/seed-derivation';
import {campaignStateSchema, parseCampaignState} from './campaign-state.schema';

export const SAVE_FORMAT_VERSION = 4;
export const SAVE_SLOTS = ['slot-1', 'slot-2', 'slot-3'] as const;
export type SaveSlot = (typeof SAVE_SLOTS)[number];
const LEGACY_OBJECTIVE_IDS = ['pipe', 'lock', 'space', 'platformer'] as const;

export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface SaveEnvelope {
    readonly formatVersion: typeof SAVE_FORMAT_VERSION;
    readonly savedAt: string;
    readonly state: CampaignState;
}

const saveEnvelopeSchema: z.ZodType<SaveEnvelope> = z.object({
    formatVersion: z.literal(SAVE_FORMAT_VERSION),
    savedAt: z.iso.datetime(),
    state: campaignStateSchema
}).strict();

const safeInteger = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const uint32 = z.number().int().min(0).max(0xffff_ffff);
const coordinateSchema = z.object({x: z.number().int().nonnegative(), y: z.number().int().nonnegative()}).strict();
const legacyCellSchema = z.discriminatedUnion('kind', [
    z.object({kind: z.literal('passage'), materialId: z.null()}).strict(),
    z.object({kind: z.literal('wall'), materialId: z.enum(MATERIAL_IDS)}).strict()
]);
const legacyHistorySchema = z.object({
    runId: z.string().min(1),
    definitionId: z.string().min(1),
    triggerId: z.string().min(1),
    kind: z.enum(['pipe', 'lock', 'shooter', 'platformer']),
    status: z.enum(['success', 'failure', 'abandoned']),
    grade: z.enum(['s', 'a', 'b', 'c', 'none']),
    score: z.number().finite().nonnegative(),
    elapsedMs: z.number().finite().nonnegative()
}).strict();
const legacyEnvelopeSchema = z.object({
    formatVersion: z.literal(1),
    savedAt: z.iso.datetime(),
    state: z.object({
        schemaVersion: z.literal(1),
        campaignSeed: safeInteger,
        act: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
        player: z.object({
            health: z.number().int().nonnegative(),
            maxHealth: z.number().int().positive(),
            scrap: z.number().int().nonnegative(),
            miningPower: z.number().int().nonnegative(),
            toolCharge: z.number().int().nonnegative(),
            installedModuleIds: z.array(z.string())
        }).strict(),
        worldSystems: z.object({
            powerRouting: z.number().int().min(0).max(100),
            securityAlert: z.number().int().min(0).max(100),
            airspaceControl: z.number().int().min(0).max(100),
            structuralStability: z.number().int().min(0).max(100)
        }).strict(),
        flags: z.array(z.string()),
        overworld: z.object({
            levelId: z.string().min(1),
            seed: safeInteger,
            maze: z.array(z.array(legacyCellSchema).min(5)).min(5),
            playerPosition: coordinateSchema,
            turn: z.number().int().nonnegative(),
            itemsInitialized: z.boolean(),
            items: z.array(z.object({
                id: z.string().min(1),
                typeId: z.enum(['health-potion', 'mining-pick']),
                position: coordinateSchema
            }).strict()),
            monstersInitialized: z.boolean(),
            monsters: z.array(z.object({
                id: z.string().min(1),
                typeId: z.enum(['moss-slime', 'ember-hound']),
                position: coordinateSchema,
                lastMoveTurn: safeInteger,
                lastAttackTurn: safeInteger
            }).strict()),
            triggerStates: z.record(z.string(), z.enum(['available', 'resolved', 'disabled'])),
            resumeGraceTurns: z.number().int().nonnegative()
        }).strict(),
        appliedEncounterRunIds: z.array(z.string()),
        encounterHistory: z.array(legacyHistorySchema)
    }).strict()
}).strict();

type LegacyEnvelope = z.infer<typeof legacyEnvelopeSchema>;

const versionTwoEnvelopeShape = z.object({
    formatVersion: z.literal(2),
    savedAt: z.iso.datetime(),
    state: z.object({
        schemaVersion: z.literal(2),
        player: z.object({}).passthrough(),
        overworld: z.object({seed: uint32}).passthrough()
    }).passthrough()
}).passthrough();

const versionThreeEnvelopeShape = z.object({
    formatVersion: z.literal(3),
    savedAt: z.iso.datetime(),
    state: z.object({
        schemaVersion: z.literal(3),
        overworld: z.object({seed: uint32}).passthrough()
    }).passthrough()
}).passthrough();

export class SaveDataError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'SaveDataError';
    }
}

function key(position: {readonly x: number; readonly y: number}): string {
    return `${position.x},${position.y}`;
}

function relocateLegacyMonsters(
    legacy: LegacyEnvelope['state']
): readonly MonsterState[] {
    const occupied = new Set<string>([key(legacy.overworld.playerPosition)]);
    const passagePositions = legacy.overworld.maze.flatMap((row, y) =>
        row.flatMap((cell, x) => cell.kind === 'passage' ? [{x, y}] : [])
    );
    return [...legacy.overworld.monsters]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(monster => {
            let position = monster.position;
            if (occupied.has(key(position))) {
                const passageDistances = getPassageDistances(
                    legacy.overworld.maze,
                    position
                );
                const replacement = passagePositions
                    .filter(candidate =>
                        !occupied.has(key(candidate)) &&
                        passageDistances.has(key(candidate))
                    )
                    .sort((left, right) => {
                        const leftDistance = passageDistances.get(key(left))!;
                        const rightDistance = passageDistances.get(key(right))!;
                        return leftDistance - rightDistance || left.y - right.y || left.x - right.x;
                    })[0];
                if (!replacement) throw new SaveDataError('Legacy monsters could not be safely relocated.');
                position = replacement;
            }
            occupied.add(key(position));
            const definition = MONSTER_DEFINITIONS[monster.typeId];
            return {
                id: monster.id,
                typeId: monster.typeId,
                variantIds: [],
                elite: false,
                position,
                spawnPosition: position,
                health: definition.maxHealth,
                maxHealth: definition.maxHealth,
                armor: definition.armor,
                actionCount: 0,
                nextMoveTurn: definition.moveEveryTurns,
                nextAttackTurn: definition.attackCooldownTurns,
                revealed: true,
                intent: null,
                statuses: [],
                undamagedTurns: 0,
                drop: null
            } satisfies MonsterState;
        });
}

function migrateLegacyEnvelope(legacy: LegacyEnvelope): SaveEnvelope {
    const old = legacy.state;
    const pipeComplete = old.flags.includes('coolant-routing-restored');
    if (
        (old.flags.includes('archive-lock-opened') && !pipeComplete) ||
        (old.flags.includes('orbital-corridor-cleared') && !old.flags.includes('archive-lock-opened')) ||
        (old.flags.includes('sublevel-nine-stabilized') && !old.flags.includes('orbital-corridor-cleared'))
    ) {
        throw new SaveDataError('Legacy objective completion order is impossible.');
    }

    const campaignSeed = old.campaignSeed >>> 0;
    const overworldSeed = old.overworld.seed >>> 0;
    const base = createInitialCampaignState({
        campaignSeed,
        overworldSeed,
        maze: old.overworld.maze,
        levelId: old.overworld.levelId
    });
    const monsters = relocateLegacyMonsters(old);
    const items = old.overworld.items.map(item => ({
        instance: createItemInstance(item.id, item.typeId),
        position: item.position
    }));
    const reserved = [
        old.overworld.playerPosition,
        ...items.map(item => item.position),
        ...monsters.map(monster => monster.position)
    ];
    const placement = placeLevelObjectives(
        old.overworld.maze,
        new Mulberry32Random(deriveSeed(overworldSeed, 'objective-placement')),
        reserved,
        LEGACY_OBJECTIVE_IDS
    );
    const objectiveTriggerIds = new Set<string>(
        OBJECTIVE_DEFINITIONS.map(definition => definition.triggerId)
    );
    const completedObjectives = OBJECTIVE_DEFINITIONS
        .filter(definition => old.flags.includes(definition.completionFlag))
        .map(definition => definition.id);

    const migrated: CampaignState = {
        ...base,
        schemaVersion: CAMPAIGN_SCHEMA_VERSION,
        act: old.act,
        player: {
            ...base.player,
            health: old.player.health,
            maxHealth: old.player.maxHealth,
            scrap: old.player.scrap,
            miningPower: old.player.miningPower,
            toolCharge: old.player.toolCharge,
            installedModuleIds: old.player.installedModuleIds
        },
        worldSystems: old.worldSystems,
        flags: old.flags,
        overworld: {
            ...base.overworld,
            contentOrigin: 'migrated-v1',
            levelContentInitialized: true,
            playerPosition: old.overworld.playerPosition,
            turn: old.overworld.turn,
            items,
            monsters,
            objectives: placement.objectives,
            pipeShortcutWall: pipeComplete ? null : placement.pipeShortcutWall,
            sanctuaryPosition: {x: 1, y: 1},
            sanctuaryServiceClaims: completedObjectives,
            triggerStates: Object.fromEntries(
                Object.entries(old.overworld.triggerStates)
                    .filter(([triggerId]) => !objectiveTriggerIds.has(triggerId))
            ),
            resumeGraceTurns: Math.min(3, old.overworld.resumeGraceTurns)
        },
        appliedEncounterRunIds: old.appliedEncounterRunIds,
        encounterHistory: old.encounterHistory
    };
    return {
        formatVersion: SAVE_FORMAT_VERSION,
        savedAt: legacy.savedAt,
        state: parseCampaignState(migrated)
    };
}

function migrateVersionTwoEnvelope(input: unknown): SaveEnvelope {
    const legacy = versionTwoEnvelopeShape.safeParse(input);
    if (!legacy.success) {
        throw new SaveDataError('Version 2 save data failed validation.', {cause: legacy.error});
    }
    const upgraded = {
        ...legacy.data,
        formatVersion: SAVE_FORMAT_VERSION,
        state: {
            ...legacy.data.state,
            schemaVersion: CAMPAIGN_SCHEMA_VERSION,
            player: {
                ...legacy.data.state.player,
                money: STARTING_MONEY
            },
            overworld: {
                ...legacy.data.state.overworld,
                serviceSites: [],
                reinforcementCountdownMs: getReinforcementDelayMs(
                    legacy.data.state.overworld.seed,
                    0
                ),
                reinforcementOrdinal: 0
            }
        }
    };
    const parsed = saveEnvelopeSchema.safeParse(upgraded);
    if (!parsed.success) {
        throw new SaveDataError('Version 2 save data failed validation.', {cause: parsed.error});
    }
    return parsed.data;
}

function migrateVersionThreeEnvelope(input: unknown): SaveEnvelope {
    const legacy = versionThreeEnvelopeShape.safeParse(input);
    if (!legacy.success) {
        throw new SaveDataError('Version 3 save data failed validation.', {cause: legacy.error});
    }
    const upgraded = {
        ...legacy.data,
        formatVersion: SAVE_FORMAT_VERSION,
        state: {
            ...legacy.data.state,
            schemaVersion: CAMPAIGN_SCHEMA_VERSION,
            overworld: {
                ...legacy.data.state.overworld,
                reinforcementCountdownMs: getReinforcementDelayMs(
                    legacy.data.state.overworld.seed,
                    0
                ),
                reinforcementOrdinal: 0
            }
        }
    };
    const parsed = saveEnvelopeSchema.safeParse(upgraded);
    if (!parsed.success) {
        throw new SaveDataError('Version 3 save data failed validation.', {cause: parsed.error});
    }
    return parsed.data;
}

function parseSerializedSave(serialized: string): {
    readonly envelope: SaveEnvelope;
    readonly migrated: boolean;
} {
    let input: unknown;
    try {
        input = JSON.parse(serialized);
    } catch (error) {
        throw new SaveDataError('Save data is not valid JSON.', {cause: error});
    }
    if (!input || typeof input !== 'object' || !('formatVersion' in input)) {
        throw new SaveDataError('Save data does not declare a format version.');
    }

    if (input.formatVersion === 1) {
        const legacy = legacyEnvelopeSchema.safeParse(input);
        if (!legacy.success) {
            throw new SaveDataError('Legacy save data failed validation.', {cause: legacy.error});
        }
        return {envelope: migrateLegacyEnvelope(legacy.data), migrated: true};
    }
    if (input.formatVersion === 2) {
        return {envelope: migrateVersionTwoEnvelope(input), migrated: true};
    }
    if (input.formatVersion === 3) {
        return {envelope: migrateVersionThreeEnvelope(input), migrated: true};
    }
    if (input.formatVersion !== SAVE_FORMAT_VERSION) {
        throw new SaveDataError(`Unsupported save format version: ${String(input.formatVersion)}.`);
    }
    const result = saveEnvelopeSchema.safeParse(input);
    if (!result.success) {
        throw new SaveDataError('Save data failed validation.', {cause: result.error});
    }
    return {envelope: result.data, migrated: false};
}

export class LocalSaveRepository {
    private readonly storage: StorageLike;
    private readonly now: () => Date;
    private readonly keyPrefix: string;

    constructor(
        storage: StorageLike,
        options: {readonly now?: () => Date; readonly keyPrefix?: string} = {}
    ) {
        this.storage = storage;
        this.now = options.now ?? (() => new Date());
        this.keyPrefix = options.keyPrefix ?? 'maze:campaign';
    }

    save(slot: SaveSlot, state: CampaignState): SaveEnvelope {
        const envelope: SaveEnvelope = {
            formatVersion: SAVE_FORMAT_VERSION,
            savedAt: this.now().toISOString(),
            state: parseCampaignState(state)
        };
        this.storage.setItem(this.keyFor(slot), JSON.stringify(envelope));
        return envelope;
    }

    load(slot: SaveSlot): SaveEnvelope | null {
        const serialized = this.storage.getItem(this.keyFor(slot));
        if (serialized === null) return null;
        const parsed = parseSerializedSave(serialized);
        if (parsed.migrated) {
            this.storage.setItem(this.keyFor(slot), JSON.stringify(parsed.envelope));
        }
        return parsed.envelope;
    }

    clear(slot: SaveSlot): void {
        this.storage.removeItem(this.keyFor(slot));
    }

    exportSlot(slot: SaveSlot): string | null {
        const envelope = this.load(slot);
        return envelope ? JSON.stringify(envelope, null, 2) : null;
    }

    importSlot(slot: SaveSlot, serialized: string): SaveEnvelope {
        const parsed = parseSerializedSave(serialized);
        this.storage.setItem(this.keyFor(slot), JSON.stringify(parsed.envelope));
        return parsed.envelope;
    }

    private keyFor(slot: SaveSlot): string {
        return `${this.keyPrefix}:${slot}`;
    }
}
