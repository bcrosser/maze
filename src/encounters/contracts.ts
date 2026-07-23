import {z} from 'zod';

import {
    ENCOUNTER_KINDS,
    ENCOUNTER_STATUSES,
    PERFORMANCE_GRADES,
    RESOURCE_KEYS,
    TRIGGER_STATES,
    WORLD_SYSTEM_KEYS,
    type ActNumber,
    type CampaignState,
    type EncounterKind
} from '../domain/campaign/campaign-state';
import {MATERIAL_IDS, type MaterialId, type MaterialTag} from '../domain/materials/materials';
import type {Coordinate} from '../domain/overworld/maze-types';

const safeInteger = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const coordinateSchema = z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative()
}).strict();
const materialIdSchema = z.custom<MaterialId>(
    value => typeof value === 'string' && MATERIAL_IDS.includes(value as MaterialId),
    {message: 'Unknown material ID.'}
);
const mazeCellSchema = z.discriminatedUnion('kind', [
    z.object({kind: z.literal('passage'), materialId: z.null()}).strict(),
    z.object({kind: z.literal('wall'), materialId: materialIdSchema}).strict()
]);

export const outcomeEffectSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('change-resource'),
        resource: z.enum(RESOURCE_KEYS),
        delta: safeInteger
    }).strict(),
    z.object({
        kind: z.literal('adjust-world-system'),
        system: z.enum(WORLD_SYSTEM_KEYS),
        delta: safeInteger
    }).strict(),
    z.object({
        kind: z.literal('upgrade-mining-power'),
        minimum: z.number().int().nonnegative()
    }).strict(),
    z.object({kind: z.literal('set-flag'), flag: z.string().min(1)}).strict(),
    z.object({kind: z.literal('remove-flag'), flag: z.string().min(1)}).strict(),
    z.object({kind: z.literal('install-module'), moduleId: z.string().min(1)}).strict(),
    z.object({
        kind: z.literal('transform-cell'),
        position: coordinateSchema,
        cell: mazeCellSchema
    }).strict(),
    z.object({
        kind: z.literal('set-trigger-state'),
        triggerId: z.string().min(1),
        state: z.enum(TRIGGER_STATES)
    }).strict()
]);

export const encounterResultSchema = z.object({
    runId: z.string().min(1),
    definitionId: z.string().min(1),
    triggerId: z.string().min(1),
    kind: z.enum(ENCOUNTER_KINDS),
    status: z.enum(ENCOUNTER_STATUSES),
    grade: z.enum(PERFORMANCE_GRADES),
    score: z.number().finite().nonnegative(),
    elapsedMs: z.number().finite().nonnegative(),
    effects: z.array(outcomeEffectSchema).max(100)
}).strict();

export type OutcomeEffect = z.infer<typeof outcomeEffectSchema>;
export type EncounterResult = z.infer<typeof encounterResultSchema>;

export type DifficultyPreset = 'story' | 'standard' | 'expert';

export interface EncounterTriggerContext {
    readonly triggerId: string;
    readonly position: Coordinate;
    readonly nearbyMaterialIds: readonly MaterialId[];
    readonly nearbyMaterialTags: readonly MaterialTag[];
}

export interface EncounterContext {
    readonly runId: string;
    readonly definitionId: string;
    readonly kind: EncounterKind;
    readonly act: ActNumber;
    readonly seed: number;
    readonly difficulty: DifficultyPreset;
    readonly campaignSnapshot: CampaignState;
    readonly trigger: EncounterTriggerContext;
    readonly modifiers: Readonly<Record<string, string | number | boolean>>;
}

export function parseEncounterResult(input: unknown): EncounterResult {
    return encounterResultSchema.parse(input);
}