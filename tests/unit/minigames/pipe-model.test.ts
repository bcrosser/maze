import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    advancePipeFlow,
    createPipePuzzle,
    finishPipePlacement,
    getPipeConnections,
    getPipeFlowVisualState,
    getPipeGrade,
    getPipeScore,
    getPipeTerminalState,
    PIPE_FINISHED_FLOW_MULTIPLIER,
    placeQueuedPiece,
    retryPipePuzzle,
    setPipePaused,
    type PipePuzzleState,
    type PipeRotation
} from '../../../src/minigames/pipe/pipe-model';

function replayWitness(state: PipePuzzleState): PipePuzzleState {
    let replay = state;
    for (const placement of state.witness.placements) {
        expect(replay.queueIndex).toBe(placement.queueIndex);
        replay = placeQueuedPiece(replay, placement.cellIndex);
        replay = advancePipeFlow(replay, state.witness.cadenceMs);
    }
    return advancePipeFlow(
        replay,
        state.config.graceMs + state.routeIndices.length * state.config.stepMs
    );
}

function withTiming(
    state: PipePuzzleState,
    graceMs: number,
    stepMs: number
): PipePuzzleState {
    return {
        ...state,
        config: {...state.config, graceMs, stepMs},
        flowClockMs: -graceMs
    };
}

function edgeNames(state: PipePuzzleState, cellIndex: number): readonly string[] {
    const x = cellIndex % state.width;
    const y = Math.floor(cellIndex / state.width);
    const names: string[] = [];
    if (y === 0) names.push('top');
    if (x === state.width - 1) names.push('right');
    if (y === state.height - 1) names.push('bottom');
    if (x === 0) names.push('left');
    return names;
}

describe('generated Pipe puzzle', () => {
    it.each([
        ['story', 10_000],
        ['standard', 8_000],
        ['expert', 6_000]
    ] as const)(
        'starts %s liquid and its timer together with a slow %ims flow step',
        (difficulty, stepMs) => {
            const state = createPipePuzzle(new Mulberry32Random(5), {difficulty});

            expect(state.config.graceMs).toBe(0);
            expect(state.config.stepMs).toBe(stepMs);
            expect(state.config.witnessCadenceMs).toBe(1_000);
            expect(state.flowClockMs).toBe(0);
            expect(getPipeFlowVisualState(state)).toMatchObject({
                connectionProgress: 0,
                connectionRemainingMs: stepMs
            });
        }
    );

    it('reproduces every generated field for the same seed and difficulty', () => {
        const first = createPipePuzzle(new Mulberry32Random(12_345), {
            difficulty: 'standard'
        });
        const second = createPipePuzzle(new Mulberry32Random(12_345), {
            difficulty: 'standard'
        });

        expect(first).toEqual(second);
        expect(first.width).toBe(6);
        expect(first.height).toBe(6);
        expect(first.routeIndices.length).toBeGreaterThanOrEqual(10);
        expect(first.routeIndices.length).toBeLessThanOrEqual(14);
        expect(first.obstacleIndices.length).toBeGreaterThanOrEqual(3);
        expect(first.obstacleIndices.length).toBeLessThanOrEqual(5);
        expect(first.terminalStatus).toBe('active');
        expect(first.wetTileIndices).toEqual([first.sourceIndex]);
    });

    it('uses a 5x5 Story board and different source/sink edges', () => {
        const state = createPipePuzzle(new Mulberry32Random(678), {difficulty: 'story'});
        const sourceEdges = edgeNames(state, state.sourceIndex);
        const sinkEdges = edgeNames(state, state.sinkIndex);

        expect(state.width).toBe(5);
        expect(state.height).toBe(5);
        expect(sourceEdges).toHaveLength(1);
        expect(sinkEdges).toHaveLength(1);
        expect(sourceEdges[0]).not.toBe(sinkEdges[0]);
        expect(state.routeIndices.length).toBeGreaterThanOrEqual(7);
        expect(state.routeIndices.length).toBeLessThanOrEqual(9);
    });

    it('creates at least 90 unique Standard signatures for seeds 0 through 99', () => {
        const signatures = new Set<string>();
        for (let seed = 0; seed < 100; seed++) {
            const state = createPipePuzzle(new Mulberry32Random(seed), {
                difficulty: 'standard'
            });
            signatures.add(JSON.stringify({
                source: state.sourceIndex,
                sink: state.sinkIndex,
                route: state.routeIndices,
                obstacles: state.obstacleIndices,
                queue: state.queue.map(piece => [
                    piece.kind,
                    piece.rotation,
                    piece.role
                ])
            }));
        }

        expect(signatures.size).toBeGreaterThanOrEqual(90);
    });

    it.each(['story', 'standard', 'expert'] as const)(
        'replays the stored %s witness through production placement and timing',
        difficulty => {
            for (let seed = 0; seed < 20; seed++) {
                const state = createPipePuzzle(new Mulberry32Random(seed), {difficulty});
                const completed = replayWitness(state);

                expect(getPipeTerminalState(completed)).toEqual({
                    status: 'success',
                    reason: null
                });
                expect(completed.activeElapsedMs)
                    .toBeLessThanOrEqual(state.witness.completionTimeMs);
            }
        }
    );

    it('adds a later recovery copy for every critical orientation outside Expert', () => {
        const state = createPipePuzzle(new Mulberry32Random(994), {
            difficulty: 'standard'
        });
        const requiredKeys = new Set(
            state.queue
                .filter(piece => piece.role === 'required')
                .map(piece => `${piece.kind}:${piece.rotation}`)
        );
        const recoveryKeys = new Set(
            state.queue
                .filter(piece => piece.role === 'recovery')
                .map(piece => `${piece.kind}:${piece.rotation}`)
        );

        expect(recoveryKeys).toEqual(requiredKeys);
        let lastRequired = -1;
        state.queue.forEach((piece, index) => {
            if (piece.role === 'required') lastRequired = index;
        });
        expect(state.queue.slice(lastRequired + 1).every(piece => piece.role === 'recovery'))
            .toBe(true);
    });
});

