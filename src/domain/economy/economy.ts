import {
    STARTING_MONEY,
    type CampaignState,
    type PlayerProgress
} from '../campaign/campaign-state';
import {
    ITEM_DEFINITIONS,
    type ItemAffixId,
    type ItemChoiceId,
    type ItemInstance,
    type ItemQuality,
    type ItemTypeId
} from '../entities/item-types';
import {MONSTER_DEFINITIONS, type MonsterState} from '../entities/monster-types';
import {
    CASINO_HEIST_UNLOCK_FLAG,
    OBJECTIVE_BY_ID
} from '../overworld/level-objectives';

export {STARTING_MONEY};

export const SPACE_OBJECTIVE_SKIP_COST = 100;

export const SHOP_OFFER_IDS = [
    'field-medicine',
    'demolition-charge',
    'arrow-cache',
    'keen-sword',
    'warden-bow',
    'getaway-car',
    'reinforced-heart',
    'drill-servo',
    'tool-capacitor'
] as const;
export type ShopOfferId = (typeof SHOP_OFFER_IDS)[number];

export interface ShopItemTemplate {
    readonly baseTypeId: ItemTypeId;
    readonly quality: ItemQuality;
    readonly affixIds: readonly ItemAffixId[];
    readonly rolledChoiceIds: readonly ItemChoiceId[];
    readonly quantity: number;
    readonly charges: number | null;
}

interface ShopOfferBase {
    readonly id: ShopOfferId;
    readonly label: string;
    readonly description: string;
    readonly price: number;
}

export interface ShopItemOffer extends ShopOfferBase {
    readonly kind: 'item';
    readonly item: ShopItemTemplate;
}

export type ShopUpgradeEffect =
    | 'max-health'
    | 'mining-power'
    | 'tool-charge';

export interface ShopUpgradeOffer extends ShopOfferBase {
    readonly kind: 'upgrade';
    readonly upgradeId: string;
    readonly effect: ShopUpgradeEffect;
}

export type ShopOffer = ShopItemOffer | ShopUpgradeOffer;

const NO_AFFIXES: readonly ItemAffixId[] = Object.freeze([]);
const NO_CHOICES: readonly ItemChoiceId[] = Object.freeze([]);
const KEEN_AFFIX: readonly ItemAffixId[] = Object.freeze(['keen']);
const WARDEN_AFFIXES: readonly ItemAffixId[] = Object.freeze(['efficient', 'piercing']);

export const SHOP_CATALOG: readonly ShopOffer[] = Object.freeze([
    Object.freeze({
        id: 'field-medicine',
        kind: 'item',
        label: 'Field Medicine',
        description: 'A common Health Potion for the next dangerous corridor.',
        price: 10,
        item: Object.freeze({
            baseTypeId: 'health-potion',
            quality: 'common',
            affixIds: NO_AFFIXES,
            rolledChoiceIds: NO_CHOICES,
            quantity: 1,
            charges: null
        })
    }),
    Object.freeze({
        id: 'demolition-charge',
        kind: 'item',
        label: 'Demolition Charge',
        description: 'A Bomb that damages monsters in a compact blast.',
        price: 16,
        item: Object.freeze({
            baseTypeId: 'bomb',
            quality: 'common',
            affixIds: NO_AFFIXES,
            rolledChoiceIds: NO_CHOICES,
            quantity: 1,
            charges: null
        })
    }),
    Object.freeze({
        id: 'arrow-cache',
        kind: 'item',
        label: 'Arrow Cache',
        description: 'A bundle of ammunition for a Bow.',
        price: 8,
        item: Object.freeze({
            baseTypeId: 'ammo-bundle',
            quality: 'common',
            affixIds: NO_AFFIXES,
            rolledChoiceIds: NO_CHOICES,
            quantity: 1,
            charges: null
        })
    }),
    Object.freeze({
        id: 'keen-sword',
        kind: 'item',
        label: 'Keen Salvage Sword',
        description: 'An uncommon sword with an extra point of damage.',
        price: 34,
        item: Object.freeze({
            baseTypeId: 'sword',
            quality: 'uncommon',
            affixIds: KEEN_AFFIX,
            rolledChoiceIds: NO_CHOICES,
            quantity: 1,
            charges: null
        })
    }),
    Object.freeze({
        id: 'warden-bow',
        kind: 'item',
        label: 'Warden Bow',
        description: 'A rare efficient bow with armor-piercing arrows.',
        price: 58,
        item: Object.freeze({
            baseTypeId: 'bow',
            quality: 'rare',
            affixIds: WARDEN_AFFIXES,
            rolledChoiceIds: NO_CHOICES,
            quantity: 1,
            charges: null
        })
    }),
    Object.freeze({
        id: 'getaway-car',
        kind: 'item',
        label: 'Getaway Car',
        description: 'A road-ready car that permanently unlocks Casino Heist.',
        price: 100,
        item: Object.freeze({
            baseTypeId: 'car',
            quality: 'rare',
            affixIds: NO_AFFIXES,
            rolledChoiceIds: NO_CHOICES,
            quantity: 1,
            charges: null
        })
    }),
    Object.freeze({
        id: 'reinforced-heart',
        kind: 'upgrade',
        label: 'Reinforced Heart',
        description: 'Permanently increases maximum health by 2 and heals 2.',
        price: 48,
        upgradeId: 'shop/reinforced-heart',
        effect: 'max-health'
    }),
    Object.freeze({
        id: 'drill-servo',
        kind: 'upgrade',
        label: 'Drill Servo',
        description: 'Permanently increases mining power by 1.',
        price: 42,
        upgradeId: 'shop/drill-servo',
        effect: 'mining-power'
    }),
    Object.freeze({
        id: 'tool-capacitor',
        kind: 'upgrade',
        label: 'Tool Capacitor',
        description: 'Installs a permanent module and supplies 8 tool charges.',
        price: 28,
        upgradeId: 'shop/tool-capacitor',
        effect: 'tool-charge'
    })
] satisfies readonly ShopOffer[]);

