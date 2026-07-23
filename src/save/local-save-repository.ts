import {z} from 'zod';

import type {CampaignState} from '../domain/campaign/campaign-state';
import {campaignStateSchema, parseCampaignState} from './campaign-state.schema';

export const SAVE_FORMAT_VERSION = 1;
export const SAVE_SLOTS = ['slot-1', 'slot-2', 'slot-3'] as const;
export type SaveSlot = (typeof SAVE_SLOTS)[number];

export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface SaveEnvelope {
    readonly formatVersion: typeof SAVE_FORMAT_VERSION;
    readonly savedAt: string;
    readonly state: CampaignState;
}

const saveEnvelopeSchema: z.ZodType<SaveEnvelope> = z.object({
    formatVersion: z.literal(SAVE_FORMAT_VERSION),
    savedAt: z.iso.datetime(),
    state: campaignStateSchema
}).strict();

export class SaveDataError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'SaveDataError';
    }
}

function parseSerializedSave(serialized: string): SaveEnvelope {
    let input: unknown;
    try {
        input = JSON.parse(serialized);
    } catch (error) {
        throw new SaveDataError('Save data is not valid JSON.', {cause: error});
    }

    if (!input || typeof input !== 'object' || !('formatVersion' in input)) {
        throw new SaveDataError('Save data does not declare a format version.');
    }
    if (input.formatVersion !== SAVE_FORMAT_VERSION) {
        throw new SaveDataError(`Unsupported save format version: ${String(input.formatVersion)}.`);
    }

    const result = saveEnvelopeSchema.safeParse(input);
    if (!result.success) {
        throw new SaveDataError('Save data failed validation.', {cause: result.error});
    }
    return result.data;
}

export class LocalSaveRepository {
    private readonly storage: StorageLike;
    private readonly now: () => Date;
    private readonly keyPrefix: string;

    constructor(
        storage: StorageLike,
        options: {readonly now?: () => Date; readonly keyPrefix?: string} = {}
    ) {
        this.storage = storage;
        this.now = options.now ?? (() => new Date());
        this.keyPrefix = options.keyPrefix ?? 'maze:campaign';
    }

    save(slot: SaveSlot, state: CampaignState): SaveEnvelope {
        const envelope: SaveEnvelope = {
            formatVersion: SAVE_FORMAT_VERSION,
            savedAt: this.now().toISOString(),
            state: parseCampaignState(state)
        };
        this.storage.setItem(this.keyFor(slot), JSON.stringify(envelope));
        return envelope;
    }

    load(slot: SaveSlot): SaveEnvelope | null {
        const serialized = this.storage.getItem(this.keyFor(slot));
        return serialized === null ? null : parseSerializedSave(serialized);
    }

    clear(slot: SaveSlot): void {
        this.storage.removeItem(this.keyFor(slot));
    }

    exportSlot(slot: SaveSlot): string | null {
        const envelope = this.load(slot);
        return envelope ? JSON.stringify(envelope, null, 2) : null;
    }

    importSlot(slot: SaveSlot, serialized: string): SaveEnvelope {
        const envelope = parseSerializedSave(serialized);
        this.storage.setItem(this.keyFor(slot), JSON.stringify(envelope));
        return envelope;
    }

    private keyFor(slot: SaveSlot): string {
        return `${this.keyPrefix}:${slot}`;
    }
}