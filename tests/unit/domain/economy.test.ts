import {describe, expect, it} from 'vitest';

import {createInitialCampaignState, STARTING_MONEY} from '../../../src/domain/campaign/campaign-state';
import {
    SPACE_OBJECTIVE_SKIP_COST,
    SHOP_CATALOG,
    calculateMonsterMoneyDrop,
    creditMoney,
    getShopOffer,
    getShopPrice,
    purchaseSpaceObjectiveSkip,
    purchaseShopOffer,
    tryDebitMoney
} from '../../../src/domain/economy/economy';
import {createItemInstance} from '../../../src/domain/entities/item-types';
import type {MonsterState} from '../../../src/domain/entities/monster-types';
import {initializeLevelContent} from '../../../src/domain/overworld/level-content-generator';
import {
    CASINO_HEIST_UNLOCK_FLAG,
    getObjectiveStatus,
    OBJECTIVE_BY_ID
} from '../../../src/domain/overworld/level-objectives';
import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import {Mulberry32Random} from '../../../src/domain/random/random-source';

function campaign(seed = 90210) {
    return createInitialCampaignState({
        campaignSeed: seed,
        maze: generateMaze({size: 21, random: new Mulberry32Random(seed)})
    });
}

function campaignWithSpace(selected: boolean) {
    for (let seed = 1; seed <= 64; seed++) {
        const state = initializeLevelContent(campaign(seed));
        if (
            state.overworld.objectives.some(objective => objective.objectiveId === 'space') ===
            selected
        ) {
            return state;
        }
    }
    throw new Error('Expected the deterministic seed corpus to vary the Space roster.');
}

function monster(
    overrides: Partial<MonsterState> = {}
): MonsterState {
    return {
        id: 'monster',
        typeId: 'moss-slime',
        variantIds: [],
        elite: false,
        position: {x: 3, y: 3},
        spawnPosition: {x: 3, y: 3},
        health: 2,
        maxHealth: 2,
        armor: 0,
        actionCount: 0,
        nextMoveTurn: 3,
        nextAttackTurn: 2,
        revealed: true,
        intent: null,
        statuses: [],
        undamagedTurns: 0,
        drop: null,
        ...overrides
    };
}