describe('placement under pressure', () => {
    it('places the queue head without changing its orientation', () => {
        const state = createPipePuzzle(new Mulberry32Random(42), {difficulty: 'standard'});
        const target = state.routeIndices[1]!;
        const head = state.queue[0]!;
        const placed = placeQueuedPiece(state, target);

        expect(placed.tiles[target]).toEqual({
            kind: head.kind,
            rotation: head.rotation,
            locked: false
        });
        expect(placed.queueIndex).toBe(1);
        expect(placed.turns).toBe(1);
        expect(state.tiles[target]?.kind).toBe('empty');
    });

    it('overwrites a dry piece, consumes the head, and adds exactly one flow step', () => {
        const state = createPipePuzzle(new Mulberry32Random(71), {
            difficulty: 'story',
            graceMs: 20_000
        });
        const routeSet = new Set(state.routeIndices);
        const obstacleSet = new Set(state.obstacleIndices);
        const dumpCell = state.tiles.findIndex(
            (_, index) => !routeSet.has(index) && !obstacleSet.has(index)
        );
        const placed = placeQueuedPiece(state, dumpCell);
        const overwritten = placeQueuedPiece(placed, dumpCell);

        expect(overwritten.queueIndex).toBe(2);
        expect(overwritten.overwrites).toBe(1);
        expect(overwritten.flowClockMs - placed.flowClockMs).toBe(state.config.stepMs);
        expect(overwritten.activeElapsedMs).toBe(placed.activeElapsedMs);
        expect(overwritten.lastEvent).toMatchObject({
            kind: 'overwritten',
            cellIndex: dumpCell,
            message: 'OVERWRITE · FLOW +1'
        });
        expect(overwritten.tiles[dumpCell]).toMatchObject({
            kind: state.queue[1]!.kind,
            rotation: state.queue[1]!.rotation
        });
    });

    it('never replaces source, sink, obstacles, or wet pipe', () => {
        let state = withTiming(
            createPipePuzzle(new Mulberry32Random(99), {difficulty: 'story'}),
            0,
            100
        );
        const firstRouteCell = state.routeIndices[1]!;
        state = placeQueuedPiece(state, firstRouteCell);
        state = advancePipeFlow(state, 100);
        expect(state.wetTileIndices).toContain(firstRouteCell);

        for (const cellIndex of [
            state.sourceIndex,
            state.sinkIndex,
            state.obstacleIndices[0]!,
            firstRouteCell
        ]) {
            const queueIndex = state.queueIndex;
            const blocked = placeQueuedPiece(state, cellIndex);
            expect(blocked.queueIndex).toBe(queueIndex);
            expect(blocked.lastEvent.kind).toBe('blocked');
        }
        expect(placeQueuedPiece(state, firstRouteCell).lastEvent.message)
            .toBe('WET PIPE LOCKED');
    });

    it('leaves an empty queue nonterminal until the front hits the bad connection', () => {
        const generated = withTiming(
            createPipePuzzle(new Mulberry32Random(102), {difficulty: 'story'}),
            0,
            100
        );
        const state: PipePuzzleState = {
            ...generated,
            queue: [],
            queueIndex: 0
        };
        const blocked = placeQueuedPiece(state, state.routeIndices[1]!);

        expect(blocked.terminalStatus).toBe('active');
        expect(blocked.lastEvent.message).toBe('QUEUE EMPTY');
        const failed = advancePipeFlow(blocked, 100);
        expect(getPipeTerminalState(failed)).toEqual({
            status: 'failure',
            reason: 'empty'
        });
    });

    it('allows an empty queue with a completed route to reach the sink', () => {
        const generated = createPipePuzzle(new Mulberry32Random(223), {
            difficulty: 'standard',
            graceMs: 30_000
        });
        const finalWitnessQueueIndex = generated.witness.placements.at(-1)!.queueIndex;
        let state: PipePuzzleState = {
            ...generated,
            queue: generated.queue.slice(0, finalWitnessQueueIndex + 1)
        };
        for (const placement of state.witness.placements) {
            state = placeQueuedPiece(state, placement.cellIndex);
        }
        expect(state.queueIndex).toBe(state.queue.length);
        state = advancePipeFlow(
            state,
            state.config.graceMs + state.routeIndices.length * state.config.stepMs
        );

        expect(state.terminalStatus).toBe('success');
    });

    it('locks placement and advances visible coolant at four times normal speed', () => {
        let state = withTiming(
            createPipePuzzle(new Mulberry32Random(414), {difficulty: 'standard'}),
            0,
            1_000
        );
        const firstPlacement = state.witness.placements[0]!;
        state = placeQueuedPiece(state, firstPlacement.cellIndex);
        const committed = finishPipePlacement(state);

        expect(committed.placementFinished).toBe(true);
        expect(committed.lastEvent).toMatchObject({
            kind: 'placement-finished',
            message: `PLACEMENT LOCKED · FLOW ×${PIPE_FINISHED_FLOW_MULTIPLIER}`
        });
        const anotherDryCell = committed.tiles.findIndex(tile => tile.kind === 'empty');
        const blocked = placeQueuedPiece(committed, anotherDryCell);
        expect(blocked.queueIndex).toBe(committed.queueIndex);
        expect(blocked.lastEvent.message).toBe('PLACEMENT LOCKED');

        const accelerated = advancePipeFlow(committed, 250);
        expect(accelerated.flowClockMs - committed.flowClockMs).toBe(1_000);
        expect(accelerated.activeElapsedMs - committed.activeElapsedMs).toBe(250);
        expect(accelerated.flowStepsResolved).toBe(1);
    });

    it('finishes a complete placed route quickly but still fails an incomplete route', () => {
        const generated = withTiming(
            createPipePuzzle(new Mulberry32Random(223), {difficulty: 'standard'}),
            0,
            100
        );
        let complete = generated;
        for (const placement of complete.witness.placements) {
            complete = placeQueuedPiece(complete, placement.cellIndex);
        }
        expect(complete.queueIndex).toBeLessThan(complete.queue.length);
        complete = finishPipePlacement(complete);
        complete = advancePipeFlow(
            complete,
            (complete.tiles.length + 1) * complete.config.stepMs /
                PIPE_FINISHED_FLOW_MULTIPLIER
        );
        expect(complete.terminalStatus).toBe('success');

        let incomplete = placeQueuedPiece(
            generated,
            generated.witness.placements[0]!.cellIndex
        );
        incomplete = finishPipePlacement(incomplete);
        incomplete = advancePipeFlow(
            incomplete,
            (incomplete.tiles.length + 1) * incomplete.config.stepMs /
                PIPE_FINISHED_FLOW_MULTIPLIER
        );
        expect(incomplete.terminalStatus).toBe('failure');
        expect(incomplete.failureReason).not.toBeNull();
    });

    it('requires a placed pipe before finishing placement', () => {
        const state = createPipePuzzle(
            new Mulberry32Random(717),
            {difficulty: 'story'}
        );
        const blocked = finishPipePlacement(state);

        expect(blocked.placementFinished).toBe(false);
        expect(blocked.lastEvent).toMatchObject({
            kind: 'blocked',
            message: 'PLACE A PIPE FIRST'
        });
    });
});

