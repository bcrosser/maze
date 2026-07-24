import {describe, expect, it} from 'vitest';

import {deriveSeed} from '../../../src/domain/random/seed-derivation';

describe('deriveSeed', () => {
    it.each([
        [0, 'maze-topology', 0, 1_417_617_988],
        [20_260_723, 'objective-placement', 1, 1_372_142_315],
        [0xffff_ffff, 'pipe-attempt', 7, 174_535_124]
    ] as const)('matches the persisted compatibility vector', (base, namespace, ordinal, expected) => {
        expect(deriveSeed(base, namespace, ordinal)).toBe(expected);
    });

    it('keeps namespaces independent', () => {
        expect(deriveSeed(42, 'items')).not.toBe(deriveSeed(42, 'monsters'));
    });

    it('rejects non-uint32 input', () => {
        expect(() => deriveSeed(-1, 'maze')).toThrow(/unsigned 32-bit/);
        expect(() => deriveSeed(1, '', 0)).toThrow(/namespace/);
    });
});
