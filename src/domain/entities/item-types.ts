import type {Coordinate} from '../overworld/maze-types';

export const ITEM_QUALITIES = ['common', 'uncommon', 'rare'] as const;
export type ItemQuality = (typeof ITEM_QUALITIES)[number];

export const ITEM_AFFIX_IDS = [
    'keen',
    'extended',
    'piercing',
    'efficient',
    'frost-bound',
    'arc-bound',
    'ember-bound',
    'durable',
    'surveyor',
    'insulated'
] as const;
export type ItemAffixId = (typeof ITEM_AFFIX_IDS)[number];

export const ITEM_CHOICE_IDS = ['mend', 'salvage', 'tools', 'guard'] as const;
export type ItemChoiceId = (typeof ITEM_CHOICE_IDS)[number];

export const ITEM_TYPE_IDS = [
    'health-potion',
    'antidote',
    'revival-feather',
    'fire-ward',
    'ice-ward',
    'lightning-ward',
    'lantern',
    'compass',
    'map-scroll',
    'multitool',
    'mining-pick',
    'bomb',
    'snare-kit',
    'axe',
    'sword',
    'dagger',
    'spear',
    'bow',
    'ammo-bundle',
    'shield',
    'coin',
    'mystery-orb',
    'car'
] as const;
export type ItemTypeId = (typeof ITEM_TYPE_IDS)[number];

export type ItemCategory =
    | 'consumable'
    | 'weapon'
    | 'utility'
    | 'tool'
    | 'currency'
    | 'choice'
    | 'vehicle';

export interface ItemDefinition {
    readonly label: string;
    readonly spriteId: string;
    readonly spriteFrame: number;
    readonly fallbackColor: number;
    readonly category: ItemCategory;
    readonly baseDamage?: number;
    readonly baseRange?: number;
    readonly baseCharges?: number;
}

export interface ItemInstance {
    readonly id: string;
    readonly baseTypeId: ItemTypeId;
    readonly quality: ItemQuality;
    readonly affixIds: readonly ItemAffixId[];
    readonly rolledChoiceIds: readonly ItemChoiceId[];
    readonly quantity: number;
    readonly charges: number | null;
}

export interface WorldItemState {
    readonly instance: ItemInstance;
    readonly position: Coordinate;
}

/** Backward-compatible public alias while callers migrate to WorldItemState. */
export type ItemState = WorldItemState;

export const ITEM_SPRITES = Object.freeze({
    'health-potion': 0,
    antidote: 3,
    'fire-ward': 4,
    'ice-ward': 5,
    'lightning-ward': 6,
    lantern: 8,
    compass: 12,
    'map-scroll': 13,
    coin: 16,
    bomb: 26,
    snare: 27,
    axe: 30,
    sword: 31,
    dagger: 32,
    spear: 33,
    bow: 34,
    'arrow-bundle': 35,
    shield: 36,
    feather: 45,
    car: 46,
    gear: 48,
    'mystery-orb': 49,
    'mining-pick': 1
} as const);