describe('persistent campaign economy', () => {
    it('starts every new campaign with a playable wallet balance', () => {
        expect(campaign().player.money).toBe(STARTING_MONEY);
    });

    it('exposes a complete, positively priced shop catalog', () => {
        expect(SHOP_CATALOG.map(offer => offer.id)).toEqual([
            'field-medicine',
            'demolition-charge',
            'arrow-cache',
            'keen-sword',
            'warden-bow',
            'getaway-car',
            'reinforced-heart',
            'drill-servo',
            'tool-capacitor'
        ]);
        for (const offer of SHOP_CATALOG) {
            expect(getShopOffer(offer.id)).toBe(offer);
            expect(getShopPrice(offer.id)).toBe(offer.price);
            expect(offer.price).toBeGreaterThan(0);
        }
        expect(getShopOffer('not-an-offer')).toBeNull();
        expect(getShopPrice('not-an-offer')).toBeNull();
    });

    it('credits and debits money without allowing a negative balance', () => {
        const base = campaign();
        const credited = creditMoney(base, 7);
        expect(credited.player.money).toBe(STARTING_MONEY + 7);

        const paid = tryDebitMoney(credited, 12);
        expect(paid.ok).toBe(true);
        expect(paid.state.player.money).toBe(STARTING_MONEY - 5);

        const refused = tryDebitMoney(base, STARTING_MONEY + 1);
        expect(refused).toEqual({
            ok: false,
            state: base,
            reason: 'insufficient-funds'
        });
        expect(() => creditMoney(base, -1)).toThrow(/non-negative safe integer/);
    });

    it('buys and stacks ordinary items atomically', () => {
        const base = campaign();
        const result = purchaseShopOffer(base, 'field-medicine');

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.state.player.money).toBe(STARTING_MONEY - 10);
        expect(result.purchasedItemId).toBe('campaign/starter-potion');
        expect(result.state.player.backpack).toEqual([
            {...base.player.backpack[0]!, quantity: 2}
        ]);
    });

    it('sells upgraded equipment with its quality and affixes intact', () => {
        const initial = campaign();
        const rich = {...initial, player: {...initial.player, money: 100}};
        const result = purchaseShopOffer(rich, 'warden-bow');

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const bow = result.state.player.backpack.find(item =>
            item.id === result.purchasedItemId
        );
        expect(bow).toMatchObject({
            baseTypeId: 'bow',
            quality: 'rare',
            affixIds: ['efficient', 'piercing']
        });
        expect(result.state.player.money).toBe(42);
    });

    it('sells the $100 car and permanently unlocks Casino Heist', () => {
        const initial = campaign();
        const rich = {...initial, player: {...initial.player, money: 100}};
        const result = purchaseShopOffer(rich, 'getaway-car');

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.state.player.money).toBe(0);
        expect(result.state.player.backpack.find(item =>
            item.id === result.purchasedItemId
        )).toMatchObject({
            baseTypeId: 'car',
            quality: 'rare'
        });
        expect(result.state.flags).toContain(CASINO_HEIST_UNLOCK_FLAG);
        expect(getObjectiveStatus(result.state.flags, 'casino-heist')).toBe('available');

        const duplicate = purchaseShopOffer(
            {...result.state, player: {...result.state.player, money: 100}},
            'getaway-car'
        );
        expect(duplicate).toMatchObject({ok: false, reason: 'already-owned'});
    });

    it('refuses unaffordable and inventory-blocked purchases without charging money', () => {
        const base = campaign();
        const poor = {...base, player: {...base.player, money: 0}};
        const unaffordable = purchaseShopOffer(poor, 'warden-bow');
        expect(unaffordable).toMatchObject({
            ok: false,
            state: poor,
            reason: 'insufficient-funds'
        });

        const full = {
            ...base,
            player: {
                ...base.player,
                money: 100,
                backpack: Array.from({length: 8}, (_, index) =>
                    createItemInstance(`full/${index}`, 'bomb')
                )
            }
        };
        const blocked = purchaseShopOffer(full, 'warden-bow');
        expect(blocked).toMatchObject({
            ok: false,
            state: full,
            reason: 'inventory-full'
        });
    });

    it('installs permanent upgrades once and enforces stat caps', () => {
        const base = {...campaign(), player: {...campaign().player, money: 200}};
        const bought = purchaseShopOffer(base, 'reinforced-heart');
        expect(bought.ok).toBe(true);
        if (!bought.ok) return;
        expect(bought.state.player).toMatchObject({
            health: 12,
            maxHealth: 12,
            money: 152
        });
        expect(bought.state.player.installedModuleIds).toContain('shop/reinforced-heart');

        const duplicate = purchaseShopOffer(
            {...bought.state, player: {...bought.state.player, money: 200}},
            'reinforced-heart'
        );
        expect(duplicate).toMatchObject({ok: false, reason: 'already-owned'});

        const capped = {
            ...base,
            player: {...base.player, money: 200, miningPower: 4}
        };
        expect(purchaseShopOffer(capped, 'drill-servo'))
            .toMatchObject({ok: false, state: capped, reason: 'upgrade-at-cap'});
    });

    it('pays deterministic premiums for threat, variants, and elites', () => {
        expect(calculateMonsterMoneyDrop(monster())).toBe(4);
        expect(calculateMonsterMoneyDrop(monster({
            typeId: 'stone-golem',
            maxHealth: 6,
            health: 6,
            armor: 1
        }))).toBe(8);
        expect(calculateMonsterMoneyDrop(monster({
            typeId: 'stone-golem',
            maxHealth: 6,
            health: 6,
            armor: 1,
            variantIds: ['armored', 'volatile'],
            elite: true
        }))).toBe(20);
    });

    it('pays exactly $100 to complete an available Space objective', () => {
        const initial = campaignWithSpace(true);
        const priorHistory = [{
            runId: 'completed-lock-run',
            definitionId: OBJECTIVE_BY_ID.lock.definitionId,
            triggerId: OBJECTIVE_BY_ID.lock.triggerId,
            kind: OBJECTIVE_BY_ID.lock.kind,
            status: 'success' as const,
            grade: 'a' as const,
            score: 1_000,
            elapsedMs: 15_000
        }];
        const available = {
            ...initial,
            player: {...initial.player, money: SPACE_OBJECTIVE_SKIP_COST},
            flags: [
                OBJECTIVE_BY_ID.pipe.completionFlag,
                OBJECTIVE_BY_ID.lock.completionFlag
            ],
            appliedEncounterRunIds: [priorHistory[0]!.runId],
            encounterHistory: priorHistory
        };

        const result = purchaseSpaceObjectiveSkip(available);

        expect(result).toMatchObject({
            ok: true,
            cost: 100,
            state: {player: {money: 0}}
        });
        expect(result.state.flags.filter(flag =>
            flag === OBJECTIVE_BY_ID.space.completionFlag
        )).toHaveLength(1);
        expect(result.state.encounterHistory).toBe(priorHistory);
        expect(result.state.appliedEncounterRunIds).toBe(available.appliedEncounterRunIds);
        expect(result.state.activeEncounter).toBe(available.activeEncounter);
        expect(available.player.money).toBe(SPACE_OBJECTIVE_SKIP_COST);
        expect(available.flags).not.toContain(OBJECTIVE_BY_ID.space.completionFlag);
    });

    it('refuses an unaffordable Space skip without mutating campaign state', () => {
        const initial = campaignWithSpace(true);
        const available = {
            ...initial,
            player: {...initial.player, money: SPACE_OBJECTIVE_SKIP_COST - 1},
            flags: [
                OBJECTIVE_BY_ID.pipe.completionFlag,
                OBJECTIVE_BY_ID.lock.completionFlag
            ]
        };

        const result = purchaseSpaceObjectiveSkip(available);

        expect(result).toEqual({
            ok: false,
            state: available,
            cost: SPACE_OBJECTIVE_SKIP_COST,
            reason: 'insufficient-funds'
        });
        expect(result.state).toBe(available);
    });

    it('refuses an unselected or completed Space objective without charging', () => {
        const withoutSpace = campaignWithSpace(false);
        const unselected = {
            ...withoutSpace,
            player: {...withoutSpace.player, money: 200}
        };
        const absentResult = purchaseSpaceObjectiveSkip(unselected);
        expect(absentResult).toMatchObject({
            ok: false,
            state: unselected,
            cost: SPACE_OBJECTIVE_SKIP_COST,
            reason: 'objective-locked'
        });
        expect(absentResult.state).toBe(unselected);
        expect(unselected.player.money).toBe(200);

        const withSpace = campaignWithSpace(true);
        const completed = {
            ...withSpace,
            player: {...withSpace.player, money: 200},
            flags: [
                OBJECTIVE_BY_ID.pipe.completionFlag,
                OBJECTIVE_BY_ID.lock.completionFlag,
                OBJECTIVE_BY_ID.space.completionFlag
            ]
        };
        const duplicate = purchaseSpaceObjectiveSkip(completed);
        expect(duplicate).toMatchObject({
            ok: false,
            state: completed,
            cost: SPACE_OBJECTIVE_SKIP_COST,
            reason: 'objective-already-completed'
        });
        expect(duplicate.state).toBe(completed);
        expect(completed.player.money).toBe(200);
        expect(completed.flags.filter(flag =>
            flag === OBJECTIVE_BY_ID.space.completionFlag
        )).toHaveLength(1);
    });
});
