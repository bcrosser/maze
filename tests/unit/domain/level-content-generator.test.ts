import {describe, expect, it} from 'vitest';

import {createInitialCampaignState} from '../../../src/domain/campaign/campaign-state';
import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import {
    getLevelContentAttemptSalt,
    getCompatibleWeaponAffixIds,
    getNativeLevelContentBudgets,
    initializeLevelContent,
    initializeLevelContentWithDiagnostics,
    LEVEL_CONTENT_GENERATION_ATTEMPT_LIMIT,
    validateNativeLevelFairness
} from '../../../src/domain/overworld/level-content-generator';
import {getPassageDistances} from '../../../src/domain/overworld/objective-placement';
import {
    getLevelObjectiveRequirementCount,
    getLevelObjectiveSelectionCount,
    LEVEL_OBJECTIVE_COUNT,
    MAX_LEVEL_OBJECTIVE_COUNT,
    OBJECTIVE_IDS,
    selectLevelObjectiveIds
} from '../../../src/domain/overworld/level-objectives';
import {
    PASSAGE_CELL,
    type Coordinate,
    type MazeCell,
    type MazeGrid
} from '../../../src/domain/overworld/maze-types';
import {Mulberry32Random} from '../../../src/domain/random/random-source';

function campaign(seed: number, levelId = 'level-1') {
    const maze = generateMaze({
        size: 21,
        topologyRandom: new Mulberry32Random(seed),
        materialRandom: new Mulberry32Random(seed ^ 0x55aa)
    });
    return createInitialCampaignState({
        campaignSeed: seed,
        overworldSeed: seed,
        levelId,
        maze
    });
}

function replaceMazeCell(
    maze: MazeGrid,
    position: Coordinate,
    replacement: MazeCell
): MazeGrid {
    return maze.map((row, y) => row.map((cell, x) =>
        x === position.x && y === position.y ? replacement : cell
    ));
}

function issueCodes(state: ReturnType<typeof initializeLevelContent>) {
    return validateNativeLevelFairness(state).issues.map(issue => issue.code);
}

