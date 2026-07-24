import {describe, expect, it} from 'vitest';

import {
    createInitialCampaignState,
    STARTING_MONEY,
    type CampaignState
} from '../../../src/domain/campaign/campaign-state';
import {
    advanceCampaignLevel,
    CAMPAIGN_VICTORY_FLAG,
    getCampaignLevelNumber,
    getLevelExitStatus
} from '../../../src/domain/campaign/level-progression';
import {initializeLevelContent} from '../../../src/domain/overworld/level-content-generator';
import {
    OBJECTIVE_BY_ID,
    type ObjectiveId
} from '../../../src/domain/overworld/level-objectives';
import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import type {Coordinate, MazeGrid} from '../../../src/domain/overworld/maze-types';
import {getPassageDistances} from '../../../src/domain/overworld/objective-placement';
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

function createCampaign(seed = 91, levelId = 'level-1') {
    const maze = generateMaze({size: 21, random: new Mulberry32Random(seed)});
    return createInitialCampaignState({campaignSeed: seed, levelId, maze});
}

const PRE_EXPANSION_OBJECTIVE_IDS = [
    'pipe',
    'lock',
    'space',
    'platformer',
    'circuit',
    'horsemaster'
] as const satisfies readonly ObjectiveId[];

function createPreExpansionCampaign(
    levelNumber: 4 | 5 | 6
): CampaignState {
    let generated: CampaignState | null = null;
    for (let seedOffset = 0; seedOffset < 64; seedOffset++) {
        const candidate = initializeLevelContent(
            createCampaign(
                8_000 + levelNumber * 100 + seedOffset,
                `level-${levelNumber}`
            )
        );
        if (candidate.overworld.pipeShortcutWall !== null) {
            generated = candidate;
            break;
        }
    }
    if (generated === null) {
        throw new Error('Could not build a deterministic pre-expansion Pipe roster fixture.');
    }
    const objectiveIds = PRE_EXPANSION_OBJECTIVE_IDS.slice(0, levelNumber);
    return {
        ...generated,
        overworld: {
            ...generated.overworld,
            objectives: objectiveIds.map((objectiveId, index) => ({
                objectiveId,
                triggerId: OBJECTIVE_BY_ID[objectiveId].triggerId,
                position: generated.overworld.objectives[index]!.position
            }))
        }
    };
}

function formatFourEnvelope(state: CampaignState): string {
    return JSON.stringify({
        formatVersion: 4,
        savedAt: '2026-07-23T14:30:00.000Z',
        state
    });
}

function coordinateKey(position: Coordinate): string {
    return `${position.x},${position.y}`;
}

interface RelocationScenario {
    readonly seed: number;
    readonly maze: MazeGrid;
    readonly origin: Coordinate;
    readonly expectedPositions: readonly Coordinate[];
    readonly oldManhattanPosition: Coordinate;
}

