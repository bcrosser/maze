import {randomInteger, type RandomSource} from '../../domain/random/random-source';
import type {DifficultyPreset} from '../../encounters/contracts';

export type TumblerRelayFeedback =
    | 'idle'
    | 'latched'
    | 'missed'
    | 'dropped'
    | 'turn-ready'
    | 'latch-all-first'
    | 'opened'
    | 'failed';

export type TumblerRelayStatus = 'active' | 'opened' | 'failed';
export type TumblerRelayFailureReason = 'alarm' | 'wear' | null;

export interface TumblerRelayConfig {
    readonly difficulty: DifficultyPreset;
    readonly levelTier?: number;
}

export interface ResolvedTumblerRelayConfig {
    readonly difficulty: DifficultyPreset;
    readonly levelTier: number;
    readonly tumblerCount: number;
    readonly catchHalfWidth: number;
    readonly maximumWear: number;
    readonly alarmWindowMs: number;
}

export interface RelayTumbler {
    /** One full up-and-down bounce takes this long. */
    readonly periodMs: number;
    /** Phase offset in [0, 1) so tumblers never move in unison. */
    readonly phase: number;
    /** Center of the gold catch band, in the same [0, 1] travel space. */
    readonly bandCenter: number;
    readonly latched: boolean;
}

export interface TumblerRelayLock {
    readonly config: ResolvedTumblerRelayConfig;
    readonly tumblers: readonly RelayTumbler[];
    readonly wear: number;
    readonly alarm: number;
    readonly activeElapsedMs: number;
    readonly misses: number;
    readonly drops: number;
    readonly feedback: TumblerRelayFeedback;
    readonly status: TumblerRelayStatus;
    readonly failureReason: TumblerRelayFailureReason;
    readonly paused: boolean;
}

const BASE_CONFIGS: Readonly<Record<DifficultyPreset, {
    readonly tumblerCount: number;
    readonly catchHalfWidth: number;
    readonly maximumWear: number;
    readonly alarmWindowMs: number;
    readonly basePeriodMs: number;
}>> = Object.freeze({
    story: Object.freeze({
        tumblerCount: 4,
        catchHalfWidth: 0.1,
        maximumWear: 7,
        alarmWindowMs: 120_000,
        basePeriodMs: 3_200
    }),
    standard: Object.freeze({
        tumblerCount: 5,
        catchHalfWidth: 0.075,
        maximumWear: 5,
        alarmWindowMs: 90_000,
        basePeriodMs: 2_800
    }),
    expert: Object.freeze({
        tumblerCount: 6,
        catchHalfWidth: 0.055,
        maximumWear: 4,
        alarmWindowMs: 70_000,
        basePeriodMs: 2_400
    })
});

const MISS_ALARM = 8;
/** Each successive tumbler bounces this much faster than the one before it. */
const PERIOD_STEP_MS = 260;
const MINIMUM_PERIOD_MS = 900;

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, places = 6): number {
    const scale = 10 ** places;
    return Math.round(value * scale) / scale;
}

export function resolveTumblerRelayConfig(
    config: TumblerRelayConfig
): ResolvedTumblerRelayConfig {
    const base = BASE_CONFIGS[config.difficulty];
    const levelTier = config.levelTier === undefined ? 0 : clamp(config.levelTier, 0, 5);
    if (config.levelTier !== undefined && !Number.isSafeInteger(config.levelTier)) {
        throw new Error('Tumbler relay level tier must be a safe integer.');
    }
    const tierRatio = levelTier / 5;
    return {
        difficulty: config.difficulty,
        levelTier,
        tumblerCount: base.tumblerCount,
        catchHalfWidth: round(base.catchHalfWidth * (1 - 0.2 * tierRatio)),
        maximumWear: base.maximumWear,
        // At tier five the alarm fills exactly 20% faster, matching pin locks.
        alarmWindowMs: round(base.alarmWindowMs / (1 + 0.2 * tierRatio))
    };
}

export function createTumblerRelayLock(
    random: RandomSource,
    config: TumblerRelayConfig
): TumblerRelayLock {
    const resolved = resolveTumblerRelayConfig(config);
    const base = BASE_CONFIGS[config.difficulty];
    const tumblers = Array.from({length: resolved.tumblerCount}, (_, index): RelayTumbler => ({
        periodMs: Math.max(
            MINIMUM_PERIOD_MS,
            base.basePeriodMs - index * PERIOD_STEP_MS - randomInteger(random, 200)
        ),
        phase: round(randomInteger(random, 1_000) / 1_000),
        bandCenter: round(0.3 + randomInteger(random, 451) / 1_000),
        latched: false
    }));
    return {
        config: resolved,
        tumblers,
        wear: resolved.maximumWear,
        alarm: 0,
        activeElapsedMs: 0,
        misses: 0,
        drops: 0,
        feedback: 'idle',
        status: 'active',
        failureReason: null,
        paused: false
    };
}

/**
 * Where a tumbler sits at a moment in time, as a triangle wave over [0, 1].
 * Positions derive purely from the active clock so pausing freezes motion.
 */
