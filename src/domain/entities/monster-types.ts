import type {ItemInstance} from './item-types';
import type {Coordinate} from '../overworld/maze-types';

export const MONSTER_TYPE_IDS = [
    'moss-slime',
    'ember-hound',
    'cave-bat',
    'floating-eye',
    'mimic',
    'stone-golem'
] as const;
export type MonsterTypeId = (typeof MONSTER_TYPE_IDS)[number];

export const MONSTER_VARIANT_IDS = [
    'armored',
    'swift',
    'venomous',
    'ember-touched',
    'volatile',
    'regenerating'
] as const;
export type MonsterVariantId = (typeof MONSTER_VARIANT_IDS)[number];

export type MonsterStrategyId =
    | 'wander'
    | 'pursue'
    | 'bat'
    | 'sentry'
    | 'mimic'
    | 'golem';

export interface MonsterDefinition {
    readonly label: string;
    readonly spriteId: string;
    readonly spriteFrame: number;
    readonly fallbackColor: number;
    readonly strategyId: MonsterStrategyId;
    readonly maxHealth: number;
    readonly armor: number;
    readonly baseDamage: number;
    readonly moveEveryTurns: number;
    readonly attackCooldownTurns: number;
    readonly detectionDistance: number;
    readonly leashDistance: number;
    readonly threat: number;
}

export interface MonsterIntent {
    readonly kind: 'melee' | 'ranged' | 'reveal';
    readonly targetPositions: readonly Coordinate[];
    readonly damage: number;
    readonly executeOnTurn: number;
}

export interface MonsterStatus {
    readonly kind: 'rooted' | 'frost-delayed' | 'poison';
    readonly remainingTurns: number;
}

export interface MonsterState {
    readonly id: string;
    readonly typeId: MonsterTypeId;
    readonly variantIds: readonly MonsterVariantId[];
    readonly elite: boolean;
    readonly position: Coordinate;
    readonly spawnPosition: Coordinate;
    readonly health: number;
    readonly maxHealth: number;
    readonly armor: number;
    readonly actionCount: number;
    readonly nextMoveTurn: number;
    readonly nextAttackTurn: number;
    readonly revealed: boolean;
    readonly intent: MonsterIntent | null;
    readonly statuses: readonly MonsterStatus[];
    readonly undamagedTurns: number;
    readonly drop: ItemInstance | null;
}

export const MONSTER_SPRITES = Object.freeze({
    'moss-slime': 0,
    'ember-hound': 1,
    'stone-golem': 2,
    'cave-bat': 6,
    mimic: 26,
    'floating-eye': 27
} as const);

export const MONSTER_DEFINITIONS = Object.freeze({
    'moss-slime': Object.freeze({
        label: 'Moss Slime',
        spriteId: 'moss-slime',
        spriteFrame: MONSTER_SPRITES['moss-slime'],
        fallbackColor: 0x55a33f,
        strategyId: 'wander',
        maxHealth: 2,
        armor: 0,
        baseDamage: 1,
        moveEveryTurns: 3,
        attackCooldownTurns: 2,
        detectionDistance: 4,
        leashDistance: 6,
        threat: 1
    }),
    'ember-hound': Object.freeze({
        label: 'Ember Hound',
        spriteId: 'ember-hound',
        spriteFrame: MONSTER_SPRITES['ember-hound'],
        fallbackColor: 0xef5b24,
        strategyId: 'pursue',
        maxHealth: 3,
        armor: 0,
        baseDamage: 2,
        moveEveryTurns: 2,
        attackCooldownTurns: 2,
        detectionDistance: 8,
        leashDistance: 12,
        threat: 2
    }),
    'cave-bat': Object.freeze({
        label: 'Cave Bat',
        spriteId: 'cave-bat',
        spriteFrame: MONSTER_SPRITES['cave-bat'],
        fallbackColor: 0x705898,
        strategyId: 'bat',
        maxHealth: 2,
        armor: 0,
        baseDamage: 1,
        moveEveryTurns: 1,
        attackCooldownTurns: 2,
        detectionDistance: 5,
        leashDistance: 8,
        threat: 2
    }),
    'floating-eye': Object.freeze({
        label: 'Sentry Eye',
        spriteId: 'floating-eye',
        spriteFrame: MONSTER_SPRITES['floating-eye'],
        fallbackColor: 0xb65fcf,
        strategyId: 'sentry',
        maxHealth: 3,
        armor: 0,
        baseDamage: 2,
        moveEveryTurns: Number.MAX_SAFE_INTEGER,
        attackCooldownTurns: 4,
        detectionDistance: 6,
        leashDistance: 0,
        threat: 2
    }),
    mimic: Object.freeze({
        label: 'Mimic',
        spriteId: 'mimic',
        spriteFrame: MONSTER_SPRITES.mimic,
        fallbackColor: 0x806b4f,
        strategyId: 'mimic',
        maxHealth: 3,
        armor: 0,
        baseDamage: 2,
        moveEveryTurns: 2,
        attackCooldownTurns: 2,
        detectionDistance: 2,
        leashDistance: 8,
        threat: 2
    }),
    'stone-golem': Object.freeze({
        label: 'Stone Golem',
        spriteId: 'stone-golem',
        spriteFrame: MONSTER_SPRITES['stone-golem'],
        fallbackColor: 0x87909f,
        strategyId: 'golem',
        maxHealth: 6,
        armor: 1,
        baseDamage: 3,
        moveEveryTurns: 3,
        attackCooldownTurns: 3,
        detectionDistance: 5,
        leashDistance: 8,
        threat: 3
    })
} as const satisfies Record<MonsterTypeId, MonsterDefinition>);
