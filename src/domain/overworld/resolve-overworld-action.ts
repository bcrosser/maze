import type {
    CampaignState,
    PendingDefeatChoice,
    PlayerProgress,
    PlayerStatus
} from '../campaign/campaign-state';
import {calculateMonsterMoneyDrop, creditMoney} from '../economy/economy';
import {
    createItemInstance,
    ITEM_DEFINITIONS,
    type ItemChoiceId,
    type ItemDefinition,
    type ItemInstance,
    type ItemTypeId,
    type WorldItemState
} from '../entities/item-types';
import {
    MONSTER_DEFINITIONS,
    type MonsterIntent,
    type MonsterState
} from '../entities/monster-types';
import type {PendingHazardState, TrapState} from '../entities/trap-types';
import {MATERIALS, type MaterialTag} from '../materials/materials';
import {Mulberry32Random, chooseRandom} from '../random/random-source';
import {deriveSeed} from '../random/seed-derivation';
import {
    advanceCampaignLevel,
    getCampaignLevelNumber,
    getLevelExitStatus,
    getLevelTier,
    MAX_CAMPAIGN_LEVEL
} from '../campaign/level-progression';
import {
    DIRECTION_VECTORS,
    type DirectionId
} from './move-player';
import {PASSAGE_CELL, type Coordinate, type MazeCell, type MazeGrid} from './maze-types';
import {initializeLevelContent} from './level-content-generator';
import {
    CASINO_HEIST_UNLOCK_FLAG,
    OBJECTIVE_BY_ID,
    type ObjectiveId
} from './level-objectives';
import {getPassageDistances} from './objective-placement';

export type OverworldAction =
    | {
        readonly kind: 'move';
        readonly direction: DirectionId;
        readonly pickup?: {
            readonly itemId: string;
            readonly choice: 'equip' | 'salvage' | 'leave' | ItemChoiceId;
            readonly replacementChoice?: 'store' | 'salvage' | 'leave';
        };
    }
    | {readonly kind: 'melee'; readonly direction: DirectionId}
    | {readonly kind: 'ranged'; readonly direction: DirectionId}
    | {readonly kind: 'mine'; readonly direction: DirectionId}
    | {
        readonly kind: 'use-item';
        readonly itemId: string;
        readonly direction?: DirectionId;
        readonly choiceId?: ItemChoiceId;
    }
    | {readonly kind: 'equip'; readonly itemId: string}
    | {readonly kind: 'salvage'; readonly itemId: string}
    | {readonly kind: 'place-item'; readonly itemId: string; readonly direction: DirectionId}
    | {readonly kind: 'interact'; readonly direction?: DirectionId}
    | {readonly kind: 'disarm'; readonly direction: DirectionId}
    | {readonly kind: 'wait'}
    | {readonly kind: 'resolve-defeat'; readonly choice: 'feather' | 'retreat'}
    | {
        readonly kind: 'claim-sanctuary-service';
        readonly objectiveId: ObjectiveId;
        readonly service: 'heal' | 'recharge';
    }
    | {
        readonly kind: 'choose-level-reward';
        readonly choice:
            | 'repair'
            | 'supply'
            | 'armory-equip'
            | 'armory-salvage'
            | 'armory-leave';
    };

export type OverworldEvent =
    | {readonly kind: 'blocked'; readonly message: string}
    | {
        readonly kind: 'choice-required';
        readonly itemId: string;
        readonly itemTypeId: ItemTypeId;
        readonly options: readonly {
            readonly id: string;
            readonly label: string;
        }[];
        readonly message: string;
    }
    | {readonly kind: 'moved'; readonly message: string}
    | {readonly kind: 'item-picked-up'; readonly itemId: string; readonly message: string}
    | {readonly kind: 'item-used'; readonly itemId: string; readonly message: string}
    | {readonly kind: 'monster-intent'; readonly monsterId: string; readonly message: string}
    | {readonly kind: 'monster-moved'; readonly monsterId: string; readonly message: string}
    | {readonly kind: 'monster-damaged'; readonly monsterId: string; readonly message: string}
    | {
        readonly kind: 'monster-defeated';
        readonly monsterId: string;
        readonly moneyDropped: number;
        readonly message: string;
    }
    | {readonly kind: 'player-damaged'; readonly amount: number; readonly message: string}
    | {readonly kind: 'trap'; readonly trapId: string; readonly message: string}
    | {readonly kind: 'sanctuary-service'; readonly message: string}
    | {readonly kind: 'level-reward'; readonly message: string}
    | {readonly kind: 'defeat'; readonly message: string}
    | {readonly kind: 'recovered'; readonly message: string};

export interface ResolveOverworldContext {
    readonly difficulty?: 'story' | 'standard' | 'expert';
}

export interface OverworldActionResult {
    readonly state: CampaignState;
    readonly events: readonly OverworldEvent[];
    readonly consumedTurn: boolean;
}

type DamageElement = 'neutral' | 'fire' | 'ice' | 'lightning';
type DamageCause = Exclude<PendingDefeatChoice['cause'], 'encounter'>;

interface IncomingDamageEvent {
    readonly amount: number;
    readonly cause: DamageCause;
    readonly element: DamageElement;
    readonly sourceId: string;
    readonly appliesPoison?: boolean;
}

const DIRECTIONS = Object.values(DIRECTION_VECTORS);

function key(position: Coordinate): string {
    return `${position.x},${position.y}`;
}

function samePosition(left: Coordinate, right: Coordinate): boolean {
    return left.x === right.x && left.y === right.y;
}

function offset(position: Coordinate, direction: DirectionId): Coordinate {
    const vector = DIRECTION_VECTORS[direction];
    return {x: position.x + vector.x, y: position.y + vector.y};
}

function isPassage(maze: MazeGrid, position: Coordinate): boolean {
    return maze[position.y]?.[position.x]?.kind === 'passage';
}

function replaceMazeCell(maze: MazeGrid, position: Coordinate, cell: MazeCell): MazeGrid {
    const nextRow = [...maze[position.y]!];
    nextRow[position.x] = cell;
    const nextMaze: (readonly MazeCell[])[] = [...maze];
    nextMaze[position.y] = nextRow;
    return nextMaze;
}

function removeBackpackItem(player: PlayerProgress, itemId: string, amount = 1): PlayerProgress {
    const item = player.backpack.find(candidate => candidate.id === itemId);
    if (!item) return player;
    const backpack = item.quantity > amount
        ? player.backpack.map(candidate =>
            candidate.id === itemId ? {...candidate, quantity: candidate.quantity - amount} : candidate
        )
        : player.backpack.filter(candidate => candidate.id !== itemId);
    return {
        ...player,
        backpack,
        quickSlotItemIds: player.quickSlotItemIds.map(id =>
            id === itemId && !backpack.some(candidate => candidate.id === itemId) ? null : id
        ) as [string | null, string | null, string | null]
    };
}

function addStatus(
    statuses: readonly PlayerStatus[],
    status: PlayerStatus
): readonly PlayerStatus[] {
    return [
        ...statuses.filter(candidate => candidate.kind !== status.kind),
        status
    ];
}

function addToBackpack(
    player: PlayerProgress,
    instance: ItemInstance
): {readonly player: PlayerProgress; readonly stored: boolean} {
    const definition = ITEM_DEFINITIONS[instance.baseTypeId];
    if (definition.category === 'currency') {
        return {player: {...player, money: player.money + instance.quantity}, stored: true};
    }
    const stack = player.backpack.find(candidate =>
        candidate.baseTypeId === instance.baseTypeId &&
        candidate.quality === instance.quality &&
        candidate.affixIds.join('|') === instance.affixIds.join('|') &&
        candidate.quantity < 3
    );
    if (stack && definition.category === 'consumable') {
        const accepted = Math.min(instance.quantity, 3 - stack.quantity);
        if (accepted === instance.quantity) {
            return {
                player: {
                    ...player,
                    backpack: player.backpack.map(candidate =>
                        candidate.id === stack.id
                            ? {...candidate, quantity: candidate.quantity + accepted}
                            : candidate
                    )
                },
                stored: true
            };
        }
    }
    if (player.backpack.length >= 8) return {player, stored: false};
    return {player: {...player, backpack: [...player.backpack, instance]}, stored: true};
}

function salvageValue(instance: ItemInstance): number {
    return instance.quality === 'rare' ? 4 : instance.quality === 'uncommon' ? 2 : 1;
}

function applyMysteryChoice(player: PlayerProgress, choiceId: ItemChoiceId): PlayerProgress {
    switch (choiceId) {
        case 'mend': {
            const missing = player.maxHealth - player.health;
            const restored = Math.min(4, missing);
            return {
                ...player,
                health: player.health + restored,
                scrap: player.scrap + Math.floor((4 - restored) / 2),
                statuses: player.statuses.filter(status => status.kind !== 'poison')
            };
        }
        case 'salvage':
            return {...player, scrap: player.scrap + 4};
        case 'tools':
            return {
                ...player,
                miningPower: Math.max(2, player.miningPower),
                toolCharge: player.toolCharge + 4
            };
        case 'guard':
            return {
                ...player,
                statuses: addStatus(player.statuses, {
                    kind: 'guard',
                    remainingTurns: 99,
                    charges: 1
                })
            };
    }
}

