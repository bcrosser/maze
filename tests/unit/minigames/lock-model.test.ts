import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    createPinTensionLock,
    probeLockPin,
    setLockTension,
    type PinTensionLock
} from '../../../src/minigames/lock/lock-model';

describe('pin-and-tension lock model', () => {
    it('creates a deterministic lock from a seed', () => {
        const first = createPinTensionLock(new Mulberry32Random(8128));
        const second = createPinTensionLock(new Mulberry32Random(8128));

        expect(first).toEqual(second);
        expect(first.pins).toHaveLength(4);
    });

    it('distinguishes slipping, binding, and correctly set pins', () => {
        const base: PinTensionLock = {
            requiredTension: 2,
            tension: 1,
            turns: 0,
            mistakes: 0,
            pins: [{targetHeight: 1, height: 0, set: false}]
        };
        const slipping = probeLockPin(base, 0);
        const binding = probeLockPin({...base, tension: 3}, 0);
        const set = probeLockPin({...base, tension: 2}, 0);

        expect(slipping.feedback).toBe('slipping');
        expect(binding.feedback).toBe('binding');
        expect(set.feedback).toBe('set');
        expect(set.state.pins[0]?.set).toBe(true);
    });

    it('completes only after every pin is set at the correct tension', () => {
        let state: PinTensionLock = {
            requiredTension: 2,
            tension: 0,
            turns: 0,
            mistakes: 0,
            pins: [
                {targetHeight: 1, height: 0, set: false},
                {targetHeight: 2, height: 0, set: false},
                {targetHeight: 3, height: 0, set: false}
            ]
        };
        state = setLockTension(state, 2);
        let completed = false;
        for (let pinIndex = 0; pinIndex < state.pins.length; pinIndex++) {
            while (!state.pins[pinIndex]?.set) {
                const result = probeLockPin(state, pinIndex);
                state = result.state;
                completed = result.completed;
            }
        }

        expect(completed).toBe(true);
        expect(state.pins.every(pin => pin.set)).toBe(true);
        expect(state.mistakes).toBe(0);
    });

    it('counts tension changes and probe attempts as turns', () => {
        const lock = createPinTensionLock(new Mulberry32Random(3));
        const tensioned = setLockTension(lock, 1);
        const probed = probeLockPin(tensioned, 0);

        expect(probed.state.turns).toBe(2);
    });
});