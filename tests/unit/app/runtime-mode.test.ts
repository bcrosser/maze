import {describe, expect, it} from 'vitest';

import {getRuntimeMode} from '../../../src/app/runtime-mode';

describe('getRuntimeMode', () => {
    it('uses the playable Phaser campaign by default', () => {
        expect(getRuntimeMode('')).toBe('phaser');
        expect(getRuntimeMode('?runtime=unknown')).toBe('phaser');
    });

    it('keeps both runtimes explicitly selectable', () => {
        expect(getRuntimeMode('?runtime=phaser')).toBe('phaser');
        expect(getRuntimeMode('?debug=1&runtime=phaser')).toBe('phaser');
        expect(getRuntimeMode('?runtime=legacy')).toBe('legacy');
    });
});