function pickupChoiceEvent(
    state: CampaignState,
    item: WorldItemState
): Extract<OverworldEvent, {kind: 'choice-required'}> {
    const definition = ITEM_DEFINITIONS[item.instance.baseTypeId];
    if (item.instance.baseTypeId === 'mystery-orb') {
        return {
            kind: 'choice-required',
            itemId: item.instance.id,
            itemTypeId: item.instance.baseTypeId,
            options: item.instance.rolledChoiceIds.map(choiceId => ({
                id: choiceId,
                label: choiceId === 'mend'
                    ? 'Mend: restore up to 4 health'
                    : choiceId === 'salvage'
                        ? 'Salvage: gain 4 scrap'
                        : choiceId === 'tools'
                            ? 'Tools: gain mining power and charges'
                            : 'Guard: prevent the next hit'
            })),
            message: 'Choose one revealed Mystery Orb effect.'
        };
    }

    const equipped = definition.category === 'weapon'
        ? state.player.equippedWeapon
        : state.player.equippedUtility;
    const options: {id: string; label: string}[] = [];
    if (!equipped) {
        options.push({id: 'equip', label: `Equip ${definition.label}`});
    } else {
        if (state.player.backpack.length < 8) {
            options.push({
                id: 'equip-store',
                label: `Equip; store ${ITEM_DEFINITIONS[equipped.baseTypeId].label}`
            });
        }
        options.push({
            id: 'equip-salvage',
            label: `Equip; salvage ${ITEM_DEFINITIONS[equipped.baseTypeId].label}`
        });
        options.push({
            id: 'equip-leave',
            label: `Equip; leave ${ITEM_DEFINITIONS[equipped.baseTypeId].label}`
        });
    }
    options.push(
        {id: 'salvage', label: `Salvage ${definition.label}`},
        {id: 'leave', label: 'Leave it here'}
    );
    return {
        kind: 'choice-required',
        itemId: item.instance.id,
        itemTypeId: item.instance.baseTypeId,
        options,
        message: `Choose what to do with ${definition.label}.`
    };
}

function requiredPickupChoice(
    state: CampaignState,
    action: OverworldAction
): Extract<OverworldEvent, {kind: 'choice-required'}> | null {
    if (action.kind !== 'move') return null;
    if (state.player.statuses.some(status => status.kind === 'rooted')) return null;
    const target = offset(state.overworld.playerPosition, action.direction);
    if (!isPassage(state.overworld.maze, target) || monsterAt(state.overworld.monsters, target)) {
        return null;
    }
    const item = state.overworld.items.find(candidate => samePosition(candidate.position, target));
    if (!item) return null;
    const category = ITEM_DEFINITIONS[item.instance.baseTypeId].category;
    if (category !== 'weapon' && category !== 'utility' && category !== 'choice') return null;

    const prompt = pickupChoiceEvent(state, item);
    if (!action.pickup || action.pickup.itemId !== item.instance.id) return prompt;
    const validOptionIds = new Set(prompt.options.map(option => option.id));
    const choiceId = action.pickup.choice === 'equip' && action.pickup.replacementChoice
        ? `equip-${action.pickup.replacementChoice}`
        : action.pickup.choice;
    return validOptionIds.has(choiceId) ? null : prompt;
}

function pickupAtPlayer(
    state: CampaignState,
    events: OverworldEvent[],
    action: OverworldAction
): CampaignState {
    const worldItem = state.overworld.items.find(item =>
        samePosition(item.position, state.overworld.playerPosition)
    );
    if (!worldItem) return state;
    const definition = ITEM_DEFINITIONS[worldItem.instance.baseTypeId];
    let player = state.player;
    let stored = false;
    let replacementItem: WorldItemState | null = null;
    const requiresChoice = definition.category === 'weapon' ||
        definition.category === 'utility' ||
        definition.category === 'choice';
    if (requiresChoice) {
        if (
            action.kind !== 'move' ||
            action.pickup?.itemId !== worldItem.instance.id
        ) return state;
        if (definition.category === 'choice') {
            const choiceId = action.pickup.choice;
            if (!worldItem.instance.rolledChoiceIds.includes(choiceId as ItemChoiceId)) return state;
            player = applyMysteryChoice(player, choiceId as ItemChoiceId);
            stored = true;
        } else if (action.pickup.choice === 'salvage') {
            player = {...player, scrap: player.scrap + salvageValue(worldItem.instance)};
            stored = true;
        } else if (action.pickup.choice === 'leave') {
            return state;
        } else if (action.pickup.choice === 'equip') {
            const prior = definition.category === 'weapon'
                ? player.equippedWeapon
                : player.equippedUtility;
            if (prior) {
                if (action.pickup.replacementChoice === 'store') {
                    const added = addToBackpack(player, prior);
                    if (!added.stored) return state;
                    player = added.player;
                } else if (action.pickup.replacementChoice === 'salvage') {
                    player = {...player, scrap: player.scrap + salvageValue(prior)};
                } else if (action.pickup.replacementChoice === 'leave') {
                    replacementItem = {instance: prior, position: worldItem.position};
                } else {
                    return state;
                }
            }
            player = {
                ...player,
                ...(definition.category === 'weapon'
                    ? {
                        equippedWeapon: worldItem.instance,
                        bowAmmo: worldItem.instance.baseTypeId === 'bow'
                            ? Math.max(6, player.bowAmmo)
                            : player.bowAmmo
                    }
                    : {equippedUtility: worldItem.instance})
            };
            stored = true;
        }
    } else {
        const added = addToBackpack(player, worldItem.instance);
        player = added.player;
        stored = added.stored;
    }
    if (!stored) return state;
    events.push({
        kind: 'item-picked-up',
        itemId: worldItem.instance.id,
        message: `${definition.label} collected.`
    });
    return {
        ...state,
        flags:
            worldItem.instance.baseTypeId === 'car' &&
            !state.flags.includes(CASINO_HEIST_UNLOCK_FLAG)
                ? [...state.flags, CASINO_HEIST_UNLOCK_FLAG]
                : state.flags,
        player,
        overworld: {
            ...state.overworld,
            items: [
                ...state.overworld.items.filter(item =>
                    item.instance.id !== worldItem.instance.id
                ),
                ...(replacementItem ? [replacementItem] : [])
            ]
        }
    };
}

function weaponStats(player: PlayerProgress): {
    readonly typeId: ItemTypeId | 'improvised';
    readonly damage: number;
    readonly range: number;
    readonly piercing: number;
} {
    const weapon = player.equippedWeapon;
    if (!weapon) return {typeId: 'improvised', damage: 1, range: 1, piercing: 0};
    const definition: ItemDefinition = ITEM_DEFINITIONS[weapon.baseTypeId];
    const qualityBonus = weapon.quality === 'rare' ? 1 : 0;
    return {
        typeId: weapon.baseTypeId,
        damage: Math.min(4, (definition.baseDamage ?? 1) +
            (weapon.affixIds.includes('keen') ? 1 : 0) + qualityBonus),
        range: (definition.baseRange ?? 1) + (weapon.affixIds.includes('extended') ? 1 : 0),
        piercing: weapon.affixIds.includes('piercing') ? 1 : 0
    };
}

function monsterAt(monsters: readonly MonsterState[], position: Coordinate): MonsterState | null {
    return monsters.find(monster => samePosition(monster.position, position)) ?? null;
}

function volatileHazard(
    state: CampaignState,
    monster: MonsterState
): PendingHazardState {
    const targetPositions = [
        monster.position,
        ...DIRECTIONS.map(direction => ({
            x: monster.position.x + direction.x,
            y: monster.position.y + direction.y
        })).filter(position => isPassage(state.overworld.maze, position))
    ];
    return {
        id: `${monster.id}/volatile`,
        typeId: 'volatile-explosion',
        origin: monster.position,
        targetPositions,
        executeAfterTurn: state.overworld.turn + 2
    };
}

function freeDropPosition(
    state: CampaignState,
    origin: Coordinate,
    additionalItems: readonly WorldItemState[]
): Coordinate | null {
    const occupied = new Set([
        ...state.overworld.items.map(item => key(item.position)),
        ...additionalItems.map(item => key(item.position)),
        ...state.overworld.objectives.map(objective => key(objective.position)),
        ...state.overworld.serviceSites.map(site => key(site.position))
    ]);
    if (!occupied.has(key(origin))) return origin;
    const distances = getPassageDistances(state.overworld.maze, origin);
    const candidates = [...distances.entries()]
        .map(([coordinateKey, value]) => {
            const [x, y] = coordinateKey.split(',').map(Number);
            return {position: {x: x!, y: y!}, value};
        })
        .filter(candidate => !occupied.has(key(candidate.position)))
        .sort((left, right) =>
            left.value - right.value ||
            left.position.y - right.position.y ||
            left.position.x - right.position.x
        );
    return candidates[0]?.position ?? null;
}

