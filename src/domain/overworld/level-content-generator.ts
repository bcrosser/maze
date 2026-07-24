import type {CampaignState} from '../campaign/campaign-state';
import {
    ITEM_AFFIX_IDS,
    ITEM_DEFINITIONS,
    type ItemAffixId,
    type ItemInstance,
    type ItemQuality,
    type ItemTypeId,
    type WorldItemState
} from '../entities/item-types';
import {
    MONSTER_DEFINITIONS,
    type MonsterState,
    type MonsterTypeId,
    type MonsterVariantId
} from '../entities/monster-types';
import {TRAP_DEFINITIONS, type TrapState, type TrapTypeId} from '../entities/trap-types';
import {MATERIALS, type MaterialTag} from '../materials/materials';
import {chooseRandom, Mulberry32Random, shuffle, type RandomSource} from '../random/random-source';
import {deriveSeed} from '../random/seed-derivation';
import {getCampaignLevelNumber} from '../campaign/level-progression';
import type {Coordinate, MazeGrid} from './maze-types';
import {
    getLevelObjectiveSelectionCount,
    isCompatibleLevelObjectiveCount,
    requiresCasinoHeistShop,
    selectLevelObjectiveIds
} from './level-objectives';
import {getPassageDistances, placeLevelObjectives} from './objective-placement';
import {placeLevelServiceSites} from './service-site-placement';

export type OverworldDifficulty = 'story' | 'standard' | 'expert';

export const LEVEL_CONTENT_GENERATION_ATTEMPT_LIMIT = 8;
export const CAR_MAZE_LOOT_CHANCE = 0.04;

export interface NativeLevelContentBudgets {
    readonly lootSlots: number;
    readonly monsterThreat: number;
    readonly monsterEntities: number;
    readonly trapCost: number;
}

export type NativeLevelFairnessIssueCode =
    | 'objective-count'
    | 'objective-unreachable'
    | 'service-site-count'
    | 'exit-unreachable'
    | 'entity-not-on-passage'
    | 'entity-unreachable'
    | 'entity-collision'
    | 'monster-safe-radius'
    | 'trap-safe-radius'
    | 'monster-adjacency'
    | 'monster-count-minimum'
    | 'trap-count-minimum'
    | 'monster-threat-budget'
    | 'monster-entity-budget'
    | 'trap-cost-budget'
    | 'trap-area-overlap'
    | 'complex-trap-no-safe-wait';

export interface NativeLevelFairnessIssue {
    readonly code: NativeLevelFairnessIssueCode;
    readonly message: string;
}

export interface NativeLevelFairnessValidation {
    readonly valid: boolean;
    readonly issues: readonly NativeLevelFairnessIssue[];
    readonly budgets: NativeLevelContentBudgets;
    readonly usage: {
        readonly monsterThreat: number;
        readonly monsterEntities: number;
        readonly trapCost: number;
    };
}

export interface LevelContentAttemptDiagnostic {
    readonly attemptOrdinal: number;
    readonly attemptSalt: number;
    readonly issues: readonly string[];
}

export interface LevelContentGenerationDiagnostics {
    readonly acceptedAttemptOrdinal: number | null;
    readonly acceptedAttemptSalt: number | null;
    readonly rejectedAttempts: readonly LevelContentAttemptDiagnostic[];
}

export interface LevelContentInitializationResult {
    readonly state: CampaignState;
    readonly diagnostics: LevelContentGenerationDiagnostics;
}

const WEAPON_AFFIX_IDS = ITEM_AFFIX_IDS.slice(0, 7);
const UTILITY_AFFIX_IDS = ITEM_AFFIX_IDS.slice(7);
const COMPLEX_TRAP_TYPE_IDS: ReadonlySet<TrapTypeId> = new Set([
    'gas-vent',
    'arc-plate',
    'flame-jet'
]);

const DIRECTIONS = Object.freeze([
    Object.freeze({x: 0, y: -1}),
    Object.freeze({x: 1, y: 0}),
    Object.freeze({x: 0, y: 1}),
    Object.freeze({x: -1, y: 0})
]);

function key(position: Coordinate): string {
    return `${position.x},${position.y}`;
}

function distance(
    distances: ReadonlyMap<string, number>,
    position: Coordinate
): number {
    return distances.get(key(position)) ?? Number.POSITIVE_INFINITY;
}

function passages(maze: MazeGrid): Coordinate[] {
    const result: Coordinate[] = [];
    for (let y = 0; y < maze.length; y++) {
        for (let x = 0; x < (maze[y]?.length ?? 0); x++) {
            if (maze[y]?.[x]?.kind === 'passage') result.push({x, y});
        }
    }
    return result;
}