describe('initializeLevelContent', () => {
    it('only offers Extended and Efficient to weapons that support them', () => {
        const ordinaryWeaponAffixes = [
            'keen',
            'piercing',
            'frost-bound',
            'arc-bound',
            'ember-bound'
        ];

        for (const typeId of ['axe', 'sword', 'dagger'] as const) {
            expect(getCompatibleWeaponAffixIds(typeId)).toEqual(ordinaryWeaponAffixes);
        }
        expect(getCompatibleWeaponAffixIds('spear')).toEqual([
            'keen',
            'extended',
            'piercing',
            'frost-bound',
            'arc-bound',
            'ember-bound'
        ]);
        expect(getCompatibleWeaponAffixIds('bow')).toEqual([
            'keen',
            'extended',
            'piercing',
            'efficient',
            'frost-bound',
            'arc-bound',
            'ember-bound'
        ]);
        expect(getCompatibleWeaponAffixIds('shield')).toEqual([]);
    });

    it('atomically creates objectives, varied loot, threats, and traps', () => {
        const generated = initializeLevelContent(campaign(42));
        expect(generated.overworld.levelContentInitialized).toBe(true);
        expect(generated.overworld.objectives).toHaveLength(4);
        expect(generated.overworld.serviceSites.map(site => site.kind)).toEqual(
            expect.arrayContaining(['blackjack', 'holdem'])
        );
        expect(generated.overworld.items.length).toBeGreaterThanOrEqual(6);
        expect(generated.overworld.monsters.length).toBeGreaterThanOrEqual(3);
        expect(generated.overworld.traps.length).toBeGreaterThanOrEqual(1);
        expect(generated.overworld.items.some(item =>
            ['sword', 'spear', 'axe', 'bow'].includes(item.instance.baseTypeId)
        )).toBe(true);
        expect(validateNativeLevelFairness(generated)).toMatchObject({
            valid: true,
            issues: []
        });
    });

    it('is deterministic and idempotent', () => {
        const first = initializeLevelContent(campaign(99));
        expect(initializeLevelContent(first)).toBe(first);
        expect(initializeLevelContent(campaign(99))).toEqual(first);
        expect(first.overworld.objectives.map(objective => objective.objectiveId))
            .toEqual(selectLevelObjectiveIds(first.overworld.seed));
    });

    it('selects a stable level-scaled roster and varies the four-game draw', () => {
        const rosters = Array.from({length: 48}, (_, seed) =>
            selectLevelObjectiveIds(seed, 1)
        );
        const signatures = new Set(rosters.map(roster => [...roster].sort().join('|')));

        expect(signatures.size).toBeGreaterThan(8);
        for (const roster of rosters) {
            expect(roster).toHaveLength(LEVEL_OBJECTIVE_COUNT);
            expect(new Set(roster).size).toBe(LEVEL_OBJECTIVE_COUNT);
        }
        for (const objectiveId of OBJECTIVE_IDS) {
            expect(rosters.some(roster => roster.includes(objectiveId))).toBe(true);
            expect(rosters.some(roster => !roster.includes(objectiveId))).toBe(true);
        }

        const generated = initializeLevelContent(campaign(37));
        const selected = generated.overworld.objectives.map(objective =>
            objective.objectiveId
        );
        expect(selected).toEqual(selectLevelObjectiveIds(37));
        expect(OBJECTIVE_IDS.filter(objectiveId => !selected.includes(objectiveId)))
            .toHaveLength(4);

        expect(Array.from({length: 9}, (_, index) =>
            getLevelObjectiveSelectionCount(index + 1)
        )).toEqual([4, 4, 4, 4, 5, 6, 7, 8, 8]);
        expect(Array.from({length: 9}, (_, index) =>
            getLevelObjectiveRequirementCount(index + 1)
        )).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8]);

        for (const levelNumber of [4, 5, 6, 7, 8, 9]) {
            const scaled = initializeLevelContent(
                campaign(370 + levelNumber, `level-${levelNumber}`)
            );
            const roster = scaled.overworld.objectives.map(objective =>
                objective.objectiveId
            );
            expect(roster).toHaveLength(getLevelObjectiveSelectionCount(levelNumber));
            expect(new Set(roster).size).toBe(roster.length);
            expect(roster).toEqual(selectLevelObjectiveIds(
                scaled.overworld.seed,
                levelNumber
            ));
            if (levelNumber >= 8) {
                expect(roster).toHaveLength(MAX_LEVEL_OBJECTIVE_COUNT);
                expect(new Set(roster)).toEqual(new Set(OBJECTIVE_IDS));
            }
        }
    });

    it('always supplies a shop route when Casino Heist is selected but locked', () => {
        for (let seed = 0; seed < 32; seed++) {
            const generated = initializeLevelContent(campaign(seed));
            const selected = generated.overworld.objectives.some(objective =>
                objective.objectiveId === 'casino-heist'
            );
            if (selected) {
                expect(generated.overworld.serviceSites.some(site =>
                    site.kind === 'shop'
                )).toBe(true);
            }
        }
    });

    it('occasionally rolls a rare car into ordinary maze loot', () => {
        const carDrops = Array.from({length: 64}, (_, seed) => {
            const generated = initializeLevelContent(
                campaign(4_000 + seed, 'level-8')
            );
            return generated.overworld.items.find(item =>
                item.instance.baseTypeId === 'car'
            )?.instance ?? null;
        });

        expect(carDrops).toContain(null);
        expect(carDrops.some(item => item?.baseTypeId === 'car')).toBe(true);
        expect(carDrops.filter(item => item !== null).every(item =>
            item.quality === 'rare'
        )).toBe(true);
    });

    it('deterministically backfills optional services into an older initialized level', () => {
        const generated = initializeLevelContent(campaign(109));
        const migrated = {
            ...generated,
            overworld: {...generated.overworld, serviceSites: []}
        };
        const backfilled = initializeLevelContent(migrated);

        expect(backfilled.overworld.serviceSites.map(site => site.kind)).toEqual(
            expect.arrayContaining(['blackjack', 'holdem'])
        );
        expect(initializeLevelContent(migrated)).toEqual(backfilled);
        expect(initializeLevelContent(backfilled)).toBe(backfilled);
    });

    it('never generates a weapon with an incompatible affix', () => {
        let affixedWeaponCount = 0;
        for (let seed = 0; seed < 50; seed++) {
            const state = campaign(seed);
            const generated = initializeLevelContent({
                ...state,
                overworld: {
                    ...state.overworld,
                    levelId: 'level-11'
                }
            });
            for (const item of generated.overworld.items) {
                const compatible = getCompatibleWeaponAffixIds(item.instance.baseTypeId);
                if (compatible.length === 0) continue;
                if (item.instance.affixIds.length > 0) affixedWeaponCount++;
                expect(item.instance.affixIds.every(affixId =>
                    compatible.includes(affixId)
                )).toBe(true);
            }
        }
        expect(affixedWeaponCount).toBeGreaterThan(0);
    });

    it('uses the exact difficulty, tier, alert, and size budget formulas as caps', () => {
        const tierFive = campaign(7, 'level-11');
        const alerted = {
            ...tierFive,
            worldSystems: {
                ...tierFive.worldSystems,
                securityAlert: 80
            }
        };

        expect(getNativeLevelContentBudgets(alerted, 'story')).toEqual({
            lootSlots: 8,
            monsterThreat: 13,
            monsterEntities: 10,
            trapCost: 6
        });
        expect(getNativeLevelContentBudgets(alerted, 'standard')).toEqual({
            lootSlots: 8,
            monsterThreat: 17,
            monsterEntities: 10,
            trapCost: 7
        });
        expect(getNativeLevelContentBudgets(alerted, 'expert')).toEqual({
            lootSlots: 8,
            monsterThreat: 20,
            monsterEntities: 10,
            trapCost: 8
        });
    });

    it('validates reachability, collisions, safe radii, and minimum entity counts', () => {
        const generated = initializeLevelContent(campaign(21));
        const objective = generated.overworld.objectives[0]!;
        const item = generated.overworld.items[0]!;
        const spawnDistances = getPassageDistances(
            generated.overworld.maze,
            {x: 1, y: 1}
        );
        const adjacentToSpawnKey = [...spawnDistances].find(([, value]) => value === 1)?.[0];
        expect(adjacentToSpawnKey).toBeDefined();
        const [monsterX, monsterY] = adjacentToSpawnKey!.split(',').map(Number);
        const objectiveWall = Object.freeze({
            kind: 'wall' as const,
            materialId: 'stone' as const
        });
        const invalid = {
            ...generated,
            overworld: {
                ...generated.overworld,
                maze: replaceMazeCell(
                    generated.overworld.maze,
                    objective.position,
                    objectiveWall
                ),
                items: [{...item, position: objective.position}, ...generated.overworld.items.slice(1)],
                monsters: [{
                    ...generated.overworld.monsters[0]!,
                    position: {x: monsterX!, y: monsterY!},
                    spawnPosition: {x: monsterX!, y: monsterY!}
                }, ...generated.overworld.monsters.slice(1)],
                traps: []
            }
        };
        const codes = issueCodes(invalid);

        expect(codes).toContain('objective-unreachable');
        expect(codes).toContain('entity-collision');
        expect(codes).toContain('monster-safe-radius');
        expect(codes).toContain('trap-count-minimum');
    });

    it('rejects monster threat/entity and trap-cost overruns', () => {
        const generated = initializeLevelContent(campaign(31));
        const monster = generated.overworld.monsters[0]!;
        const trap = generated.overworld.traps[0]!;
        const overBudget = {
            ...generated,
            overworld: {
                ...generated.overworld,
                monsters: Array.from({length: 30}, (_, index) => ({
                    ...monster,
                    id: `${monster.id}/copy-${index}`
                })),
                traps: Array.from({length: 20}, (_, index) => ({
                    ...trap,
                    id: `${trap.id}/copy-${index}`,
                    typeId: 'flame-jet' as const
                }))
            }
        };
        const codes = issueCodes(overBudget);

        expect(codes).toContain('monster-threat-budget');
        expect(codes).toContain('monster-entity-budget');
        expect(codes).toContain('trap-cost-budget');
    });

    it('requires a reachable safe approach/wait cell for every complex trap', () => {
        const generated = initializeLevelContent(campaign(41, 'level-7'));
        const trap = {
            ...generated.overworld.traps[0]!,
            typeId: 'gas-vent' as const
        };
        let isolatedMaze: MazeGrid = generated.overworld.maze.map(row =>
            row.map(() => Object.freeze({
                kind: 'wall' as const,
                materialId: 'stone' as const
            }))
        );
        isolatedMaze = replaceMazeCell(isolatedMaze, trap.position, PASSAGE_CELL);
        const invalid = {
            ...generated,
            overworld: {
                ...generated.overworld,
                maze: isolatedMaze,
                traps: [trap]
            }
        };

        expect(issueCodes(invalid)).toContain('complex-trap-no-safe-wait');
    });

    it('bounds deterministic salted retries and reports every rejected attempt', () => {
        const original = campaign(51);
        const blockedMaze: MazeGrid = original.overworld.maze.map(row =>
            row.map(() => Object.freeze({
                kind: 'wall' as const,
                materialId: 'stone' as const
            }))
        );
        const blocked = {
            ...original,
            overworld: {...original.overworld, maze: blockedMaze}
        };
        const captureMessage = (): string => {
            try {
                initializeLevelContent(blocked);
                throw new Error('Expected generation to fail.');
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        };
        const firstMessage = captureMessage();

        expect(firstMessage).toContain(
            `after ${LEVEL_CONTENT_GENERATION_ATTEMPT_LIMIT} deterministic attempts`
        );
        expect(firstMessage.match(/attempt \d+ \(salt \d+\)/g)).toHaveLength(
            LEVEL_CONTENT_GENERATION_ATTEMPT_LIMIT
        );
        expect(firstMessage).toContain(
            `attempt ${LEVEL_CONTENT_GENERATION_ATTEMPT_LIMIT - 1}`
        );
        expect(captureMessage()).toBe(firstMessage);

        const salts = Array.from(
            {length: LEVEL_CONTENT_GENERATION_ATTEMPT_LIMIT},
            (_, ordinal) => getLevelContentAttemptSalt(51, ordinal)
        );
        expect(salts[0]).toBe(0);
        expect(new Set(salts).size).toBe(salts.length);
        expect(salts).toEqual(Array.from(
            {length: LEVEL_CONTENT_GENERATION_ATTEMPT_LIMIT},
            (_, ordinal) => getLevelContentAttemptSalt(51, ordinal)
        ));
    });

    it('deterministically accepts a later salted candidate after a fairness rejection', () => {
        const accepted = initializeLevelContentWithDiagnostics(
            campaign(6, 'level-11'),
            'expert'
        );

        expect(accepted.diagnostics.acceptedAttemptOrdinal).toBeGreaterThan(0);
        expect(accepted.diagnostics.acceptedAttemptOrdinal)
            .toBeLessThan(LEVEL_CONTENT_GENERATION_ATTEMPT_LIMIT);
        expect(accepted.diagnostics.rejectedAttempts).toHaveLength(
            accepted.diagnostics.acceptedAttemptOrdinal!
        );
        expect(accepted.state.overworld.objectives.map(objective => objective.objectiveId))
            .toEqual(selectLevelObjectiveIds(accepted.state.overworld.seed, 11));
        expect(validateNativeLevelFairness(accepted.state, 'expert').valid).toBe(true);
        expect(initializeLevelContentWithDiagnostics(
            campaign(6, 'level-11'),
            'expert'
        )).toEqual(accepted);
    });

    it('keeps generated native content within fairness bounds across presets', () => {
        for (const difficulty of ['story', 'standard', 'expert'] as const) {
            for (let seed = 60; seed < 75; seed++) {
                const generated = initializeLevelContent(campaign(seed, 'level-11'), difficulty);
                const validation = validateNativeLevelFairness(generated, difficulty);
                expect(
                    validation.valid,
                    `${difficulty} seed ${seed}: ${validation.issues
                        .map(issue => issue.message)
                        .join('; ')}`
                ).toBe(true);
                expect(validation.usage.monsterThreat)
                    .toBeLessThanOrEqual(validation.budgets.monsterThreat);
                expect(validation.usage.monsterEntities)
                    .toBeLessThanOrEqual(validation.budgets.monsterEntities);
                expect(validation.usage.trapCost)
                    .toBeLessThanOrEqual(validation.budgets.trapCost);
            }
        }
    });
});
