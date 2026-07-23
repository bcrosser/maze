import type {Coordinate} from '../overworld/maze-types';

export const MONSTER_TYPE_IDS = ['moss-slime', 'ember-hound'] as const;
export const MONSTER_STRATEGY_IDS = ['wander', 'fire-hunter'] as const;
export type MonsterTypeId = (typeof MONSTER_TYPE_IDS)[number];
export type MonsterStrategyId = (typeof MONSTER_STRATEGY_IDS)[number];

export interface MonsterDefinition {
    readonly label: string;
    readonly spriteFrame: number;
    readonly fallbackColor: number;
    readonly strategyId: MonsterStrategyId;
    readonly moveEveryTurns: number;
    readonly attackCooldownTurns: number;
    readonly baseDamage: number;
}

export interface MonsterState {
    readonly id: string;
    readonly typeId: MonsterTypeId;
    readonly position: Coordinate;
    readonly lastMoveTurn: number;
    readonly lastAttackTurn: number;
}

export const MONSTER_DEFINITIONS = Object.freeze({
    'moss-slime': Object.freeze({
        label: 'Moss Slime',
        spriteFrame: 0,
        fallbackColor: 0x55a33f,
        strategyId: 'wander',
        moveEveryTurns: 3,
        attackCooldownTurns: 2,
        baseDamage: 1
    }),
    'ember-hound': Object.freeze({
        label: 'Ember Hound',
        spriteFrame: 1,
        fallbackColor: 0xef5b24,
        strategyId: 'fire-hunter',
        moveEveryTurns: 2,
        attackCooldownTurns: 2,
        baseDamage: 2
    })
} as const satisfies Record<MonsterTypeId, MonsterDefinition>);