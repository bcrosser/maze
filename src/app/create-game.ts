import Phaser from 'phaser';

import {PHASER_MIGRATION_SEED} from './game-constants';
import type {GameShell} from './game-shell';
import {updatePhaserEncounter, updatePhaserHud} from './game-shell';
import type {CampaignState} from '../domain/campaign/campaign-state';
import {LockpickScene} from '../minigames/lock/lockpick.scene';
import {PlatformerScene} from '../minigames/platformer/platformer.scene';
import {PipeDreamScene} from '../minigames/pipe/pipe-dream.scene';
import {ShooterScene} from '../minigames/shooter/shooter.scene';
import {GAME_VIEW_SIZE, OverworldScene} from '../scenes/overworld.scene';

export interface CreateMazeGameOptions {
    readonly initialCampaign?: CampaignState;
    readonly itemSpriteSheetUrl: string;
    readonly monsterSpriteSheetUrl: string;
    readonly onCampaignChanged?: (state: CampaignState) => void;
}

export function createMazeGame(
    canvas: HTMLCanvasElement,
    shell: GameShell,
    options: CreateMazeGameOptions
): Phaser.Game {
    const scene = new OverworldScene({
        seed: PHASER_MIGRATION_SEED,
        itemSpriteSheetUrl: options.itemSpriteSheetUrl,
        monsterSpriteSheetUrl: options.monsterSpriteSheetUrl,
        ...(options.initialCampaign ? {initialCampaign: options.initialCampaign} : {}),
        onStateChanged: (state, event) => {
            updatePhaserHud(shell, state, event);
            options.onCampaignChanged?.(state);
        },
        onEncounterChanged: kind => updatePhaserEncounter(shell, kind)
    });

    return new Phaser.Game({
        type: Phaser.WEBGL,
        title: 'Maze',
        version: '0.2.0',
        parent: 'canvas-stage',
        canvas,
        width: GAME_VIEW_SIZE,
        height: GAME_VIEW_SIZE,
        backgroundColor: '#f4f1e8',
        pixelArt: true,
        roundPixels: true,
        scene: [
            scene,
            new PipeDreamScene(),
            new LockpickScene(),
            new ShooterScene(),
            new PlatformerScene()
        ],
        scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH
        }
    });
}