export function tumblerPosition(tumbler: RelayTumbler, activeElapsedMs: number): number {
    const cycle = (activeElapsedMs / tumbler.periodMs + tumbler.phase) % 1;
    return round(cycle < 0.5 ? cycle * 2 : 2 - cycle * 2);
}

/** Tumblers latch strictly left to right; this is the one that reacts to a press. */
export function getActiveTumblerIndex(state: TumblerRelayLock): number | null {
    const index = state.tumblers.findIndex(tumbler => !tumbler.latched);
    return index === -1 ? null : index;
}

export function isTumblerInBand(state: TumblerRelayLock, index: number): boolean {
    const tumbler = state.tumblers[index];
    if (!tumbler) throw new Error(`Unknown tumbler index: ${index}.`);
    const position = tumblerPosition(tumbler, state.activeElapsedMs);
    return Math.abs(position - tumbler.bandCenter) <= state.config.catchHalfWidth;
}

function shouldDropLatch(difficulty: DifficultyPreset, missCount: number): boolean {
    if (difficulty === 'story') return false;
    if (difficulty === 'expert') return true;
    return missCount % 2 === 0;
}

function withFailureIfNeeded(state: TumblerRelayLock): TumblerRelayLock {
    if (state.wear <= 0) {
        return {
            ...state,
            wear: 0,
            feedback: 'failed',
            status: 'failed',
            failureReason: 'wear'
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

export interface PressTumblerResult {
    readonly state: TumblerRelayLock;
    readonly feedback: TumblerRelayFeedback;
}

export function pressTumbler(state: TumblerRelayLock): PressTumblerResult {
    if (state.status !== 'active') return {state, feedback: state.feedback};
    const activeIndex = getActiveTumblerIndex(state);
    if (activeIndex === null) {
        const ready = {...state, feedback: 'turn-ready' as const};
        return {state: ready, feedback: ready.feedback};
    }

    if (isTumblerInBand(state, activeIndex)) {
        const tumblers = state.tumblers.map((tumbler, index) =>
            index === activeIndex ? {...tumbler, latched: true} : tumbler
        );
        const allLatched = tumblers.every(tumbler => tumbler.latched);
        const feedback: TumblerRelayFeedback = allLatched ? 'turn-ready' : 'latched';
        const nextState = {...state, tumblers, feedback};
        return {state: nextState, feedback};
    }

    const misses = state.misses + 1;
    const dropIndex = activeIndex - 1;
    const dropsLatch = shouldDropLatch(state.config.difficulty, misses) && dropIndex >= 0;
    const tumblers = dropsLatch
        ? state.tumblers.map((tumbler, index) =>
            index === dropIndex ? {...tumbler, latched: false} : tumbler
        )
        : state.tumblers;
    const feedback: TumblerRelayFeedback = dropsLatch ? 'dropped' : 'missed';
    const nextState = withFailureIfNeeded({
        ...state,
        tumblers,
        wear: state.wear - 1,
        alarm: Math.min(100, state.alarm + MISS_ALARM),
        misses,
        drops: state.drops + (dropsLatch ? 1 : 0),
        feedback
    });
    return {
        state: nextState,
        feedback: nextState.status === 'failed' ? 'failed' : feedback
    };
}

export function turnTumblerCam(state: TumblerRelayLock): TumblerRelayLock {
    if (state.status !== 'active') return state;
    if (!state.tumblers.every(tumbler => tumbler.latched)) {
        return {...state, feedback: 'latch-all-first'};
    }
    return {...state, feedback: 'opened', status: 'opened'};
}

export function setTumblerRelayPaused(
    state: TumblerRelayLock,
    paused: boolean
): TumblerRelayLock {
    if (state.status !== 'active' || state.paused === paused) return state;
    return {...state, paused};
}

export function advanceTumblerRelayTime(
    state: TumblerRelayLock,
    deltaMs: number
): TumblerRelayLock {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
        throw new Error('Tumbler relay time delta must be a finite non-negative number.');
    }
    if (deltaMs === 0 || state.paused || state.status !== 'active') return state;

    const elapsedMs = state.activeElapsedMs + deltaMs;
    // Alarm derives from total active time plus miss penalties, so batched
    // frames and one large clock advance always agree.
    const alarm = Math.min(
        100,
        state.misses * MISS_ALARM + elapsedMs * (100 / state.config.alarmWindowMs)
    );
    return withFailureIfNeeded({
        ...state,
        activeElapsedMs: round(elapsedMs),
        alarm: round(alarm)
    });
}

export function gradeTumblerRelay(state: TumblerRelayLock): 's' | 'a' | 'b' | 'c' | 'none' {
    if (state.status !== 'opened') return 'none';
    if (state.misses === 0 && state.alarm < 25 && state.activeElapsedMs < 45_000) return 's';
    if (state.misses <= 1 && state.alarm < 50) return 'a';
    if (state.alarm < 80) return 'b';
    return 'c';
}

export function scoreTumblerRelay(state: TumblerRelayLock): number {
    if (state.status !== 'opened') return 0;
    return Math.max(
        500,
        4_000 -
        Math.floor(state.activeElapsedMs / 25) -
        300 * state.misses -
        250 * state.drops
    );
}