export const ITEM_DEFINITIONS = Object.freeze({
    'health-potion': Object.freeze({
        label: 'Health Potion',
        spriteId: 'health-potion',
        spriteFrame: ITEM_SPRITES['health-potion'],
        fallbackColor: 0xd83847,
        category: 'consumable'
    }),
    antidote: Object.freeze({
        label: 'Antidote',
        spriteId: 'antidote',
        spriteFrame: ITEM_SPRITES.antidote,
        fallbackColor: 0x62c370,
        category: 'consumable'
    }),
    'revival-feather': Object.freeze({
        label: 'Revival Feather',
        spriteId: 'feather',
        spriteFrame: ITEM_SPRITES.feather,
        fallbackColor: 0xf5f0df,
        category: 'consumable'
    }),
    'fire-ward': Object.freeze({
        label: 'Fire Ward',
        spriteId: 'fire-ward',
        spriteFrame: ITEM_SPRITES['fire-ward'],
        fallbackColor: 0xef5b24,
        category: 'consumable'
    }),
    'ice-ward': Object.freeze({
        label: 'Ice Ward',
        spriteId: 'ice-ward',
        spriteFrame: ITEM_SPRITES['ice-ward'],
        fallbackColor: 0x67d5e8,
        category: 'consumable'
    }),
    'lightning-ward': Object.freeze({
        label: 'Lightning Ward',
        spriteId: 'lightning-ward',
        spriteFrame: ITEM_SPRITES['lightning-ward'],
        fallbackColor: 0xefc75e,
        category: 'consumable'
    }),
    lantern: Object.freeze({
        label: 'Lantern',
        spriteId: 'lantern',
        spriteFrame: ITEM_SPRITES.lantern,
        fallbackColor: 0xefc75e,
        category: 'utility'
    }),
    compass: Object.freeze({
        label: 'Compass',
        spriteId: 'compass',
        spriteFrame: ITEM_SPRITES.compass,
        fallbackColor: 0xd7a64a,
        category: 'utility'
    }),
    'map-scroll': Object.freeze({
        label: 'Map Scroll',
        spriteId: 'map-scroll',
        spriteFrame: ITEM_SPRITES['map-scroll'],
        fallbackColor: 0xf5f0df,
        category: 'consumable'
    }),
    multitool: Object.freeze({
        label: 'Multitool',
        spriteId: 'gear',
        spriteFrame: ITEM_SPRITES.gear,
        fallbackColor: 0x87909f,
        category: 'utility',
        baseCharges: 2
    }),
    'mining-pick': Object.freeze({
        label: 'Mining Pick',
        spriteId: 'mining-pick',
        spriteFrame: ITEM_SPRITES['mining-pick'],
        fallbackColor: 0xd7a64a,
        category: 'tool'
    }),
    bomb: Object.freeze({
        label: 'Bomb',
        spriteId: 'bomb',
        spriteFrame: ITEM_SPRITES.bomb,
        fallbackColor: 0x171918,
        category: 'consumable'
    }),
    'snare-kit': Object.freeze({
        label: 'Snare Kit',
        spriteId: 'snare',
        spriteFrame: ITEM_SPRITES.snare,
        fallbackColor: 0x806b4f,
        category: 'consumable'
    }),
    axe: Object.freeze({
        label: 'Fire Axe',
        spriteId: 'axe',
        spriteFrame: ITEM_SPRITES.axe,
        fallbackColor: 0xef5b24,
        category: 'weapon',
        baseDamage: 3,
        baseRange: 1
    }),
    sword: Object.freeze({
        label: 'Salvage Sword',
        spriteId: 'sword',
        spriteFrame: ITEM_SPRITES.sword,
        fallbackColor: 0xc9ced6,
        category: 'weapon',
        baseDamage: 2,
        baseRange: 1
    }),
    dagger: Object.freeze({
        label: 'Dagger',
        spriteId: 'dagger',
        spriteFrame: ITEM_SPRITES.dagger,
        fallbackColor: 0xc9ced6,
        category: 'weapon',
        baseDamage: 1,
        baseRange: 1
    }),
    spear: Object.freeze({
        label: 'Spear',
        spriteId: 'spear',
        spriteFrame: ITEM_SPRITES.spear,
        fallbackColor: 0xd7a64a,
        category: 'weapon',
        baseDamage: 2,
        baseRange: 2
    }),
    bow: Object.freeze({
        label: 'Bow',
        spriteId: 'bow',
        spriteFrame: ITEM_SPRITES.bow,
        fallbackColor: 0x806b4f,
        category: 'weapon',
        baseDamage: 2,
        baseRange: 6
    }),
    'ammo-bundle': Object.freeze({
        label: 'Ammo Bundle',
        spriteId: 'arrow-bundle',
        spriteFrame: ITEM_SPRITES['arrow-bundle'],
        fallbackColor: 0xd7a64a,
        category: 'consumable'
    }),
    shield: Object.freeze({
        label: 'Shield',
        spriteId: 'shield',
        spriteFrame: ITEM_SPRITES.shield,
        fallbackColor: 0x67d5e8,
        category: 'utility'
    }),
    coin: Object.freeze({
        label: 'Coin',
        spriteId: 'coin',
        spriteFrame: ITEM_SPRITES.coin,
        fallbackColor: 0xefc75e,
        category: 'currency'
    }),
    'mystery-orb': Object.freeze({
        label: 'Mystery Orb',
        spriteId: 'mystery-orb',
        spriteFrame: ITEM_SPRITES['mystery-orb'],
        fallbackColor: 0x9b5de5,
        category: 'choice'
    }),
    car: Object.freeze({
        label: 'Getaway Car',
        spriteId: 'car',
        spriteFrame: ITEM_SPRITES.car,
        fallbackColor: 0xd83847,
        category: 'vehicle'
    })
} as const satisfies Record<ItemTypeId, ItemDefinition>);

export function createItemInstance(
    id: string,
    baseTypeId: ItemTypeId,
    options: Partial<Omit<ItemInstance, 'id' | 'baseTypeId'>> = {}
): ItemInstance {
    const definition: ItemDefinition = ITEM_DEFINITIONS[baseTypeId];
    return {
        id,
        baseTypeId,
        quality: options.quality ?? 'common',
        affixIds: options.affixIds ?? [],
        rolledChoiceIds: options.rolledChoiceIds ?? [],
        quantity: options.quantity ?? 1,
        charges: options.charges ?? definition.baseCharges ?? null
    };
}
