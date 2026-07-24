import {Mulberry32Random, randomInteger} from '../random/random-source';
import {deriveSeed} from '../random/seed-derivation';

export const MIN_REINFORCEMENT_DELAY_MS = 30_000;
export const MAX_REINFORCEMENT_DELAY_MS = 60_000;

const REINFORCEMENT_DELAY_SECONDS =
    (MAX_REINFORCEMENT_DELAY_MS - MIN_REINFORCEMENT_DELAY_MS) / 1_000 + 1;

/**
 * Returns a persisted, deterministic whole-second delay in the inclusive
 * 30–60 second range for the next reinforcement ordinal.
 */
export function getReinforcementDelayMs(
    levelSeed: number,
    reinforcementOrdinal: number
): number {
    const random = new Mulberry32Random(deriveSeed(
        levelSeed,
        'overworld-reinforcement-delay',
        reinforcementOrdinal
    ));
    return MIN_REINFORCEMENT_DELAY_MS +
        randomInteger(random, REINFORCEMENT_DELAY_SECONDS) * 1_000;
}
