import {randomInteger, type RandomSource} from '../../domain/random/random-source';
import type {DifficultyPreset} from '../../encounters/contracts';

export const DIAL_SIZE = 100;

export type SafeDialFeedback =
    | 'idle'
    | 'cold'
    | 'faint'
    | 'warm'
    | 'hot'
    | 'gate-set'
    | 'false-gate'
    | 'handle-ready'
    | 'lock-gates-first'
    | 'opened'
    | 'failed';

export type SafeDialStatus = 'active' | 'opened' | 'failed';
export type SafeDialFailureReason = 'alarm' | 'focus' | null;

export interface SafeDialConfig {
    readonly difficulty: DifficultyPreset;
    readonly levelTier?: number;
}

export interface ResolvedSafeDialConfig {
    readonly difficulty: DifficultyPreset;
    readonly levelTier: number;
    readonly gateCount: number;
    readonly gateTolerance: number;
    readonly maximumFocus: number;
    readonly alarmWindowMs: number;
}

export interface SafeDialLock {
    readonly config: ResolvedSafeDialConfig;
    /** Hidden combination, one dial number per gate, in required order. */
    readonly gates: readonly number[];
    readonly gatesLocked: number;
    readonly dial: number;
    readonly focus: number;
    readonly falseGates: number;
    readonly alarm: number;
    readonly activeElapsedMs: number;
    readonly feedback: SafeDialFeedback;
    readonly status: SafeDialStatus;
    readonly failureReason: SafeDialFailureReason;
    readonly paused: boolean;
}

const BASE_CONFIGS: Readonly<Record<DifficultyPreset, {
    readonly gateCount: number;
    readonly gateTolerance: number;
    readonly maximumFocus: number;
    readonly alarmWindowMs: number;
}>> = Object.freeze({
    story: Object.freeze({
        gateCount: 3,
        gateTolerance: 3,
        maximumFocus: 7,
        alarmWindowMs: 120_000
    }),
    standard: Object.freeze({
        gateCount: 3,
        gateTolerance: 2,
        maximumFocus: 5,
        alarmWindowMs: 90_000
    }),
    expert: Object.freeze({
        gateCount: 4,
        gateTolerance: 1,
        maximumFocus: 4,
        alarmWindowMs: 70_000
    })
});

const MINIMUM_GATE_SEPARATION = 12;
const FALSE_GATE_ALARM = 10;

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, places = 6): number {
    const scale = 10 ** places;
    return Math.round(value * scale) / scale;
}

function wrapDial(position: number): number {
    return ((Math.round(position) % DIAL_SIZE) + DIAL_SIZE) % DIAL_SIZE;
}

/** Shortest distance between two dial numbers around the 0-99 ring. */
export function dialDistance(a: number, b: number): number {
    const direct = Math.abs(wrapDial(a) - wrapDial(b));
    return Math.min(direct, DIAL_SIZE - direct);
}

export function resolveSafeDialConfig(config: SafeDialConfig): ResolvedSafeDialConfig {
    const base = BASE_CONFIGS[config.difficulty];
    const levelTier = config.levelTier === undefined ? 0 : clamp(config.levelTier, 0, 5);
    if (config.levelTier !== undefined && !Number.isSafeInteger(config.levelTier)) {
        throw new Error('Safe dial level tier must be a safe integer.');
    }
    return {
        difficulty: config.difficulty,
        levelTier,
        gateCount: base.gateCount,
        gateTolerance: base.gateTolerance,
        maximumFocus: base.maximumFocus,
        // At tier five the alarm fills exactly 20% faster, matching pin locks.
        alarmWindowMs: round(base.alarmWindowMs / (1 + 0.2 * (levelTier / 5)))
    };
}

function createGates(random: RandomSource, gateCount: number): readonly number[] {
    const gates: number[] = [];
    let guard = 0;
    while (gates.length < gateCount) {
        if (guard++ > 500) throw new Error('Safe dial gate generation did not converge.');
        const candidate = randomInteger(random, DIAL_SIZE);
        if (gates.every(gate => dialDistance(gate, candidate) >= MINIMUM_GATE_SEPARATION)) {
            gates.push(candidate);
        }
    }
    return gates;
}

export function createSafeDialLock(
    random: RandomSource,
    config: SafeDialConfig
): SafeDialLock {
    const resolved = resolveSafeDialConfig(config);
    return {
        config: resolved,
        gates: createGates(random, resolved.gateCount),
        gatesLocked: 0,
        dial: 0,
        focus: resolved.maximumFocus,
        falseGates: 0,
        alarm: 0,
        activeElapsedMs: 0,
        feedback: 'idle',
        status: 'active',
        failureReason: null,
        paused: false
    };
}

export function getCurrentGate(state: SafeDialLock): number | null {
    return state.gates[state.gatesLocked] ?? null;
}

