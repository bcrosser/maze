import type {CampaignState} from '../campaign/campaign-state';
import {getLevelTier} from '../campaign/level-progression';
import {createItemInstance, type ItemInstance, type ItemTypeId} from '../entities/item-types';
import {
    MONSTER_DEFINITIONS,
    type MonsterState,
    type MonsterTypeId,
    type MonsterVariantId
} from '../entities/monster-types';
import {chooseRandom, Mulberry32Random, shuffle, type RandomSource} from '../random/random-source';
import {deriveSeed} from '../random/seed-derivation';
import type {Coordinate} from './maze-types';
import {getPassageDistances} from './objective-placement';
import {getReinforcementDelayMs} from './reinforcement-schedule';

export const REINFORCEMENT_MONSTER_CAP = 8;
export const REINFORCEMENT_PLAYER_SAFE_DISTANCE = 7;
export const REINFORCEMENT_LANDMARK_SAFE_DISTANCE = 2;

export interface ReinforcementAdvanceResult {
    readonly state: CampaignState;
    readonly spawnedMonsters: readonly MonsterState[];
    readonly spawnPending: boolean;
}

const REINFORCEMENT_DROP_TYPE_IDS = [
    'health-potion',
    'coin',
    'coin',
    'ammo-bundle',
    'antidote',
    'bomb'
] as const satisfies readonly ItemTypeId[];

function key(position: Coordinate): string {
    return `${position.x},${position.y}`;
}

function passages(state: CampaignState): Coordinate[] {
    return state.overworld.maze.flatMap((row, y) =>
        row.flatMap((cell, x) => cell.kind === 'passage' ? [{x, y}] : [])
    );
}

function monsterPool(tier: number): readonly MonsterTypeId[] {
    if (tier <= 0) return ['moss-slime', 'ember-hound'];
    if (tier === 1) return ['moss-slime', 'ember-hound', 'floating-eye'];
    if (tier === 2) {
        return ['moss-slime', 'ember-hound', 'floating-eye', 'cave-bat', 'mimic'];
    }
    return ['moss-slime', 'ember-hound', 'floating-eye', 'cave-bat', 'mimic', 'stone-golem'];
}

function variantFor(
    typeId: MonsterTypeId,
    random: RandomSource
): MonsterVariantId {
    const compatible: MonsterVariantId[] = [
        'armored',
        'swift',
        'venomous',
        'ember-touched',
        'volatile',
        'regenerating'
    ].filter(variant =>
        !(variant === 'armored' && typeId === 'stone-golem') &&
        !(variant === 'swift' && typeId === 'cave-bat')
    ) as MonsterVariantId[];
    return chooseRandom(compatible, random);
}

function createDrop(
    monsterId: string,
    random: RandomSource
): ItemInstance | null {
    if (random.next() >= 0.42) return null;
    return createItemInstance(
        `${monsterId}/drop`,
        chooseRandom(REINFORCEMENT_DROP_TYPE_IDS, random)
    );
}

function reservedPositionKeys(state: CampaignState): ReadonlySet<string> {
    return new Set([
        key(state.overworld.playerPosition),
        ...state.overworld.items.map(item => key(item.position)),
        ...state.overworld.monsters.map(monster => key(monster.position)),
        ...state.overworld.traps.map(trap => key(trap.position)),
        ...state.overworld.objectives.map(objective => key(objective.position)),
        ...state.overworld.serviceSites.map(site => key(site.position)),
        ...state.overworld.pendingHazards.flatMap(hazard =>
            [hazard.origin, ...hazard.targetPositions].map(key)
        )
    ]);
}

function reinforcementPosition(
    state: CampaignState,
    reinforcementOrdinal: number
): Coordinate | null {
    const {maze, playerPosition, objectives, serviceSites, sanctuaryPosition} = state.overworld;
    const playerDistances = getPassageDistances(maze, playerPosition);
    const exit = {x: maze.length - 2, y: maze.length - 2};
    const protectedLandmarks = [
        exit,
        sanctuaryPosition,
        ...objectives.map(objective => objective.position),
        ...serviceSites.map(site => site.position)
    ];
    const landmarkDistances = protectedLandmarks.map(position =>
        getPassageDistances(maze, position)
    );
    const reserved = reservedPositionKeys(state);
    const candidates = passages(state).filter(position => {
        const positionKey = key(position);
        const distanceFromPlayer = playerDistances.get(positionKey);
        if (
            distanceFromPlayer === undefined ||
            distanceFromPlayer < REINFORCEMENT_PLAYER_SAFE_DISTANCE ||
            reserved.has(positionKey)
        ) return false;
        if (landmarkDistances.some(distances =>
            (distances.get(positionKey) ?? Number.POSITIVE_INFINITY) <=
                REINFORCEMENT_LANDMARK_SAFE_DISTANCE
        )) return false;
        return state.overworld.monsters.every(monster =>
            Math.abs(monster.position.x - position.x) +
                Math.abs(monster.position.y - position.y) > 1
        );
    }).sort((left, right) => left.y - right.y || left.x - right.x);

    if (candidates.length === 0) return null;
    return shuffle(
        candidates,
        new Mulberry32Random(deriveSeed(
            state.overworld.seed,
            'overworld-reinforcement-placement',
            reinforcementOrdinal
        ))
    )[0] ?? null;
}