function killMonster(
    state: CampaignState,
    monster: MonsterState,
    events: OverworldEvent[]
): CampaignState {
    let items = [...state.overworld.items];
    if (monster.drop) {
        const dropPosition = freeDropPosition(state, monster.position, items);
        if (dropPosition) items.push({instance: monster.drop, position: dropPosition});
    }
    let mercyDropUsed = state.overworld.mercyDropUsed;
    const hasHealing = state.player.backpack.some(item =>
        item.baseTypeId === 'health-potion' || item.baseTypeId === 'antidote'
    );
    if (!mercyDropUsed && state.player.health <= 3 && !hasHealing) {
        const mercyPosition = freeDropPosition(state, monster.position, items);
        if (mercyPosition) {
            items.push({
                instance: {
                    id: `${state.overworld.levelId}/mercy-potion`,
                    baseTypeId: 'health-potion',
                    quality: 'common',
                    affixIds: [],
                    rolledChoiceIds: [],
                    quantity: 1,
                    charges: null
                },
                position: mercyPosition
            });
            mercyDropUsed = true;
        }
    }
    const pendingHazards = monster.variantIds.includes('volatile')
        ? [...state.overworld.pendingHazards, volatileHazard(state, monster)]
        : state.overworld.pendingHazards;
    const moneyDropped = calculateMonsterMoneyDrop(monster);
    events.push({
        kind: 'monster-defeated',
        monsterId: monster.id,
        moneyDropped,
        message: `${MONSTER_DEFINITIONS[monster.typeId].label} defeated. ` +
            `$${moneyDropped} recovered.`
    });
    const rewardedState = creditMoney(state, moneyDropped);
    return {
        ...rewardedState,
        overworld: {
            ...rewardedState.overworld,
            monsters: rewardedState.overworld.monsters.filter(candidate =>
                candidate.id !== monster.id
            ),
            items,
            pendingHazards,
            mercyDropUsed
        }
    };
}

function attackMonster(
    state: CampaignState,
    monster: MonsterState,
    damage: number,
    piercing: number,
    events: OverworldEvent[]
): {readonly state: CampaignState; readonly killed: boolean} {
    const dealt = Math.max(1, damage - Math.max(0, monster.armor - piercing));
    const health = Math.max(0, monster.health - dealt);
    events.push({
        kind: 'monster-damaged',
        monsterId: monster.id,
        message: `${MONSTER_DEFINITIONS[monster.typeId].label} took ${dealt} damage.`
    });
    let nextState: CampaignState = {
        ...state,
        overworld: {
            ...state.overworld,
            monsters: state.overworld.monsters.map(candidate =>
                candidate.id === monster.id
                    ? {...candidate, health, undamagedTurns: 0}
                    : candidate
            )
        }
    };
    if (health > 0) return {state: nextState, killed: false};
    nextState = killMonster(nextState, {...monster, health: 0}, events);
    return {state: nextState, killed: true};
}

function attackWithEquippedWeapon(
    state: CampaignState,
    monster: MonsterState,
    damage: number,
    piercing: number,
    events: OverworldEvent[]
): {readonly state: CampaignState; readonly killed: boolean} {
    const weapon = state.player.equippedWeapon;
    const emberBonus = weapon?.affixIds.includes('ember-bound') &&
        touchesWallTag(state.overworld.maze, monster.position, 'cold') ? 1 : 0;
    let attacked = attackMonster(state, monster, damage + emberBonus, piercing, events);

    if (
        !attacked.killed &&
        weapon?.affixIds.includes('frost-bound')
    ) {
        attacked = {
            ...attacked,
            state: {
                ...attacked.state,
                overworld: {
                    ...attacked.state.overworld,
                    monsters: attacked.state.overworld.monsters.map(candidate =>
                        candidate.id === monster.id &&
                        !candidate.statuses.some(status => status.kind === 'frost-delayed')
                            ? {
                                ...candidate,
                                statuses: [
                                    ...candidate.statuses,
                                    {kind: 'frost-delayed' as const, remainingTurns: 1}
                                ]
                            }
                            : candidate
                    )
                }
            }
        };
    }

    if (
        weapon?.affixIds.includes('arc-bound') &&
        (
            touchesWallTag(state.overworld.maze, monster.position, 'wet') ||
            touchesWallTag(state.overworld.maze, monster.position, 'conductive')
        )
    ) {
        const distances = getPassageDistances(state.overworld.maze, monster.position);
        const chained = attacked.state.overworld.monsters
            .filter(candidate =>
                candidate.id !== monster.id &&
                (distances.get(key(candidate.position)) ?? Number.POSITIVE_INFINITY) <= 2
            )
            .sort((left, right) =>
                (distances.get(key(left.position)) ?? Number.POSITIVE_INFINITY) -
                    (distances.get(key(right.position)) ?? Number.POSITIVE_INFINITY) ||
                left.position.y - right.position.y ||
                left.position.x - right.position.x ||
                left.id.localeCompare(right.id)
            )[0];
        if (chained) {
            attacked = {
                ...attacked,
                state: attackMonster(attacked.state, chained, 1, 0, events).state
            };
        }
    }

    return attacked;
}

function lineTarget(
    state: CampaignState,
    direction: DirectionId,
    range: number
): MonsterState | null {
    let position = state.overworld.playerPosition;
    for (let step = 0; step < range; step++) {
        position = offset(position, direction);
        if (!isPassage(state.overworld.maze, position)) return null;
        const monster = monsterAt(state.overworld.monsters, position);
        if (monster) return monster;
    }
    return null;
}

function applyUseItem(
    state: CampaignState,
    action: Extract<OverworldAction, {kind: 'use-item'}>,
    events: OverworldEvent[]
): CampaignState | null {
    const item = state.player.backpack.find(candidate => candidate.id === action.itemId);
    if (!item) return null;
    let player = state.player;
    let consumed = true;
    let message = `${ITEM_DEFINITIONS[item.baseTypeId].label} used.`;
    switch (item.baseTypeId) {
        case 'health-potion': {
            const base = item.quality === 'rare' ? 6 : 4;
            const restored = Math.min(base, player.maxHealth - player.health);
            if (restored === 0) return null;
            player = {...player, health: player.health + restored};
            message = `Restored ${restored} health.`;
            break;
        }
        case 'antidote':
            player = {
                ...player,
                health: Math.min(player.maxHealth, player.health + 1),
                statuses: player.statuses.filter(status => status.kind !== 'poison')
            };
            break;
        case 'fire-ward':
        case 'ice-ward':
        case 'lightning-ward':
            player = {
                ...player,
                statuses: addStatus(player.statuses, {
                    kind: item.baseTypeId,
                    remainingTurns: 99,
                    charges: 2
                })
            };
            break;
        case 'map-scroll':
            player = {
                ...player,
                statuses: addStatus(player.statuses, {
                    kind: 'map-reveal',
                    remainingTurns: 20,
                    charges: 0
                })
            };
            break;
        case 'mining-pick': {
            const power = item.quality === 'rare' ? 4 : item.quality === 'uncommon' ? 3 : 2;
            const charges = item.quality === 'rare' ? 4 : item.quality === 'uncommon' ? 5 : 6;
            player = {
                ...player,
                miningPower: Math.max(power, player.miningPower),
                toolCharge: player.toolCharge + charges
            };
            break;
        }
        case 'ammo-bundle': {
            const efficient = player.equippedWeapon?.affixIds.includes('efficient') ?? false;
            const cap = efficient ? 16 : 12;
            if (player.bowAmmo >= cap) return null;
            player = {...player, bowAmmo: Math.min(cap, player.bowAmmo + (efficient ? 8 : 6))};
            break;
        }
        case 'bomb': {
            if (!action.direction) return null;
            let target = state.overworld.playerPosition;
            let wallTarget: Coordinate | null = null;
            for (let step = 0; step < 4; step++) {
                const next = offset(target, action.direction);
                if (!isPassage(state.overworld.maze, next)) {
                    wallTarget = next;
                    break;
                }
                target = next;
            }
            let nextState = {...state, player};
            if (wallTarget) {
                const wall = nextState.overworld.maze[wallTarget.y]?.[wallTarget.x];
                const perimeter = wallTarget.x === 0 || wallTarget.y === 0 ||
                    wallTarget.x === nextState.overworld.maze.length - 1 ||
                    wallTarget.y === nextState.overworld.maze.length - 1;
                const shortcut = nextState.overworld.pipeShortcutWall &&
                    samePosition(nextState.overworld.pipeShortcutWall, wallTarget);
                if (wall?.kind === 'wall' && !perimeter && !shortcut) {
                    const tags: readonly MaterialTag[] = MATERIALS[wall.materialId].tags;
                    if (tags.includes('flammable') || tags.includes('organic')) {
                        nextState = {
                            ...nextState,
                            overworld: {
                                ...nextState.overworld,
                                maze: replaceMazeCell(
                                    nextState.overworld.maze,
                                    wallTarget,
                                    PASSAGE_CELL
                                )
                            }
                        };
                        target = wallTarget;
                    }
                }
            }
            const victims = nextState.overworld.monsters.filter(monster =>
                Math.abs(monster.position.x - target.x) + Math.abs(monster.position.y - target.y) <= 1
            );
            for (const victim of victims) {
                const current = nextState.overworld.monsters.find(monster => monster.id === victim.id);
                if (current) nextState = attackMonster(nextState, current, 4, 0, events).state;
            }
            player = nextState.player;
            state = nextState;
            break;
        }
        case 'snare-kit': {
            if (!action.direction) return null;
            const position = offset(state.overworld.playerPosition, action.direction);
            if (
                !isPassage(state.overworld.maze, position) ||
                state.overworld.traps.some(trap => samePosition(trap.position, position))
            ) return null;
            state = {
                ...state,
                overworld: {
                    ...state.overworld,
                    traps: [...state.overworld.traps, {
                        id: `${state.overworld.levelId}/player-snare-${state.overworld.turn}`,
                        typeId: 'snare',
                        position,
                        owner: 'player',
                        revealed: true,
                        disabled: false,
                        phase: 0,
                        nextPhaseTurn: 0
                    }]
                }
            };
            break;
        }
        case 'mystery-orb': {
            if (!action.choiceId || !item.rolledChoiceIds.includes(action.choiceId)) return null;
            switch (action.choiceId) {
                case 'mend': {
                    const missing = player.maxHealth - player.health;
                    const restored = Math.min(4, missing);
                    player = {
                        ...player,
                        health: player.health + restored,
                        scrap: player.scrap + Math.floor((4 - restored) / 2),
                        statuses: player.statuses.filter(status => status.kind !== 'poison')
                    };
                    break;
                }
                case 'salvage':
                    player = {...player, scrap: player.scrap + 4};
                    break;
                case 'tools':
                    player = {
                        ...player,
                        miningPower: Math.max(2, player.miningPower),
                        toolCharge: player.toolCharge + 4
                    };
                    break;
                case 'guard':
                    player = {
                        ...player,
                        statuses: addStatus(player.statuses, {
                            kind: 'guard',
                            remainingTurns: 99,
                            charges: 1
                        })
                    };
                    break;
            }
            break;
        }
        default:
            consumed = false;
            return null;
    }
    if (consumed) player = removeBackpackItem(player, item.id);
    events.push({kind: 'item-used', itemId: item.id, message});
    return {...state, player};
}

