import Phaser from 'phaser';

import type {GameShell} from './game-shell';
import {updatePhaserEncounter, updatePhaserHud} from './game-shell';
import type {CampaignState} from '../domain/campaign/campaign-state';
import {BlackjackScene} from '../minigames/casino/blackjack.scene';
import {HoldemScene} from '../minigames/casino/holdem.scene';
import {CircuitCrushScene} from '../minigames/circuit/circuit.scene';
import {HorsemasterScene} from '../minigames/horsemaster/horsemaster.scene';
import {CasinoHeistScene} from '../minigames/heist/casino-heist.scene';
import {LockpickScene} from '../minigames/lock/lockpick.scene';
import {PlatformerScene} from '../minigames/platformer/platformer.scene';
import {PipeDreamScene} from '../minigames/pipe/pipe-dream.scene';
import {ShooterScene} from '../minigames/shooter/shooter.scene';
import {ZapperScene} from '../minigames/zapper/zapper.scene';
import {GAME_VIEW_SIZE, OverworldScene} from '../scenes/overworld.scene';

export interface CreateMazeGameOptions {
    readonly initialCampaign?: CampaignState;
    readonly campaignSeed: number;
    readonly itemSpriteSheetUrl: string;
    readonly monsterSpriteSheetUrl: string;
    readonly objectiveSpriteSheetUrl: string;
    readonly spaceAtlasImageUrl: string;
    readonly spaceAtlasDataUrl: string;
    readonly onCampaignChanged?: (state: CampaignState) => void;
}

export function createMazeGame(
    canvas: HTMLCanvasElement,
    shell: GameShell,
    options: CreateMazeGameOptions
): Phaser.Game {
    const scene = new OverworldScene({
        seed: options.initialCampaign?.campaignSeed ?? options.campaignSeed,
        itemSpriteSheetUrl: options.itemSpriteSheetUrl,
        monsterSpriteSheetUrl: options.monsterSpriteSheetUrl,
        objectiveSpriteSheetUrl: options.objectiveSpriteSheetUrl,
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
        version: '0.3.0',
        parent: 'canvas-stage',
        canvas,
        width: GAME_VIEW_SIZE,
        height: GAME_VIEW_SIZE,
        backgroundColor: '#f4f1e8',
        pixelArt: true,
        roundPixels: true,
        input: {
            activePointers: 3
        },
        scene: [
            scene,
            new PipeDreamScene(),
            new LockpickScene(),
            new CircuitCrushScene(),
            new BlackjackScene(),
            new HoldemScene(),
            new ShooterScene({
                atlasImageUrl: options.spaceAtlasImageUrl,
                atlasDataUrl: options.spaceAtlasDataUrl
            }),
            new PlatformerScene(),
            new HorsemasterScene(),
            new ZapperScene(),
            new CasinoHeistScene()
        ],
        scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH
        }
    });
}