/**
 * Deterministically rolls and fairly places one reinforcement for the supplied
 * persisted ordinal. It does not mutate or insert into the campaign.
 */
export function createReinforcementMonster(
    state: CampaignState,
    reinforcementOrdinal = state.overworld.reinforcementOrdinal
): MonsterState | null {
    if (!state.overworld.levelContentInitialized) return null;
    const position = reinforcementPosition(state, reinforcementOrdinal);
    if (!position) return null;

    const {seed, levelId, turn} = state.overworld;
    const tier = getLevelTier(state);
    const typeRandom = new Mulberry32Random(deriveSeed(
        seed,
        'overworld-reinforcement-type',
        reinforcementOrdinal
    ));
    const featureRandom = new Mulberry32Random(deriveSeed(
        seed,
        'overworld-reinforcement-features',
        reinforcementOrdinal
    ));
    const dropRandom = new Mulberry32Random(deriveSeed(
        seed,
        'overworld-reinforcement-drop',
        reinforcementOrdinal
    ));
    const typeId = chooseRandom(monsterPool(tier), typeRandom);
    const definition = MONSTER_DEFINITIONS[typeId];
    const elite = tier >= 3 && featureRandom.next() < 0.06;
    const variantChance = [0.08, 0.14, 0.22, 0.32, 0.42, 0.5][tier]!;
    const variantCount = elite ? 2 : featureRandom.next() < variantChance ? 1 : 0;
    const variantIds: MonsterVariantId[] = [];
    while (variantIds.length < variantCount) {
        const variant = variantFor(typeId, featureRandom);
        if (!variantIds.includes(variant)) variantIds.push(variant);
    }
    const armored = variantIds.includes('armored');
    const swift = variantIds.includes('swift');
    const maxHealth = Math.max(
        1,
        definition.maxHealth + (armored ? 2 : 0) + (elite ? 2 : 0) - (swift ? 1 : 0)
    );
    const id = `${levelId}/reinforcement-${reinforcementOrdinal + 1}`;

    return {
        id,
        typeId,
        variantIds,
        elite,
        position,
        spawnPosition: position,
        health: maxHealth,
        maxHealth,
        armor: definition.armor + (armored ? 1 : 0),
        actionCount: 0,
        nextMoveTurn: turn + Math.max(
            1,
            definition.moveEveryTurns + (armored ? 1 : 0) - (swift ? 1 : 0)
        ),
        nextAttackTurn: turn + definition.attackCooldownTurns,
        revealed: typeId !== 'mimic',
        intent: null,
        statuses: [],
        undamagedTurns: 0,
        drop: createDrop(id, dropRandom)
    };
}

export function getReinforcementMonsterCap(_state: CampaignState): number {
    return REINFORCEMENT_MONSTER_CAP;
}

function reinforcementClockCanAdvance(state: CampaignState): boolean {
    return state.overworld.levelContentInitialized &&
        state.activeEncounter === null &&
        state.pendingLevelReward === null &&
        state.overworld.pendingDefeatChoice === null &&
        state.player.health > 0;
}

/**
 * Advances only the active overworld time supplied by the caller. The caller
 * should not include paused, hidden, casino, or encounter time.
 *
 * A due spawn remains at zero while the entity cap is full or no fair cell is
 * currently available, so defeating or moving away from a monster immediately
 * gives the pending reinforcement another chance on the next call.
 */
export function advanceOverworldReinforcements(
    state: CampaignState,
    activeElapsedMs: number
): ReinforcementAdvanceResult {
    if (!Number.isFinite(activeElapsedMs) || activeElapsedMs < 0) {
        throw new Error('Active reinforcement time must be a finite non-negative number.');
    }
    if (!reinforcementClockCanAdvance(state)) {
        return {
            state,
            spawnedMonsters: [],
            spawnPending: state.overworld.reinforcementCountdownMs === 0
        };
    }

    let nextState = state;
    let remainingElapsedMs = activeElapsedMs;
    const spawnedMonsters: MonsterState[] = [];

    while (true) {
        const countdown = nextState.overworld.reinforcementCountdownMs;
        if (countdown > remainingElapsedMs) {
            if (remainingElapsedMs > 0) {
                nextState = {
                    ...nextState,
                    overworld: {
                        ...nextState.overworld,
                        reinforcementCountdownMs: countdown - remainingElapsedMs
                    }
                };
            }
            break;
        }

        remainingElapsedMs -= countdown;
        if (countdown !== 0) {
            nextState = {
                ...nextState,
                overworld: {
                    ...nextState.overworld,
                    reinforcementCountdownMs: 0
                }
            };
        }

        if (nextState.overworld.monsters.length >= getReinforcementMonsterCap(nextState)) break;
        const monster = createReinforcementMonster(nextState);
        if (!monster) break;

        const nextOrdinal = nextState.overworld.reinforcementOrdinal + 1;
        spawnedMonsters.push(monster);
        nextState = {
            ...nextState,
            overworld: {
                ...nextState.overworld,
                monsters: [...nextState.overworld.monsters, monster],
                reinforcementOrdinal: nextOrdinal,
                reinforcementCountdownMs: getReinforcementDelayMs(
                    nextState.overworld.seed,
                    nextOrdinal
                )
            }
        };
        if (remainingElapsedMs <= 0) break;
    }

    return {
        state: nextState,
        spawnedMonsters,
        spawnPending: nextState.overworld.reinforcementCountdownMs === 0
    };
}