function applyPlayerAction(
    state: CampaignState,
    action: OverworldAction,
    events: OverworldEvent[]
): {readonly state: CampaignState; readonly valid: boolean} {
    if (action.kind === 'resolve-defeat' || action.kind === 'choose-level-reward') {
        return {state, valid: false};
    }
    if (state.player.weaponRecoveryActions > 0 && ['melee', 'ranged'].includes(action.kind)) {
        events.push({kind: 'blocked', message: 'The axe needs one action to recover.'});
        return {state, valid: false};
    }

    if (action.kind === 'wait') return {state, valid: true};

    if (action.kind === 'equip') {
        const item = state.player.backpack.find(candidate => candidate.id === action.itemId);
        if (!item) return {state, valid: false};
        const definition = ITEM_DEFINITIONS[item.baseTypeId];
        if (definition.category !== 'weapon' && definition.category !== 'utility') {
            return {state, valid: false};
        }
        const prior = definition.category === 'weapon'
            ? state.player.equippedWeapon
            : state.player.equippedUtility;
        let backpack = state.player.backpack.filter(candidate => candidate.id !== item.id);
        if (prior) backpack = [...backpack, prior];
        const quickSlotItemIds = state.player.quickSlotItemIds.map(id =>
            id === item.id ? null : id
        ) as [string | null, string | null, string | null];
        return {
            valid: true,
            state: {
                ...state,
                player: {
                    ...state.player,
                    backpack,
                    quickSlotItemIds,
                    ...(definition.category === 'weapon'
                        ? {
                            equippedWeapon: item,
                            bowAmmo: item.baseTypeId === 'bow'
                                ? Math.max(6, state.player.bowAmmo)
                                : state.player.bowAmmo
                        }
                        : {equippedUtility: item})
                }
            }
        };
    }

    if (action.kind === 'salvage') {
        const item = state.player.backpack.find(candidate => candidate.id === action.itemId);
        if (!item) return {state, valid: false};
        const value = salvageValue(item);
        return {
            valid: true,
            state: {
                ...state,
                player: {
                    ...removeBackpackItem(state.player, item.id, item.quantity),
                    scrap: state.player.scrap + value
                }
            }
        };
    }

    if (action.kind === 'use-item') {
        const next = applyUseItem(state, action, events);
        return next ? {state: next, valid: true} : {state, valid: false};
    }

    if (action.kind === 'place-item') {
        const next = applyUseItem(state, {
            kind: 'use-item',
            itemId: action.itemId,
            direction: action.direction
        }, events);
        return next ? {state: next, valid: true} : {state, valid: false};
    }

    if (action.kind === 'claim-sanctuary-service') {
        const placement = state.overworld.objectives.find(objective =>
            objective.objectiveId === action.objectiveId
        );
        if (
            !placement ||
            !samePosition(placement.position, state.overworld.playerPosition) ||
            !state.flags.includes(OBJECTIVE_BY_ID[action.objectiveId].completionFlag)
        ) {
            return {state, valid: false};
        }
        const entitlement = state.overworld.objectives.find(objective =>
            state.flags.includes(OBJECTIVE_BY_ID[objective.objectiveId].completionFlag) &&
            !state.overworld.sanctuaryServiceClaims.includes(objective.objectiveId)
        );
        if (!entitlement) return {state, valid: false};

        let player = state.player;
        let message: string;
        if (action.service === 'heal') {
            if (player.scrap < 2 || player.health >= player.maxHealth) {
                return {state, valid: false};
            }
            player = {
                ...player,
                scrap: player.scrap - 2,
                health: Math.min(player.maxHealth, player.health + 2)
            };
            message = 'Sanctuary restored 2 health for 2 scrap.';
        } else {
            const utility = player.equippedUtility;
            const utilityDefinition: ItemDefinition | null = utility
                ? ITEM_DEFINITIONS[utility.baseTypeId]
                : null;
            const baseCap = utilityDefinition?.baseCharges;
            const chargeCap = baseCap === undefined
                ? null
                : Math.min(5, baseCap + (utility?.affixIds.includes('durable') ? 2 : 0));
            if (
                player.scrap < 3 ||
                !utility ||
                utility.charges === null ||
                chargeCap === null ||
                utility.charges >= chargeCap
            ) {
                return {state, valid: false};
            }
            player = {
                ...player,
                scrap: player.scrap - 3,
                equippedUtility: {...utility, charges: utility.charges + 1}
            };
            message = 'Sanctuary restored one utility charge for 3 scrap.';
        }
        events.push({kind: 'sanctuary-service', message});
        return {
            valid: true,
            state: {
                ...state,
                player,
                overworld: {
                    ...state.overworld,
                sanctuaryServiceClaims: [
                    ...state.overworld.sanctuaryServiceClaims,
                    entitlement.objectiveId
                ]
                }
            }
        };
    }

    if (action.kind === 'interact') {
        if (!action.direction) return {state, valid: false};
        const next = applyPlayerAction(
            state,
            {kind: 'disarm', direction: action.direction},
            events
        );
        return next;
    }

    if (action.kind === 'disarm') {
        const target = offset(state.overworld.playerPosition, action.direction);
        const trap = state.overworld.traps.find(candidate =>
            samePosition(candidate.position, target) && !candidate.disabled
        );
        if (!trap) return {state, valid: false};
        const complex = ['gas-vent', 'arc-plate', 'flame-jet'].includes(trap.typeId);
        let player = state.player;
        if (complex) {
            const tool = player.equippedUtility;
            if (tool?.baseTypeId !== 'multitool' || (tool.charges ?? 0) <= 0) return {state, valid: false};
            player = {
                ...player,
                equippedUtility: {...tool, charges: (tool.charges ?? 0) - 1}
            };
        }
        events.push({kind: 'trap', trapId: trap.id, message: `${trap.typeId} disabled.`});
        return {
            valid: true,
            state: {
                ...state,
                player,
                overworld: {
                    ...state.overworld,
                    traps: state.overworld.traps.map(candidate =>
                        candidate.id === trap.id ? {...candidate, disabled: true} : candidate
                    )
                }
            }
        };
    }

    const direction = action.direction;
    const weapon = weaponStats(state.player);
    if (action.kind === 'ranged') {
        if (weapon.typeId !== 'bow' && weapon.typeId !== 'spear') return {state, valid: false};
        if (weapon.typeId === 'bow' && state.player.bowAmmo <= 0) {
            const adjacent = monsterAt(
                state.overworld.monsters,
                offset(state.overworld.playerPosition, direction)
            );
            if (!adjacent) return {state, valid: false};
            return {
                valid: true,
                state: attackMonster(state, adjacent, 1, 0, events).state
            };
        }
        const target = lineTarget(state, direction, weapon.range);
        if (!target) return {state, valid: false};
        let nextState = state;
        if (weapon.typeId === 'bow') {
            nextState = {...nextState, player: {...nextState.player, bowAmmo: nextState.player.bowAmmo - 1}};
        }
        nextState = attackWithEquippedWeapon(
            nextState,
            target,
            weapon.damage,
            weapon.piercing,
            events
        ).state;
        return {state: nextState, valid: true};
    }

    const targetPosition = offset(state.overworld.playerPosition, direction);
    const targetMonster = monsterAt(state.overworld.monsters, targetPosition);
    if (action.kind === 'melee' || (action.kind !== 'mine' && targetMonster)) {
        if (!targetMonster) return {state, valid: false};
        const emptyBow = weapon.typeId === 'bow' && state.player.bowAmmo <= 0;
        const attacked = emptyBow
            ? attackMonster(state, targetMonster, 1, 0, events)
            : attackWithEquippedWeapon(
                state,
                targetMonster,
                weapon.damage,
                weapon.piercing,
                events
            );
        const player = weapon.typeId === 'axe'
            ? {...attacked.state.player, weaponRecoveryActions: 1 as const}
            : attacked.state.player;
        return {
            valid: true,
            state: attacked.killed && action.kind === 'move'
                ? {
                    ...attacked.state,
                    player,
                    overworld: {
                        ...attacked.state.overworld,
                        playerPosition: targetPosition
                    }
                }
                : {...attacked.state, player}
        };
    }

    const targetCell = state.overworld.maze[targetPosition.y]?.[targetPosition.x];
    if (!targetCell) return {state, valid: false};
    if (targetCell.kind === 'passage') {
        if (action.kind === 'mine') return {state, valid: false};
        const rooted = state.player.statuses.find(status => status.kind === 'rooted');
        if (rooted) {
            return {
                valid: true,
                state: {
                    ...state,
                    player: {
                        ...state.player,
                        statuses: state.player.statuses.filter(status => status.kind !== 'rooted')
                    }
                }
            };
        }
        return {
            valid: true,
            state: {
                ...state,
                overworld: {...state.overworld, playerPosition: targetPosition}
            }
        };
    }
    const perimeter = targetPosition.x === 0 || targetPosition.y === 0 ||
        targetPosition.x === state.overworld.maze.length - 1 ||
        targetPosition.y === state.overworld.maze.length - 1;
    const protectedShortcut = state.overworld.pipeShortcutWall &&
        samePosition(targetPosition, state.overworld.pipeShortcutWall);
    const material = MATERIALS[targetCell.materialId];
    const hardness = 'hardness' in material ? material.hardness : undefined;
    if (
        perimeter ||
        protectedShortcut ||
        hardness === undefined ||
        state.player.toolCharge <= 0 ||
        state.player.miningPower < hardness
    ) return {state, valid: false};
    const scrap = hardness >= 4 ? 2 : 1;
    return {
        valid: true,
        state: {
            ...state,
            player: {
                ...state.player,
                toolCharge: state.player.toolCharge - 1,
                scrap: state.player.scrap + scrap + (targetCell.materialId === 'gold' ? 1 : 0)
            },
            overworld: {
                ...state.overworld,
                maze: replaceMazeCell(state.overworld.maze, targetPosition, PASSAGE_CELL),
                playerPosition: targetPosition
            }
        }
    };
}

