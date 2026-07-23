import {describe, expect, it} from 'vitest';

import {createInitialCampaignState} from '../../../src/domain/campaign/campaign-state';
import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    LocalSaveRepository,
    SaveDataError,
    type StorageLike
} from '../../../src/save/local-save-repository';

class MemoryStorage implements StorageLike {
    readonly values = new Map<string, string>();

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }
}

function createCampaign(seed = 91) {
    const maze = generateMaze({size: 21, random: new Mulberry32Random(seed)});
    return createInitialCampaignState({campaignSeed: seed, maze});
}

describe('LocalSaveRepository', () => {
    it('round-trips campaign state through a versioned envelope', () => {
        const storage = new MemoryStorage();
        const repository = new LocalSaveRepository(storage, {
            now: () => new Date('2026-07-23T14:30:00.000Z')
        });
        const campaign = createCampaign();

        const saved = repository.save('slot-1', campaign);
        const loaded = repository.load('slot-1');

        expect(saved.savedAt).toBe('2026-07-23T14:30:00.000Z');
        expect(loaded).toEqual(saved);
        expect(loaded?.state).toEqual(campaign);
    });

    it('keeps all three slots isolated', () => {
        const repository = new LocalSaveRepository(new MemoryStorage());
        repository.save('slot-1', createCampaign(1));
        repository.save('slot-2', createCampaign(2));
        repository.save('slot-3', createCampaign(3));

        expect(repository.load('slot-1')?.state.campaignSeed).toBe(1);
        expect(repository.load('slot-2')?.state.campaignSeed).toBe(2);
        expect(repository.load('slot-3')?.state.campaignSeed).toBe(3);
    });

    it('validates an import before replacing a good slot', () => {
        const storage = new MemoryStorage();
        const repository = new LocalSaveRepository(storage);
        const original = repository.save('slot-1', createCampaign());

        expect(() => repository.importSlot('slot-1', '{"formatVersion":1,"state":{}}'))
            .toThrow(SaveDataError);
        expect(repository.load('slot-1')).toEqual(original);
    });

    it('reports corrupt JSON and unsupported versions', () => {
        const repository = new LocalSaveRepository(new MemoryStorage());

        expect(() => repository.importSlot('slot-1', 'not-json'))
            .toThrow('Save data is not valid JSON.');
        expect(() => repository.importSlot('slot-1', JSON.stringify({formatVersion: 99})))
            .toThrow('Unsupported save format version: 99.');
    });

    it('clears and exports slots without exposing unchecked data', () => {
        const repository = new LocalSaveRepository(new MemoryStorage());
        repository.save('slot-1', createCampaign());

        expect(repository.exportSlot('slot-1')).toContain('"formatVersion": 1');
        repository.clear('slot-1');
        expect(repository.load('slot-1')).toBeNull();
        expect(repository.exportSlot('slot-1')).toBeNull();
    });
});