function adjacentWallTags(maze: MazeGrid, position: Coordinate): ReadonlySet<MaterialTag> {
    const tags = new Set<MaterialTag>();
    for (const direction of DIRECTIONS) {
        const cell = maze[position.y + direction.y]?.[position.x + direction.x];
        if (cell?.kind !== 'wall') continue;
        for (const tag of MATERIALS[cell.materialId].tags) tags.add(tag);
    }
    return tags;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function levelTier(state: CampaignState): number {
    return Math.min(5, Math.floor((getCampaignLevelNumber(state) - 1) / 2));
}

export function getNativeLevelContentBudgets(
    state: CampaignState,
    difficulty: OverworldDifficulty = 'standard'
): NativeLevelContentBudgets {
    const tier = levelTier(state);
    const size = state.overworld.maze.length;
    const baseThreat = clamp(5 + Math.floor((size - 21) / 8) + 2 * tier, 5, 24);
    const difficultyThreat = difficulty === 'story'
        ? Math.floor(baseThreat * 0.75)
        : difficulty === 'expert'
            ? Math.ceil(baseThreat * 1.2)
            : baseThreat;
    const alertThreat = state.worldSystems.securityAlert >= 80
        ? 2
        : state.worldSystems.securityAlert >= 40 ? 1 : 0;
    let trapCost = clamp(2 + Math.floor((size - 21) / 16) + tier, 2, 12);
    if (difficulty === 'story') trapCost = Math.max(1, trapCost - 1);
    if (difficulty === 'expert') trapCost++;
    return {
        lootSlots: clamp(
            6 + Math.floor((size - 21) / 12) + Math.floor(tier / 2),
            6,
            16
        ),
        monsterThreat: Math.min(26, difficultyThreat + alertThreat),
        monsterEntities: clamp(
            5 + Math.floor((size - 21) / 12) + tier,
            5,
            18
        ),
        trapCost
    };
}

export function getLevelContentAttemptSalt(
    levelSeed: number,
    attemptOrdinal: number
): number {
    if (!Number.isSafeInteger(attemptOrdinal) || attemptOrdinal < 0) {
        throw new Error('Level-content attempt ordinal must be a non-negative safe integer.');
    }
    return attemptOrdinal === 0
        ? 0
        : deriveSeed(levelSeed, 'overworld-content-retry', attemptOrdinal);
}

function randomForAttempt(
    levelSeed: number,
    namespace: string,
    attemptSalt: number
): RandomSource {
    return new Mulberry32Random(deriveSeed(levelSeed, namespace, attemptSalt));
}

function passageNeighbors(maze: MazeGrid, position: Coordinate): Coordinate[] {
    return DIRECTIONS
        .map(direction => ({
            x: position.x + direction.x,
            y: position.y + direction.y
        }))
        .filter(candidate => maze[candidate.y]?.[candidate.x]?.kind === 'passage');
}

function qualityForTier(tier: number, random: RandomSource): ItemQuality {
    const weights = [
        [80, 20, 0],
        [70, 27, 3],
        [60, 34, 6],
        [52, 38, 10],
        [45, 40, 15],
        [38, 42, 20]
    ][tier]!;
    const roll = random.next() * 100;
    if (roll < weights[2]!) return 'rare';
    if (roll < weights[2]! + weights[1]!) return 'uncommon';
    return 'common';
}

export function getCompatibleWeaponAffixIds(
    typeId: ItemTypeId
): readonly ItemAffixId[] {
    if (ITEM_DEFINITIONS[typeId].category !== 'weapon') return [];
    return WEAPON_AFFIX_IDS.filter(affixId => {
        if (affixId === 'extended') return typeId === 'spear' || typeId === 'bow';
        if (affixId === 'efficient') return typeId === 'bow';
        return true;
    });
}

function affixesFor(
    typeId: ItemTypeId,
    quality: ItemQuality,
    random: RandomSource
): readonly ItemAffixId[] {
    const category = ITEM_DEFINITIONS[typeId].category;
    if (!['weapon', 'utility'].includes(category) || quality === 'common') return [];
    const source = category === 'weapon'
        ? getCompatibleWeaponAffixIds(typeId)
        : UTILITY_AFFIX_IDS;
    const count = quality === 'rare' ? 2 : 1;
    const chosen: ItemAffixId[] = [];
    for (const affix of shuffle(source, random)) {
        if (chosen.length >= count) break;
        if (
            (affix === 'frost-bound' && chosen.includes('ember-bound')) ||
            (affix === 'ember-bound' && chosen.includes('frost-bound'))
        ) continue;
        chosen.push(affix);
    }
    return chosen;
}

function createGeneratedItem(
    levelId: string,
    index: number,
    typeId: ItemTypeId,
    tier: number,
    random: RandomSource
): ItemInstance {
    const fixedCommon = new Set<ItemTypeId>([
        'antidote',
        'ammo-bundle',
        'bomb',
        'snare-kit',
        'coin',
        'map-scroll',
        'revival-feather'
    ]);
    const quality = typeId === 'car'
        ? 'rare'
        : fixedCommon.has(typeId) ? 'common' : qualityForTier(tier, random);
    const affixIds = affixesFor(typeId, quality, random);
    const baseCharges = (ITEM_DEFINITIONS[typeId] as {
        readonly baseCharges?: number;
    }).baseCharges;
    const durableBonus = affixIds.includes('durable') ? 2 : 0;
    const rolledChoiceIds = typeId === 'mystery-orb'
        ? shuffle(['mend', 'salvage', 'tools', 'guard'] as const, random).slice(0, 3)
        : [];
    return {
        id: `${levelId}/item-${index + 1}`,
        baseTypeId: typeId,
        quality,
        affixIds,
        rolledChoiceIds,
        quantity: 1,
        charges: baseCharges === undefined ? null : Math.min(5, baseCharges + durableBonus)
    };
}

function selectPosition(
    available: Coordinate[],
    random: RandomSource,
    predicate: (position: Coordinate) => boolean,
    requireMatch = false
): Coordinate {
    const matches = available.filter(predicate);
    if (requireMatch && matches.length === 0) {
        throw new Error('Level content could not satisfy a guaranteed placement range.');
    }
    const source = matches.length > 0 ? matches : available;
    if (source.length === 0) throw new Error('Level content exhausted all placement cells.');
    const selected = chooseRandom(source, random);
    available.splice(available.findIndex(position => key(position) === key(selected)), 1);
    return selected;
}

function itemTypesForRemaining(random: RandomSource, tier: number): ItemTypeId {
    const roll = random.next();
    if (roll < CAR_MAZE_LOOT_CHANCE) return 'car';
    if (roll < 0.35) {
        return chooseRandom(['health-potion', 'antidote', 'revival-feather'], random);
    }
    if (roll < 0.60) {
        return chooseRandom(['lantern', 'compass', 'map-scroll', 'multitool', 'shield'], random);
    }
    if (roll < 0.85) {
        return chooseRandom(
            tier >= 1 ? ['sword', 'spear', 'axe', 'bow'] : ['sword', 'spear'],
            random
        );
    }
    return chooseRandom(
        ['mining-pick', 'ammo-bundle', 'bomb', 'snare-kit', 'coin', 'mystery-orb'],
        random
    );
}

function createItems(
    state: CampaignState,
    reserved: ReadonlySet<string>,
    tier: number,
    attemptSalt: number
): readonly WorldItemState[] {
    const {maze, seed, levelId} = state.overworld;
    const placementRandom = randomForAttempt(seed, 'overworld-item-placement', attemptSalt);
    const typeRandom = randomForAttempt(seed, 'overworld-item-types', attemptSalt);
    const affixRandom = randomForAttempt(seed, 'overworld-item-affixes', attemptSalt);
    const spawnDistances = getPassageDistances(maze, {x: 1, y: 1});
    const available = shuffle(passages(maze).filter(position => !reserved.has(key(position))), placementRandom);
    const slots = getNativeLevelContentBudgets(state).lootSlots;
    const guaranteed: {typeId: ItemTypeId; minimum: number; maximum: number}[] = [
        {
            typeId: tier >= 1 && typeRandom.next() < 0.5
                ? chooseRandom(['axe', 'bow'], typeRandom)
                : chooseRandom(['sword', 'spear'], typeRandom),
            minimum: 6,
            maximum: 12
        },
        {typeId: 'health-potion', minimum: 4, maximum: 10},
        {typeId: 'mining-pick', minimum: 8, maximum: 18},
        {
            typeId: chooseRandom(['lantern', 'compass', 'multitool', 'shield'], typeRandom),
            minimum: 5,
            maximum: 20
        }
    ];
    const types = [
        ...guaranteed.map(entry => entry.typeId),
        'health-potion' as const,
        ...Array.from({length: Math.max(0, slots - guaranteed.length - 1)}, () =>
            itemTypesForRemaining(typeRandom, tier)
        )
    ];

    return types.map((typeId, index) => {
        const range = guaranteed[index];
        const position = selectPosition(available, placementRandom, candidate => {
            const candidateDistance = distance(spawnDistances, candidate);
            if (range) return candidateDistance >= range.minimum && candidateDistance <= range.maximum;
            return candidateDistance >= Math.floor(Math.max(...spawnDistances.values()) / 2);
        }, range !== undefined);
        return {
            instance: createGeneratedItem(levelId, index, typeId, tier, affixRandom),
            position
        };
    });
}

function monsterPool(tier: number): readonly MonsterTypeId[] {
    if (tier <= 0) return ['moss-slime', 'ember-hound'];
    if (tier === 1) return ['moss-slime', 'ember-hound', 'floating-eye'];
    if (tier === 2) return ['moss-slime', 'ember-hound', 'floating-eye', 'cave-bat', 'mimic'];
    return ['moss-slime', 'ember-hound', 'floating-eye', 'cave-bat', 'mimic', 'stone-golem'];
}

function variantFor(typeId: MonsterTypeId, random: RandomSource): MonsterVariantId {
    const variants: MonsterVariantId[] = [
        'armored',
        'swift',
        'venomous',
        'ember-touched',
        'volatile',
        'regenerating'
    ];
    return chooseRandom(variants.filter(variant =>
        !(variant === 'armored' && typeId === 'stone-golem') &&
        !(variant === 'swift' && typeId === 'cave-bat')
    ), random);
}

function createMonsterDrop(
    levelId: string,
    monsterIndex: number,
    random: RandomSource,
    tier: number,
    minimumUncommon: boolean
): ItemInstance | null {
    if (!minimumUncommon && random.next() >= 0.38) return null;
    const typeId = chooseRandom<ItemTypeId>(
        ['health-potion', 'coin', 'ammo-bundle', 'antidote', 'bomb'],
        random
    );
    const item = createGeneratedItem(levelId, 10_000 + monsterIndex, typeId, tier, random);
    return minimumUncommon && ITEM_DEFINITIONS[typeId].category !== 'consumable'
        ? {...item, quality: 'uncommon'}
        : item;
}

function createMonsters(
    state: CampaignState,
    reserved: ReadonlySet<string>,
    tier: number,
    difficulty: OverworldDifficulty,
    attemptSalt: number
): readonly MonsterState[] {
    const {maze, seed, levelId, objectives, serviceSites} = state.overworld;
    const placementRandom = randomForAttempt(seed, 'overworld-monster-placement', attemptSalt);
    const typeRandom = randomForAttempt(seed, 'overworld-monster-types', attemptSalt);
    const variantRandom = randomForAttempt(seed, 'overworld-monster-variants', attemptSalt);
    const dropRandom = randomForAttempt(seed, 'monster-loot', attemptSalt);
    const spawnDistances = getPassageDistances(maze, {x: 1, y: 1});
    const objectiveDistances = objectives.map(objective =>
        getPassageDistances(maze, objective.position)
    );
    const serviceDistances = serviceSites.map(site =>
        getPassageDistances(maze, site.position)
    );
    const exitDistances = getPassageDistances(maze, {x: maze.length - 2, y: maze.length - 2});
    const candidates = shuffle(passages(maze).filter(position =>
        !reserved.has(key(position)) &&
        distance(spawnDistances, position) > 6 &&
        distance(exitDistances, position) > 2 &&
        objectiveDistances.every(map => distance(map, position) > 2) &&
        serviceDistances.every(map => distance(map, position) > 2)
    ), placementRandom);

    const budgets = getNativeLevelContentBudgets(state, difficulty);
    const threatBudget = budgets.monsterThreat;
    const entityCap = budgets.monsterEntities;
    const variantChance = [0, 0.1, 0.2, 0.3, 0.4, 0.5][tier]!;
    const eliteCap = tier < 3 ? 0 : tier < 5 ? 1 : 2;
    const monsters: MonsterState[] = [];
    let spent = 0;
    let elites = 0;
    for (const position of candidates) {
        if (monsters.length >= entityCap || spent >= threatBudget) break;
        if (monsters.some(monster =>
            Math.abs(monster.position.x - position.x) + Math.abs(monster.position.y - position.y) <= 1
        )) continue;
        const pool = monsterPool(tier);
        const typeId = monsters.length < 2
            ? (monsters.length === 0 ? 'moss-slime' : 'ember-hound')
            : chooseRandom(pool, typeRandom);
        const definition = MONSTER_DEFINITIONS[typeId];
        const elite = elites < eliteCap && variantRandom.next() < 0.08;
        const variantCount = elite ? 2 : variantRandom.next() < variantChance ? 1 : 0;
        const variantIds: MonsterVariantId[] = [];
        while (variantIds.length < variantCount) {
            const variant = variantFor(typeId, variantRandom);
            if (!variantIds.includes(variant)) variantIds.push(variant);
        }
        const threat = definition.threat + variantIds.length + (elite ? 2 : 0);
        if (spent + threat > threatBudget) continue;
        if (elite) elites++;
        spent += threat;
        const armored = variantIds.includes('armored');
        const swift = variantIds.includes('swift');
        const maxHealth = definition.maxHealth + (armored ? 2 : 0) + (elite ? 2 : 0) - (swift ? 1 : 0);
        monsters.push({
            id: `${levelId}/monster-${monsters.length + 1}`,
            typeId,
            variantIds,
            elite,
            position,
            spawnPosition: position,
            health: Math.max(1, maxHealth),
            maxHealth: Math.max(1, maxHealth),
            armor: definition.armor + (armored ? 1 : 0),
            actionCount: 0,
            nextMoveTurn: definition.moveEveryTurns + (armored ? 1 : 0) - (swift ? 1 : 0),
            nextAttackTurn: 0,
            revealed: typeId !== 'mimic',
            intent: null,
            statuses: [],
            undamagedTurns: 0,
            drop: createMonsterDrop(levelId, monsters.length, dropRandom, tier, elite)
        });
    }
    return monsters;
}

function trapTypeFor(tags: ReadonlySet<MaterialTag>, random: RandomSource, tier: number): TrapTypeId {
    const candidates: TrapTypeId[] = ['spike-plate', 'snare'];
    if (tier >= 2 && tags.has('poisonous')) candidates.push('gas-vent');
    if (tier >= 3 && (tags.has('wet') || tags.has('conductive'))) candidates.push('arc-plate');
    if (tier >= 3 && (tags.has('hot') || tags.has('flammable'))) candidates.push('flame-jet');
    return chooseRandom(candidates, random);
}

function createTraps(
    state: CampaignState,
    reserved: ReadonlySet<string>,
    tier: number,
    difficulty: OverworldDifficulty,
    attemptSalt: number
): readonly TrapState[] {
    const {maze, seed, levelId, objectives, serviceSites} = state.overworld;
    const random = randomForAttempt(seed, 'overworld-traps', attemptSalt);
    const spawnDistances = getPassageDistances(maze, {x: 1, y: 1});
    const exitDistances = getPassageDistances(maze, {x: maze.length - 2, y: maze.length - 2});
    const objectiveDistances = objectives.map(objective =>
        getPassageDistances(maze, objective.position)
    );
    const serviceDistances = serviceSites.map(site =>
        getPassageDistances(maze, site.position)
    );
    const budget = getNativeLevelContentBudgets(state, difficulty).trapCost;
    const traps: TrapState[] = [];
    let spent = 0;
    for (const position of shuffle(passages(maze), random)) {
        if (spent >= budget) break;
        if (
            reserved.has(key(position)) ||
            distance(spawnDistances, position) <= 6 ||
            distance(exitDistances, position) <= 2 ||
            objectiveDistances.some(map => distance(map, position) <= 2) ||
            serviceDistances.some(map => distance(map, position) <= 2) ||
            traps.some(trap =>
                Math.abs(trap.position.x - position.x) + Math.abs(trap.position.y - position.y) <= 1
            )
        ) continue;
        const typeId = trapTypeFor(adjacentWallTags(maze, position), random, tier);
        const cost = TRAP_DEFINITIONS[typeId].cost;
        if (spent + cost > budget) continue;
        traps.push({
            id: `${levelId}/trap-${traps.length + 1}`,
            typeId,
            position,
            owner: 'world',
            revealed: false,
            disabled: false,
            phase: 0,
            nextPhaseTurn: typeId === 'spike-plate' || typeId === 'snare' ? 0 : 4
        });
        spent += cost;
    }
    return traps;
}

export function getGeneratedTrapTargetPositions(
    state: CampaignState,
    trap: TrapState
): readonly Coordinate[] {
    if (trap.typeId === 'gas-vent') {
        return [trap.position, ...passageNeighbors(state.overworld.maze, trap.position)];
    }
    if (trap.typeId !== 'arc-plate' && trap.typeId !== 'flame-jet') {
        return [trap.position];
    }
    const lines = DIRECTIONS.map(direction => {
        const targets: Coordinate[] = [trap.position];
        let position = trap.position;
        for (let step = 0; step < 3; step++) {
            position = {
                x: position.x + direction.x,
                y: position.y + direction.y
            };
            if (state.overworld.maze[position.y]?.[position.x]?.kind !== 'passage') break;
            targets.push(position);
        }
        return targets;
    });
    const longest = Math.max(...lines.map(line => line.length));
    const candidates = lines.filter(line => line.length === longest);
    return candidates[deriveSeed(state.overworld.seed, trap.id) % candidates.length]!;
}

function monsterThreat(monster: MonsterState): number {
    return MONSTER_DEFINITIONS[monster.typeId].threat +
        monster.variantIds.length +
        (monster.elite ? 2 : 0);
}

function addIssue(
    issues: NativeLevelFairnessIssue[],
    code: NativeLevelFairnessIssueCode,
    message: string
): void {
    issues.push({code, message});
}

interface FairnessEntity {
    readonly label: string;
    readonly position: Coordinate;
}

interface SafeZone {
    readonly label: string;
    readonly position: Coordinate;
    readonly radius: number;
    readonly distances: ReadonlyMap<string, number>;
}

function safeZones(state: CampaignState): readonly SafeZone[] {
    const {maze, objectives, sanctuaryPosition, serviceSites} = state.overworld;
    const candidates = [
        {label: 'spawn', position: {x: 1, y: 1}, radius: 6},
        {
            label: 'exit',
            position: {x: maze.length - 2, y: maze.length - 2},
            radius: 2
        },
        {label: 'sanctuary', position: sanctuaryPosition, radius: 2},
        ...objectives.map(objective => ({
            label: `${objective.objectiveId} objective`,
            position: objective.position,
            radius: 2
        })),
        ...serviceSites.map(site => ({
            label: `${site.kind} service`,
            position: site.position,
            radius: 2
        }))
    ];
    const merged = new Map<string, {
        label: string;
        position: Coordinate;
        radius: number;
    }>();
    for (const candidate of candidates) {
        const existing = merged.get(key(candidate.position));
        if (!existing || existing.radius < candidate.radius) {
            merged.set(key(candidate.position), candidate);
        }
    }
    return [...merged.values()].map(zone => ({
        ...zone,
        distances: getPassageDistances(maze, zone.position)
    }));
}

function fairnessEntities(state: CampaignState): readonly FairnessEntity[] {
    return [
        ...state.overworld.objectives.map(objective => ({
            label: `objective ${objective.objectiveId}`,
            position: objective.position
        })),
        ...state.overworld.serviceSites.map(site => ({
            label: `service ${site.id}`,
            position: site.position
        })),
        ...state.overworld.items.map(item => ({
            label: `item ${item.instance.id}`,
            position: item.position
        })),
        ...state.overworld.traps.map(trap => ({
            label: `trap ${trap.id}`,
            position: trap.position
        })),
        ...state.overworld.monsters.map(monster => ({
            label: `monster ${monster.id}`,
            position: monster.position
        }))
    ];
}

function validateReachabilityAndCollisions(
    state: CampaignState,
    issues: NativeLevelFairnessIssue[]
): void {
    const {maze, objectives, sanctuaryPosition} = state.overworld;
    const spawn = {x: 1, y: 1};
    const exit = {x: maze.length - 2, y: maze.length - 2};
    const reachable = getPassageDistances(maze, spawn);
    if (!reachable.has(key(exit))) {
        addIssue(issues, 'exit-unreachable', `Exit ${key(exit)} is not reachable from spawn.`);
    }
    const levelNumber = getCampaignLevelNumber(state);
    const uniqueObjectiveCount = new Set(
        objectives.map(objective => objective.objectiveId)
    ).size;
    if (
        !isCompatibleLevelObjectiveCount(levelNumber, objectives.length) ||
        uniqueObjectiveCount !== objectives.length
    ) {
        addIssue(
            issues,
            'objective-count',
            `Expected ${getLevelObjectiveSelectionCount(levelNumber)} distinct objectives ` +
            `(or a compatible persisted 4/5/6-game roster); found ${objectives.length}.`
        );
    }
    for (const objective of objectives) {
        if (!reachable.has(key(objective.position))) {
            addIssue(
                issues,
                'objective-unreachable',
                `${objective.objectiveId} objective ${key(objective.position)} is not reachable from spawn.`
            );
        }
    }
    for (const kind of ['blackjack', 'holdem'] as const) {
        const count = state.overworld.serviceSites.filter(site => site.kind === kind).length;
        if (count !== 1) {
            addIssue(
                issues,
                'service-site-count',
                `Expected exactly one ${kind} service; found ${count}.`
            );
        }
    }
    const shopCount = state.overworld.serviceSites.filter(site => site.kind === 'shop').length;
    const requiredShopCount = requiresCasinoHeistShop(state.flags, objectives) ? 1 : 0;
    if (shopCount > 1 || shopCount < requiredShopCount) {
        addIssue(
            issues,
            'service-site-count',
            requiredShopCount === 1
                ? `Locked Casino Heist requires exactly one shop service; found ${shopCount}.`
                : `Expected at most one shop service; found ${shopCount}.`
        );
    }

    const occupied = new Map<string, string>();
    const reserveProtected = (position: Coordinate, label: string): void => {
        const positionKey = key(position);
        if (!occupied.has(positionKey)) occupied.set(positionKey, label);
    };
    reserveProtected(spawn, 'spawn');
    reserveProtected(exit, 'exit');
    reserveProtected(sanctuaryPosition, 'sanctuary');

    for (const entity of fairnessEntities(state)) {
        const positionKey = key(entity.position);
        if (maze[entity.position.y]?.[entity.position.x]?.kind !== 'passage') {
            addIssue(
                issues,
                'entity-not-on-passage',
                `${entity.label} is not on a passage at ${positionKey}.`
            );
        } else if (!reachable.has(positionKey)) {
            addIssue(
                issues,
                'entity-unreachable',
                `${entity.label} is not reachable from spawn at ${positionKey}.`
            );
        }
        const conflict = occupied.get(positionKey);
        if (conflict) {
            addIssue(
                issues,
                'entity-collision',
                `${entity.label} overlaps ${conflict} at ${positionKey}.`
            );
        } else {
            occupied.set(positionKey, entity.label);
        }
    }
}

function validateSafeRadii(
    state: CampaignState,
    issues: NativeLevelFairnessIssue[]
): void {
    const zones = safeZones(state);
    for (const monster of state.overworld.monsters) {
        for (const zone of zones) {
            const graphDistance = zone.distances.get(key(monster.position));
            if (graphDistance !== undefined && graphDistance <= zone.radius) {
                addIssue(
                    issues,
                    'monster-safe-radius',
                    `${monster.id} is ${graphDistance} steps from ${zone.label}; minimum is ${zone.radius + 1}.`
                );
                break;
            }
        }
    }
    for (const trap of state.overworld.traps) {
        for (const zone of zones) {
            const graphDistance = zone.distances.get(key(trap.position));
            if (graphDistance !== undefined && graphDistance <= zone.radius) {
                addIssue(
                    issues,
                    'trap-safe-radius',
                    `${trap.id} is ${graphDistance} steps from ${zone.label}; minimum is ${zone.radius + 1}.`
                );
                break;
            }
        }
    }
}

function validateMonsterSpacing(
    state: CampaignState,
    issues: NativeLevelFairnessIssue[]
): void {
    const monsters = state.overworld.monsters;
    for (let leftIndex = 0; leftIndex < monsters.length; leftIndex++) {
        const left = monsters[leftIndex]!;
        for (let rightIndex = leftIndex + 1; rightIndex < monsters.length; rightIndex++) {
            const right = monsters[rightIndex]!;
            const manhattan = Math.abs(left.position.x - right.position.x) +
                Math.abs(left.position.y - right.position.y);
            if (manhattan <= 1) {
                addIssue(
                    issues,
                    'monster-adjacency',
                    `${left.id} and ${right.id} begin ${manhattan} cells apart.`
                );
            }
        }
    }
}

function validateTrapGeometry(
    state: CampaignState,
    issues: NativeLevelFairnessIssue[]
): void {
    const trapsWithAreas = state.overworld.traps
        .filter(trap => trap.typeId !== 'snare')
        .map(trap => {
            const targets = getGeneratedTrapTargetPositions(state, trap);
            return {trap, targets, targetKeys: new Set(targets.map(key))};
        });
    const unsafeKeys = new Set(trapsWithAreas.flatMap(entry => [...entry.targetKeys]));
    const monsterKeys = new Set(state.overworld.monsters.map(monster => key(monster.position)));
    const trapKeys = new Set(state.overworld.traps.map(trap => key(trap.position)));
    const zones = safeZones(state);

    for (let leftIndex = 0; leftIndex < trapsWithAreas.length; leftIndex++) {
        const left = trapsWithAreas[leftIndex]!;
        for (let rightIndex = leftIndex + 1; rightIndex < trapsWithAreas.length; rightIndex++) {
            const right = trapsWithAreas[rightIndex]!;
            if ([...left.targetKeys].some(targetKey => right.targetKeys.has(targetKey))) {
                addIssue(
                    issues,
                    'trap-area-overlap',
                    `${left.trap.id} and ${right.trap.id} have overlapping initial marked areas.`
                );
            }
        }
        const monsterTarget = left.targets.find(target => monsterKeys.has(key(target)));
        if (monsterTarget) {
            addIssue(
                issues,
                'trap-area-overlap',
                `${left.trap.id} initially marks monster cell ${key(monsterTarget)}.`
            );
        }
        for (const target of left.targets) {
            for (const zone of zones) {
                const graphDistance = zone.distances.get(key(target));
                if (graphDistance !== undefined && graphDistance <= zone.radius) {
                    addIssue(
                        issues,
                        'trap-safe-radius',
                        `${left.trap.id} marks a cell ${graphDistance} steps from ${zone.label}.`
                    );
                    break;
                }
            }
        }
    }

    const reachableWithoutHazards = getPassageDistances(
        state.overworld.maze,
        {x: 1, y: 1},
        unsafeKeys
    );
    for (const entry of trapsWithAreas) {
        if (!COMPLEX_TRAP_TYPE_IDS.has(entry.trap.typeId)) continue;
        const hasSafeWaitCell = entry.targets.some(target =>
            passageNeighbors(state.overworld.maze, target).some(candidate => {
                const candidateKey = key(candidate);
                return !unsafeKeys.has(candidateKey) &&
                    !monsterKeys.has(candidateKey) &&
                    !trapKeys.has(candidateKey) &&
                    reachableWithoutHazards.has(candidateKey);
            })
        );
        if (!hasSafeWaitCell) {
            addIssue(
                issues,
                'complex-trap-no-safe-wait',
                `${entry.trap.id} has no reachable approach/wait cell outside marked areas.`
            );
        }
    }
}

export function validateNativeLevelFairness(
    state: CampaignState,
    difficulty: OverworldDifficulty = 'standard'
): NativeLevelFairnessValidation {
    const issues: NativeLevelFairnessIssue[] = [];
    const budgets = getNativeLevelContentBudgets(state, difficulty);
    const usage = {
        monsterThreat: state.overworld.monsters.reduce(
            (total, monster) => total + monsterThreat(monster),
            0
        ),
        monsterEntities: state.overworld.monsters.length,
        trapCost: state.overworld.traps.reduce(
            (total, trap) => total + TRAP_DEFINITIONS[trap.typeId].cost,
            0
        )
    };

    validateReachabilityAndCollisions(state, issues);
    validateSafeRadii(state, issues);
    validateMonsterSpacing(state, issues);
    validateTrapGeometry(state, issues);

    if (usage.monsterEntities < 2) {
        addIssue(
            issues,
            'monster-count-minimum',
            `Native levels require at least 2 monsters; found ${usage.monsterEntities}.`
        );
    }
    if (state.overworld.traps.length < 1) {
        addIssue(issues, 'trap-count-minimum', 'Native levels require at least 1 trap.');
    }
    if (usage.monsterThreat > budgets.monsterThreat) {
        addIssue(
            issues,
            'monster-threat-budget',
            `Monster threat ${usage.monsterThreat} exceeds budget ${budgets.monsterThreat}.`
        );
    }
    if (usage.monsterEntities > budgets.monsterEntities) {
        addIssue(
            issues,
            'monster-entity-budget',
            `Monster count ${usage.monsterEntities} exceeds cap ${budgets.monsterEntities}.`
        );
    }
    if (usage.trapCost > budgets.trapCost) {
        addIssue(
            issues,
            'trap-cost-budget',
            `Trap cost ${usage.trapCost} exceeds budget ${budgets.trapCost}.`
        );
    }

    return {
        valid: issues.length === 0,
        issues,
        budgets,
        usage
    };
}

function createNativeLevelContentCandidate(
    state: CampaignState,
    difficulty: OverworldDifficulty,
    attemptSalt: number
): CampaignState {
    const placement = placeLevelObjectives(
        state.overworld.maze,
        randomForAttempt(state.overworld.seed, 'objective-placement', attemptSalt),
        [],
        selectLevelObjectiveIds(
            state.overworld.seed,
            getCampaignLevelNumber(state)
        )
    );
    const serviceSites = placeLevelServiceSites(
        state.overworld.maze,
        state.overworld.levelId,
        placement.objectives,
        new Mulberry32Random(deriveSeed(state.overworld.seed, 'service-site-placement')),
        {forceShop: requiresCasinoHeistShop(state.flags, placement.objectives)}
    );
    let candidate: CampaignState = {
        ...state,
        overworld: {
            ...state.overworld,
            objectives: placement.objectives,
            serviceSites,
            pipeShortcutWall: placement.pipeShortcutWall,
            sanctuaryPosition: {x: 1, y: 1}
        }
    };
    const tier = levelTier(state);
    const reserved = new Set<string>([
        '1,1',
        `${state.overworld.maze.length - 2},${state.overworld.maze.length - 2}`,
        ...placement.objectives.map(objective => key(objective.position)),
        ...serviceSites.map(site => key(site.position))
    ]);
    const items = createItems(candidate, reserved, tier, attemptSalt);
    for (const item of items) reserved.add(key(item.position));
    const traps = createTraps(candidate, reserved, tier, difficulty, attemptSalt);
    for (const trap of traps) reserved.add(key(trap.position));
    const monsters = createMonsters(candidate, reserved, tier, difficulty, attemptSalt);
    candidate = {
        ...candidate,
        overworld: {
            ...candidate.overworld,
            items,
            traps,
            monsters
        }
    };
    return candidate;
}

function describeGenerationError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function describeRejectedAttempt(attempt: LevelContentAttemptDiagnostic): string {
    return `attempt ${attempt.attemptOrdinal} (salt ${attempt.attemptSalt}): ` +
        attempt.issues.join('; ');
}

export function initializeLevelContentWithDiagnostics(
    state: CampaignState,
    difficulty: OverworldDifficulty = 'standard'
): LevelContentInitializationResult {
    if (state.overworld.levelContentInitialized) {
        const forceShop = requiresCasinoHeistShop(
            state.flags,
            state.overworld.objectives
        );
        const missingRequiredShop = forceShop &&
            !state.overworld.serviceSites.some(site => site.kind === 'shop');
        if (
            (state.overworld.serviceSites.length === 0 || missingRequiredShop) &&
            isCompatibleLevelObjectiveCount(
                getCampaignLevelNumber(state),
                state.overworld.objectives.length
            )
        ) {
            return {
                state: {
                    ...state,
                    overworld: {
                        ...state.overworld,
                        serviceSites: placeLevelServiceSites(
                            state.overworld.maze,
                            state.overworld.levelId,
                            state.overworld.objectives,
                            new Mulberry32Random(deriveSeed(
                                state.overworld.seed,
                                'service-site-placement'
                            )),
                            {forceShop}
                        )
                    }
                },
                diagnostics: {
                    acceptedAttemptOrdinal: null,
                    acceptedAttemptSalt: null,
                    rejectedAttempts: []
                }
            };
        }
        return {
            state,
            diagnostics: {
                acceptedAttemptOrdinal: null,
                acceptedAttemptSalt: null,
                rejectedAttempts: []
            }
        };
    }
    if (
        state.overworld.items.length > 0 ||
        state.overworld.monsters.length > 0 ||
        state.overworld.traps.length > 0 ||
        state.overworld.objectives.length > 0 ||
        state.overworld.serviceSites.length > 0
    ) {
        throw new Error('Uninitialized level content must be empty.');
    }

    const rejectedAttempts: LevelContentAttemptDiagnostic[] = [];
    for (
        let attemptOrdinal = 0;
        attemptOrdinal < LEVEL_CONTENT_GENERATION_ATTEMPT_LIMIT;
        attemptOrdinal++
    ) {
        const attemptSalt = getLevelContentAttemptSalt(
            state.overworld.seed,
            attemptOrdinal
        );
        try {
            const candidate = createNativeLevelContentCandidate(
                state,
                difficulty,
                attemptSalt
            );
            const validation = validateNativeLevelFairness(candidate, difficulty);
            if (validation.valid) {
                return {
                    state: {
                        ...candidate,
                        overworld: {
                            ...candidate.overworld,
                            levelContentInitialized: true
                        }
                    },
                    diagnostics: {
                        acceptedAttemptOrdinal: attemptOrdinal,
                        acceptedAttemptSalt: attemptSalt,
                        rejectedAttempts
                    }
                };
            }
            rejectedAttempts.push({
                attemptOrdinal,
                attemptSalt,
                issues: validation.issues.map(issue => `${issue.code}: ${issue.message}`)
            });
        } catch (error) {
            rejectedAttempts.push({
                attemptOrdinal,
                attemptSalt,
                issues: [`generation-error: ${describeGenerationError(error)}`]
            });
        }
    }
    throw new Error(
        `Unable to generate fair native level content for ${state.overworld.levelId} after ` +
        `${LEVEL_CONTENT_GENERATION_ATTEMPT_LIMIT} deterministic attempts. ` +
        rejectedAttempts.map(describeRejectedAttempt).join(' | ')
    );
}

export function initializeLevelContent(
    state: CampaignState,
    difficulty: OverworldDifficulty = 'standard'
): CampaignState {
    return initializeLevelContentWithDiagnostics(state, difficulty).state;
}
