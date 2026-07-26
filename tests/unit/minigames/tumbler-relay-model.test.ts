import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    advanceTumblerRelayTime,
    createTumblerRelayLock,
    getActiveTumblerIndex,
    gradeTumblerRelay,
    isTumblerInBand,
    pressTumbler,
    scoreTumblerRelay,
    setTumblerRelayPaused,
    tumblerPosition,
    turnTumblerCam,
    type TumblerRelayLock
} from '../../../src/minigames/lock/tumbler-relay-model';
import type {DifficultyPreset} from '../../../src/encounters/contracts';

function createScenario(difficulty: DifficultyPreset = 'standard'): TumblerRelayLock {
    const state = createTumblerRelayLock(new Mulberry32Random(11), {difficulty});
    return {
        ...state,
        tumblers: state.tumblers.map(tumbler => ({
            ...tumbler,
            periodMs: 1_000,
            phase: 0,
            bandCenter: 0.5,
            latched: false
        }))
    };
}

/** Puts the active (first unlatched) tumbler exactly at its band center. */
function atBandCenter(state: TumblerRelayLock): TumblerRelayLock {
    return {...state, activeElapsedMs: 250};
}

describe('tumbler relay generation', () => {
    it('is deterministic with per-tumbler speeds that increase left to right', () => {
        for (let seed = 0; seed < 40; seed++) {
            const first = createTumblerRelayLock(new Mulberry32Random(seed), {difficulty: 'standard'});
            const second = createTumblerRelayLock(new Mulberry32Random(seed), {difficulty: 'standard'});

            expect(first).toEqual(second);
            expect(first.tumblers).toHaveLength(5);
            for (let index = 1; index < first.tumblers.length; index++) {
                expect(first.tumblers[index]!.periodMs)
                    .toBeLessThan(first.tumblers[index - 1]!.periodMs);
                expect(first.tumblers[index]!.bandCenter).toBeGreaterThanOrEqual(0.3);
                expect(first.tumblers[index]!.bandCenter).toBeLessThanOrEqual(0.75);
            }
        }
    });

    it('applies difficulty presets and the tier-five escalation', () => {
        const story = createTumblerRelayLock(new Mulberry32Random(1), {difficulty: 'story'});
        const expert = createTumblerRelayLock(new Mulberry32Random(1), {difficulty: 'expert'});
        const tiered = createTumblerRelayLock(
            new Mulberry32Random(1),
            {difficulty: 'standard', levelTier: 5}
        );

        expect(story.config).toMatchObject({tumblerCount: 4, maximumWear: 7, alarmWindowMs: 120_000});
        expect(expert.config).toMatchObject({tumblerCount: 6, maximumWear: 4});
        expect(tiered.config.alarmWindowMs).toBe(75_000);
        expect(tiered.config.catchHalfWidth).toBe(0.06);
    });

    it('moves each tumbler as a triangle wave over its own period and phase', () => {
        const tumbler = {periodMs: 1_000, phase: 0, bandCenter: 0.5, latched: false};

        expect(tumblerPosition(tumbler, 0)).toBe(0);
        expect(tumblerPosition(tumbler, 250)).toBe(0.5);
        expect(tumblerPosition(tumbler, 500)).toBe(1);
        expect(tumblerPosition(tumbler, 750)).toBe(0.5);
        expect(tumblerPosition({...tumbler, phase: 0.25}, 0)).toBe(0.5);
    });
});

describe('tumbler relay play', () => {
    it('latches the leftmost unlatched tumbler when pressed inside the band', () => {
        const state = atBandCenter(createScenario());
        expect(getActiveTumblerIndex(state)).toBe(0);
        expect(isTumblerInBand(state, 0)).toBe(true);

        const latched = pressTumbler(state);
        expect(latched.feedback).toBe('latched');
        expect(latched.state.tumblers[0]?.latched).toBe(true);
        expect(getActiveTumblerIndex(latched.state)).toBe(1);
        expect(latched.state.wear).toBe(state.wear);
    });

    it('charges wear and alarm on a miss and applies the difficulty drop rules', () => {
        const withFirstLatched = (difficulty: DifficultyPreset): TumblerRelayLock => {
            const state = createScenario(difficulty);
            return {
                ...state,
                tumblers: state.tumblers.map((tumbler, index) =>
                    index === 0 ? {...tumbler, latched: true} : tumbler
                ),
                activeElapsedMs: 0
            };
        };

        const story = pressTumbler(withFirstLatched('story'));
        expect(story.feedback).toBe('missed');
        expect(story.state.wear).toBe(6);
        expect(story.state.alarm).toBe(8);
        expect(story.state.tumblers[0]?.latched).toBe(true);

        const standardFirst = pressTumbler(withFirstLatched('standard'));
        const standardSecond = pressTumbler({...standardFirst.state, activeElapsedMs: 0});
        expect(standardFirst.feedback).toBe('missed');
        expect(standardSecond.feedback).toBe('dropped');
        expect(standardSecond.state.tumblers[0]?.latched).toBe(false);
        expect(standardSecond.state.drops).toBe(1);

        const expert = pressTumbler(withFirstLatched('expert'));
        expect(expert.feedback).toBe('dropped');
        expect(expert.state.tumblers[0]?.latched).toBe(false);
    });

    it('fails at zero wear and requires a separate cam turn after every latch', () => {
        const worn = pressTumbler({...createScenario('expert'), wear: 1, activeElapsedMs: 0});
        expect(worn.state).toMatchObject({status: 'failed', failureReason: 'wear'});

        let state = createScenario();
        expect(turnTumblerCam(state).feedback).toBe('latch-all-first');
        while (getActiveTumblerIndex(state) !== null) {
            const result = pressTumbler(atBandCenter(state));
            state = result.state;
        }
        expect(state.feedback).toBe('turn-ready');
        const opened = turnTumblerCam(state);
        expect(opened).toMatchObject({status: 'opened', feedback: 'opened'});
    });

    it('fills the alarm from active time, freezes while paused, and fails when full', () => {
        const state = createScenario();
        const halfway = advanceTumblerRelayTime(state, 45_000);
        const paused = setTumblerRelayPaused(halfway, true);

        expect(halfway.alarm).toBe(50);
        expect(advanceTumblerRelayTime(paused, 60_000)).toEqual(paused);
        expect(
            advanceTumblerRelayTime(setTumblerRelayPaused(paused, false), 45_000).status
        ).toBe('failed');
    });

    it('grades and scores an opened relay by misses, drops, alarm, and time', () => {
        let state = createScenario();
        while (getActiveTumblerIndex(state) !== null) {
            state = pressTumbler(atBandCenter(state)).state;
        }
        const opened = turnTumblerCam(state);

        expect(gradeTumblerRelay({...opened, activeElapsedMs: 20_000, alarm: 20})).toBe('s');
        expect(gradeTumblerRelay({...opened, misses: 1, alarm: 40})).toBe('a');
        expect(gradeTumblerRelay({...opened, misses: 3, alarm: 79})).toBe('b');
        expect(scoreTumblerRelay({...opened, activeElapsedMs: 10_000, misses: 2, drops: 1}))
            .toBe(4_000 - 400 - 600 - 250);
        expect(scoreTumblerRelay({...opened, status: 'failed'})).toBe(0);
        expect(gradeTumblerRelay({...opened, status: 'active'})).toBe('none');
    });
});