describe('incremental liquid and terminal rules', () => {
    it('reports build countdown and fractional connection timing independently', () => {
        let state = withTiming(
            createPipePuzzle(new Mulberry32Random(55), {difficulty: 'story'}),
            1_000,
            200
        );
        state = advancePipeFlow(state, 750);
        expect(getPipeFlowVisualState(state)).toMatchObject({
            graceProgress: 0.75,
            graceRemainingMs: 250,
            connectionProgress: 0
        });
        state = advancePipeFlow(state, 350);
        expect(getPipeFlowVisualState(state)).toMatchObject({
            connectionProgress: 0.5,
            connectionRemainingMs: 100
        });
        expect(state.flowStepsResolved).toBe(0);
    });

    it('freezes model time and placement while paused', () => {
        const state = createPipePuzzle(new Mulberry32Random(6), {difficulty: 'story'});
        const paused = setPipePaused(state, true);
        const advanced = advancePipeFlow(paused, 50_000);
        const placed = placeQueuedPiece(advanced, state.routeIndices[1]!);

        expect(advanced.flowClockMs).toBe(state.flowClockMs);
        expect(advanced.activeElapsedMs).toBe(0);
        expect(placed.queueIndex).toBe(0);
        expect(setPipePaused(placed, false).paused).toBe(false);
    });

    it('consumes a frame stall in fixed boundaries instead of discarding excess time', () => {
        let state = withTiming(
            createPipePuzzle(new Mulberry32Random(991), {difficulty: 'standard'}),
            1_000,
            200
        );
        for (const placement of state.witness.placements) {
            state = placeQueuedPiece(state, placement.cellIndex);
        }
        state = advancePipeFlow(state, 1_550);

        expect(state.flowClockMs).toBe(550);
        expect(state.flowStepsResolved).toBe(2);
        expect(getPipeFlowVisualState(state).connectionProgress).toBeCloseTo(0.75);
    });

    it('fails deterministically on a mismatched joint', () => {
        const generated = withTiming(
            createPipePuzzle(new Mulberry32Random(88), {difficulty: 'story'}),
            0,
            100
        );
        const firstCell = generated.routeIndices[1]!;
        const sourceDirection = getPipeConnections(generated.tiles[generated.sourceIndex]!)[0]!;
        const reciprocalRotation: Record<typeof sourceDirection, PipeRotation> = {
            up: 1,
            right: 0,
            down: 1,
            left: 0
        };
        const wrongRotation = reciprocalRotation[sourceDirection];
        const state: PipePuzzleState = {
            ...generated,
            queue: [{
                id: 'wrong',
                kind: 'straight',
                rotation: wrongRotation,
                role: 'decoy'
            }],
            queueIndex: 0
        };
        const failed = advancePipeFlow(placeQueuedPiece(state, firstCell), 100);

        expect(failed.terminalStatus).toBe('failure');
        expect(failed.failureReason).toBe('mismatch');
    });

    it('fails when the liquid front reaches a board edge', () => {
        const generated = withTiming(
            createPipePuzzle(new Mulberry32Random(881), {difficulty: 'story'}),
            0,
            100
        );
        const sourceX = generated.sourceIndex % generated.width;
        const sourceY = Math.floor(generated.sourceIndex / generated.width);
        let outwardRotation: PipeRotation;
        if (sourceX === 0) outwardRotation = 2;
        else if (sourceX === generated.width - 1) outwardRotation = 0;
        else if (sourceY === 0) outwardRotation = 3;
        else outwardRotation = 1;
        const tiles = [...generated.tiles];
        tiles[generated.sourceIndex] = {
            kind: 'source',
            rotation: outwardRotation,
            locked: true
        };
        const failed = advancePipeFlow({...generated, tiles}, 100);

        expect(failed.terminalStatus).toBe('failure');
        expect(failed.failureReason).toBe('edge');
    });

    it('detects a repeated wet connection as a pressure loop', () => {
        let state = withTiming(
            createPipePuzzle(new Mulberry32Random(89), {difficulty: 'story'}),
            0,
            100
        );
        const firstCell = state.routeIndices[1]!;
        state = placeQueuedPiece(state, firstCell);
        const connectionKey = state.sourceIndex < firstCell
            ? `${state.sourceIndex}:${firstCell}`
            : `${firstCell}:${state.sourceIndex}`;
        state = {
            ...state,
            visitedConnections: [connectionKey]
        };
        state = advancePipeFlow(state, 100);

        expect(state.failureReason).toBe('pressure-loop');
    });

    it('retries from the exact generated board and queue', () => {
        const state = createPipePuzzle(new Mulberry32Random(612), {difficulty: 'expert'});
        const changed = advancePipeFlow(
            placeQueuedPiece(state, state.routeIndices[1]!),
            400
        );
        const retried = retryPipePuzzle(changed);

        expect(retried.tiles).toEqual(state.tiles);
        expect(retried.queue).toEqual(state.queue);
        expect(retried.routeIndices).toEqual(state.routeIndices);
        expect(retried.queueIndex).toBe(0);
        expect(retried.flowClockMs).toBe(
            state.config.graceMs === 0 ? 0 : -state.config.graceMs
        );
        expect(retried.lastEvent.kind).toBe('retried');
    });
});

describe('Pipe scoring', () => {
    it('uses witness-normalized active time and exact overwrite boundaries', () => {
        const base = createPipePuzzle(new Mulberry32Random(31), {difficulty: 'story'});
        const success: PipePuzzleState = {
            ...base,
            terminalStatus: 'success',
            witness: {...base.witness, completionTimeMs: 1_000},
            activeElapsedMs: 1_100,
            overwrites: 0
        };

        expect(getPipeGrade(success)).toBe('s');
        expect(getPipeGrade({...success, activeElapsedMs: 1_101})).toBe('a');
        expect(getPipeGrade({...success, overwrites: 2})).toBe('b');
        expect(getPipeGrade({...success, overwrites: 4})).toBe('c');
        expect(getPipeGrade({...success, terminalStatus: 'failure'})).toBe('none');
        expect(getPipeScore(success)).toBe(4_990);
        expect(getPipeScore({
            ...success,
            activeElapsedMs: 2_000,
            overwrites: 2
        })).toBe(3_700);
        expect(getPipeScore({...success, terminalStatus: 'failure'})).toBe(0);
    });
});
