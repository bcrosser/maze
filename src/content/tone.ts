import {z} from 'zod';

export const CONTENT_TONES = [
    'non-sequitur-humor',
    'dark-future',
    'pop-culture-homage',
    'retro-heart'
] as const;

export const NARRATIVE_BEAT_KINDS = [
    'dialogue',
    'environment',
    'encounter',
    'item',
    'mission',
    'outcome'
] as const;

export type ContentTone = (typeof CONTENT_TONES)[number];
export type NarrativeBeatKind = (typeof NARRATIVE_BEAT_KINDS)[number];

export const TARGET_TONE_PERCENTAGES = Object.freeze({
    'non-sequitur-humor': 30,
    'dark-future': 30,
    'pop-culture-homage': 10,
    'retro-heart': 30
} as const satisfies Record<ContentTone, number>);

export const DEFAULT_TONE_TOLERANCE_PERCENTAGE_POINTS = 5;

export const narrativeBeatSchema = z.object({
    id: z.string().min(1),
    act: z.number().int().min(1).max(4),
    kind: z.enum(NARRATIVE_BEAT_KINDS),
    primaryTone: z.enum(CONTENT_TONES),
    weight: z.number().int().min(1).max(3),
    summary: z.string().min(1),
    referenceNote: z.string().min(1).optional()
}).strict().superRefine((beat, context) => {
    if (beat.primaryTone === 'pop-culture-homage' && !beat.referenceNote) {
        context.addIssue({
            code: 'custom',
            path: ['referenceNote'],
            message: 'Pop-culture homage must document how the reference is transformed and original.'
        });
    }
});

export type NarrativeBeat = z.infer<typeof narrativeBeatSchema>;

export interface ToneMeasurement {
    readonly weightedBeats: number;
    readonly targetPercentage: number;
    readonly actualPercentage: number;
    readonly deviationPercentagePoints: number;
}

export interface ToneDistributionReport {
    readonly totalWeight: number;
    readonly tolerancePercentagePoints: number;
    readonly withinTolerance: boolean;
    readonly tones: Readonly<Record<ContentTone, ToneMeasurement>>;
}

function roundPercentage(value: number): number {
    return Math.round(value * 100) / 100;
}

export function parseNarrativeBeat(input: unknown): NarrativeBeat {
    return narrativeBeatSchema.parse(input);
}

export function analyzeToneDistribution(
    beats: readonly NarrativeBeat[],
    tolerancePercentagePoints = DEFAULT_TONE_TOLERANCE_PERCENTAGE_POINTS
): ToneDistributionReport {
    if (beats.length === 0) throw new Error('At least one narrative beat is required.');
    if (!Number.isFinite(tolerancePercentagePoints) || tolerancePercentagePoints < 0) {
        throw new Error('Tone tolerance must be a non-negative finite number.');
    }

    const weights: Record<ContentTone, number> = {
        'non-sequitur-humor': 0,
        'dark-future': 0,
        'pop-culture-homage': 0,
        'retro-heart': 0
    };
    for (const beat of beats) weights[beat.primaryTone] += beat.weight;

    const totalWeight = Object.values(weights).reduce((total, weight) => total + weight, 0);
    const tones = Object.fromEntries(CONTENT_TONES.map(tone => {
        const actualPercentage = roundPercentage((weights[tone] / totalWeight) * 100);
        const deviationPercentagePoints = roundPercentage(
            actualPercentage - TARGET_TONE_PERCENTAGES[tone]
        );
        return [tone, {
            weightedBeats: weights[tone],
            targetPercentage: TARGET_TONE_PERCENTAGES[tone],
            actualPercentage,
            deviationPercentagePoints
        }];
    })) as Record<ContentTone, ToneMeasurement>;

    return {
        totalWeight,
        tolerancePercentagePoints,
        withinTolerance: CONTENT_TONES.every(tone =>
            Math.abs(tones[tone].deviationPercentagePoints) <= tolerancePercentagePoints
        ),
        tones
    };
}

export function assertToneDistribution(
    beats: readonly NarrativeBeat[],
    tolerancePercentagePoints = DEFAULT_TONE_TOLERANCE_PERCENTAGE_POINTS
): ToneDistributionReport {
    const report = analyzeToneDistribution(beats, tolerancePercentagePoints);
    if (report.withinTolerance) return report;

    const deviations = CONTENT_TONES
        .filter(tone =>
            Math.abs(report.tones[tone].deviationPercentagePoints) > tolerancePercentagePoints
        )
        .map(tone => {
            const measurement = report.tones[tone];
            return `${tone}: ${measurement.actualPercentage}% (target ${measurement.targetPercentage}%)`;
        });
    throw new Error(`Content tone distribution is outside tolerance: ${deviations.join(', ')}.`);
}