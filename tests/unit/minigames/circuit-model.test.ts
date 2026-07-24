import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    CIRCUIT_COLORS,
    activateCircuitBooster,
    applyCircuitSwap,
    canonicalCircuitSignature,
    createCircuitPuzzle,
    ensureCircuitPlayable,
    getCircuitHint,
    getCircuitLegalSwaps,
    getCircuitMatchedIndices,
    getCircuitProgress,
    retryCircuitPuzzle,
    validateCircuitPuzzle,
    validateCircuitWitness,
    type CircuitChip,
    type CircuitColor,
    type CircuitPuzzleState,
    type CircuitSpecial,
    type CircuitSwap
} from '../../../src/minigames/circuit/circuit-model';

function create(seed: number): CircuitPuzzleState {
    return createCircuitPuzzle(new Mulberry32Random(seed));
}

function backgroundChips(size = 8): CircuitChip[] {
    const chips: CircuitChip[] = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            chips.push({
                id: y * size + x + 10_000,
                color: CIRCUIT_COLORS[(x + y * 2) % CIRCUIT_COLORS.length]!,
                special: 'none'
            });
        }
    }
    return chips;
}

function replaceChip(
    chips: CircuitChip[],
    index: number,
    color: CircuitColor,
    special: CircuitSpecial = 'none'
): void {
    chips[index] = {...chips[index]!, color, special};
}

function playableFixture(
    state: CircuitPuzzleState,
    chips: readonly CircuitChip[],
    blockerIndices: readonly number[] = [chips.length - 1],
    movesRemaining = state.movesRemaining
): CircuitPuzzleState {
    const blockers = chips.map(() => 0);
    for (const index of blockerIndices) blockers[index] = 1;
    return {
        ...state,
        chips,
        blockers,
        blockersRemaining: blockerIndices.length,
        movesRemaining,
        terminalStatus: 'active',
        failureReason: null,
        lastHint: null
    };
}

function findSwapWithUnaffectedCell(
    state: CircuitPuzzleState
): {readonly swap: CircuitSwap; readonly unaffectedIndex: number; readonly affectedIndex: number} {
    for (const swap of getCircuitLegalSwaps(state)) {
        const probe = applyCircuitSwap(
            playableFixture(state, state.chips, [state.chips.length - 1]),
            swap.fromIndex,
            swap.toIndex
        );
        const affected = new Set(probe.lastEvent.affectedIndices);
        const unaffectedIndex = state.chips.findIndex((_, index) => !affected.has(index));
        if (unaffectedIndex >= 0 && probe.lastEvent.affectedIndices[0] !== undefined) {
            return {
                swap,
                unaffectedIndex,
                affectedIndex: probe.lastEvent.affectedIndices[0]
            };
        }
    }
    throw new Error('Fixture did not contain a suitably local legal swap.');
}

