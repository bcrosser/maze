import {randomInteger, type RandomSource} from '../../domain/random/random-source';

export const LOCK_LEVELS = [0, 1, 2, 3] as const;
export type LockLevel = (typeof LOCK_LEVELS)[number];
export type LockFeedback = 'idle' | 'slipping' | 'binding' | 'set';

export interface LockPin {
    readonly targetHeight: Exclude<LockLevel, 0>;
    readonly height: LockLevel;
    readonly set: boolean;
}

export interface PinTensionLock {
    readonly requiredTension: Exclude<LockLevel, 0>;
    readonly tension: LockLevel;
    readonly pins: readonly LockPin[];
    readonly turns: number;
    readonly mistakes: number;
}

export interface ProbeLockResult {
    readonly state: PinTensionLock;
    readonly feedback: LockFeedback;
    readonly completed: boolean;
}

function nextLevel(level: LockLevel): LockLevel {
    return ((level + 1) % LOCK_LEVELS.length) as LockLevel;
}

export function createPinTensionLock(
    random: RandomSource,
    pinCount = 4
): PinTensionLock {
    if (!Number.isSafeInteger(pinCount) || pinCount < 3 || pinCount > 6) {
        throw new Error('Pin-tension locks require between three and six pins.');
    }

    return {
        requiredTension: (randomInteger(random, 3) + 1) as Exclude<LockLevel, 0>,
        tension: 0,
        turns: 0,
        mistakes: 0,
        pins: Array.from({length: pinCount}, () => ({
            targetHeight: (randomInteger(random, 3) + 1) as Exclude<LockLevel, 0>,
            height: 0,
            set: false
        }))
    };
}

export function setLockTension(
    state: PinTensionLock,
    tension: LockLevel
): PinTensionLock {
    if (state.tension === tension) return state;
    return {...state, tension, turns: state.turns + 1};
}

export function probeLockPin(state: PinTensionLock, pinIndex: number): ProbeLockResult {
    const pin = state.pins[pinIndex];
    if (!pin) throw new Error(`Unknown lock pin index: ${pinIndex}.`);
    if (pin.set) return {state, feedback: 'set', completed: state.pins.every(candidate => candidate.set)};

    const height = nextLevel(pin.height);
    let feedback: LockFeedback = 'idle';
    let set = false;
    let mistakes = state.mistakes;
    if (height === pin.targetHeight) {
        if (state.tension === state.requiredTension) {
            feedback = 'set';
            set = true;
        } else if (state.tension < state.requiredTension) {
            feedback = 'slipping';
            mistakes++;
        } else {
            feedback = 'binding';
            mistakes++;
        }
    }

    const pins = [...state.pins];
    pins[pinIndex] = {...pin, height, set};
    const nextState = {...state, pins, turns: state.turns + 1, mistakes};
    return {
        state: nextState,
        feedback,
        completed: nextState.pins.every(candidate => candidate.set)
    };
}