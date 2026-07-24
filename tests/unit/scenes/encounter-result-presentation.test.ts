import {describe, expect, it} from 'vitest';

import {getEncounterResultPresentation} from '../../../src/scenes/encounter-result-presentation';

describe('getEncounterResultPresentation', () => {
    it('announces the Casino Heist payout together with recorded objective progress', () => {
        const presentation = getEncounterResultPresentation(
            'Casino Heist',
            {status: 'success'},
            false
        );

        expect(presentation.title).toBe('OBJECTIVE COMPLETE');
        expect(presentation.detail).toContain('$1,000 stolen');
        expect(presentation.detail).toContain('Progress toward the exit was recorded');
        expect(presentation.returnMessage).toContain('$1,000 stolen');
    });
});