function findRelocationScenario(): RelocationScenario {
    for (let seed = 1; seed <= 64; seed++) {
        const maze = generateMaze({size: 21, random: new Mulberry32Random(seed)});
        const passages = maze.flatMap((row, y) =>
            row.flatMap((cell, x) => cell.kind === 'passage' ? [{x, y}] : [])
        );
        for (const origin of passages) {
            const distances = getPassageDistances(maze, origin);
            if (distances.size < 12) continue;
            const occupied = new Set([coordinateKey(origin)]);
            const expectedPositions: Coordinate[] = [];
            for (let index = 0; index < 10; index++) {
                const free = passages.filter(position => !occupied.has(coordinateKey(position)));
                const graphPosition = [...free].sort((left, right) =>
                    (distances.get(coordinateKey(left)) ?? Number.POSITIVE_INFINITY) -
                    (distances.get(coordinateKey(right)) ?? Number.POSITIVE_INFINITY) ||
                    left.y - right.y ||
                    left.x - right.x
                )[0];
                const manhattanPosition = [...free].sort((left, right) =>
                    Math.abs(left.x - origin.x) + Math.abs(left.y - origin.y) -
                    (Math.abs(right.x - origin.x) + Math.abs(right.y - origin.y)) ||
                    left.y - right.y ||
                    left.x - right.x
                )[0];
                if (!graphPosition || !manhattanPosition) break;
                expectedPositions.push(graphPosition);
                if (coordinateKey(graphPosition) !== coordinateKey(manhattanPosition)) {
                    return {
                        seed,
                        maze,
                        origin,
                        expectedPositions,
                        oldManhattanPosition: manhattanPosition
                    };
                }
                occupied.add(coordinateKey(graphPosition));
            }
        }
    }
    throw new Error('The deterministic maze corpus did not expose a relocation-order difference.');
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

    it('loads and round-trips format-v4 level 4/5/6 pre-expansion rosters verbatim', () => {
        const storage = new MemoryStorage();
        const repository = new LocalSaveRepository(storage);
        const slots = ['slot-1', 'slot-2', 'slot-3'] as const;

        for (const [index, levelNumber] of ([4, 5, 6] as const).entries()) {
            const slot = slots[index]!;
            const legacyState = createPreExpansionCampaign(levelNumber);
            const serialized = formatFourEnvelope(legacyState);
            storage.values.set(`maze:campaign:${slot}`, serialized);
            const loaded = repository.load(slot);

            expect(loaded?.formatVersion).toBe(4);
            expect(loaded?.state).toEqual(legacyState);
            expect(loaded?.state.overworld.levelId).toBe(`level-${levelNumber}`);
            expect(loaded?.state.overworld.objectives.map(objective => objective.objectiveId))
                .toEqual(PRE_EXPANSION_OBJECTIVE_IDS.slice(0, levelNumber));
            expect(getLevelExitStatus(loaded!.state).total).toBe(levelNumber);
            expect(initializeLevelContent(loaded!.state)).toBe(loaded!.state);
            expect(storage.values.get(`maze:campaign:${slot}`)).toBe(serialized);

            const exported = repository.exportSlot(slot)!;
            const roundTripped = repository.importSlot(slot, exported);
            expect(roundTripped.state).toEqual(legacyState);
            expect(roundTripped.state.overworld.objectives)
                .toEqual(loaded?.state.overworld.objectives);
        }
    });

    it('keeps a persisted format-v4 level-six campaign victory terminal after expansion', () => {
        const storage = new MemoryStorage();
        const repository = new LocalSaveRepository(storage);
        const levelSix = createPreExpansionCampaign(6);
        const completionFlags = levelSix.overworld.objectives.map(objective =>
            OBJECTIVE_BY_ID[objective.objectiveId].completionFlag
        );
        const exit = {
            x: levelSix.overworld.maze.length - 2,
            y: levelSix.overworld.maze.length - 2
        };
        const legacyVictory: CampaignState = {
            ...levelSix,
            flags: [...completionFlags, CAMPAIGN_VICTORY_FLAG],
            pendingLevelReward: null,
            overworld: {
                ...levelSix.overworld,
                playerPosition: exit,
                pipeShortcutWall: null,
                sanctuaryPosition: {x: 1, y: 1},
                sanctuaryServiceClaims: []
            }
        };
        storage.values.set(
            'maze:campaign:slot-1',
            formatFourEnvelope(legacyVictory)
        );

        const loaded = repository.load('slot-1')!;
        expect(loaded.state).toEqual(legacyVictory);
        expect(getCampaignLevelNumber(loaded.state)).toBe(6);
        expect(getLevelExitStatus(loaded.state)).toEqual({
            ready: true,
            completed: 6,
            total: 6,
            nextLabel: null
        });
        expect(loaded.state.flags.filter(flag => flag === CAMPAIGN_VICTORY_FLAG))
            .toHaveLength(1);
        expect(advanceCampaignLevel(loaded.state)).toBe(loaded.state);

        const roundTripped = repository.importSlot(
            'slot-2',
            repository.exportSlot('slot-1')!
        );
        expect(roundTripped.state).toEqual(legacyVictory);
        expect(advanceCampaignLevel(roundTripped.state)).toBe(roundTripped.state);
        expect(getCampaignLevelNumber(roundTripped.state)).toBe(6);
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

        expect(repository.exportSlot('slot-1')).toContain('"formatVersion": 4');
        repository.clear('slot-1');
        expect(repository.load('slot-1')).toBeNull();
        expect(repository.exportSlot('slot-1')).toBeNull();
    });

    it('migrates overlapping legacy monsters by reachable graph distance with y/x ties', () => {
        const scenario = findRelocationScenario();
        const storage = new MemoryStorage();
        const repository = new LocalSaveRepository(storage);
        const monsters = scenario.expectedPositions.map((_, index) => ({
            id: `legacy-monster-${String(index).padStart(2, '0')}`,
            typeId: index % 2 === 0 ? 'moss-slime' as const : 'ember-hound' as const,
            position: scenario.origin,
            lastMoveTurn: 0,
            lastAttackTurn: 0
        }));
        const legacyEnvelope = {
            formatVersion: 1,
            savedAt: '2026-07-23T14:30:00.000Z',
            state: {
                schemaVersion: 1,
                campaignSeed: scenario.seed,
                act: 1,
                player: {
                    health: 10,
                    maxHealth: 10,
                    scrap: 0,
                    miningPower: 0,
                    toolCharge: 0,
                    installedModuleIds: []
                },
                worldSystems: {
                    powerRouting: 50,
                    securityAlert: 0,
                    airspaceControl: 50,
                    structuralStability: 50
                },
                flags: [],
                overworld: {
                    levelId: 'level-1',
                    seed: scenario.seed,
                    maze: scenario.maze,
                    playerPosition: scenario.origin,
                    turn: 0,
                    itemsInitialized: true,
                    items: [],
                    monstersInitialized: true,
                    monsters,
                    triggerStates: {},
                    resumeGraceTurns: 0
                },
                appliedEncounterRunIds: [],
                encounterHistory: []
            }
        };

        const migrated = repository.importSlot('slot-1', JSON.stringify(legacyEnvelope));
        expect(migrated.state.overworld.monsters.map(monster => monster.position))
            .toEqual(scenario.expectedPositions);
        expect(scenario.expectedPositions.at(-1)).not.toEqual(scenario.oldManhattanPosition);
    });

    it('migrates version 2 saves with a wallet and empty optional service sites', () => {
        const storage = new MemoryStorage();
        const repository = new LocalSaveRepository(storage);
        const current = createCampaign(31415);
        const {money: _money, ...player} = current.player;
        const {serviceSites: _serviceSites, ...overworld} = current.overworld;
        const versionTwoEnvelope = {
            formatVersion: 2,
            savedAt: '2026-07-23T14:30:00.000Z',
            state: {
                ...current,
                schemaVersion: 2,
                player,
                overworld
            }
        };

        const migrated = repository.importSlot('slot-1', JSON.stringify(versionTwoEnvelope));

        expect(migrated.formatVersion).toBe(4);
        expect(migrated.state.schemaVersion).toBe(4);
        expect(migrated.state.player.money).toBe(STARTING_MONEY);
        expect(migrated.state.overworld.serviceSites).toEqual([]);
        expect(migrated.state.overworld.reinforcementOrdinal).toBe(0);
        expect(migrated.state.overworld.reinforcementCountdownMs)
            .toBeGreaterThanOrEqual(30_000);
        expect(JSON.parse(storage.values.get('maze:campaign:slot-1')!).formatVersion).toBe(4);
    });

    it('migrates version 3 saves with a deterministic reinforcement clock', () => {
        const storage = new MemoryStorage();
        const repository = new LocalSaveRepository(storage);
        const current = createCampaign(27_182);
        const {
            reinforcementCountdownMs: _countdown,
            reinforcementOrdinal: _ordinal,
            ...overworld
        } = current.overworld;
        const versionThreeEnvelope = {
            formatVersion: 3,
            savedAt: '2026-07-23T14:30:00.000Z',
            state: {
                ...current,
                schemaVersion: 3,
                overworld
            }
        };

        const migrated = repository.importSlot('slot-1', JSON.stringify(versionThreeEnvelope));

        expect(migrated.formatVersion).toBe(4);
        expect(migrated.state.schemaVersion).toBe(4);
        expect(migrated.state.overworld.reinforcementOrdinal).toBe(0);
        expect(migrated.state.overworld.reinforcementCountdownMs)
            .toBe(createCampaign(27_182).overworld.reinforcementCountdownMs);
        expect(JSON.parse(storage.values.get('maze:campaign:slot-1')!).formatVersion).toBe(4);
    });
});
