import {describe, expect, it} from 'vitest';

import type {PlayerProgress} from '../../../src/domain/campaign/campaign-state';
import {createItemInstance} from '../../../src/domain/entities/item-types';
import {
    getMinigameItemBonus,
    MINIGAME_BONUS_TARGETS
} from '../../../src/domain/minigame/minigame-item-bonuses';

function playerWith(
    backpackTypes: Parameters<typeof createItemInstance>[1][],
    equippedWeaponType?: Parameters<typeof createItemInstance>[1],
    equippedUtilityType?: Parameters<typeof createItemInstance>[1]
): PlayerProgress {
    return {
        health: 10,
        maxHealth: 10,
        money: 0,
        scrap: 0,
        miningPower: 0,
        toolCharge: 0,
        installedModuleIds: [],
        backpack: backpackTypes.map((type, index) =>
            createItemInstance(`backpack-${index}`, type)
        ),
        equippedWeapon: equippedWeaponType
            ? createItemInstance('weapon', equippedWeaponType)
            : null,
        equippedUtility: equippedUtilityType
            ? createItemInstance('utility', equippedUtilityType)
            : null,
        bowAmmo: 0,
        quickSlotItemIds: [null, null, null],
        statuses: [],
        weaponRecoveryActions: 0
    };
}

describe('minigame item bonuses', () => {
    it('covers every required minigame target without mutating inventory', () => {
        const player = playerWith([
            'multitool',
            'mining-pick',
            'lantern',
            'compass',
            'shield',
            'bomb',
            'ammo-bundle',
            'map-scroll'
        ]);
        const before = structuredClone(player);

        for (const target of MINIGAME_BONUS_TARGETS) {
            const bonus = getMinigameItemBonus(player, target);
            expect(bonus.labels.length).toBeGreaterThan(0);
            expect(bonus.modifiers.itemBonusLabel).toBe(bonus.labels.join(' · '));
        }
        expect(player).toEqual(before);
    });

    it('recognizes equipped items even when they are not in the backpack', () => {
        const player = playerWith([], 'bow', 'shield');
        expect(getMinigameItemBonus(player, 'shooter').modifiers.spaceShieldBonus)
            .toBe(1);
        expect(getMinigameItemBonus(player, 'platformer').modifiers.platformerShieldBonusMs)
            .toBe(10_000);
    });

    it('returns no labels or modifiers when no useful item is owned', () => {
        const bonus = getMinigameItemBonus(playerWith(['health-potion']), 'circuit');
        expect(bonus).toEqual({labels: [], modifiers: {}});
    });
});
