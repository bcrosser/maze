import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    advanceLockTime,
    createLockPuzzle,
    createLockPuzzleForFamily,
    createPinTensionLock,
    getCurrentBindingPinIndex,
    getCurrentTensionBand,
    gradeLock,
    moveLockPick,
    releaseLockPick,
    resolveLockPuzzleConfig,
    scoreLock,
    setLockPaused,
    setLockTension,
    turnLockCylinder,
    type PinTensionLock
} from '../../../src/minigames/lock/lock-model';
import type {DifficultyPreset} from '../../../src/encounters/contracts';

function createScenario(difficulty: DifficultyPreset = 'standard'): PinTensionLock {
    const state = createLockPuzzle(
        new Mulberry32Random(91),
        {difficulty, pinCount: 4}
    );
    return {
        ...state,
        bindingOrder: [0, 1, 2, 3],
        tensionBands: state.tensionBands.map(() => ({
            center: 0.5,
            minimum: 0.4,
            maximum: 0.6
        })),
        pins: state.pins.map((pin, index) => ({
            ...pin,
            targetHeight: 0.5,
            height: 0,
            set: false,
            bindingRank: index
        })),
        selectedPinIndex: 0,
        pickHeight: 0,
        tension: 0.5,
        feedback: 'idle',
        setHistory: []
    };
}

function attempt(
    state: PinTensionLock,
    pinIndex: number,
    height: number,
    tension: number
): ReturnType<typeof releaseLockPick> {
    return releaseLockPick(
        moveLockPick(
            setLockTension(state, tension),
            pinIndex,
            height
        )
    );
}

function setEveryPin(initial: PinTensionLock): PinTensionLock {
    let state = initial;
    while (getCurrentBindingPinIndex(state) !== null) {
        const pinIndex = getCurrentBindingPinIndex(state)!;
        const pin = state.pins[pinIndex]!;
        const band = getCurrentTensionBand(state)!;
        const result = attempt(state, pinIndex, pin.targetHeight, band.center);
        expect(result.feedback).toBe(
            result.state.pins.every(candidate => candidate.set)
                ? 'turn-ready'
                : 'set'
        );
        state = result.state;
    }
    return state;
}

describe('pin-tumbler lock generation', () => {
    it('reproduces target heights, binding order, and per-pin tension bands', () => {
        const first = createLockPuzzle(
            new Mulberry32Random(8128),
            {difficulty: 'standard', levelTier: 2}
        );
        const second = createLockPuzzle(
            new Mulberry32Random(8128),
            {difficulty: 'standard', levelTier: 2}
        );

        expect(first).toEqual(second);
        expect(first.pins).toHaveLength(5);
        expect(first.bindingOrder).toHaveLength(5);
        expect(first.tensionBands).toHaveLength(5);
        expect(new Set(first.bindingOrder).size).toBe(5);
        expect(first.tensionBands.slice(1).some((band, index) =>
            band.center !== first.tensionBands[index]?.center
        )).toBe(true);
    });

    it('produces at least ninety distinct Standard signatures for seeds 0 through 99', () => {
        const signatures = new Set(
            Array.from({length: 100}, (_, seed) => {
                const lock = createLockPuzzle(
                    new Mulberry32Random(seed),
                    {difficulty: 'standard'}
                );
                return JSON.stringify({
                    heights: lock.pins.map(pin => pin.targetHeight),
                    order: lock.bindingOrder,
                    bands: lock.tensionBands
                });
            })
        );

        expect(signatures.size).toBeGreaterThanOrEqual(90);
    });

    it.each(['story', 'standard', 'expert'] as const)(
        'gives every %s pin a visibly distinct target depth',
        difficulty => {
            for (let seed = 0; seed < 40; seed++) {
                const lock = createLockPuzzle(new Mulberry32Random(seed), {difficulty});
                const heights = lock.pins.map(pin => pin.targetHeight).sort((a, b) => a - b);
                const gaps = heights.slice(1).map((height, index) =>
                    height - heights[index]!
                );

                expect(new Set(heights).size).toBe(heights.length);
                expect(Math.min(...gaps)).toBeGreaterThan(0.06);
                expect(heights.at(-1)! - heights[0]!).toBeGreaterThan(0.36);
            }
        }
    );

    it('uses the exact preset bases and bounded tier-five escalation', () => {
        expect(resolveLockPuzzleConfig({difficulty: 'story'})).toMatchObject({
            pinCount: 4,
            maximumIntegrity: 7,
            alarmWindowMs: 120_000,
            tensionBandWidth: 0.24,
            setTolerance: 0.08
        });
        expect(resolveLockPuzzleConfig({difficulty: 'standard'})).toMatchObject({
            pinCount: 5,
            maximumIntegrity: 5,
            alarmWindowMs: 90_000,
            tensionBandWidth: 0.18,
            setTolerance: 0.06
        });
        expect(resolveLockPuzzleConfig({difficulty: 'expert'})).toMatchObject({
            pinCount: 6,
            maximumIntegrity: 4,
            alarmWindowMs: 70_000,
            tensionBandWidth: 0.13,
            setTolerance: 0.05
        });
        expect(resolveLockPuzzleConfig({
            difficulty: 'standard',
            levelTier: 5
        })).toMatchObject({
            pinCount: 6,
            alarmWindowMs: 75_000,
            tensionBandWidth: 0.144
        });
        expect(resolveLockPuzzleConfig({
            difficulty: 'story',
            levelTier: 5
        }).pinCount).toBe(5);
        expect(resolveLockPuzzleConfig({
            difficulty: 'expert',
            levelTier: 5
        }).pinCount).toBe(6);
    });

    it('retains the family factory and compatibility factory contracts', () => {
        const compatible = createPinTensionLock(new Mulberry32Random(3));
        const family = createLockPuzzleForFamily(
            new Mulberry32Random(3),
            'pin-tension',
            {difficulty: 'standard'}
        );

        expect(compatible).toEqual(family);
        expect(() => createLockPuzzleForFamily(
            new Mulberry32Random(3),
            'combination',
            {difficulty: 'standard'}
        )).toThrow(/Unsupported lock family/);
    });
});