function stepToward(
    maze: MazeGrid,
    origin: Coordinate,
    target: Coordinate,
    blocked: ReadonlySet<string>
): Coordinate | null {
    const targetDistances = getPassageDistances(maze, target, blocked);
    return DIRECTIONS
        .map(direction => ({x: origin.x + direction.x, y: origin.y + direction.y}))
        .filter(position => isPassage(maze, position) && !blocked.has(key(position)))
        .sort((left, right) =>
            (targetDistances.get(key(left)) ?? Number.POSITIVE_INFINITY) -
            (targetDistances.get(key(right)) ?? Number.POSITIVE_INFINITY)
        )[0] ?? null;
}

function hasLineOfSight(
    maze: MazeGrid,
    from: Coordinate,
    to: Coordinate,
    range: number
): boolean {
    if (from.x !== to.x && from.y !== to.y) return false;
    const distance = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
    if (distance > range) return false;
    const step = {x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y)};
    let current = from;
    for (let index = 1; index < distance; index++) {
        current = {x: current.x + step.x, y: current.y + step.y};
        if (!isPassage(maze, current)) return false;
    }
    return true;
}

function touchesWallTag(
    maze: MazeGrid,
    position: Coordinate,
    tag: MaterialTag
): boolean {
    return DIRECTIONS.some(direction => {
        const cell = maze[position.y + direction.y]?.[position.x + direction.x];
        if (cell?.kind !== 'wall') return false;
        const tags: readonly MaterialTag[] = MATERIALS[cell.materialId].tags;
        return tags.includes(tag);
    });
}

function monsterDamage(monster: MonsterState, state: CampaignState): number {
    const definition = MONSTER_DEFINITIONS[monster.typeId];
    const emberBonus = monster.variantIds.includes('ember-touched') && (
        touchesWallTag(state.overworld.maze, monster.position, 'hot') ||
        touchesWallTag(state.overworld.maze, state.overworld.playerPosition, 'hot')
    ) ? 1 : 0;
    return definition.baseDamage + emberBonus;
}

function monsterDamageElement(monster: MonsterState): DamageElement {
    return monster.typeId === 'ember-hound' || monster.variantIds.includes('ember-touched')
        ? 'fire'
        : 'neutral';
}

function prepareIntent(monster: MonsterState, state: CampaignState): MonsterIntent {
    const definition = MONSTER_DEFINITIONS[monster.typeId];
    if (definition.strategyId === 'mimic' && !monster.revealed) {
        return {
            kind: 'reveal',
            targetPositions: [],
            damage: 0,
            executeOnTurn: state.overworld.turn + 1
        };
    }
    return {
        kind: definition.strategyId === 'sentry' ? 'ranged' : 'melee',
        targetPositions: [state.overworld.playerPosition],
        damage: monsterDamage(monster, state),
        executeOnTurn: state.overworld.turn + 1
    };
}

function monsterProtectedCells(state: CampaignState): ReadonlySet<string> {
    const protectedCells = new Set<string>([
        ...state.overworld.objectives.map(objective => key(objective.position)),
        key({
            x: state.overworld.maze.length - 2,
            y: state.overworld.maze.length - 2
        })
    ]);
    const sanctuaryDistances = getPassageDistances(
        state.overworld.maze,
        state.overworld.sanctuaryPosition
    );
    for (const [positionKey, distance] of sanctuaryDistances) {
        if (distance <= 2) protectedCells.add(positionKey);
    }
    return protectedCells;
}

