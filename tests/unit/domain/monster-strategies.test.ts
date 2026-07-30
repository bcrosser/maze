import {describe, expect, it} from 'vitest';

import {
    createInitialCampaignState,
    type CampaignState
} from '../../../src/domain/campaign/campaign-state';
import {
    MONSTER_DEFINITIONS,
    MONSTER_SPRITES,
    MONSTER_TYPE_IDS,
    type MonsterState,
    type MonsterTypeId
} from '../../../src/domain/entities/monster-types';
import {initializeLevelContent} from '../../../src/domain/overworld/level-content-generator';
import {getPassageDistances} from '../../../src/domain/overworld/maze-distances';
import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import {resolveOverworldAction} from '../../../src/domain/overworld/resolve-overworld-action';
import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {campaignStateSchema} from '../../../src/save/campaign-state.schema';

function campaign(seed = 31, levelId = 'level-1'): CampaignState {
    return initializeLevelContent(createInitialCampaignState({
        campaignSeed: seed,
        overworldSeed: seed,
        levelId,
        maze: generateMaze({
            size: 21,
            topologyRandom: new Mulberry32Random(seed),
            materialRandom: new Mulberry32Random(seed + 1)
        })
    }));
}

function parsePosition(positionKey: string): {readonly x: number; readonly y: number} {
    const [x, y] = positionKey.split(',').map(Number);
    return {x: x!, y: y!};
}

/**
 * Places one monster at a known walking distance from the player. Both are kept
 * clear of the spawn sanctuary, whose protected cells deliberately freeze any
 * monster standing in them.
 */
function withLoneMonster(
    typeId: MonsterTypeId,
    distance: number
): {readonly state: CampaignState; readonly monster: MonsterState} {
    const generated = campaign();
    const maze = generated.overworld.maze;
    const spawnDistances = getPassageDistances(maze, {x: 1, y: 1});
    const clearOfSanctuary = (positionKey: string): boolean =>
        (spawnDistances.get(positionKey) ?? 0) >= 4;
    const placement = [...spawnDistances]
        .filter(([positionKey, value]) => value >= 6 && clearOfSanctuary(positionKey))
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([playerKey]) => {
            const player = parsePosition(playerKey);
            const monsterKey = [...getPassageDistances(maze, player)]
                .filter(([positionKey, value]) =>
                    value === distance && clearOfSanctuary(positionKey)
                )
                .sort(([left], [right]) => left.localeCompare(right))[0]?.[0];
            return monsterKey === undefined ? [] : [{player, monsterKey}];
        })[0];
    if (!placement) {
        throw new Error(`No fixture places a monster ${distance} cells from the player.`);
    }
    const base: CampaignState = {
        ...generated,
        overworld: {...generated.overworld, playerPosition: placement.player}
    };
    const {x, y} = parsePosition(placement.monsterKey);
    const definition = MONSTER_DEFINITIONS[typeId];
    const monster: MonsterState = {
        id: 'test/monster-1',
        typeId,
        variantIds: [],
        elite: false,
        position: {x: x!, y: y!},
        spawnPosition: {x: x!, y: y!},
        health: definition.maxHealth,
        maxHealth: definition.maxHealth,
        armor: definition.armor,
        actionCount: 0,
        nextMoveTurn: 0,
        nextAttackTurn: 0,
        revealed: true,
        intent: null,
        statuses: [],
        undamagedTurns: 0,
        drop: null
    };
    return {
        monster,
        state: {
            ...base,
            overworld: {...base.overworld, monsters: [monster], traps: [], items: []}
        }
    };
}

describe('monster registry', () => {
    it('maps every monster type to a distinct atlas frame in range', () => {
        const frames = MONSTER_TYPE_IDS.map(typeId =>
            MONSTER_DEFINITIONS[typeId].spriteFrame
        );
        expect(new Set(frames).size).toBe(MONSTER_TYPE_IDS.length);
        for (const frame of frames) {
            expect(frame).toBeGreaterThanOrEqual(0);
            expect(frame).toBeLessThanOrEqual(49);
        }
        expect(Object.keys(MONSTER_SPRITES).sort())
            .toEqual([...MONSTER_TYPE_IDS].sort());
    });

    it('offers a much wider roster than the original six archetypes', () => {
        expect(MONSTER_TYPE_IDS.length).toBeGreaterThanOrEqual(14);
        const strategies = new Set(MONSTER_TYPE_IDS.map(typeId =>
            MONSTER_DEFINITIONS[typeId].strategyId
        ));
        expect(strategies).toContain('ambusher');
        expect(strategies).toContain('caster');
    });

    it('scales threat with the danger a monster actually poses', () => {
        const slime = MONSTER_DEFINITIONS['moss-slime'];
        const guardian = MONSTER_DEFINITIONS['maze-guardian'];
        expect(guardian.threat).toBeGreaterThan(slime.threat);
        expect(guardian.maxHealth).toBeGreaterThan(slime.maxHealth);
        expect(guardian.baseDamage).toBeGreaterThan(slime.baseDamage);
        for (const typeId of MONSTER_TYPE_IDS) {
            const definition = MONSTER_DEFINITIONS[typeId];
            expect(definition.threat).toBeGreaterThan(0);
            expect(definition.moveEveryTurns).toBeGreaterThanOrEqual(1);
        }
    });

    it('validates saves that carry the new monster types', () => {
        const {state} = withLoneMonster('maze-guardian', 4);
        expect(() => campaignStateSchema.parse(state)).not.toThrow();
    });
});

describe('new monster strategies', () => {
    it('lets an ambusher close ground faster than a plain pursuer', () => {
        const distance = 6;
        const advance = (typeId: MonsterTypeId): number => {
            const {state} = withLoneMonster(typeId, distance);
            const result = resolveOverworldAction(state, {kind: 'wait'});
            const moved = result.state.overworld.monsters[0]!;
            const distances = getPassageDistances(
                result.state.overworld.maze,
                result.state.overworld.playerPosition
            );
            return distances.get(`${moved.position.x},${moved.position.y}`) ?? distance;
        };

        const ambusherDistance = advance('giant-spider');
        const pursuerDistance = advance('skeleton');
        expect(ambusherDistance).toBeLessThan(distance);
        expect(ambusherDistance).toBeLessThan(pursuerDistance);
    });

    it('never lets an ambusher leap onto the player instead of telegraphing', () => {
        for (const distance of [3, 4, 5, 6]) {
            const {state} = withLoneMonster('shadow-stalker', distance);
            const result = resolveOverworldAction(state, {kind: 'wait'});
            const moved = result.state.overworld.monsters[0]!;
            expect(moved.position).not.toEqual(result.state.overworld.playerPosition);
        }
    });

    it('telegraphs a ranged strike when a caster has line of sight', () => {
        const {state} = withLoneMonster('frost-wraith', 1);
        const result = resolveOverworldAction(state, {kind: 'wait'});
        const caster = result.state.overworld.monsters[0]!;

        expect(caster.intent).not.toBeNull();
        expect(caster.intent?.kind).toBe('ranged');
    });
});
