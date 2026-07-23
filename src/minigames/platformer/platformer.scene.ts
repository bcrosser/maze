import Phaser from 'phaser';

import type {PerformanceGrade} from '../../domain/campaign/campaign-state';
import type {EncounterContext, EncounterResult, OutcomeEffect} from '../../encounters/contracts';
import {
    createActOnePlatformerLevel,
    createPlatformerState,
    PLATFORMER_PLAYER_SIZE,
    stepPlatformer,
    type PlatformerInput,
    type PlatformerLevel,
    type PlatformerState
} from './platformer-model';

export const PLATFORMER_SCENE_KEY = 'platformer';

export interface PlatformerLaunchData {
    readonly context: EncounterContext;
    readonly onComplete: (result: EncounterResult) => void;
}

const VIEW_SIZE = 672;

function platformerGrade(state: PlatformerState, collectibleCount: number): PerformanceGrade {
    if (state.deaths === 0 && state.collectedIds.length === collectibleCount) return 's';
    if (state.deaths <= 1 && state.collectedIds.length >= 2) return 'a';
    if (state.deaths <= 3) return 'b';
    return 'c';
}

function platformColor(id: string): number {
    if (id === 'tool-bridge') return 0xb66a3c;
    if (id === 'supply-drone-bridge') return 0x67d5e8;
    if (id === 'powered-lift') return 0xf4ed45;
    if (id.includes('ledge') || id.includes('step')) return 0x59636e;
    return 0x3f4745;
}

export class PlatformerScene extends Phaser.Scene {
    private launchData!: PlatformerLaunchData;
    private level!: PlatformerLevel;
    private state!: PlatformerState;
    private player!: Phaser.GameObjects.Rectangle;
    private statusText!: Phaser.GameObjects.Text;
    private collectibleShapes = new Map<string, Phaser.GameObjects.Arc>();
    private leftHeld = false;
    private rightHeld = false;
    private jumpHeld = false;
    private jumpPressed = false;
    private startedAt = 0;
    private finishing = false;

    constructor() {
        super({key: PLATFORMER_SCENE_KEY});
    }

    create(data: PlatformerLaunchData): void {
        this.launchData = data;
        this.level = createActOnePlatformerLevel({
            powerRouting: data.context.campaignSnapshot.worldSystems.powerRouting,
            miningPower: data.context.campaignSnapshot.player.miningPower,
            airspaceControl: data.context.campaignSnapshot.worldSystems.airspaceControl
        });
        this.state = createPlatformerState(this.level);
        this.leftHeld = false;
        this.rightHeld = false;
        this.jumpHeld = false;
        this.jumpPressed = false;
        this.startedAt = this.time.now;
        this.finishing = false;

        this.cameras.main.setBackgroundColor(0x111714);
        this.drawBackdrop();
        for (const platform of this.level.platforms) {
            this.add.rectangle(
                platform.x,
                platform.y,
                platform.width,
                platform.height,
                platformColor(platform.id)
            ).setOrigin(0);
        }
        for (const hazard of this.level.hazards) {
            if (hazard.id === 'lower-void') continue;
            this.add.rectangle(hazard.x, hazard.y, hazard.width, hazard.height, 0xef5b24)
                .setOrigin(0);
            for (let x = hazard.x + 5; x < hazard.x + hazard.width; x += 10) {
                this.add.triangle(x, hazard.y, 0, 20, 5, 0, 10, 20, 0xf4ed45)
                    .setOrigin(0.5, 0);
            }
        }
        for (const checkpoint of this.level.checkpoints) {
            this.add.rectangle(checkpoint.x, checkpoint.y, checkpoint.width, checkpoint.height, 0x67d5e8, 0.18)
                .setOrigin(0)
                .setStrokeStyle(2, 0x67d5e8);
            this.add.text(checkpoint.x + 4, checkpoint.y - 24, 'DRONE SAVE', {
                color: '#67d5e8',
                fontFamily: 'Georgia, serif',
                fontSize: '13px'
            });
        }
        this.add.rectangle(
            this.level.goal.x,
            this.level.goal.y,
            this.level.goal.width,
            this.level.goal.height,
            0xefc75e,
            0.18
        ).setOrigin(0).setStrokeStyle(3, 0xefc75e);
        this.add.text(this.level.goal.x - 48, this.level.goal.y - 30, 'MAINTENANCE EXIT', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '15px'
        });
        for (const collectible of this.level.collectibles) {
            const shape = this.add.circle(collectible.x, collectible.y, 11, 0xefc75e)
                .setStrokeStyle(2, 0xf5f0df);
            this.collectibleShapes.set(collectible.id, shape);
        }