const SHOP_OFFER_BY_ID = new Map<string, ShopOffer>(
    SHOP_CATALOG.map(offer => [offer.id, offer])
);

export type MoneyDebitResult =
    | {readonly ok: true; readonly state: CampaignState}
    | {
        readonly ok: false;
        readonly state: CampaignState;
        readonly reason: 'insufficient-funds';
    };

export type ShopPurchaseFailureReason =
    | 'unknown-offer'
    | 'insufficient-funds'
    | 'inventory-full'
    | 'already-owned'
    | 'upgrade-at-cap';

export type ShopPurchaseResult =
    | {
        readonly ok: true;
        readonly state: CampaignState;
        readonly offer: ShopOffer;
        readonly purchasedItemId: string | null;
    }
    | {
        readonly ok: false;
        readonly state: CampaignState;
        readonly offer: ShopOffer | null;
        readonly reason: ShopPurchaseFailureReason;
    };

export type SpaceObjectiveSkipFailureReason =
    | 'objective-locked'
    | 'objective-already-completed'
    | 'insufficient-funds';

export type SpaceObjectiveSkipResult =
    | {
        readonly ok: true;
        readonly state: CampaignState;
        readonly cost: typeof SPACE_OBJECTIVE_SKIP_COST;
    }
    | {
        readonly ok: false;
        readonly state: CampaignState;
        readonly cost: typeof SPACE_OBJECTIVE_SKIP_COST;
        readonly reason: SpaceObjectiveSkipFailureReason;
    };

function assertMoneyAmount(amount: number, label: string): void {
    if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new Error(`${label} must be a non-negative safe integer.`);
    }
}

export function getShopOffer(id: string): ShopOffer | null {
    return SHOP_OFFER_BY_ID.get(id) ?? null;
}

export function getShopPrice(id: string): number | null {
    return getShopOffer(id)?.price ?? null;
}

export function creditMoney(state: CampaignState, amount: number): CampaignState {
    assertMoneyAmount(amount, 'Money credit');
    const money = amount > Number.MAX_SAFE_INTEGER - state.player.money
        ? Number.MAX_SAFE_INTEGER
        : state.player.money + amount;
    if (amount === 0) return state;
    return {...state, player: {...state.player, money}};
}

export function tryDebitMoney(state: CampaignState, amount: number): MoneyDebitResult {
    assertMoneyAmount(amount, 'Money debit');
    if (state.player.money < amount) {
        return {ok: false, state, reason: 'insufficient-funds'};
    }
    if (amount === 0) return {ok: true, state};
    return {
        ok: true,
        state: {
            ...state,
            player: {...state.player, money: state.player.money - amount}
        }
    };
}

/**
 * Pays to resolve only the Space objective. This deliberately does not create
 * encounter history: buying a bypass is campaign progress, not a played run.
 */
export function purchaseSpaceObjectiveSkip(
    state: CampaignState
): SpaceObjectiveSkipResult {
    const definition = OBJECTIVE_BY_ID.space;
    if (state.flags.includes(definition.completionFlag)) {
        return {
            ok: false,
            state,
            cost: SPACE_OBJECTIVE_SKIP_COST,
            reason: 'objective-already-completed'
        };
    }
    if (!state.overworld.objectives.some(objective => objective.objectiveId === 'space')) {
        return {
            ok: false,
            state,
            cost: SPACE_OBJECTIVE_SKIP_COST,
            reason: 'objective-locked'
        };
    }

    const debit = tryDebitMoney(state, SPACE_OBJECTIVE_SKIP_COST);
    if (!debit.ok) {
        return {
            ok: false,
            state,
            cost: SPACE_OBJECTIVE_SKIP_COST,
            reason: debit.reason
        };
    }
    return {
        ok: true,
        cost: SPACE_OBJECTIVE_SKIP_COST,
        state: {
            ...debit.state,
            flags: [...debit.state.flags, definition.completionFlag]
        }
    };
}