describe('pin-tumbler release resolution', () => {
    it('previews feedback while moving without applying a penalty', () => {
        const state = createScenario();
        const springy = moveLockPick(state, 2, 0.5);
        const binding = moveLockPick(state, 0, 0.2);
        const loose = moveLockPick(setLockTension(state, 0.2), 0, 0.5);
        const jammed = moveLockPick(setLockTension(state, 0.8), 0, 0.5);

        expect(springy.feedback).toBe('springy');
        expect(binding.feedback).toBe('binding');
        expect(loose.feedback).toBe('loose');
        expect(jammed.feedback).toBe('jammed');
        for (const preview of [springy, binding, loose, jammed]) {
            expect(preview.alarm).toBe(0);
            expect(preview.integrity).toBe(state.integrity);
        }
    });

    it.each(['story', 'standard', 'expert'] as const)(
        'resolves every precedence row and resets every non-set pin on %s',
        difficulty => {
            const state = createScenario(difficulty);
            const jammed = attempt(state, 2, 0.5, 0.8);
            const springy = attempt(state, 2, 0.5, 0.5);
            const loose = attempt(state, 0, 0.5, 0.2);
            const binding = attempt(state, 0, 0.2, 0.5);
            const set = attempt(state, 0, 0.5, 0.5);

            expect(jammed.feedback).toBe('jammed');
            expect(jammed.state.alarm).toBe(15);
            expect(jammed.state.integrity).toBe(state.integrity - 1);
            expect(jammed.state.pins[2]?.height).toBe(0);

            expect(springy.feedback).toBe('springy');
            expect(springy.state.alarm).toBe(3);
            expect(springy.state.integrity).toBe(state.integrity);
            expect(springy.state.pins[2]?.height).toBe(0);

            expect(loose.feedback).toBe('loose');
            expect(loose.state.alarm).toBe(3);
            expect(loose.state.integrity).toBe(state.integrity);
            expect(loose.state.pins[0]?.height).toBe(0);

            expect(binding.feedback).toBe('binding');
            expect(binding.state.alarm).toBe(0);
            expect(binding.state.pins[0]?.height).toBe(0);

            expect(set.feedback).toBe('set');
            expect(set.state.alarm).toBe(0);
            expect(set.state.pins[0]).toMatchObject({height: 0.5, set: true});
        }
    );

    it('uses the configured seam tolerance inclusively', () => {
        const state = createScenario();
        const tolerance = state.config.setTolerance;

        expect(attempt(state, 0, 0.5 + tolerance, 0.5).feedback).toBe('set');
        expect(attempt(state, 0, 0.5 + tolerance + 0.001, 0.5).feedback)
            .toBe('binding');
    });

    it('selects the next binding pin after every successful set', () => {
        const state = createScenario();
        const first = attempt(state, 0, 0.5, 0.5);
        const second = attempt(first.state, 1, 0.5, 0.5);

        expect(first).toMatchObject({
            feedback: 'set',
            state: {
                selectedPinIndex: 1,
                pickHeight: 0,
                feedback: 'set'
            }
        });
        expect(second).toMatchObject({
            feedback: 'set',
            state: {
                selectedPinIndex: 2,
                pickHeight: 0,
                feedback: 'set'
            }
        });
    });

    it('drops no Story pin, every second Standard jam, and every Expert jam', () => {
        const withFirstSet = (difficulty: DifficultyPreset): PinTensionLock => ({
            ...createScenario(difficulty),
            pins: createScenario(difficulty).pins.map((pin, index) =>
                index === 0 ? {...pin, set: true, height: pin.targetHeight} : pin
            ),
            setHistory: [0],
            selectedPinIndex: 1
        });

        const story = attempt(withFirstSet('story'), 1, 0.5, 0.8).state;
        expect(story.pins[0]?.set).toBe(true);
        expect(story.droppedPins).toBe(0);

        const standardFirst = attempt(withFirstSet('standard'), 1, 0.5, 0.8).state;
        const standardSecond = attempt(standardFirst, 1, 0.5, 0.8).state;
        expect(standardFirst.pins[0]?.set).toBe(true);
        expect(standardSecond.pins[0]?.set).toBe(false);
        expect(standardSecond.droppedPins).toBe(1);

        const expert = attempt(withFirstSet('expert'), 1, 0.5, 0.8).state;
        expect(expert.pins[0]?.set).toBe(false);
        expect(expert.droppedPins).toBe(1);
    });

    it('fails immediately at zero integrity or a full alarm', () => {
        const integrityState = {...createScenario('expert'), integrity: 1};
        const broken = attempt(integrityState, 0, 0.5, 0.8).state;
        const alarmed = advanceLockTime(
            createScenario('standard'),
            createScenario('standard').config.alarmWindowMs
        );

        expect(broken).toMatchObject({
            integrity: 0,
            status: 'failed',
            failureReason: 'integrity'
        });
        expect(alarmed).toMatchObject({
            alarm: 100,
            status: 'failed',
            failureReason: 'alarm'
        });
    });
});