describe('certified Circuit Crush generation', () => {
    it('reproduces every generated field for the same seed', () => {
        const first = create(12_345);
        const second = create(12_345);

        expect(first).toEqual(second);
        expect(first.width).toBe(8);
        expect(first.height).toBe(8);
        expect(first.movesRemaining).toBe(18);
        expect(first.blockersRemaining).toBe(6);
        expect(first.certificate).toMatchObject({
            requiredMoves: 6,
            moveBudget: 18,
            verified: true
        });
    });

    it('generates diverse circuit layouts and witnesses', () => {
        const signatures = new Set<string>();
        for (let seed = 0; seed < 50; seed++) {
            const state = create(seed);
            signatures.add(JSON.stringify({
                board: canonicalCircuitSignature(state),
                blockers: state.blockers,
                witness: state.certificate.swaps
            }));
        }

        expect(signatures.size).toBeGreaterThanOrEqual(48);
    });

    it('certifies stable, playable, replayable boards across 128 seeds', () => {
        for (let seed = 0; seed < 128; seed++) {
            const state = create(seed);
            const boardValidation = validateCircuitPuzzle(state);
            const witnessValidation = validateCircuitWitness(state);

            expect(boardValidation, `board seed ${seed}`).toMatchObject({
                valid: true,
                automaticMatchCount: 0
            });
            expect(boardValidation.legalMoveCount, `legal seed ${seed}`).toBeGreaterThan(0);
            expect(witnessValidation, `witness seed ${seed}`).toMatchObject({
                valid: true,
                completed: true,
                movesUsed: state.certificate.requiredMoves
            });
            expect(state.certificate.requiredMoves).toBeLessThanOrEqual(
                state.movesRemaining
            );
        }
    }, 30_000);

    it('supports both board sizes while preserving the certificate', () => {
        for (const size of [7, 8] as const) {
            const state = createCircuitPuzzle(new Mulberry32Random(550 + size), {
                size,
                moveBudget: 15,
                witnessMoves: 5
            });

            expect(state.chips).toHaveLength(size * size);
            expect(state.blockers).toHaveLength(size * size);
            expect(validateCircuitPuzzle(state).valid).toBe(true);
            expect(validateCircuitWitness(state).valid).toBe(true);
        }
    });

    it('replays its witness through production swaps and wins on the final step', () => {
        const initial = create(991);
        let state = initial;

        initial.certificate.swaps.forEach((swap, moveIndex) => {
            expect(state.terminalStatus).toBe('active');
            state = applyCircuitSwap(state, swap.fromIndex, swap.toIndex);
            if (moveIndex < initial.certificate.swaps.length - 1) {
                expect(state.blockersRemaining).toBeGreaterThan(0);
            }
        });

        expect(state.terminalStatus).toBe('success');
        expect(state.failureReason).toBeNull();
        expect(state.blockersRemaining).toBe(0);
        expect(state.movesSpent).toBe(initial.certificate.requiredMoves);
        expect(canonicalCircuitSignature(state)).toBe(
            initial.certificate.finalSignature
        );
        expect(getCircuitProgress(state)).toBe(1);
    });

    it('creates a new deterministic layout for a retry instead of reusing the loss', () => {
        const initial = create(42);
        const fixture = findSwapWithUnaffectedCell(initial);
        const finalMove = playableFixture(
            initial,
            initial.chips,
            [fixture.unaffectedIndex],
            1
        );
        const failed = applyCircuitSwap(
            finalMove,
            fixture.swap.fromIndex,
            fixture.swap.toIndex
        );
        expect(failed.terminalStatus).toBe('failure');

        const retried = retryCircuitPuzzle(failed, new Mulberry32Random(8_888));
        const reproduced = retryCircuitPuzzle(failed, new Mulberry32Random(8_888));

        expect(retried).toEqual(reproduced);
        expect(retried.attemptNumber).toBe(failed.attemptNumber + 1);
        expect(canonicalCircuitSignature(retried)).not.toBe(
            canonicalCircuitSignature(failed)
        );
        expect(validateCircuitWitness(retried).valid).toBe(true);
    });
});

describe('swaps, cascades, and move boundaries', () => {
    it('preserves a move when cells are not adjacent or form no match', () => {
        const state = create(15);
        const nonAdjacent = applyCircuitSwap(state, 0, state.width * 2);

        expect(nonAdjacent.movesRemaining).toBe(state.movesRemaining);
        expect(nonAdjacent.movesSpent).toBe(0);
        expect(nonAdjacent.chips).toEqual(state.chips);
        expect(nonAdjacent.lastEvent.kind).toBe('invalid-swap');

        const legalKeys = new Set(
            getCircuitLegalSwaps(state)
                .flatMap(swap => [
                    `${swap.fromIndex}:${swap.toIndex}`,
                    `${swap.toIndex}:${swap.fromIndex}`
                ])
        );
        let invalidAdjacent: CircuitSwap | null = null;
        for (let index = 0; index < state.chips.length - 1; index++) {
            if ((index + 1) % state.width === 0) continue;
            if (!legalKeys.has(`${index}:${index + 1}`)) {
                invalidAdjacent = {fromIndex: index, toIndex: index + 1};
                break;
            }
        }
        expect(invalidAdjacent).not.toBeNull();
        const rejected = applyCircuitSwap(
            state,
            invalidAdjacent!.fromIndex,
            invalidAdjacent!.toIndex
        );
        expect(rejected.movesRemaining).toBe(state.movesRemaining);
        expect(rejected.lastEvent.message).toContain('MOVE PRESERVED');
    });

    it('uses deterministic refill and resolves every cascade before returning', () => {
        const initial = create(2_024);
        const swap = initial.certificate.swaps[0]!;
        const first = applyCircuitSwap(initial, swap.fromIndex, swap.toIndex);
        const second = applyCircuitSwap(initial, swap.fromIndex, swap.toIndex);

        expect(first).toEqual(second);
        expect(first.movesRemaining).toBe(initial.movesRemaining - 1);
        expect(first.lastEvent.affectedIndices.length).toBeGreaterThanOrEqual(3);
        expect(first.lastEvent.cascades).toBeGreaterThanOrEqual(1);
        expect(getCircuitMatchedIndices(first)).toEqual([]);
        if (first.terminalStatus === 'active') {
            expect(getCircuitLegalSwaps(first).length).toBeGreaterThan(0);
        }
    });

    it('allows genuine multi-stage cascades', () => {
        let cascadeState: CircuitPuzzleState | null = null;
        for (let seed = 0; seed < 80 && cascadeState === null; seed++) {
            const initial = create(seed);
            for (const swap of getCircuitLegalSwaps(initial)) {
                const result = applyCircuitSwap(initial, swap.fromIndex, swap.toIndex);
                if (result.lastEvent.cascades >= 2) {
                    cascadeState = result;
                    break;
                }
            }
        }

        expect(cascadeState).not.toBeNull();
        expect(cascadeState!.lastEvent.cascades).toBeGreaterThanOrEqual(2);
        expect(getCircuitMatchedIndices(cascadeState!)).toEqual([]);
    }, 15_000);

    it('fails only after a valid final move leaves a blocker behind', () => {
        const initial = create(77);
        const fixture = findSwapWithUnaffectedCell(initial);
        const oneMove = playableFixture(
            initial,
            initial.chips,
            [fixture.unaffectedIndex],
            1
        );
        const failed = applyCircuitSwap(
            oneMove,
            fixture.swap.fromIndex,
            fixture.swap.toIndex
        );

        expect(failed.movesRemaining).toBe(0);
        expect(failed.blockersRemaining).toBe(1);
        expect(failed.terminalStatus).toBe('failure');
        expect(failed.failureReason).toBe('moves-exhausted');
        expect(validateCircuitPuzzle(failed).valid).toBe(true);
    });

    it('awards success instead of failure when the last move clears the last blocker', () => {
        const initial = create(78);
        const fixture = findSwapWithUnaffectedCell(initial);
        const oneMove = playableFixture(
            initial,
            initial.chips,
            [fixture.affectedIndex],
            1
        );
        const won = applyCircuitSwap(
            oneMove,
            fixture.swap.fromIndex,
            fixture.swap.toIndex
        );

        expect(won.movesRemaining).toBe(0);
        expect(won.blockersRemaining).toBe(0);
        expect(won.terminalStatus).toBe('success');
        expect(won.failureReason).toBeNull();
    });
});