function addPurchasedItem(
    player: PlayerProgress,
    item: ShopItemTemplate,
    itemId: string
): {readonly player: PlayerProgress; readonly itemId: string} | null {
    const definition = ITEM_DEFINITIONS[item.baseTypeId];
    const stack = player.backpack.find(candidate =>
        candidate.baseTypeId === item.baseTypeId &&
        candidate.quality === item.quality &&
        candidate.affixIds.join('|') === item.affixIds.join('|') &&
        candidate.charges === item.charges &&
        candidate.quantity + item.quantity <= 3
    );
    if (stack && definition.category === 'consumable') {
        return {
            itemId: stack.id,
            player: {
                ...player,
                backpack: player.backpack.map(candidate =>
                    candidate.id === stack.id
                        ? {...candidate, quantity: candidate.quantity + item.quantity}
                        : candidate
                )
            }
        };
    }
    if (player.backpack.length >= 8) return null;
    const instance: ItemInstance = {id: itemId, ...item};
    return {
        itemId,
        player: {...player, backpack: [...player.backpack, instance]}
    };
}

function itemIdsInState(state: CampaignState): ReadonlySet<string> {
    return new Set([
        ...state.player.backpack.map(item => item.id),
        ...(state.player.equippedWeapon ? [state.player.equippedWeapon.id] : []),
        ...(state.player.equippedUtility ? [state.player.equippedUtility.id] : []),
        ...state.overworld.items.map(item => item.instance.id),
        ...state.overworld.monsters.flatMap(monster =>
            monster.drop ? [monster.drop.id] : []
        ),
        ...(state.pendingLevelReward ? [state.pendingLevelReward.armoryOffer.id] : [])
    ]);
}

function nextPurchasedItemId(state: CampaignState, offerId: ShopOfferId): string {
    const prefix = `${state.overworld.levelId}/shop/${offerId}`;
    const ids = itemIdsInState(state);
    let ordinal = 1;
    while (ids.has(`${prefix}/${ordinal}`)) ordinal++;
    return `${prefix}/${ordinal}`;
}

function applyUpgrade(
    player: PlayerProgress,
    offer: ShopUpgradeOffer
): PlayerProgress | 'already-owned' | 'upgrade-at-cap' {
    if (player.installedModuleIds.includes(offer.upgradeId)) return 'already-owned';
    const installedModuleIds = [...player.installedModuleIds, offer.upgradeId];
    switch (offer.effect) {
        case 'max-health':
            if (player.maxHealth >= 99) return 'upgrade-at-cap';
            return {
                ...player,
                maxHealth: Math.min(99, player.maxHealth + 2),
                health: Math.min(99, player.health + 2),
                installedModuleIds
            };
        case 'mining-power':
            if (player.miningPower >= 4) return 'upgrade-at-cap';
            return {
                ...player,
                miningPower: player.miningPower + 1,
                installedModuleIds
            };
        case 'tool-charge':
            if (player.toolCharge > 991) return 'upgrade-at-cap';
            return {
                ...player,
                toolCharge: player.toolCharge + 8,
                installedModuleIds
            };
    }
}

export function purchaseShopOffer(
    state: CampaignState,
    offerId: string
): ShopPurchaseResult {
    const offer = getShopOffer(offerId);
    if (!offer) return {ok: false, state, offer: null, reason: 'unknown-offer'};
    if (
        offer.kind === 'item' &&
        offer.item.baseTypeId === 'car' &&
        state.flags.includes(CASINO_HEIST_UNLOCK_FLAG)
    ) {
        return {ok: false, state, offer, reason: 'already-owned'};
    }
    if (state.player.money < offer.price) {
        return {ok: false, state, offer, reason: 'insufficient-funds'};
    }

    let player: PlayerProgress;
    let purchasedItemId: string | null = null;
    if (offer.kind === 'item') {
        purchasedItemId = nextPurchasedItemId(state, offer.id);
        const added = addPurchasedItem(state.player, offer.item, purchasedItemId);
        if (!added) {
            return {ok: false, state, offer, reason: 'inventory-full'};
        }
        player = added.player;
        purchasedItemId = added.itemId;
    } else {
        const upgraded = applyUpgrade(state.player, offer);
        if (typeof upgraded === 'string') {
            return {ok: false, state, offer, reason: upgraded};
        }
        player = upgraded;
    }

    return {
        ok: true,
        offer,
        purchasedItemId,
        state: {
            ...state,
            player: {...player, money: player.money - offer.price},
            flags:
                offer.kind === 'item' &&
                offer.item.baseTypeId === 'car' &&
                !state.flags.includes(CASINO_HEIST_UNLOCK_FLAG)
                    ? [...state.flags, CASINO_HEIST_UNLOCK_FLAG]
                    : state.flags
        }
    };
}

/**
 * Monster money is deterministic, so a save/reload cannot reroll the reward.
 * Threat drives the baseline while elites and behavior variants pay a premium.
 */
export function calculateMonsterMoneyDrop(monster: MonsterState): number {
    const threat = MONSTER_DEFINITIONS[monster.typeId].threat;
    return 2 + threat * 2 + monster.variantIds.length * 2 + (monster.elite ? 8 : 0);
}