/**
 * Stethoscope needle strength in [0, 1]. It rises smoothly as the dial nears
 * the current gate but never reveals the exact number by itself.
 */
export function getDialSignalStrength(state: SafeDialLock): number {
    const gate = getCurrentGate(state);
    if (gate === null) return 1;
    return round(clamp(1 - dialDistance(state.dial, gate) / 25, 0, 1));
}

function signalFeedback(state: SafeDialLock): SafeDialFeedback {
    const gate = getCurrentGate(state);
    if (gate === null) return 'handle-ready';
    const distance = dialDistance(state.dial, gate);
    if (distance <= state.config.gateTolerance) return 'hot';
    if (distance <= 6) return 'warm';
    if (distance <= 14) return 'faint';
    return 'cold';
}

export function setDialPosition(state: SafeDialLock, position: number): SafeDialLock {
    if (!Number.isFinite(position)) throw new Error('Dial position must be finite.');
    if (state.status !== 'active') return state;
    const dial = wrapDial(position);
    if (dial === state.dial) return state;
    const nextState = {...state, dial};
    return {...nextState, feedback: signalFeedback(nextState)};
}

export function rotateDial(state: SafeDialLock, delta: number): SafeDialLock {
    if (!Number.isFinite(delta)) throw new Error('Dial delta must be finite.');
    return setDialPosition(state, state.dial + delta);
}

function withFailureIfNeeded(state: SafeDialLock): SafeDialLock {
    if (state.focus <= 0) {
        return {
            ...state,
            focus: 0,
            feedback: 'failed',
            status: 'failed',
            failureReason: 'focus'
        };
    }
    if (state.alarm >= 100) {
        return {
            ...state,
            alarm: 100,
            feedback: 'failed',
            status: 'failed',
            failureReason: 'alarm'
        };
    }
    return state;
}

export interface TrySafeDialGateResult {
    readonly state: SafeDialLock;
    readonly feedback: SafeDialFeedback;
}

export function tryGate(state: SafeDialLock): TrySafeDialGateResult {
    if (state.status !== 'active') return {state, feedback: state.feedback};
    const gate = getCurrentGate(state);
    if (gate === null) {
        const ready = {...state, feedback: 'handle-ready' as const};
        return {state: ready, feedback: ready.feedback};
    }

    if (dialDistance(state.dial, gate) <= state.config.gateTolerance) {
        const gatesLocked = state.gatesLocked + 1;
        const feedback: SafeDialFeedback =
            gatesLocked >= state.gates.length ? 'handle-ready' : 'gate-set';
        const nextState = {...state, gatesLocked, feedback};
        return {state: nextState, feedback};
    }

    const nextState = withFailureIfNeeded({
        ...state,
        focus: state.focus - 1,
        alarm: Math.min(100, state.alarm + FALSE_GATE_ALARM),
        falseGates: state.falseGates + 1,
        feedback: 'false-gate'
    });
    return {
        state: nextState,
        feedback: nextState.status === 'failed' ? 'failed' : 'false-gate'
    };
}

export function pullHandle(state: SafeDialLock): SafeDialLock {
    if (state.status !== 'active') return state;
    if (state.gatesLocked < state.gates.length) {
        return {...state, feedback: 'lock-gates-first'};
    }
    return {...state, feedback: 'opened', status: 'opened'};
}

export function setSafeDialPaused(state: SafeDialLock, paused: boolean): SafeDialLock {
    if (state.status !== 'active' || state.paused === paused) return state;
    return {...state, paused};
}

export function advanceSafeDialTime(state: SafeDialLock, deltaMs: number): SafeDialLock {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
        throw new Error('Safe dial time delta must be a finite non-negative number.');
    }
    if (deltaMs === 0 || state.paused || state.status !== 'active') return state;

    const elapsedMs = state.activeElapsedMs + deltaMs;
    // Alarm derives from total active time plus false-gate penalties, so
    // batched frames and one large clock advance always agree.
    const alarm = Math.min(
        100,
        state.falseGates * FALSE_GATE_ALARM + elapsedMs * (100 / state.config.alarmWindowMs)
    );
    return withFailureIfNeeded({
        ...state,
        activeElapsedMs: round(elapsedMs),
        alarm: round(alarm)
    });
}

export function gradeSafeDial(state: SafeDialLock): 's' | 'a' | 'b' | 'c' | 'none' {
    if (state.status !== 'opened') return 'none';
    if (state.falseGates === 0 && state.alarm < 25 && state.activeElapsedMs < 45_000) return 's';
    if (state.falseGates <= 1 && state.alarm < 50) return 'a';
    if (state.alarm < 80) return 'b';
    return 'c';
}

export function scoreSafeDial(state: SafeDialLock): number {
    if (state.status !== 'opened') return 0;
    return Math.max(
        500,
        4_000 - Math.floor(state.activeElapsedMs / 25) - 400 * state.falseGates
    );
}