describe('special circuit chips', () => {
    it('creates a row pulse from a four-chip line', () => {
        const state = create(301);
        const chips = backgroundChips();
        const y = 3;
        replaceChip(chips, y * 8, 'cyan');
        replaceChip(chips, y * 8 + 1, 'cyan');
        replaceChip(chips, y * 8 + 2, 'magenta');
        replaceChip(chips, y * 8 + 3, 'cyan');
        replaceChip(chips, y * 8 + 4, 'amber');
        replaceChip(chips, (y + 1) * 8 + 2, 'cyan');
        const fixture = playableFixture(state, chips, [63]);

        expect(getCircuitMatchedIndices(fixture)).toEqual([]);
        const result = applyCircuitSwap(fixture, y * 8 + 2, (y + 1) * 8 + 2);

        expect(result.lastEvent.specialsCreated).toBeGreaterThanOrEqual(1);
        expect(result.lastEvent.specialKindsCreated).toContain('row');
    });

    it('creates a color-clear capacitor from a five-chip line', () => {
        const state = create(302);
        const chips = backgroundChips();
        const y = 3;
        replaceChip(chips, y * 8, 'violet');
        replaceChip(chips, y * 8 + 1, 'violet');
        replaceChip(chips, y * 8 + 2, 'magenta');
        replaceChip(chips, y * 8 + 3, 'violet');
        replaceChip(chips, y * 8 + 4, 'violet');
        replaceChip(chips, (y + 1) * 8 + 2, 'violet');
        const fixture = playableFixture(state, chips, [63]);

        expect(getCircuitMatchedIndices(fixture)).toEqual([]);
        const result = applyCircuitSwap(fixture, y * 8 + 2, (y + 1) * 8 + 2);

        expect(result.lastEvent.specialKindsCreated).toContain('color');
    });

    it('creates a burst node from a T-shaped circuit', () => {
        const state = create(303);
        const chips = backgroundChips();
        const center = 3 * 8 + 3;
        replaceChip(chips, center, 'amber');
        replaceChip(chips, center - 1, 'lime');
        replaceChip(chips, center + 1, 'lime');
        replaceChip(chips, center - 8, 'lime');
        replaceChip(chips, center - 16, 'lime');
        replaceChip(chips, center + 8, 'lime');
        replaceChip(chips, 3, 'amber');
        const fixture = playableFixture(state, chips, [63]);

        expect(getCircuitMatchedIndices(fixture)).toEqual([]);
        const result = applyCircuitSwap(fixture, center, center + 8);

        expect(result.lastEvent.specialKindsCreated).toContain('burst');
    });

    it('activates a row special predictably when it is swapped', () => {
        const state = create(304);
        const chips = backgroundChips();
        const specialIndex = 3 * 8 + 3;
        replaceChip(chips, specialIndex, 'cyan', 'row');
        const fixture = playableFixture(state, chips, [63]);
        const result = applyCircuitSwap(fixture, specialIndex, specialIndex + 1);
        const expectedRow = Array.from({length: 8}, (_, x) => 3 * 8 + x);

        expect(result.lastEvent.specialsActivated).toBeGreaterThanOrEqual(1);
        for (const index of expectedRow) {
            expect(result.lastEvent.affectedIndices).toContain(index);
        }
    });

    it('uses the partner color when a color-clear special is swapped', () => {
        const state = create(305);
        const chips = backgroundChips();
        replaceChip(chips, 0, 'cyan', 'color');
        replaceChip(chips, 1, 'amber');
        const amberIndices = chips
            .map((chip, index) => chip.color === 'amber' ? index : -1)
            .filter(index => index >= 0);
        const fixture = playableFixture(state, chips, [63]);
        const result = applyCircuitSwap(fixture, 0, 1);

        expect(result.lastEvent.specialsActivated).toBeGreaterThanOrEqual(1);
        for (const index of amberIndices) {
            expect(result.lastEvent.affectedIndices).toContain(index);
        }
    });
});