        this.player = this.add.rectangle(
            this.state.x,
            this.state.y,
            PLATFORMER_PLAYER_SIZE.width,
            PLATFORMER_PLAYER_SIZE.height,
            0x67d5e8
        ).setOrigin(0).setStrokeStyle(2, 0xf5f0df);
        this.cameras.main.setBounds(0, 0, this.level.width, this.level.height);
        this.cameras.main.startFollow(this.player, true, 0.12, 0.08, -180, 0);
        this.cameras.main.setRoundPixels(true);

        this.add.rectangle(0, 0, VIEW_SIZE, 96, 0x0f110e, 0.9)
            .setOrigin(0)
            .setScrollFactor(0)
            .setDepth(100);
        this.add.text(20, 16, 'SUBLEVEL 9 // CARTRIDGE WEATHER', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '23px'
        }).setScrollFactor(0).setDepth(101);
        this.statusText = this.add.text(20, 52, '', {
            color: '#dce8a5',
            fontFamily: 'Georgia, serif',
            fontSize: '16px'
        }).setScrollFactor(0).setDepth(101);
        const closeButton = this.add.circle(630, 48, 20, 0x2f3430)
            .setStrokeStyle(2, 0x676b60)
            .setScrollFactor(0)
            .setDepth(102)
            .setInteractive({useHandCursor: true});
        this.add.text(630, 47, 'X', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '18px'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(103);
        closeButton.on('pointerdown', () => this.finish('abandoned'));

        this.createTouchControls();
        this.input.keyboard?.on('keydown', this.handleKeyDown, this);
        this.input.keyboard?.on('keyup', this.handleKeyUp, this);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown, this);
            this.input.keyboard?.off('keyup', this.handleKeyUp, this);
            delete this.game.canvas.dataset.platformerX;
            delete this.game.canvas.dataset.platformerY;
            delete this.game.canvas.dataset.platformerVelocityY;
            delete this.game.canvas.dataset.platformerGrounded;
            delete this.game.canvas.dataset.platformerDeaths;
            delete this.game.canvas.dataset.platformerCollected;
        });
        this.syncPresentation();
    }

    override update(_time: number, delta: number): void {
        if (this.finishing) return;
        const previousDeaths = this.state.deaths;
        const input: PlatformerInput = {
            horizontal: this.leftHeld === this.rightHeld ? 0 : this.leftHeld ? -1 : 1,
            jumpPressed: this.jumpPressed,
            jumpHeld: this.jumpHeld
        };
        this.jumpPressed = false;
        this.state = stepPlatformer(this.state, input, this.level, delta);
        this.syncPresentation();

        if (this.state.deaths > previousDeaths) {
            this.statusText.setText(
                `Respawn ${this.state.deaths}/5. The checkpoint says this still counts as exercise.`
            );
        }
        if (this.state.deaths >= 5) {
            this.finishing = true;
            this.statusText.setText('FACILITY CLOSED FOR REPEATED GRAVITY').setColor('#ef8d6b');
            this.time.delayedCall(500, () => this.finish('failure'));
            return;
        }
        if (this.state.completed) {
            this.finishing = true;
            this.statusText.setText('EXIT FOUND - SOMEWHERE, AN 8-BIT CROWD CHEERS').setColor('#67d5e8');
            this.time.delayedCall(500, () => this.finish('success'));
        }
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        const key = event.key.toLowerCase();
        if (event.key === 'Escape') {
            this.finish('abandoned');
        } else if (event.key === 'ArrowLeft' || key === 'a') {
            this.leftHeld = true;
        } else if (event.key === 'ArrowRight' || key === 'd') {
            this.rightHeld = true;
        } else if (event.key === 'ArrowUp' || key === 'w' || event.key === ' ') {
            if (!this.jumpHeld) this.jumpPressed = true;
            this.jumpHeld = true;
        } else {
            return;
        }
        event.preventDefault();
    };

    private readonly handleKeyUp = (event: KeyboardEvent): void => {
        const key = event.key.toLowerCase();
        if (event.key === 'ArrowLeft' || key === 'a') this.leftHeld = false;
        else if (event.key === 'ArrowRight' || key === 'd') this.rightHeld = false;
        else if (event.key === 'ArrowUp' || key === 'w' || event.key === ' ') this.jumpHeld = false;
        else return;
        event.preventDefault();
    };

    private drawBackdrop(): void {
        this.add.rectangle(0, 96, this.level.width, 494, 0x18231e).setOrigin(0);
        for (let x = 40; x < this.level.width; x += 180) {
            const height = 100 + (x % 270);
            this.add.rectangle(x, 590 - height, 110, height, 0x222b29).setOrigin(0);
            this.add.rectangle(x + 18, 590 - height + 24, 18, 12, 0xefc75e, 0.35).setOrigin(0);
            this.add.rectangle(x + 60, 590 - height + 52, 18, 12, 0x67d5e8, 0.28).setOrigin(0);
        }
    }

    private createTouchControls(): void {
        const createHoldButton = (
            x: number,
            label: string,
            onDown: () => void,
            onUp: () => void
        ): void => {
            const button = this.add.circle(x, 604, 36, 0x171918, 0.86)
                .setStrokeStyle(2, 0xefc75e)
                .setScrollFactor(0)
                .setDepth(102)
                .setInteractive({useHandCursor: true});
            this.add.text(x, 604, label, {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '22px'
            }).setOrigin(0.5).setScrollFactor(0).setDepth(103);
            button.on('pointerdown', onDown);
            button.on('pointerup', onUp);
            button.on('pointerout', onUp);
        };
        createHoldButton(62, '<', () => { this.leftHeld = true; }, () => { this.leftHeld = false; });
        createHoldButton(142, '>', () => { this.rightHeld = true; }, () => { this.rightHeld = false; });
        createHoldButton(598, '^', () => {
            if (!this.jumpHeld) this.jumpPressed = true;
            this.jumpHeld = true;
        }, () => { this.jumpHeld = false; });
    }

    private syncPresentation(): void {
        this.player.setPosition(this.state.x, this.state.y);
        for (const [collectibleId, shape] of this.collectibleShapes) {
            shape.setVisible(!this.state.collectedIds.includes(collectibleId));
        }
        this.statusText.setText(
            `Cartridges ${this.state.collectedIds.length}/${this.level.collectibles.length}  ` +
            `Respawns ${this.state.deaths}`
        );
        this.game.canvas.dataset.platformerX = String(Math.round(this.state.x));
        this.game.canvas.dataset.platformerY = String(Math.round(this.state.y));
        this.game.canvas.dataset.platformerVelocityY = String(Math.round(this.state.velocityY));
        this.game.canvas.dataset.platformerGrounded = String(this.state.grounded);
        this.game.canvas.dataset.platformerDeaths = String(this.state.deaths);
        this.game.canvas.dataset.platformerCollected = String(this.state.collectedIds.length);
    }

    private finish(status: 'success' | 'failure' | 'abandoned'): void {
        if (status === 'abandoned' && this.finishing) return;
        this.finishing = true;
        this.launchData.onComplete(this.createResult(status));
        this.scene.stop();
    }

    private createResult(status: 'success' | 'failure' | 'abandoned'): EncounterResult {
        const effects: OutcomeEffect[] = status === 'success'
            ? [
                {kind: 'change-resource', resource: 'scrap', delta: 4},
                {kind: 'change-resource', resource: 'health', delta: 2},
                {kind: 'adjust-world-system', system: 'structuralStability', delta: 20},
                {kind: 'set-flag', flag: 'sublevel-nine-stabilized'},
                {kind: 'set-flag', flag: `memory-cartridges-${this.state.collectedIds.length}`},
                {
                    kind: 'set-trigger-state',
                    triggerId: this.launchData.context.trigger.triggerId,
                    state: 'resolved'
                }
            ]
            : [
                {kind: 'change-resource', resource: 'health', delta: -2},
                {kind: 'adjust-world-system', system: 'structuralStability', delta: -5},
                {kind: 'set-flag', flag: 'sublevel-nine-awaits-repairs'}
            ];
        return {
            runId: this.launchData.context.runId,
            definitionId: this.launchData.context.definitionId,
            triggerId: this.launchData.context.trigger.triggerId,
            kind: 'platformer',
            status,
            grade: status === 'success'
                ? platformerGrade(this.state, this.level.collectibles.length)
                : 'none',
            score: status === 'success'
                ? Math.max(500, 3_000 + this.state.collectedIds.length * 500 - this.state.deaths * 300)
                : 0,
            elapsedMs: Math.max(0, this.time.now - this.startedAt),
            effects
        };
    }
}