function advanceMonsters(
    state: CampaignState,
    events: OverworldEvent[]
): {readonly state: CampaignState; readonly incomingDamage: readonly IncomingDamageEvent[]} {
    if (state.overworld.resumeGraceTurns > 0) {
        return {
            incomingDamage: [],
            state: {
                ...state,
                overworld: {
                    ...state.overworld,
                    resumeGraceTurns: state.overworld.resumeGraceTurns - 1,
                    monsters: state.overworld.monsters.map(monster => ({...monster, intent: null}))
                }
            }
        };
    }

    const incomingDamage: IncomingDamageEvent[] = [];
    const protectedCells = monsterProtectedCells(state);
    const sanctuaryDistances = getPassageDistances(
        state.overworld.maze,
        state.overworld.sanctuaryPosition
    );
    const playerIsProtected = (
        sanctuaryDistances.get(key(state.overworld.playerPosition)) ??
        Number.POSITIVE_INFINITY
    ) <= 2;
    const acted = new Set<string>();
    let monsters = [...state.overworld.monsters];
    for (const monster of monsters) {
        if (!monster.intent || monster.intent.executeOnTurn > state.overworld.turn) continue;
        acted.add(monster.id);
        if (monster.intent.kind === 'reveal') {
            monsters = monsters.map(candidate =>
                candidate.id === monster.id
                    ? {...candidate, revealed: true, intent: null, actionCount: candidate.actionCount + 1}
                    : candidate
            );
            continue;
        }
        if (!playerIsProtected && monster.intent.targetPositions.some(position =>
            samePosition(position, state.overworld.playerPosition)
        )) {
            incomingDamage.push({
                amount: monster.intent.damage,
                cause: 'monster',
                element: monsterDamageElement(monster),
                sourceId: monster.id,
                appliesPoison: monster.variantIds.includes('venomous')
            });
        }
        monsters = monsters.map(candidate =>
            candidate.id === monster.id
                ? {
                    ...candidate,
                    intent: null,
                    nextAttackTurn: state.overworld.turn +
                        MONSTER_DEFINITIONS[candidate.typeId].attackCooldownTurns,
                    actionCount: candidate.actionCount + 1
                }
                : candidate
        );
    }

    const occupied = new Set([
        ...monsters.map(monster => key(monster.position)),
        ...protectedCells
    ]);
    occupied.add(key(state.overworld.playerPosition));
    const playerDistances = getPassageDistances(state.overworld.maze, state.overworld.playerPosition);
    for (const monster of [...monsters].sort((left, right) => left.id.localeCompare(right.id))) {
        if (acted.has(monster.id)) continue;
        const current = monsters.find(candidate => candidate.id === monster.id)!;
        if (current.intent) continue;
        const definition = MONSTER_DEFINITIONS[current.typeId];
        const playerDistance = playerDistances.get(key(current.position)) ?? Number.POSITIVE_INFINITY;
        const sentrySees = definition.strategyId === 'sentry' &&
            hasLineOfSight(
                state.overworld.maze,
                current.position,
                state.overworld.playerPosition,
                definition.detectionDistance
            );
        const adjacent = playerDistance === 1;
        const canPrepare = !playerIsProtected &&
            state.overworld.turn >= current.nextAttackTurn &&
            (adjacent || sentrySees || (definition.strategyId === 'mimic' && playerDistance <= 2));
        if (canPrepare) {
            const intent = prepareIntent(current, state);
            monsters = monsters.map(candidate =>
                candidate.id === current.id
                    ? {...candidate, intent, actionCount: candidate.actionCount + 1}
                    : candidate
            );
            events.push({
                kind: 'monster-intent',
                monsterId: current.id,
                message: `${definition.label} telegraphs ${intent.kind}.`
            });
            continue;
        }
        if (state.overworld.turn < current.nextMoveTurn || definition.strategyId === 'sentry') {
            continue;
        }
        const spawnDistances = getPassageDistances(state.overworld.maze, current.spawnPosition);
        const playerDistanceFromSpawn = spawnDistances.get(
            key(state.overworld.playerPosition)
        ) ?? Number.POSITIVE_INFINITY;
        const awayFromSpawn = !samePosition(current.position, current.spawnPosition);
        const alerted = playerDistance <= definition.detectionDistance ||
            (awayFromSpawn && playerDistanceFromSpawn <= definition.leashDistance);
        const returningHome = awayFromSpawn &&
            playerDistanceFromSpawn > definition.leashDistance;
        if (!alerted && !returningHome) continue;
        const delayed = current.statuses.find(status =>
            status.kind === 'rooted' || status.kind === 'frost-delayed'
        );
        if (delayed) {
            const moveEvery = Math.max(1, definition.moveEveryTurns +
                (current.variantIds.includes('armored') ? 1 : 0) -
                (current.variantIds.includes('swift') ? 1 : 0));
            monsters = monsters.map(candidate =>
                candidate.id === current.id
                    ? {
                        ...candidate,
                        statuses: candidate.statuses
                            .map(status => status === delayed
                                ? {...status, remainingTurns: status.remainingTurns - 1}
                                : status
                            )
                            .filter(status => status.remainingTurns > 0),
                        nextMoveTurn: state.overworld.turn + moveEvery,
                        actionCount: candidate.actionCount + 1
                    }
                    : candidate
            );
            continue;
        }
        if (definition.strategyId === 'bat' && current.actionCount % 3 === 2) {
            monsters = monsters.map(candidate =>
                candidate.id === current.id
                    ? {
                        ...candidate,
                        nextMoveTurn: state.overworld.turn + 1,
                        actionCount: candidate.actionCount + 1
                    }
                    : candidate
            );
            continue;
        }
        occupied.delete(key(current.position));
        let next: Coordinate | null;
        if (returningHome) {
            next = stepToward(
                state.overworld.maze,
                current.position,
                current.spawnPosition,
                occupied
            );
        } else if (definition.strategyId === 'wander') {
            const random = new Mulberry32Random(deriveSeed(
                deriveSeed(state.overworld.seed, 'monster-ai', state.overworld.turn),
                current.id,
                current.actionCount
            ));
            const options = DIRECTIONS
                .map(direction => ({x: current.position.x + direction.x, y: current.position.y + direction.y}))
                .filter(position => isPassage(state.overworld.maze, position) && !occupied.has(key(position)));
            next = options.length > 0 ? chooseRandom(options, random) : null;
        } else {
            next = stepToward(
                state.overworld.maze,
                current.position,
                state.overworld.playerPosition,
                occupied
            );
        }
        const moveEvery = Math.max(1, definition.moveEveryTurns +
            (current.variantIds.includes('armored') ? 1 : 0) -
            (current.variantIds.includes('swift') ? 1 : 0));
        monsters = monsters.map(candidate =>
            candidate.id === current.id
                ? {
                    ...candidate,
                    ...(next ? {position: next} : {}),
                    nextMoveTurn: state.overworld.turn + moveEvery,
                    actionCount: candidate.actionCount + 1
                }
                : candidate
        );
        occupied.add(key(next ?? current.position));
        if (next) {
            events.push({
                kind: 'monster-moved',
                monsterId: current.id,
                message: `${definition.label} moved.`
            });
        }
    }

    return {
        incomingDamage,
        state: {
            ...state,
            overworld: {...state.overworld, monsters}
        }
    };
}

function trapTargets(
    state: CampaignState,
    trap: TrapState
): readonly Coordinate[] {
    if (trap.typeId === 'gas-vent') {
        return [trap.position, ...DIRECTIONS.map(direction => ({
            x: trap.position.x + direction.x,
            y: trap.position.y + direction.y
        })).filter(position => isPassage(state.overworld.maze, position))];
    }
    if (trap.typeId !== 'arc-plate' && trap.typeId !== 'flame-jet') {
        return [trap.position];
    }
    const lines = DIRECTIONS.map(direction => {
        const targets: Coordinate[] = [trap.position];
        let position = trap.position;
        for (let step = 0; step < 3; step++) {
            position = {x: position.x + direction.x, y: position.y + direction.y};
            if (!isPassage(state.overworld.maze, position)) break;
            targets.push(position);
        }
        return targets;
    });
    const longest = Math.max(...lines.map(line => line.length));
    const candidates = lines.filter(line => line.length === longest);
    return candidates[deriveSeed(state.overworld.seed, trap.id) % candidates.length]!;
}

function applyMonsterPoison(
    state: CampaignState,
    events: OverworldEvent[]
): CampaignState {
    let next = state;
    for (const snapshot of state.overworld.monsters) {
        const poisoned = snapshot.statuses.find(status => status.kind === 'poison');
        if (!poisoned) continue;
        const current = next.overworld.monsters.find(monster => monster.id === snapshot.id);
        if (!current) continue;
        next = {
            ...next,
            overworld: {
                ...next.overworld,
                monsters: next.overworld.monsters.map(monster =>
                    monster.id === current.id
                        ? {
                            ...monster,
                            statuses: monster.statuses
                                .map(status => status === poisoned
                                    ? {...status, remainingTurns: status.remainingTurns - 1}
                                    : status
                                )
                                .filter(status => status.remainingTurns > 0)
                        }
                        : monster
                )
            }
        };
        const updated = next.overworld.monsters.find(monster => monster.id === current.id);
        if (updated) next = attackMonster(next, updated, 1, 0, events).state;
    }
    return next;
}

