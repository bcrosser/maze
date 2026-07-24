export const UINT32_MAX = 0xffff_ffff;

function assertUint32(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
        throw new Error(`${label} must be an unsigned 32-bit integer.`);
    }
}

/**
 * Stable FNV-1a + avalanche seed derivation. This is persisted game behavior:
 * changing it requires a new generator/content version.
 */
export function deriveSeed(baseSeed: number, namespace: string, ordinal = 0): number {
    assertUint32(baseSeed, 'Base seed');
    assertUint32(ordinal, 'Seed ordinal');
    if (namespace.length === 0) throw new Error('Seed namespace cannot be empty.');

    let hash = 0x811c9dc5;
    for (const byte of new TextEncoder().encode(namespace)) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193);
    }

    let value = (hash ^ baseSeed ^ Math.imul(ordinal, 0x9e3779b1)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    value ^= value >>> 16;
    return value >>> 0;
}

export interface CampaignSeedSource {
    nextSeed(): number;
}

export class WebCryptoCampaignSeedSource implements CampaignSeedSource {
    nextSeed(): number {
        const cryptoApi = globalThis.crypto;
        if (!cryptoApi?.getRandomValues) {
            throw new Error('Unable to create a random maze: Web Crypto is unavailable.');
        }
        const values = new Uint32Array(1);
        try {
            cryptoApi.getRandomValues(values);
        } catch (error) {
            throw new Error('Unable to create a random maze: entropy source failed.', {
                cause: error
            });
        }
        const seed = values[0];
        if (seed === undefined) {
            throw new Error('Unable to create a random maze: entropy source returned no value.');
        }
        return seed;
    }
}
