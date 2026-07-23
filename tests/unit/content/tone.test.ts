import {describe, expect, it} from 'vitest';

import {
    analyzeToneDistribution,
    assertToneDistribution,
    parseNarrativeBeat,
    type ContentTone,
    type NarrativeBeat
} from '../../../src/content/tone';

function createBeat(
    id: string,
    primaryTone: ContentTone,
    weight: 1 | 2 | 3,
    referenceNote?: string
): NarrativeBeat {
    return parseNarrativeBeat({
        id,
        act: 1,
        kind: 'dialogue',
        primaryTone,
        weight,
        summary: `Test beat ${id}`,
        ...(referenceNote ? {referenceNote} : {})
    });
}

describe('campaign tone distribution', () => {
    it('accepts the requested 30/30/10/30 editorial mix', () => {
        const beats = [
            createBeat('absurd-1', 'non-sequitur-humor', 3),
            createBeat('future-1', 'dark-future', 3),
            createBeat('homage-1', 'pop-culture-homage', 1, 'Original genre parody.'),
            createBeat('retro-1', 'retro-heart', 3)
        ];

        const report = assertToneDistribution(beats);

        expect(report.withinTolerance).toBe(true);
        expect(report.tones['non-sequitur-humor'].actualPercentage).toBe(30);
        expect(report.tones['dark-future'].actualPercentage).toBe(30);
        expect(report.tones['pop-culture-homage'].actualPercentage).toBe(10);
        expect(report.tones['retro-heart'].actualPercentage).toBe(30);
    });

    it('reports a campaign that leans too heavily on one tone', () => {
        const beats = [
            createBeat('future-1', 'dark-future', 3),
            createBeat('future-2', 'dark-future', 3),
            createBeat('retro-1', 'retro-heart', 1)
        ];

        const report = analyzeToneDistribution(beats);

        expect(report.withinTolerance).toBe(false);
        expect(() => assertToneDistribution(beats)).toThrow(
            'Content tone distribution is outside tolerance'
        );
    });

    it('requires a transformation note for pop-culture homage', () => {
        expect(() => createBeat('unexplained-reference', 'pop-culture-homage', 1)).toThrow(
            'Pop-culture homage must document how the reference is transformed and original.'
        );
    });

    it('requires content before calculating a distribution', () => {
        expect(() => analyzeToneDistribution([])).toThrow(
            'At least one narrative beat is required.'
        );
    });
});