function resolveTrapsAndHazards(
    state: CampaignState,
    events: OverworldEvent[]
): {readonly state: CampaignState; readonly incomingDamage: readonly IncomingDamageEvent[]} {
    const incomingDamage: IncomingDamageEvent[] = [];
    let nextState = applyMonsterPoison(state, events);
    let player = nextState.player;
    const traps: TrapState[] = [];
    const playerDistances = getPassageDistances(
        nextState.overworld.maze,
        nextState.overworld.playerPosition
    );
    const revealRadius = nextState.player.equippedUtility?.baseTypeId === 'lantern'
        ? 5 + (nextState.player.equippedUtility.affixIds.includes('surveyor') ? 2 : 0)
        : 2;

    for (const trap of nextState.overworld.traps) {
        if (trap.disabled) {
            traps.push(trap);
            continue;
        }
        const distance = playerDistances.get(key(trap.position));
        const newlyRevealed = !trap.revealed &&
            distance !== undefined &&
            distance <= revealRadius;
        let nextTrap: TrapState = newlyRevealed ? {...trap, revealed: true} : trap;
        if (newlyRevealed) {
            events.push({kind: 'trap', trapId: trap.id, message: `${trap.typeId} revealed.`});
        }

        if (trap.typeId === 'snare' && trap.owner === 'player') {
            const victim = nextState.overworld.monsters.find(monster =>
                samePosition(monster.position, trap.position)
            );
            if (victim) {
                nextState = {
                    ...nextState,
                    overworld: {
                        ...nextState.overworld,
                        monsters: nextState.overworld.monsters.map(monster =>
                            monster.id === victim.id
                                ? {
                                    ...monster,
                                    statuses: [
                                        ...monster.statuses.filter(status => status.kind !== 'rooted'),
                                        {kind: 'rooted' as const, remainingTurns: 3}
                                    ]
                                }
                                : monster
                        )
                    }
                };
                nextTrap = {...nextTrap, disabled: true};
                events.push({
                    kind: 'trap',
                    trapId: trap.id,
                    message: `${MONSTER_DEFINITIONS[victim.typeId].label} was snared.`
                });
            }
            traps.push(nextTrap);
            continue;
        }

        const playerOnTrap = samePosition(trap.position, nextState.overworld.playerPosition);
        if (!newlyRevealed && playerOnTrap && trap.typeId === 'spike-plate' &&
            nextState.overworld.turn >= trap.nextPhaseTurn) {
            incomingDamage.push({
                amount: 2,
                cause: 'trap',
                element: 'neutral',
                sourceId: trap.id
            });
            events.push({kind: 'trap', trapId: trap.id, message: 'Spike Plate dealt 2 damage.'});
            nextTrap = {...nextTrap, nextPhaseTurn: nextState.overworld.turn + 3};
        } else if (!newlyRevealed && playerOnTrap && trap.typeId === 'snare') {
            player = {
                ...player,
                statuses: addStatus(player.statuses, {
                    kind: 'rooted',
                    remainingTurns: 1,
                    charges: 0
                })
            };
            nextTrap = {...nextTrap, disabled: true};
            events.push({kind: 'trap', trapId: trap.id, message: 'A snare roots movement.'});
        }

        const complex = trap.typeId === 'gas-vent' ||
            trap.typeId === 'arc-plate' ||
            trap.typeId === 'flame-jet';
        if (
            complex &&
            nextTrap.revealed &&
            !newlyRevealed &&
            nextState.overworld.turn >= nextTrap.nextPhaseTurn
        ) {
            if (nextTrap.phase === 0) {
                nextTrap = {
                    ...nextTrap,
                    phase: 1,
                    nextPhaseTurn: nextState.overworld.turn + 1
                };
                events.push({
                    kind: 'trap',
                    trapId: trap.id,
                    message: `${trap.typeId} warns before firing.`
                });
            } else {
                const targets = trapTargets(nextState, nextTrap);
                if (targets.some(position =>
                    samePosition(position, nextState.overworld.playerPosition)
                )) {
                    if (nextTrap.typeId === 'gas-vent') {
                        player = {
                            ...player,
                            statuses: addStatus(player.statuses, {
                                kind: 'poison',
                                remainingTurns: 2,
                                charges: 0
                            })
                        };
                    } else {
                        incomingDamage.push({
                            amount: 2,
                            cause: 'trap',
                            element: nextTrap.typeId === 'arc-plate' ? 'lightning' : 'fire',
                            sourceId: trap.id
                        });
                    }
                }
                for (const snapshot of [...nextState.overworld.monsters]) {
                    if (!targets.some(position => samePosition(position, snapshot.position))) continue;
                    const current = nextState.overworld.monsters.find(monster =>
                        monster.id === snapshot.id
                    );
                    if (!current) continue;
                    if (nextTrap.typeId === 'gas-vent') {
                        nextState = {
                            ...nextState,
                            overworld: {
                                ...nextState.overworld,
                                monsters: nextState.overworld.monsters.map(monster =>
                                    monster.id === current.id
                                        ? {
                                            ...monster,
                                            statuses: [
                                                ...monster.statuses.filter(status =>
                                                    status.kind !== 'poison'
                                                ),
                                                {kind: 'poison' as const, remainingTurns: 2}
                                            ]
                                        }
                                        : monster
                                )
                            }
                        };
                    } else {
                        nextState = attackMonster(nextState, current, 2, 0, events).state;
                    }
                }
                nextTrap = {
                    ...nextTrap,
                    phase: 0,
                    nextPhaseTurn: nextState.overworld.turn + 4
                };
                events.push({
                    kind: 'trap',
                    trapId: trap.id,
                    message: `${trap.typeId} discharged.`
                });
            }
        }
        traps.push(nextTrap);
    }

    const remainingHazards: PendingHazardState[] = [];
    for (const hazard of nextState.overworld.pendingHazards) {
        if (hazard.executeAfterTurn > nextState.overworld.turn) {
            remainingHazards.push(hazard);
            continue;
        }
        if (hazard.targetPositions.some(position =>
            samePosition(position, nextState.overworld.playerPosition)
        )) {
            incomingDamage.push({
                amount: 2,
                cause: 'volatile',
                element: 'neutral',
                sourceId: hazard.id
            });
        }
        for (const snapshot of [...nextState.overworld.monsters]) {
            if (!hazard.targetPositions.some(position =>
                samePosition(position, snapshot.position)
            )) continue;
            const current = nextState.overworld.monsters.find(monster => monster.id === snapshot.id);
            if (current) nextState = attackMonster(nextState, current, 2, 0, events).state;
        }
        events.push({kind: 'trap', trapId: hazard.id, message: 'Volatile blast resolved.'});
    }
    const damagedMonsterIds = new Set(events.flatMap(event =>
        event.kind === 'monster-damaged' ? [event.monsterId] : []
    ));
    const monsters = nextState.overworld.monsters.map(monster => {
        if (!monster.variantIds.includes('regenerating') || monster.health >= monster.maxHealth) {
            return monster.undamagedTurns === 0 ? monster : {...monster, undamagedTurns: 0};
        }
        if (damagedMonsterIds.has(monster.id)) {
            return monster.undamagedTurns === 0 ? monster : {...monster, undamagedTurns: 0};
        }
        const undamagedTurns = monster.undamagedTurns + 1;
        return undamagedTurns >= 3
            ? {...monster, health: Math.min(monster.maxHealth, monster.health + 1), undamagedTurns: 0}
            : {...monster, undamagedTurns};
    });
    return {
        incomingDamage,
        state: {
            ...nextState,
            player,
            overworld: {
                ...nextState.overworld,
                traps,
                monsters,
                pendingHazards: remainingHazards
            }
        }
    };
}

function tickStatuses(
    state: CampaignState
): {readonly state: CampaignState; readonly poisonDamage: number} {
    let poisonDamage = 0;
    const statuses: PlayerStatus[] = [];
    for (const status of state.player.statuses) {
        if (status.kind === 'poison') poisonDamage++;
        const remainingTurns = Math.max(0, status.remainingTurns - 1);
        if (remainingTurns > 0 || status.charges > 0) statuses.push({...status, remainingTurns});
    }
    return {
        poisonDamage,
        state: {...state, player: {...state.player, statuses}}
    };
}

function reduceIncomingDamage(
    player: PlayerProgress,
    damageEvents: readonly IncomingDamageEvent[],
    damageCap: number
): {
    readonly player: PlayerProgress;
    readonly damage: number;
    readonly lethalCause: DamageCause | null;
    readonly poisonApplied: boolean;
} {
    let currentPlayer = player;
    let totalDamage = 0;
    let lethalCause: DamageCause | null = null;
    let poisonApplied = false;
    for (const event of damageEvents) {
        if (event.amount <= 0 || totalDamage >= damageCap) continue;
        let amount = event.amount;
        const wardKind = event.element === 'neutral' ? null : `${event.element}-ward`;
        const ward = wardKind
            ? currentPlayer.statuses.find(status =>
                status.kind === wardKind && status.charges > 0
            )
            : undefined;
        if (ward) {
            amount = Math.max(0, amount - 2);
            currentPlayer = {
                ...currentPlayer,
                statuses: currentPlayer.statuses
                    .map(status => status === ward
                        ? {...status, charges: status.charges - 1}
                        : status
                    )
                    .filter(status =>
                        !['fire-ward', 'ice-ward', 'lightning-ward'].includes(status.kind) ||
                        status.charges > 0
                    )
            };
        }
        if (amount <= 0) continue;

        const guard = currentPlayer.statuses.find(status =>
            status.kind === 'guard' && status.charges > 0
        );
        if (guard) {
            currentPlayer = {
                ...currentPlayer,
                statuses: currentPlayer.statuses
                    .map(status => status === guard
                        ? {...status, charges: status.charges - 1}
                        : status
                    )
                    .filter(status => status.kind !== 'guard' || status.charges > 0)
            };
            continue;
        }

        const shield = currentPlayer.equippedUtility?.baseTypeId === 'shield' ? 1 : 0;
        const insulated = event.element !== 'neutral' &&
            currentPlayer.equippedUtility?.affixIds.includes('insulated') ? 1 : 0;
        const reduced = Math.max(1, amount - Math.min(2, shield + insulated));
        const applied = Math.min(reduced, damageCap - totalDamage);
        if (applied > 0) {
            totalDamage += applied;
            lethalCause = event.cause;
            poisonApplied ||= event.appliesPoison === true;
        }
    }
    return {player: currentPlayer, damage: totalDamage, lethalCause, poisonApplied};
}

function isNegativePlayerStatus(status: PlayerStatus): boolean {
    return status.kind === 'poison' || status.kind === 'rooted';
}

export function retreatAfterDefeat(state: CampaignState): CampaignState {
    return {
        ...state,
        player: {
            ...state.player,
            health: state.player.maxHealth,
            statuses: state.player.statuses.filter(status => !isNegativePlayerStatus(status))
        },
        overworld: {
            ...state.overworld,
            playerPosition: state.overworld.sanctuaryPosition,
            monsters: state.overworld.monsters.map(monster => ({
                ...monster,
                position: monster.spawnPosition,
                intent: null,
                statuses: []
            })),
            pendingDefeatChoice: null,
            levelDeathCount: state.overworld.levelDeathCount + 1,
            resumeGraceTurns: 3
        }
    };
}

function enterDefeat(
    state: CampaignState,
    cause: PendingDefeatChoice['cause'],
    events: OverworldEvent[]
): CampaignState {
    const feather = state.player.backpack.find(item => item.baseTypeId === 'revival-feather');
    if (!feather) {
        events.push({kind: 'defeat', message: 'Defeated. Retreating to the sanctuary.'});
        return retreatAfterDefeat(state);
    }
    events.push({kind: 'defeat', message: 'Use the Revival Feather or retreat.'});
    return {
        ...state,
        overworld: {
            ...state.overworld,
            pendingDefeatChoice: {
                turn: state.overworld.turn,
                cause,
                featherInstanceId: feather.id
            }
        }
    };
}

export function resolveCampaignDefeat(
    state: CampaignState,
    cause: PendingDefeatChoice['cause']
): {readonly state: CampaignState; readonly events: readonly OverworldEvent[]} {
    if (state.player.health > 0) return {state, events: []};
    const events: OverworldEvent[] = [];
    return {state: enterDefeat(state, cause, events), events};
}

