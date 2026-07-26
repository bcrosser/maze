import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    advanceSafeDialTime,
    createSafeDialLock,
    dialDistance,
    getCurrentGate,
    getDialSignalStrength,
    gradeSafeDial,
    pullHandle,
    rotateDial,
    scoreSafeDial,
    setDialPosition,
    setSafeDialPaused,
    tryGate,
    type SafeDialLock
} from '../../../src/minigames/lock/safe-dial-model';

function createScenario(): SafeDialLock {
    const state = createSafeDialLock(new Mulberry32Random(7), {difficulty: 'standard'});
    return {...state, gates: [20, 55, 80]};
}

describe('safe dial generation', () => {
    it('is deterministic and keeps every gate well separated on the ring', () => {
        for (let seed = 0; seed < 40; seed++) {
            const first = createSafeDialLock(new Mulberry32Random(seed), {difficulty: 'standard'});
            const second = createSafeDialLock(new Mulberry32Random(seed), {difficulty: 'standard'});

            expect(first).toEqual(second);
            expect(first.gates).toHaveLength(3);
            for (let a = 0; a < first.gates.length; a++) {
                for (let b = a + 1; b < first.gates.length; b++) {
                    expect(dialDistance(first.gates[a]!, first.gates[b]!))
                        .toBeGreaterThanOrEqual(12);
                }
            }
        }
    });

    it('applies difficulty presets and the tier-five alarm escalation', () => {
        const story = createSafeDialLock(new Mulberry32Random(1), {difficulty: 'story'});
        const expert = createSafeDialLock(new Mulberry32Random(1), {difficulty: 'expert'});
        const tiered = createSafeDialLock(
            new Mulberry32Random(1),
            {difficulty: 'standard', levelTier: 5}
        );

        expect(story.config).toMatchObject({gateCount: 3, gateTolerance: 3, alarmWindowMs: 120_000});
        expect(expert.config).toMatchObject({gateCount: 4, gateTolerance: 1, maximumFocus: 4});
        expect(tiered.config.alarmWindowMs).toBe(75_000);
    });
});

describe('safe dial play', () => {
    it('wraps the dial around the 0-99 ring in both directions', () => {
        const state = createScenario();
        expect(rotateDial(state, -1).dial).toBe(99);
        expect(setDialPosition(state, 137).dial).toBe(37);
    });

    it('reports a stronger signal and hotter feedback as the dial nears the gate', () => {
        const state = createScenario();
        const cold = setDialPosition(state, 60);
        const faint = setDialPosition(state, 30);
        const warm = setDialPosition(state, 25);
        const hot = setDialPosition(state, 21);

        expect(cold.feedback).toBe('cold');
        expect(faint.feedback).toBe('faint');
        expect(warm.feedback).toBe('warm');
        expect(hot.feedback).toBe('hot');
        expect(getDialSignalStrength(hot)).toBeGreaterThan(getDialSignalStrength(warm));
        expect(getDialSignalStrength(warm)).toBeGreaterThan(getDialSignalStrength(cold));
    });

    it('locks gates in order within tolerance and readies the handle after the last', () => {
        let state = setDialPosition(createScenario(), 21);
        expect(getCurrentGate(state)).toBe(20);

        const first = tryGate(state);
        expect(first.feedback).toBe('gate-set');
        state = setDialPosition(first.state, 55);
        const second = tryGate(state);
        expect(second.feedback).toBe('gate-set');
        state = setDialPosition(second.state, 79);
        const third = tryGate(state);
        expect(third.feedback).toBe('handle-ready');

        expect(pullHandle(second.state).feedback).toBe('lock-gates-first');
        const opened = pullHandle(third.state);
        expect(opened).toMatchObject({status: 'opened', feedback: 'opened'});
    });

    it('charges focus and alarm for a false gate and fails at zero focus', () => {
        const state = setDialPosition(createScenario(), 60);
        const missed = tryGate(state);

        expect(missed.feedback).toBe('false-gate');
        expect(missed.state.focus).toBe(state.focus - 1);
        expect(missed.state.alarm).toBe(10);
        expect(missed.state.falseGates).toBe(1);

        const exhausted = tryGate({...state, focus: 1});
        expect(exhausted.state).toMatchObject({status: 'failed', failureReason: 'focus'});
    });

    it('fills the alarm from active time, freezes while paused, and fails when full', () => {
        const state = createScenario();
        const halfway = advanceSafeDialTime(state, 45_000);
        const paused = setSafeDialPaused(halfway, true);

        expect(halfway.alarm).toBe(50);
        expect(advanceSafeDialTime(paused, 60_000)).toEqual(paused);
        expect(
            advanceSafeDialTime(setSafeDialPaused(paused, false), 45_000).status
        ).toBe('failed');
    });

    it('grades and scores an opened safe by false gates, alarm, and time', () => {
        let state = createScenario();
        for (const gate of state.gates) {
            state = tryGate(setDialPosition(state, gate)).state;
        }
        const opened = pullHandle(state);

        expect(gradeSafeDial({...opened, activeElapsedMs: 20_000, alarm: 20})).toBe('s');
        expect(gradeSafeDial({...opened, falseGates: 1, alarm: 40})).toBe('a');
        expect(gradeSafeDial({...opened, falseGates: 3, alarm: 79})).toBe('b');
        expect(scoreSafeDial({...opened, activeElapsedMs: 10_000, falseGates: 2}))
            .toBe(4_000 - 400 - 800);
        expect(scoreSafeDial({...opened, status: 'failed'})).toBe(0);
        expect(gradeSafeDial({...opened, status: 'active'})).toBe('none');
    });
});
