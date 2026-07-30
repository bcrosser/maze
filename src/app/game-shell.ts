import type {QuickSlotView} from './control-deck';
import type {CampaignState, EncounterKind} from '../domain/campaign/campaign-state';
import {getItemGlyph, ITEM_DEFINITIONS} from '../domain/entities/item-types';
import {describeWeaponStats, getWeaponStats} from '../domain/entities/weapon-stats';
import {getCampaignLevelNumber, getLevelExitStatus} from '../domain/campaign/level-progression';
import {
    getObjectiveStatus,
    getSelectableObjectives,
    getTrackedObjective
} from '../domain/overworld/level-objectives';
import {DIRECTION_VECTORS, type DirectionId} from '../domain/overworld/move-player';
import {getPassageDistances} from '../domain/overworld/maze-distances';
import type {OverworldEvent} from '../domain/overworld/resolve-overworld-action';

export type GameActivityKind = EncounterKind | 'blackjack' | 'holdem';

function requireElement<T extends HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Expected the game shell to provide ${selector}.`);
    return element;
}

export interface GameShell {
    readonly canvas: HTMLCanvasElement;
    readonly gameMain: HTMLElement;
    readonly startPanel: HTMLElement;
    readonly startBackdrop: HTMLElement;
    readonly startButton: HTMLButtonElement;
    readonly menuButton: HTMLButtonElement;
    readonly pausePanel: HTMLElement;
    readonly pauseBackdrop: HTMLElement;
    readonly resumeButton: HTMLButtonElement;
    readonly restartButton: HTMLButtonElement;
    readonly level: HTMLElement;
    readonly health: HTMLElement;
    readonly mining: HTMLElement;
    readonly weapon: HTMLElement;
    readonly backpack: HTMLElement;
    readonly money: HTMLElement;
    readonly reinforcement: HTMLElement;
    readonly objective: HTMLElement;
    readonly objectiveCycle: HTMLButtonElement;
    readonly playerStatus: HTMLElement;
    readonly mazeHelp: HTMLButtonElement;
    readonly exitStatus: HTMLElement;
    readonly message: HTMLElement;
    readonly controlDeck: HTMLElement;
}

export function getGameShell(): GameShell {
    return {
        canvas: requireElement<HTMLCanvasElement>('#canvas'),
        gameMain: requireElement<HTMLElement>('#game-main'),
        startPanel: requireElement<HTMLElement>('#start-panel'),
        startBackdrop: requireElement<HTMLElement>('#overlay-backdrop'),
        startButton: requireElement<HTMLButtonElement>('#start-btn'),
        menuButton: requireElement<HTMLButtonElement>('#menu-toggle-btn'),
        pausePanel: requireElement<HTMLElement>('#pause-panel'),
        pauseBackdrop: requireElement<HTMLElement>('#overlay-backdrop-pause'),
        resumeButton: requireElement<HTMLButtonElement>('#resume-btn'),
        restartButton: requireElement<HTMLButtonElement>('#restart-btn'),
        level: requireElement<HTMLElement>('#level'),
        health: requireElement<HTMLElement>('#health'),
        mining: requireElement<HTMLElement>('#mining'),
        weapon: requireElement<HTMLElement>('#weapon'),
        backpack: requireElement<HTMLElement>('#backpack'),
        money: requireElement<HTMLElement>('#money'),
        reinforcement: requireElement<HTMLElement>('#reinforcement'),
        objective: requireElement<HTMLElement>('#objective'),
        objectiveCycle: requireElement<HTMLButtonElement>('#objective-cycle'),
        playerStatus: requireElement<HTMLElement>('#player-status'),
        mazeHelp: requireElement<HTMLButtonElement>('#maze-help'),
        exitStatus: requireElement<HTMLElement>('#exit-status'),
        message: requireElement<HTMLElement>('#message'),
        controlDeck: requireElement<HTMLElement>('#control-deck')
    };
}

export function enterPhaserGame(shell: GameShell): HTMLCanvasElement {
    shell.startPanel.classList.add('hidden');
    shell.startBackdrop.classList.add('hidden');
    shell.gameMain.classList.remove('hidden');
    shell.menuButton.classList.remove('hidden');
    shell.controlDeck.classList.remove('hidden');

    const canvas = shell.canvas;
    canvas.dataset.runtime = 'phaser';
    canvas.setAttribute(
        'aria-label',
        'Phaser maze prototype. Use arrow keys, WASD, or the on-screen control deck to move.'
    );
    return canvas;
}

export function updatePhaserHud(
    shell: GameShell,
    state: CampaignState,
    event?: OverworldEvent
): void {
    shell.level.textContent = String(getCampaignLevelNumber(state));
    shell.health.textContent = `${state.player.health} / ${state.player.maxHealth}`;
    // Mining needs both numbers spelled out: power decides which walls can be
    // cut, charges decide how many more cuts remain.
    shell.mining.textContent = state.player.miningPower === 0
        ? 'No pick'
        : `power ${state.player.miningPower} · ${state.player.toolCharge} left`;
    shell.weapon.textContent = describeWeaponStats(
        getWeaponStats(state.player),
        {ammo: state.player.bowAmmo}
    );
    shell.backpack.textContent =
        `${state.player.backpack.length} / ${state.player.backpackCapacity}`;
    shell.money.textContent = `$${state.player.money}`;
    shell.reinforcement.textContent = state.overworld.reinforcementCountdownMs <= 0
        ? 'Ready'
        : `${Math.ceil(state.overworld.reinforcementCountdownMs / 1_000)}s`;
    const exit = getLevelExitStatus(state);
    const currentObjective = exit.ready ? null : getTrackedObjective(state);
    const lockedRequiredHeist = !exit.ready && currentObjective === null
        ? state.overworld.objectives.find(objective =>
            objective.objectiveId === 'casino-heist' &&
            getObjectiveStatus(state.flags, objective.objectiveId) === 'locked'
        )
        : undefined;
    const requiredHeistShop = lockedRequiredHeist
        ? state.overworld.serviceSites.find(site => site.kind === 'shop')
        : undefined;
    const objectiveLabel = currentObjective?.label ??
        (lockedRequiredHeist ? 'Getaway Car · Shop' : 'Exit');
    if (state.player.equippedUtility?.baseTypeId === 'compass') {
        const target = currentObjective
            ? state.overworld.objectives.find(objective =>
                objective.objectiveId === currentObjective.id
            )?.position
            : requiredHeistShop?.position ??
                lockedRequiredHeist?.position ?? {
                x: state.overworld.maze.length - 2,
                y: state.overworld.maze.length - 2
            };
        if (target) {
            const distances = getPassageDistances(state.overworld.maze, target);
            const arrows: Record<DirectionId, string> = {
                up: '↑',
                down: '↓',
                left: '←',
                right: '→'
            };
            const nextDirection = (
                Object.entries(DIRECTION_VECTORS) as [
                    DirectionId,
                    {readonly x: number; readonly y: number}
                ][]
            ).map(([direction, vector]) => ({
                direction,
                distance: distances.get(
                    `${state.overworld.playerPosition.x + vector.x},` +
                    `${state.overworld.playerPosition.y + vector.y}`
                ) ?? Number.POSITIVE_INFINITY
            })).sort((left, right) => left.distance - right.distance)[0];
            const distance = distances.get(
                `${state.overworld.playerPosition.x},${state.overworld.playerPosition.y}`
            );
            shell.objective.textContent = distance === undefined
                ? objectiveLabel
                : `${objectiveLabel} ${nextDirection ? arrows[nextDirection.direction] : '•'} ${distance}`;
        } else {
            shell.objective.textContent = objectiveLabel;
        }
    } else {
        shell.objective.textContent = objectiveLabel;
    }
    // Retargeting only makes sense when more than one objective is still open.
    const selectableCount = exit.ready ? 0 : getSelectableObjectives(state).length;
    shell.objectiveCycle.disabled = selectableCount < 2;
    shell.objectiveCycle.dataset.selectable = String(selectableCount);
    shell.playerStatus.textContent = state.player.statuses.length > 0
        ? state.player.statuses.map(status =>
            `${status.kind} ${status.remainingTurns}`
        ).join(', ')
        : 'Clear';
    shell.exitStatus.textContent = exit.ready
        ? `Ready ${exit.completed} / ${exit.total}`
        : `Locked ${exit.completed} / ${exit.total}`;
    shell.exitStatus.dataset.ready = String(exit.ready);
    if (event) {
        shell.message.textContent = 'message' in event ? (event.message ?? '') : '';
    }
    shell.gameMain.dataset.playerX = String(state.overworld.playerPosition.x);
    shell.gameMain.dataset.playerY = String(state.overworld.playerPosition.y);
    shell.gameMain.dataset.mazeSize = String(state.overworld.maze.length);
    shell.gameMain.dataset.levelId = state.overworld.levelId;
    shell.gameMain.dataset.powerRouting = String(state.worldSystems.powerRouting);
    shell.gameMain.dataset.securityAlert = String(state.worldSystems.securityAlert);
    shell.gameMain.dataset.airspaceControl = String(state.worldSystems.airspaceControl);
    shell.gameMain.dataset.structuralStability = String(state.worldSystems.structuralStability);
    shell.gameMain.dataset.scrap = String(state.player.scrap);
    shell.gameMain.dataset.money = String(state.player.money);
    shell.gameMain.dataset.reinforcementCountdownMs =
        String(state.overworld.reinforcementCountdownMs);
    shell.gameMain.dataset.reinforcementOrdinal =
        String(state.overworld.reinforcementOrdinal);
    shell.gameMain.dataset.itemCount = String(state.overworld.items.length);
    shell.gameMain.dataset.monsterCount = String(state.overworld.monsters.length);
    shell.gameMain.dataset.trapCount = String(state.overworld.traps.length);
    shell.gameMain.dataset.backpackCount = String(state.player.backpack.length);
    shell.gameMain.dataset.weapon = state.player.equippedWeapon?.baseTypeId ?? 'improvised';
    shell.gameMain.dataset.objectiveStatuses = state.overworld.objectives.map(objective =>
        `${objective.objectiveId}:${getObjectiveStatus(state.flags, objective.objectiveId)}`
    ).join(',');
    shell.gameMain.dataset.turn = String(state.overworld.turn);
    shell.gameMain.dataset.campaignFlags = state.flags.join(',');
}

/**
 * The three quick slots as the shared control deck renders them. An empty slot
 * still occupies its position so the row never reflows while playing.
 */
export function getQuickSlotViews(
    state: CampaignState
): readonly (QuickSlotView | null)[] {
    return state.player.quickSlotItemIds.map(itemId => {
        if (itemId === null) return null;
        const item = state.player.backpack.find(candidate => candidate.id === itemId);
        if (!item) return null;
        const definition = ITEM_DEFINITIONS[item.baseTypeId];
        const detail = item.quantity > 1
            ? `×${item.quantity}`
            : item.charges !== null ? `(${item.charges})` : undefined;
        return {
            icon: getItemGlyph(item.baseTypeId),
            label: definition.label,
            ...(detail ? {detail} : {})
        };
    });
}

export function updatePhaserEncounter(shell: GameShell, kind: GameActivityKind | null): void {
    const canvas = shell.gameMain.querySelector<HTMLCanvasElement>('canvas');
    // Every scene now declares its own scheme for the shared deck, so the deck
    // stays on screen and simply changes what its buttons mean.
    if (kind) {
        shell.gameMain.dataset.encounter = kind;
        const label: Record<GameActivityKind, string> = {
            pipe: 'Pipe routing game. Place queued fixed-orientation pipes ahead of the slowly advancing liquid.',
            lock: 'Lock picking game. Set the binding pins while maintaining safe tension.',
            shooter: 'Space combat game. Move freely, fire manually, use bombs, and defeat the Corridor Warden.',
            platformer: 'Platform game. Move, jump, collect every power core, fight enemies, and reach the lift.',
            circuit: 'Circuit Crash match-three game. Swap adjacent circuit boards, trigger special chips, and repair every sparking short before moves run out.',
            horsemaster: 'Horsemaster crossing game. Time the horse’s jumps between exercise machines mounted on moving cars and reach the Ultra Horse Gym.',
            zapper: 'Zapper nanotech lab game. Fill and slide slime-powered blasters to waiting aliens, then catch the completed weapons.',
            'casino-heist': 'Casino Heist driving game. Dodge road hazards, collect weapon modules and ammunition, and survive the getaway.',
            blackjack: 'Optional Blackjack table. Choose a wager, then hit, stand, or double down.',
            holdem: 'Optional heads-up Texas Hold’em. Bet across four streets against the computer.'
        };
        canvas?.setAttribute('aria-label', label[kind]);
    } else {
        delete shell.gameMain.dataset.encounter;
        canvas?.setAttribute(
            'aria-label',
            'Maze overworld. Use arrow keys, WASD, or the on-screen control deck to move.'
        );
    }
}
