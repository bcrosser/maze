import type {CampaignState} from '../campaign/campaign-state';
import {MATERIALS} from '../materials/materials';
import {chooseRandom, shuffle, type RandomSource} from '../random/random-source';
import type {Coordinate, MazeGrid} from '../overworld/maze-types';
import {
    MONSTER_DEFINITIONS,
    MONSTER_TYPE_IDS,
    type MonsterState,
    type MonsterTypeId
} from './monster-types';

export type MonsterTurnEvent =
    | {readonly kind: 'monster-moved'; readonly monsterId: string}
    | {
        readonly kind: 'player-damaged';
        readonly monsterId: string;
        readonly typeId: MonsterTypeId;
        readonly amount: number;
        readonly message: string;
    };

export interface MonsterTurnResult {
    readonly state: CampaignState;
    readonly events: readonly MonsterTurnEvent[];
}

const DIRECTIONS = Object.freeze([
    Object.freeze({x: 0, y: -1}),
    Object.freeze({x: 0, y: 1}),
    Object.freeze({x: -1, y: 0}),
    Object.freeze({x: 1, y: 0})
]);

function coordinateKey(position: Coordinate): string {
    return `${position.x},${position.y}`;
}

function isPassage(maze: MazeGrid, position: Coordinate): boolean {
    return maze[position.y]?.[position.x]?.kind === 'passage';
}

export function spawnInitialMonsters(
    maze: MazeGrid,
    random: RandomSource,
    reservedPositions: readonly Coordinate[] = []
): readonly MonsterState[] {
    const size = maze.length;
    const reserved = new Set(reservedPositions.map(coordinateKey));
    reserved.add('1,1');
    reserved.add(`${size - 2},${size - 2}`);

    const positions: Coordinate[] = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < (maze[y]?.length ?? 0); x++) {
            const position = {x, y};
            if (!isPassage(maze, position) || reserved.has(coordinateKey(position))) continue;
            positions.push(position);
        }
    }

    const shuffledPositions = shuffle(positions, random);
    const monsterCount = Math.min(Math.floor(size / 4), shuffledPositions.length);
    return Array.from({length: monsterCount}, (_, index) => ({
        id: `monster-${index + 1}`,
        typeId: MONSTER_TYPE_IDS[index % MONSTER_TYPE_IDS.length]!,
        position: shuffledPositions[index]!,
        lastMoveTurn: 0,
        lastAttackTurn: Number.MIN_SAFE_INTEGER
    }));
}

export function initializeOverworldMonsters(
    state: CampaignState,
    random: RandomSource,
    reservedPositions: readonly Coordinate[] = []
): CampaignState {
    if (state.overworld.monstersInitialized) return state;
    return {
        ...state,
        overworld: {
            ...state.overworld,
            monstersInitialized: true,
            monsters: spawnInitialMonsters(state.overworld.maze, random, reservedPositions)
        }
    };
}

function availableSteps(
    maze: MazeGrid,
    position: Coordinate,
    occupied: ReadonlySet<string>
): Coordinate[] {
    return DIRECTIONS
        .map(direction => ({x: position.x + direction.x, y: position.y + direction.y}))
        .filter(step => isPassage(maze, step))
        .filter(step => !occupied.has(coordinateKey(step)));
}

