export interface RandomSource {
    next(): number;
}

export class Mulberry32Random implements RandomSource {
    private state: number;

    constructor(seed: number) {
        if (!Number.isSafeInteger(seed)) throw new Error('Random seed must be a safe integer.');
        this.state = seed >>> 0;
    }

    next(): number {
        this.state = (this.state + 0x6d2b79f5) >>> 0;
        let value = this.state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    }
}

export function randomInteger(random: RandomSource, maximumExclusive: number): number {
    if (!Number.isSafeInteger(maximumExclusive) || maximumExclusive <= 0) {
        throw new Error('Random integer maximum must be a positive safe integer.');
    }

    const value = random.next();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new Error('RandomSource.next() must return a number in [0, 1).');
    }
    return Math.floor(value * maximumExclusive);
}

export function chooseRandom<T>(values: readonly T[], random: RandomSource): T {
    if (values.length === 0) throw new Error('Cannot choose from an empty collection.');
    return values[randomInteger(random, values.length)]!;
}

export function shuffle<T>(values: readonly T[], random: RandomSource): T[] {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index--) {
        const swapIndex = randomInteger(random, index + 1);
        const swapValue = shuffled[swapIndex]!;
        shuffled[swapIndex] = shuffled[index]!;
        shuffled[index] = swapValue;
    }
    return shuffled;
}