import {z} from 'zod';

import {
    CAMPAIGN_SCHEMA_VERSION,
    ENCOUNTER_KINDS,
    ENCOUNTER_STATUSES,
    PERFORMANCE_GRADES,
    TRIGGER_STATES,
    type CampaignState
} from '../domain/campaign/campaign-state';
import {ITEM_TYPE_IDS} from '../domain/entities/item-types';
import {MONSTER_TYPE_IDS} from '../domain/entities/monster-types';
import {MATERIAL_IDS, type MaterialId} from '../domain/materials/materials';

const safeInteger = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const nonNegativeSafeInteger = safeInteger.nonnegative();
const coordinateSchema = z.object({
    x: nonNegativeSafeInteger,
    y: nonNegativeSafeInteger
}).strict();
const materialIdSchema = z.custom<MaterialId>(
    value => typeof value === 'string' && MATERIAL_IDS.includes(value as MaterialId),
    {message: 'Unknown material ID.'}
);
const mazeCellSchema = z.discriminatedUnion('kind', [
    z.object({kind: z.literal('passage'), materialId: z.null()}).strict(),
    z.object({kind: z.literal('wall'), materialId: materialIdSchema}).strict()
]);
const mazeSchema = z.array(z.array(mazeCellSchema).min(5)).min(5);
const playerSchema = z.object({
    health: nonNegativeSafeInteger,
    maxHealth: nonNegativeSafeInteger.positive(),
    scrap: nonNegativeSafeInteger,
    miningPower: nonNegativeSafeInteger,
    toolCharge: nonNegativeSafeInteger,
    installedModuleIds: z.array(z.string().min(1))
}).strict().refine(player => player.health <= player.maxHealth, {
    message: 'Player health cannot exceed maximum health.',
    path: ['health']
});
const historyEntrySchema = z.object({
    runId: z.string().min(1),
    definitionId: z.string().min(1),
    triggerId: z.string().min(1),
    kind: z.enum(ENCOUNTER_KINDS),
    status: z.enum(ENCOUNTER_STATUSES),
    grade: z.enum(PERFORMANCE_GRADES),
    score: z.number().finite().nonnegative(),
    elapsedMs: z.number().finite().nonnegative()
}).strict();

export const campaignStateSchema: z.ZodType<CampaignState> = z.object({
    schemaVersion: z.literal(CAMPAIGN_SCHEMA_VERSION),
    campaignSeed: safeInteger,
    act: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    player: playerSchema,
    worldSystems: z.object({
        powerRouting: safeInteger.min(0).max(100),
        securityAlert: safeInteger.min(0).max(100),
        airspaceControl: safeInteger.min(0).max(100),
        structuralStability: safeInteger.min(0).max(100)
    }).strict(),
    flags: z.array(z.string().min(1)),
    overworld: z.object({
        levelId: z.string().min(1),
        seed: safeInteger,
        maze: mazeSchema,
        playerPosition: coordinateSchema,
        turn: nonNegativeSafeInteger,
        itemsInitialized: z.boolean(),
        items: z.array(z.object({
            id: z.string().min(1),
            typeId: z.enum(ITEM_TYPE_IDS),
            position: coordinateSchema
        }).strict()),
        monstersInitialized: z.boolean(),
        monsters: z.array(z.object({
            id: z.string().min(1),
            typeId: z.enum(MONSTER_TYPE_IDS),
            position: coordinateSchema,
            lastMoveTurn: safeInteger,
            lastAttackTurn: safeInteger
        }).strict()),
        triggerStates: z.record(z.string().min(1), z.enum(TRIGGER_STATES)),
        resumeGraceTurns: nonNegativeSafeInteger
    }).strict(),
    appliedEncounterRunIds: z.array(z.string().min(1)),
    encounterHistory: z.array(historyEntrySchema)
}).strict().superRefine((state, context) => {
    const size = state.overworld.maze.length;
    if (size % 2 === 0 || state.overworld.maze.some(row => row.length !== size)) {
        context.addIssue({
            code: 'custom',
            path: ['overworld', 'maze'],
            message: 'Saved maze must be an odd square grid.'
        });
    }

    const {x, y} = state.overworld.playerPosition;
    if (state.overworld.maze[y]?.[x]?.kind !== 'passage') {
        context.addIssue({
            code: 'custom',
            path: ['overworld', 'playerPosition'],
            message: 'Saved player position must be an open maze passage.'
        });
    }

    const uniqueRunIds = new Set(state.appliedEncounterRunIds);
    if (uniqueRunIds.size !== state.appliedEncounterRunIds.length) {
        context.addIssue({
            code: 'custom',
            path: ['appliedEncounterRunIds'],
            message: 'Applied encounter run IDs must be unique.'
        });
    }
});

export function parseCampaignState(input: unknown): CampaignState {
    return campaignStateSchema.parse(input);
}