describe('attempt-scoped circuit boosters and recovery', () => {
    it('provides a deterministic, blocker-first hint without changing the board', () => {
        const state = create(601);
        const directHint = getCircuitHint(state);
        const hinted = activateCircuitBooster(state, {kind: 'hint'});

        expect(directHint).not.toBeNull();
        expect(hinted.lastHint).toEqual(directHint);
        expect(hinted.chips).toEqual(state.chips);
        expect(hinted.randomState).toBe(state.randomState);
        expect(hinted.boosterCharges.hints).toBe(state.boosterCharges.hints - 1);
        expect(hinted.movesRemaining).toBe(state.movesRemaining);
    });

    it('overclocks the move budget once and refuses an empty charge', () => {
        const state = createCircuitPuzzle(new Mulberry32Random(602), {
            boosterCharges: {extraMoves: 1}
        });
        const boosted = activateCircuitBooster(state, {kind: 'extra-moves'});
        const rejected = activateCircuitBooster(boosted, {kind: 'extra-moves'});

        expect(boosted.movesRemaining).toBe(
            state.movesRemaining + state.config.extraMoveAmount
        );
        expect(boosted.boosterCharges.extraMoves).toBe(0);
        expect(rejected.movesRemaining).toBe(boosted.movesRemaining);
        expect(rejected.lastEvent.kind).toBe('booster-unavailable');
    });

    it('uses a targeted 3x3 pulse without spending a move', () => {
        const state = create(603);
        const target = state.blockers.findIndex(strength => strength > 0);
        const pulsed = activateCircuitBooster(state, {kind: 'pulse', cellIndex: target});

        expect(pulsed.movesRemaining).toBe(state.movesRemaining);
        expect(pulsed.boosterCharges.pulses).toBe(state.boosterCharges.pulses - 1);
        expect(pulsed.blockersRemaining).toBeLessThan(state.blockersRemaining);
        expect(pulsed.lastEvent.affectedIndices).toContain(target);
    });

    it('reroutes to a different stable playable board and preserves objectives', () => {
        const state = create(604);
        const shuffled = activateCircuitBooster(state, {kind: 'shuffle'});

        expect(shuffled.chips).not.toEqual(state.chips);
        expect(shuffled.blockers).toEqual(state.blockers);
        expect(shuffled.movesRemaining).toBe(state.movesRemaining);
        expect(shuffled.boosterCharges.shuffles).toBe(
            state.boosterCharges.shuffles - 1
        );
        expect(getCircuitMatchedIndices(shuffled)).toEqual([]);
        expect(getCircuitLegalSwaps(shuffled).length).toBeGreaterThan(0);
    });

    it('recovers a deterministic no-move board for free and keeps it winnable', () => {
        const state = create(605);
        const deadChips = backgroundChips();
        const deadState = playableFixture(state, deadChips, [5, 27, 49]);

        expect(getCircuitMatchedIndices(deadState)).toEqual([]);
        expect(getCircuitLegalSwaps(deadState)).toEqual([]);
        const first = ensureCircuitPlayable(deadState);
        const second = ensureCircuitPlayable(deadState);

        expect(first).toEqual(second);
        expect(first.blockers).toEqual(deadState.blockers);
        expect(first.movesRemaining).toBe(deadState.movesRemaining);
        expect(first.noMoveRecoveries).toBe(deadState.noMoveRecoveries + 1);
        expect(first.lastEvent.kind).toBe('no-move-shuffle');
        expect(getCircuitMatchedIndices(first)).toEqual([]);
        expect(getCircuitLegalSwaps(first).length).toBeGreaterThan(0);
        expect(validateCircuitPuzzle(first).valid).toBe(true);
    });
});