function findStepTowardPlayer(
    maze: MazeGrid,
    monster: MonsterState,
    target: Coordinate,
    occupied: ReadonlySet<string>
): Coordinate | null {
    const startKey = coordinateKey(monster.position);
    const targetKey = coordinateKey(target);
    if (startKey === targetKey) return null;

    const queue: Coordinate[] = [monster.position];
    const previous = new Map<string, string | null>([[startKey, null]]);
    for (let queueIndex = 0; queueIndex < queue.length && !previous.has(targetKey); queueIndex++) {
        const current = queue[queueIndex]!;
        for (const direction of DIRECTIONS) {
            const next = {x: current.x + direction.x, y: current.y + direction.y};
            const nextKey = coordinateKey(next);
            const blockedByMonster = occupied.has(nextKey) && nextKey !== targetKey;
            if (!isPassage(maze, next) || blockedByMonster || previous.has(nextKey)) continue;
            previous.set(nextKey, coordinateKey(current));
            queue.push(next);
        }
    }

    if (!previous.has(targetKey)) return null;
    let stepKey = targetKey;
    while (previous.get(stepKey) !== startKey) {
        const priorKey = previous.get(stepKey);
        if (!priorKey) return null;
        stepKey = priorKey;
    }
    const [x, y] = stepKey.split(',').map(Number);
    return Number.isInteger(x) && Number.isInteger(y) ? {x: x!, y: y!} : null;
}

function damageForContact(state: CampaignState, monster: MonsterState): number {
    const definition = MONSTER_DEFINITIONS[monster.typeId];
    if (definition.strategyId !== 'fire-hunter') return definition.baseDamage;

    const nearHotWall = DIRECTIONS.some(direction => {
        const cell = state.overworld.maze[monster.position.y + direction.y]?.[
            monster.position.x + direction.x
        ];
        return cell?.kind === 'wall' && MATERIALS[cell.materialId].tags.some(tag => tag === 'hot');
    });
    return definition.baseDamage + (nearHotWall ? 1 : 0);
}

export function advanceMonsterTurn(
    state: CampaignState,
    random: RandomSource
): MonsterTurnResult {
    if (state.overworld.resumeGraceTurns > 0) {
        return {
            state: {
                ...state,
                overworld: {
                    ...state.overworld,
                    resumeGraceTurns: state.overworld.resumeGraceTurns - 1
                }
            },
            events: []
        };
    }

    const occupied = new Set(state.overworld.monsters.map(monster => coordinateKey(monster.position)));
    const events: MonsterTurnEvent[] = [];
    let monsters = [...state.overworld.monsters];

    monsters = monsters.map(monster => {
        const definition = MONSTER_DEFINITIONS[monster.typeId];
        if (state.overworld.turn - monster.lastMoveTurn < definition.moveEveryTurns) return monster;

        occupied.delete(coordinateKey(monster.position));
        const step = definition.strategyId === 'fire-hunter'
            ? findStepTowardPlayer(
                state.overworld.maze,
                monster,
                state.overworld.playerPosition,
                occupied
            )
            : (() => {
                const steps = availableSteps(state.overworld.maze, monster.position, occupied);
                return steps.length > 0 ? chooseRandom(steps, random) : null;
            })();
        const nextMonster: MonsterState = {
            ...monster,
            ...(step ? {position: step} : {}),
            lastMoveTurn: state.overworld.turn
        };
        occupied.add(coordinateKey(nextMonster.position));
        if (step) events.push({kind: 'monster-moved', monsterId: monster.id});
        return nextMonster;
    });

    let health = state.player.health;
    monsters = monsters.map(monster => {
        const sharesPlayerCell = monster.position.x === state.overworld.playerPosition.x &&
            monster.position.y === state.overworld.playerPosition.y;
        const definition = MONSTER_DEFINITIONS[monster.typeId];
        const canAttack = state.overworld.turn - monster.lastAttackTurn >=
            definition.attackCooldownTurns;
        if (!sharesPlayerCell || !canAttack) return monster;

        const amount = damageForContact(state, monster);
        health = Math.max(0, health - amount);
        events.push({
            kind: 'player-damaged',
            monsterId: monster.id,
            typeId: monster.typeId,
            amount,
            message: `${definition.label} dealt ${amount} damage.`
        });
        return {...monster, lastAttackTurn: state.overworld.turn};
    });

    return {
        state: {
            ...state,
            player: {...state.player, health},
            overworld: {...state.overworld, monsters}
        },
        events
    };
}