describe('pin-tumbler clock, turn, and results', () => {
    it('advances continuous alarm time deterministically and freezes while paused', () => {
        const state = createScenario('standard');
        const firstHalf = advanceLockTime(state, 45_000);
        const inSubsteps = Array.from({length: 45}, () => 1_000)
            .reduce(advanceLockTime, state);
        const paused = setLockPaused(firstHalf, true);

        expect(firstHalf.alarm).toBe(50);
        expect(firstHalf.activeElapsedMs).toBe(45_000);
        expect(inSubsteps).toEqual(firstHalf);
        expect(advanceLockTime(paused, 30_000)).toEqual(paused);
        expect(advanceLockTime(setLockPaused(paused, false), 45_000).status).toBe('failed');
    });

    it('requires a separate cylinder turn after every pin is set', () => {
        const state = createScenario();
        const early = turnLockCylinder(state);
        const ready = setEveryPin(state);
        const opened = turnLockCylinder(ready);

        expect(early).toMatchObject({
            status: 'active',
            feedback: 'set-all-pins-first'
        });
        expect(ready).toMatchObject({
            status: 'active',
            feedback: 'turn-ready'
        });
        expect(opened).toMatchObject({
            status: 'opened',
            feedback: 'opened',
            cylinderRotation: 1
        });
    });

    it('applies the exact grade boundaries', () => {
        const opened = {...turnLockCylinder(setEveryPin(createScenario())), integrity: 4};

        expect(gradeLock({...opened, alarm: 24.999, activeElapsedMs: 44_999})).toBe('s');
        expect(gradeLock({
            ...opened,
            integrity: 3,
            alarm: 49.999,
            activeElapsedMs: 45_000
        })).toBe('a');
        expect(gradeLock({...opened, integrity: 1, alarm: 79.999})).toBe('b');
        expect(gradeLock({...opened, integrity: 1, alarm: 80})).toBe('c');
        expect(gradeLock({...opened, status: 'active'})).toBe('none');
    });

    it('uses active time and the exact jam, slip, and drop score penalties', () => {
        const opened = turnLockCylinder(setEveryPin(createScenario()));
        const scored = {
            ...opened,
            activeElapsedMs: 12_525,
            jams: 2,
            slipsOrSpringyAttempts: 3,
            droppedPins: 1
        };

        expect(scoreLock(scored)).toBe(
            4_000 - Math.floor(12_525 / 25) - 2 * 350 - 3 * 100 - 250
        );
        expect(scoreLock({
            ...scored,
            activeElapsedMs: 500_000,
            jams: 20
        })).toBe(500);
        expect(scoreLock({...scored, status: 'failed'})).toBe(0);
    });
});
