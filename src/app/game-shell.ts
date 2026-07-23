import type {CampaignState, EncounterKind} from '../domain/campaign/campaign-state';
import {getCampaignLevelNumber, getLevelExitStatus} from '../domain/campaign/level-progression';
import type {ItemPickupEvent} from '../domain/entities/item-system';
import type {MonsterTurnEvent} from '../domain/entities/monster-system';
import type {OverworldMoveEvent} from '../domain/overworld/move-player';

function requireElement<T extends HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Expected the game shell to provide ${selector}.`);
    return element;
}

export interface GameShell {
    readonly legacyCanvas: HTMLCanvasElement;
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
    readonly exitStatus: HTMLElement;
    readonly message: HTMLElement;
}

export function getGameShell(): GameShell {
    return {
        legacyCanvas: requireElement<HTMLCanvasElement>('#canvas'),
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
        exitStatus: requireElement<HTMLElement>('#exit-status'),
        message: requireElement<HTMLElement>('#message')
    };
}

export function enterPhaserGame(shell: GameShell): HTMLCanvasElement {
    shell.startPanel.classList.add('hidden');
    shell.startBackdrop.classList.add('hidden');
    shell.gameMain.classList.remove('hidden');
    shell.menuButton.classList.remove('hidden');

    const canvas = shell.legacyCanvas.cloneNode(false) as HTMLCanvasElement;
    canvas.dataset.runtime = 'phaser';
    canvas.setAttribute(
        'aria-label',
        'Phaser maze prototype. Use arrow keys, WASD, or the on-screen controls to move.'
    );
    shell.legacyCanvas.replaceWith(canvas);
    return canvas;
}

export function updatePhaserHud(
    shell: GameShell,
    state: CampaignState,
    event?: OverworldMoveEvent | ItemPickupEvent | MonsterTurnEvent
): void {
    shell.level.textContent = String(getCampaignLevelNumber(state));
    shell.health.textContent = `${state.player.health} / ${state.player.maxHealth}`;
    shell.mining.textContent = `${state.player.miningPower} (${state.player.toolCharge})`;
    const exit = getLevelExitStatus(state);
    shell.exitStatus.textContent = exit.ready
        ? `Ready ${exit.completed} / ${exit.total}`
        : `Locked ${exit.completed} / ${exit.total}`;
    shell.exitStatus.dataset.ready = String(exit.ready);
    shell.message.textContent = event && 'message' in event ? (event.message ?? '') : '';
    shell.gameMain.dataset.playerX = String(state.overworld.playerPosition.x);
    shell.gameMain.dataset.playerY = String(state.overworld.playerPosition.y);
    shell.gameMain.dataset.mazeSize = String(state.overworld.maze.length);
    shell.gameMain.dataset.levelId = state.overworld.levelId;
    shell.gameMain.dataset.powerRouting = String(state.worldSystems.powerRouting);
    shell.gameMain.dataset.securityAlert = String(state.worldSystems.securityAlert);
    shell.gameMain.dataset.airspaceControl = String(state.worldSystems.airspaceControl);
    shell.gameMain.dataset.structuralStability = String(state.worldSystems.structuralStability);
    shell.gameMain.dataset.scrap = String(state.player.scrap);
    shell.gameMain.dataset.itemCount = String(state.overworld.items.length);
    shell.gameMain.dataset.monsterCount = String(state.overworld.monsters.length);
    shell.gameMain.dataset.turn = String(state.overworld.turn);
    shell.gameMain.dataset.campaignFlags = state.flags.join(',');
}

export function updatePhaserEncounter(shell: GameShell, kind: EncounterKind | null): void {
    if (kind) shell.gameMain.dataset.encounter = kind;
    else delete shell.gameMain.dataset.encounter;
}
