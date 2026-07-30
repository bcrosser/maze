import type {ItemInstance} from './item-types';
import type {Coordinate} from '../overworld/maze-types';

export const MONSTER_TYPE_IDS = [
    'moss-slime',
    'ember-hound',
    'cave-bat',
    'floating-eye',
    'mimic',
    'stone-golem',
    'giant-spider',
    'skeleton',
    'viper',
    'shadow-stalker',
    'frost-wraith',
    'bone-knight',
    'dragon-hatchling',
    'maze-guardian'
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
    | 'golem'
    /** Pursues, then covers the last stretch in a double-speed leap. */
    | 'ambusher'
    /** Pursues at a distance and strikes down open corridors. */
    | 'caster';

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
    skeleton: 4,
    'cave-bat': 6,
    'giant-spider': 7,
    viper: 9,
    'frost-wraith': 11,
    'shadow-stalker': 15,
    mimic: 26,
    'floating-eye': 27,
    'bone-knight': 36,
    'dragon-hatchling': 47,
    'maze-guardian': 49
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
        // The sentry strategy never takes a movement step, so this cadence is
        // unused. It must stay a small safe integer because spawn code derives
        // `nextMoveTurn` from it and saved turn counters must remain safe
        // integers.
        moveEveryTurns: 1,
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
    }),
    'giant-spider': Object.freeze({
        label: 'Giant Spider',
        spriteId: 'giant-spider',
        spriteFrame: MONSTER_SPRITES['giant-spider'],
        fallbackColor: 0x6b4a7a,
        strategyId: 'ambusher',
        maxHealth: 3,
        armor: 0,
        baseDamage: 2,
        moveEveryTurns: 2,
        attackCooldownTurns: 2,
        detectionDistance: 7,
        leashDistance: 10,
        threat: 3
    }),
    skeleton: Object.freeze({
        label: 'Skeleton',
        spriteId: 'skeleton',
        spriteFrame: MONSTER_SPRITES.skeleton,
        fallbackColor: 0xe5dfbd,
        strategyId: 'pursue',
        maxHealth: 4,
        armor: 1,
        baseDamage: 2,
        moveEveryTurns: 2,
        attackCooldownTurns: 2,
        detectionDistance: 7,
        leashDistance: 11,
        threat: 3
    }),
    viper: Object.freeze({
        label: 'Cave Viper',
        spriteId: 'viper',
        spriteFrame: MONSTER_SPRITES.viper,
        fallbackColor: 0x4f8f3f,
        strategyId: 'ambusher',
        maxHealth: 3,
        armor: 0,
        baseDamage: 3,
        moveEveryTurns: 1,
        attackCooldownTurns: 3,
        detectionDistance: 6,
        leashDistance: 9,
        threat: 4
    }),
    'shadow-stalker': Object.freeze({
        label: 'Shadow Stalker',
        spriteId: 'shadow-stalker',
        spriteFrame: MONSTER_SPRITES['shadow-stalker'],
        fallbackColor: 0x453a63,
        strategyId: 'ambusher',
        maxHealth: 5,
        armor: 1,
        baseDamage: 3,
        moveEveryTurns: 1,
        attackCooldownTurns: 2,
        detectionDistance: 9,
        leashDistance: 14,
        threat: 5
    }),
    'frost-wraith': Object.freeze({
        label: 'Frost Wraith',
        spriteId: 'frost-wraith',
        spriteFrame: MONSTER_SPRITES['frost-wraith'],
        fallbackColor: 0x8fd8ea,
        strategyId: 'caster',
        maxHealth: 4,
        armor: 0,
        baseDamage: 3,
        moveEveryTurns: 2,
        attackCooldownTurns: 3,
        detectionDistance: 8,
        leashDistance: 12,
        threat: 4
    }),
    'bone-knight': Object.freeze({
        label: 'Bone Knight',
        spriteId: 'bone-knight',
        spriteFrame: MONSTER_SPRITES['bone-knight'],
        fallbackColor: 0xb9b3a0,
        strategyId: 'pursue',
        maxHealth: 8,
        armor: 2,
        baseDamage: 4,
        moveEveryTurns: 2,
        attackCooldownTurns: 3,
        detectionDistance: 8,
        leashDistance: 13,
        threat: 6
    }),
    'dragon-hatchling': Object.freeze({
        label: 'Dragon Hatchling',
        spriteId: 'dragon-hatchling',
        spriteFrame: MONSTER_SPRITES['dragon-hatchling'],
        fallbackColor: 0xd8562f,
        strategyId: 'caster',
        maxHealth: 7,
        armor: 1,
        baseDamage: 4,
        moveEveryTurns: 2,
        attackCooldownTurns: 3,
        detectionDistance: 9,
        leashDistance: 14,
        threat: 7
    }),
    'maze-guardian': Object.freeze({
        label: 'Maze Guardian',
        spriteId: 'maze-guardian',
        spriteFrame: MONSTER_SPRITES['maze-guardian'],
        fallbackColor: 0xcf9a3a,
        strategyId: 'golem',
        maxHealth: 11,
        armor: 3,
        baseDamage: 5,
        moveEveryTurns: 2,
        attackCooldownTurns: 3,
        detectionDistance: 8,
        leashDistance: 16,
        threat: 9
    })
} as const satisfies Record<MonsterTypeId, MonsterDefinition>);