function resolveDefeatChoice(
    state: CampaignState,
    action: Extract<OverworldAction, {kind: 'resolve-defeat'}>
): OverworldActionResult {
    const pending = state.overworld.pendingDefeatChoice;
    if (!pending) {
        return {
            state,
            consumedTurn: false,
            events: [{kind: 'blocked', message: 'No defeat choice is pending.'}]
        };
    }
    if (action.choice === 'retreat') {
        return {
            state: retreatAfterDefeat(state),
            consumedTurn: false,
            events: [{kind: 'recovered', message: 'Returned to the sanctuary.'}]
        };
    }
    const feather = state.player.backpack.find(item => item.id === pending.featherInstanceId);
    if (!feather) {
        return {
            state,
            consumedTurn: false,
            events: [{kind: 'blocked', message: 'The required Revival Feather is missing.'}]
        };
    }
    return {
        consumedTurn: false,
        state: {
            ...state,
            player: {
                ...removeBackpackItem(state.player, feather.id),
                health: 3,
                statuses: state.player.statuses.filter(status => !isNegativePlayerStatus(status))
            },
            overworld: {
                ...state.overworld,
                pendingDefeatChoice: null,
                monsters: state.overworld.monsters.map(monster => {
                    const adjacent = Math.abs(
                        monster.position.x - state.overworld.playerPosition.x
                    ) + Math.abs(
                        monster.position.y - state.overworld.playerPosition.y
                    ) <= 1;
                    return adjacent
                        ? {
                            ...monster,
                            intent: null,
                            nextMoveTurn: Math.max(
                                monster.nextMoveTurn,
                                state.overworld.turn + 2
                            ),
                            nextAttackTurn: Math.max(
                                monster.nextAttackTurn,
                                state.overworld.turn + 2
                            )
                        }
                        : monster;
                })
            }
        },
        events: [{kind: 'recovered', message: 'Revival Feather restored 3 health.'}]
    };
}

function createLevelReward(state: CampaignState): CampaignState {
    if (
        state.pendingLevelReward ||
        state.overworld.pendingDefeatChoice ||
        state.player.health <= 0 ||
        !getLevelExitStatus(state).ready
    ) return state;
    const exit = {
        x: state.overworld.maze.length - 2,
        y: state.overworld.maze.length - 2
    };
    if (!samePosition(state.overworld.playerPosition, exit)) return state;
    if (getCampaignLevelNumber(state) >= MAX_CAMPAIGN_LEVEL) {
        return advanceCampaignLevel(state);
    }

    const seed = deriveSeed(state.overworld.seed, 'level-reward', 0);
    const random = new Mulberry32Random(seed);
    const typeId = random.next() < 0.5 ? 'sword' : 'spear';
    const rare = getLevelTier(state) >= 4 && random.next() < 0.25;
    const affixIds = rare
        ? typeId === 'spear'
            ? ['extended', 'piercing'] as const
            : ['keen', 'piercing'] as const
        : ['keen'] as const;
    const armoryOffer: ItemInstance = {
        ...createItemInstance(`${state.overworld.levelId}/armory-reward`, typeId),
        quality: rare ? 'rare' : 'uncommon',
        affixIds
    };
    return {
        ...state,
        pendingLevelReward: {
            levelId: state.overworld.levelId,
            seed,
            armoryOffer
        }
    };
}

function resolveLevelRewardChoice(
    state: CampaignState,
    action: Extract<OverworldAction, {kind: 'choose-level-reward'}>
): OverworldActionResult {
    const reward = state.pendingLevelReward;
    const exit = {
        x: state.overworld.maze.length - 2,
        y: state.overworld.maze.length - 2
    };
    if (
        !reward ||
        reward.levelId !== state.overworld.levelId ||
        !samePosition(state.overworld.playerPosition, exit) ||
        !getLevelExitStatus(state).ready
    ) {
        return {
            state,
            consumedTurn: false,
            events: [{kind: 'blocked', message: 'That level reward is no longer valid.'}]
        };
    }

    let player = state.player;
    if (action.choice === 'repair') {
        player = {...player, health: Math.min(player.maxHealth, player.health + 5)};
        const potion = createItemInstance(
            `${state.overworld.levelId}/repair-potion`,
            'health-potion'
        );
        const added = addToBackpack(player, potion);
        player = added.stored
            ? added.player
            : {...player, scrap: player.scrap + 2};
    } else if (action.choice === 'supply') {
        const efficient = player.equippedWeapon?.affixIds.includes('efficient') ?? false;
        const utility = player.equippedUtility;
        const utilityDefinition: ItemDefinition | null = utility
            ? ITEM_DEFINITIONS[utility.baseTypeId]
            : null;
        const baseCap = utilityDefinition?.baseCharges;
        const utilityCap = baseCap === undefined
            ? null
            : Math.min(5, baseCap + (utility?.affixIds.includes('durable') ? 2 : 0));
        player = {
            ...player,
            toolCharge: player.toolCharge + 6,
            bowAmmo: Math.min(efficient ? 16 : 12, player.bowAmmo + 6),
            equippedUtility: utility?.charges !== null &&
                utility?.charges !== undefined &&
                utilityCap !== null
                ? {...utility, charges: Math.min(utilityCap, utility.charges + 1)}
                : utility
        };
    } else if (action.choice === 'armory-equip') {
        const prior = player.equippedWeapon;
        if (prior) {
            const added = addToBackpack(player, prior);
            player = added.stored
                ? added.player
                : {...player, scrap: player.scrap + salvageValue(prior)};
        }
        player = {...player, equippedWeapon: reward.armoryOffer};
    } else if (action.choice === 'armory-salvage') {
        player = {...player, scrap: player.scrap + salvageValue(reward.armoryOffer)};
    }

    const next = initializeLevelContent(advanceCampaignLevel({
        ...state,
        player,
        pendingLevelReward: null
    }));
    return {
        state: next,
        consumedTurn: false,
        events: [{
            kind: 'level-reward',
            message: `Level reward ${action.choice.replaceAll('-', ' ')} claimed.`
        }]
    };
}

export function resolveOverworldAction(
    state: CampaignState,
    action: OverworldAction,
    context: ResolveOverworldContext = {}
): OverworldActionResult {
    if (state.pendingLevelReward) {
        return action.kind === 'choose-level-reward'
            ? resolveLevelRewardChoice(state, action)
            : {
                state,
                consumedTurn: false,
                events: [{
                    kind: 'blocked',
                    message: 'Choose a level reward before taking another action.'
                }]
            };
    }
    if (state.overworld.pendingDefeatChoice) {
        return action.kind === 'resolve-defeat'
            ? resolveDefeatChoice(state, action)
            : {
                state,
                consumedTurn: false,
                events: [{kind: 'blocked', message: 'Resolve defeat before taking another action.'}]
            };
    }
    if (action.kind === 'resolve-defeat') return resolveDefeatChoice(state, action);
    if (action.kind === 'choose-level-reward') return resolveLevelRewardChoice(state, action);
    const pickupPrompt = requiredPickupChoice(state, action);
    if (pickupPrompt) {
        return {state, events: [pickupPrompt], consumedTurn: false};
    }
    const events: OverworldEvent[] = [];
    const playerAction = applyPlayerAction(state, action, events);
    if (!playerAction.valid) {
        if (events.length === 0) events.push({kind: 'blocked', message: 'That action is not available.'});
        return {state, events, consumedTurn: false};
    }

    let nextState: CampaignState = {
        ...playerAction.state,
        player: {
            ...playerAction.state.player,
            weaponRecoveryActions: state.player.weaponRecoveryActions === 1 &&
                state.player.equippedWeapon?.baseTypeId === 'axe' &&
                action.kind !== 'melee' &&
                action.kind !== 'ranged'
                ? 0
                : playerAction.state.player.weaponRecoveryActions
        },
        overworld: {
            ...playerAction.state.overworld,
            turn: state.overworld.turn + 1
        }
    };
    nextState = pickupAtPlayer(nextState, events, action);
    const statusTick = tickStatuses(nextState);
    nextState = statusTick.state;
    const monsterTurn = advanceMonsters(nextState, events);
    nextState = monsterTurn.state;
    const environment = resolveTrapsAndHazards(nextState, events);
    nextState = environment.state;

    const damageCap = context.difficulty === 'story' ? 2 : context.difficulty === 'expert' ? 4 : 3;
    const reduced = reduceIncomingDamage(nextState.player, [
        ...monsterTurn.incomingDamage,
        ...environment.incomingDamage
    ], damageCap);
    const directHealth = Math.max(0, reduced.player.health - reduced.damage);
    const poisonHealth = directHealth === 0
        ? 0
        : Math.max(1, directHealth - statusTick.poisonDamage);
    const statuses = reduced.poisonApplied && poisonHealth > 0
        ? addStatus(reduced.player.statuses, {
            kind: 'poison',
            remainingTurns: 2,
            charges: 0
        })
        : reduced.player.statuses;
    nextState = {
        ...nextState,
        player: {...reduced.player, health: poisonHealth, statuses}
    };
    if (reduced.damage > 0) {
        events.push({
            kind: 'player-damaged',
            amount: reduced.damage,
            message: `Took ${reduced.damage} damage.`
        });
    }
    if (directHealth === 0) {
        nextState = enterDefeat(nextState, reduced.lethalCause ?? 'monster', events);
    }
    nextState = createLevelReward(nextState);
    return {state: nextState, events, consumedTurn: true};
}
