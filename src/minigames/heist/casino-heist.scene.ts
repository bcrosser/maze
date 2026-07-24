import Phaser from 'phaser';

import type {PerformanceGrade} from '../../domain/campaign/campaign-state';
import {Mulberry32Random} from '../../domain/random/random-source';
import type {
    EncounterContext,
    EncounterResult,
    OutcomeEffect
} from '../../encounters/contracts';
import {
    getEncounterItemBonusLabel,
    getEncounterNumberModifier
} from '../item-bonus';
import {
    CASINO_HEIST_FIXED_STEP_MS,
    CASINO_HEIST_REWARD_CREDITS,
    CASINO_HEIST_WORLD_WIDTH,
    advanceCasinoHeist,
    canonicalCasinoHeistCourseSignature,
    createCasinoHeistCourse,
    createCasinoHeistState,
    getCasinoHeistRenderSnapshot,
    setCasinoHeistPaused,
    type CasinoHeistEvent,
    type CasinoHeistRenderSnapshot,
    type CasinoHeistState
} from './casino-heist-model';

export const CASINO_HEIST_SCENE_KEY = 'casino-heist';

export interface CasinoHeistLaunchData {
    readonly context: EncounterContext;
    readonly onComplete: (result: EncounterResult) => void;
}

const VIEW_SIZE = 672;
const SCALE_X = VIEW_SIZE / CASINO_HEIST_WORLD_WIDTH;

const COLORS = Object.freeze({
    night: 0x090b18,
    city: 0x151a30,
    road: 0x282d39,
    roadAlternate: 0x242a35,
    shoulder: 0xb84558,
    lane: 0xf4d269,
    paper: 0xf7f1da,
    cyan: 0x56e4ff,
    casino: 0xf54fbd,
    gold: 0xffdc64,
    danger: 0xff5265,
    weapon: 0xa98cff,
    ammo: 0x74ef87,
    ink: 0x080a12
});

const ENEMY_COLORS = Object.freeze([
    0xf04f62,
    0x8f68e8,
    0x4ccbd5,
    0xf0a348,
    0x65bd68,
    0xdd5bc2,
    0x8eabc9,
    0xd7c84c
]);

function x(value: number): number {
    return value * SCALE_X;
}

function resolveAttemptNumber(runId: string): number {
    const value = Number(runId.split('/').at(-1));
    return Number.isSafeInteger(value) && value >= 0 ? value + 1 : 1;
}

function gradeHeist(state: CasinoHeistState): PerformanceGrade {
    if (state.status !== 'success') return 'none';
    const elapsedMs = state.activeTicks * CASINO_HEIST_FIXED_STEP_MS;
    if (state.telemetry.hitsTaken === 0 && elapsedMs <= 52_000) return 's';
    if (state.telemetry.hitsTaken <= 1 && elapsedMs <= 65_000) return 'a';
    if (state.player.health >= 2) return 'b';
    return 'c';
}

export class CasinoHeistScene extends Phaser.Scene {
    private launchData!: CasinoHeistLaunchData;
    private state!: CasinoHeistState;
    private graphics!: Phaser.GameObjects.Graphics;
    private hudText!: Phaser.GameObjects.Text;
    private messageText!: Phaser.GameObjects.Text;
    private helpObjects: Phaser.GameObjects.GameObject[] = [];
    private helpOpen = false;
    private steerLeft = false;
    private steerRight = false;
    private fireHeld = false;
    private finishing = false;
    private finishTimer: Phaser.Time.TimerEvent | null = null;
    private animationClockMs = 0;

    constructor() {
        super({key: CASINO_HEIST_SCENE_KEY});
    }

    create(data: CasinoHeistLaunchData): void {
        this.launchData = data;
        const levelTier = Phaser.Math.Clamp(
            Math.floor(getEncounterNumberModifier(data.context, 'levelTier', 1)),
            0,
            5
        );
        const hullBonus = Math.max(
            0,
            Math.floor(getEncounterNumberModifier(data.context, 'heistHullBonus'))
        );
        const handlingMultiplier = Math.max(
            1,
            getEncounterNumberModifier(data.context, 'heistHandlingMultiplier', 1)
        );
        const course = createCasinoHeistCourse(
            new Mulberry32Random(data.context.seed),
            {
                segmentCount: 18 + levelTier * 2,
                bonuses: {
                    armor: hullBonus,
                    handling: Math.min(1, handlingMultiplier - 1),
                    powerupChance: 0,
                    startAmmo: 0
                }
            }
        );
        this.state = createCasinoHeistState(course);
        this.helpObjects = [];
        this.helpOpen = false;
        this.steerLeft = false;
        this.steerRight = false;
        this.fireHeld = false;
        this.finishing = false;
        this.finishTimer = null;
        this.animationClockMs = 0;

        this.cameras.main.setBackgroundColor(COLORS.night);
        this.graphics = this.add.graphics().setDepth(10);
        this.add.text(VIEW_SIZE / 2, 20, 'CASINO HEIST · GETAWAY RUN', {
            color: '#f7f1da',
            backgroundColor: '#4a2058',
            fontFamily: 'Georgia, serif',
            fontSize: '23px',
            fontStyle: 'bold',
            padding: {x: 16, y: 7}
        }).setOrigin(0.5).setDepth(30);

        const itemBonus = getEncounterItemBonusLabel(data.context);
        if (itemBonus) {
            this.add.text(VIEW_SIZE / 2, 55, `ITEM BONUS · ${itemBonus}`, {
                color: '#080a12',
                backgroundColor: 'rgba(116,239,135,0.92)',
                fontFamily: 'monospace',
                fontSize: '10px',
                padding: {x: 7, y: 3}
            }).setOrigin(0.5).setDepth(30);
        }
        this.game.canvas.dataset.itemBonus = itemBonus ?? '';
        this.hudText = this.add.text(12, 82, '', {
            color: '#f7f1da',
            backgroundColor: 'rgba(8,10,18,0.9)',
            fontFamily: 'monospace',
            fontSize: '14px',
            padding: {x: 9, y: 6}
        }).setDepth(30);
        this.messageText = this.add.text(VIEW_SIZE / 2, 119,
            'STEER FOR THE FIRST WEAPON MODULE · YOUR CAR STARTS UNARMED',
            {
                color: '#080a12',
                backgroundColor: 'rgba(247,241,218,0.93)',
                fontFamily: 'Georgia, serif',
                fontSize: '13px',
                fontStyle: 'bold',
                align: 'center',
                padding: {x: 10, y: 5},
                wordWrap: {width: 500, useAdvancedWrap: true}
            }
        ).setOrigin(0.5).setDepth(30);

        this.createControls();
        this.input.keyboard?.on('keydown', this.handleKeyDown);
        this.input.keyboard?.on('keyup', this.handleKeyUp);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown);
            this.input.keyboard?.off('keyup', this.handleKeyUp);
            this.finishTimer?.remove(false);
            this.clearDatasets();
        });
        this.syncPresentation();
        if (resolveAttemptNumber(data.context.runId) === 1) this.showHelp();
    }

    override update(_time: number, delta: number): void {
        this.animationClockMs += Math.max(0, delta);
        if (this.finishing || this.helpOpen) {
            this.drawWorld();
            return;
        }
        const steer = this.steerLeft === this.steerRight
            ? 0
            : this.steerLeft ? -1 : 1;
        const result = advanceCasinoHeist(this.state, {
            steer,
            fire: this.fireHeld
        }, Math.max(0, delta));
        this.state = result.state;
        this.handleEvents(result.events);
        this.syncPresentation();

        if (this.state.status !== 'active' && !this.finishing) {
            const terminal = this.state.status;
            this.finishing = true;
            this.fireHeld = false;
            this.finishTimer = this.time.delayedCall(1_000, () => this.finish(terminal));
        }
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (this.finishing) return;
        if (this.helpOpen) {
            if (['enter', ' ', 'h', 'escape'].includes(event.key.toLowerCase())) {
                event.preventDefault();
                this.closeHelp();
            }
            return;
        }
        switch (event.key.toLowerCase()) {
            case 'arrowleft':
            case 'a':
                event.preventDefault();
                this.steerLeft = true;
                break;
            case 'arrowright':
            case 'd':
                event.preventDefault();
                this.steerRight = true;
                break;
            case ' ':
            case 'f':
            case 'enter':
                event.preventDefault();
                this.fireHeld = true;
                break;
            case 'h':
                event.preventDefault();
                this.showHelp();
                break;
            case 'escape':
                event.preventDefault();
                this.finish('abandoned');
                break;
        }
    };

    private readonly handleKeyUp = (event: KeyboardEvent): void => {
        switch (event.key.toLowerCase()) {
            case 'arrowleft':
            case 'a':
                this.steerLeft = false;
                break;
            case 'arrowright':
            case 'd':
                this.steerRight = false;
                break;
            case ' ':
            case 'f':
            case 'enter':
                this.fireHeld = false;
                break;
        }
    };

    private createControls(): void {
        this.createHoldButton(82, 616, 126, '◀ STEER', () => {
            this.steerLeft = true;
        }, () => {
            this.steerLeft = false;
        });
        this.createHoldButton(224, 616, 126, 'STEER ▶', () => {
            this.steerRight = true;
        }, () => {
            this.steerRight = false;
        });
        this.createHoldButton(534, 616, 224, 'FIRE · NEEDS WEAPON + AMMO', () => {
            this.fireHeld = true;
        }, () => {
            this.fireHeld = false;
        }, 0x603c82);
        this.createTapButton(42, 20, 68, 'EXIT', () => this.finish('abandoned'), 0x743943);
        this.createTapButton(630, 20, 68, 'HELP', () => this.showHelp(), 0x285a68);
    }

    private createHoldButton(
        xPosition: number,
        yPosition: number,
        width: number,
        label: string,
        start: () => void,
        stop: () => void,
        color = 0x294c5b
    ): void {
        const button = this.add.rectangle(xPosition, yPosition, width, 52, color, 0.97)
            .setStrokeStyle(2, COLORS.cyan)
            .setDepth(40)
            .setInteractive({useHandCursor: true});
        this.add.text(xPosition, yPosition, label, {
            color: '#f7f1da',
            fontFamily: 'Georgia, serif',
            fontSize: width > 180 ? '13px' : '15px',
            fontStyle: 'bold',
            align: 'center'
        }).setOrigin(0.5).setDepth(41);
        button.on('pointerdown', () => {
            if (!this.finishing && !this.helpOpen) start();
        });
        button.on('pointerup', stop);
        button.on('pointerout', stop);
        button.on('pointerupoutside', stop);
    }

    private createTapButton(
        xPosition: number,
        yPosition: number,
        width: number,
        label: string,
        action: () => void,
        color: number
    ): void {
        const button = this.add.rectangle(xPosition, yPosition, width, 34, color, 0.98)
            .setStrokeStyle(2, COLORS.gold)
            .setDepth(40)
            .setInteractive({useHandCursor: true});
        this.add.text(xPosition, yPosition, label, {
            color: '#f7f1da',
            fontFamily: 'Georgia, serif',
            fontSize: '12px',
            fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(41);
        const invoke = (): void => {
            if (!this.finishing && !this.helpOpen) action();
        };
        button.on('pointerdown', invoke);
    }

    private showHelp(): void {
        if (this.helpOpen || this.finishing) return;
        this.helpOpen = true;
        this.steerLeft = false;
        this.steerRight = false;
        this.fireHeld = false;
        this.state = setCasinoHeistPaused(this.state, true);
        const panel = this.add.rectangle(VIEW_SIZE / 2, VIEW_SIZE / 2, 592, 420, 0x090b18, 0.99)
            .setStrokeStyle(4, COLORS.casino)
            .setDepth(100)
            .setInteractive({useHandCursor: true});
        const title = this.add.text(VIEW_SIZE / 2, 154, 'GETAWAY DRIVER BRIEFING', {
            color: '#ff76d2',
            fontFamily: 'Georgia, serif',
            fontSize: '25px',
            fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(101);
        const body = this.add.text(VIEW_SIZE / 2, 326,
            'You already found the Getaway Car. Now reach the casino at the end of the road.\n\n' +
            'Hold LEFT or RIGHT for variable steering. Dodge nanotech crates, bollards, and the road edge.\n\n' +
            'Your car starts with NO WEAPON. Drive through the violet gun module, then keep collecting green ammo crates.\n\n' +
            'Luxury interceptors have spiked wheels and fire machine guns from their front only. Stay beside or behind them, or fire back.\n\n' +
            'Survive the route to steal $1,000. A destroyed car earns nothing.',
            {
                color: '#f7f1da',
                fontFamily: 'Georgia, serif',
                fontSize: '16px',
                align: 'center',
                lineSpacing: 4,
                wordWrap: {width: 520, useAdvancedWrap: true}
            }
        ).setOrigin(0.5).setDepth(101);
        const close = this.add.text(VIEW_SIZE / 2, 510, 'ENTER · START THE GETAWAY', {
            color: '#090b18',
            backgroundColor: '#ff76d2',
            fontFamily: 'Georgia, serif',
            fontSize: '17px',
            fontStyle: 'bold',
            padding: {x: 18, y: 10}
        }).setOrigin(0.5).setDepth(101).setInteractive({useHandCursor: true});
        panel.on('pointerdown', () => this.closeHelp());
        close.on('pointerdown', () => this.closeHelp());
        this.helpObjects = [panel, title, body, close];
        this.publishTelemetry();
    }

    private closeHelp(): void {
        if (!this.helpOpen) return;
        for (const object of this.helpObjects) object.destroy();
        this.helpObjects = [];
        this.helpOpen = false;
        this.state = setCasinoHeistPaused(this.state, false);
        this.publishTelemetry();
    }

    private handleEvents(events: readonly CasinoHeistEvent[]): void {
        for (const event of events) {
            switch (event.kind) {
                case 'enemy-spawned':
                    this.messageText.setText('LUXURY INTERCEPTOR INBOUND · WATCH ITS FRONT GUNS');
                    break;
                case 'pickup-collected':
                    this.messageText.setText(
                        event.pickupKind === 'weapon'
                            ? `PULSE CANNON ONLINE · ${event.ammo} SHOTS`
                            : `AMMO RECOVERED · ${event.ammo} SHOTS`
                    );
                    break;
                case 'player-fired':
                    break;
                case 'enemy-fired':
                    this.messageText.setText('ENEMY MUZZLE FLASH · CHANGE YOUR LINE');
                    break;
                case 'damage':
                    this.messageText.setText(
                        `${event.source.replace('-', ' ').toUpperCase()} HIT · ` +
                        `${event.health} HULL LEFT`
                    );
                    break;
                case 'recovered':
                    this.messageText.setText('HULL STABLE · KEEP DRIVING');
                    break;
                case 'enemy-destroyed':
                    this.messageText.setText('INTERCEPTOR DISABLED · ROAD OPEN');
                    break;
                case 'success':
                    this.messageText.setText(`CASINO REACHED · $${event.credits.toLocaleString()} STOLEN`);
                    break;
                case 'failure':
                    this.messageText.setText('GETAWAY CAR DESTROYED · THE NEXT ROAD WILL BE NEW');
                    break;
            }
        }
    }

    private syncPresentation(): void {
        this.drawWorld();
        const snapshot = getCasinoHeistRenderSnapshot(this.state);
        const progress = Phaser.Math.Clamp(
            snapshot.player.distance / snapshot.finishDistance,
            0,
            1
        );
        const hearts = '♥'.repeat(snapshot.player.health) +
            '♡'.repeat(snapshot.player.maxHealth - snapshot.player.health);
        const weapon = snapshot.player.weapon === 'none'
            ? 'UNARMED'
            : `PULSE ${snapshot.player.ammo}`;
        this.hudText.setText(
            `HULL ${hearts}  ${weapon}  CASINO ${Math.round(progress * 100)}%`
        );
        this.publishTelemetry();
    }

    private drawWorld(): void {
        const graphics = this.graphics;
        const snapshot = getCasinoHeistRenderSnapshot(this.state);
        graphics.clear();
        graphics.fillStyle(COLORS.night);
        graphics.fillRect(0, 0, VIEW_SIZE, VIEW_SIZE);
        this.drawCity(graphics);
        this.drawRoad(graphics, snapshot);
        this.drawCasino(graphics, snapshot.finishY);
        for (const obstacle of snapshot.obstacles) {
            this.drawObstacle(graphics, x(obstacle.x), obstacle.y, obstacle.kind, x(obstacle.width), obstacle.length);
        }
        for (const powerup of snapshot.powerups) {
            this.drawPowerup(graphics, x(powerup.x), powerup.y, powerup.kind);
        }
        for (const enemy of snapshot.enemies) {
            this.drawCar(graphics, x(enemy.x), enemy.y, true, enemy.colorIndex, false);
        }
        for (const projectile of snapshot.projectiles) {
            graphics.fillStyle(
                projectile.allegiance === 'player' ? COLORS.cyan : COLORS.danger
            );
            graphics.fillRoundedRect(x(projectile.x) - 3, projectile.y - 10, 6, 19, 3);
            graphics.fillStyle(0xffffff, 0.75);
            graphics.fillRect(x(projectile.x) - 1, projectile.y - 7, 2, 9);
        }
        const blink = snapshot.player.recoveryMs > 0 &&
            Math.floor(snapshot.player.recoveryMs / 90) % 2 === 0;
        if (!blink) {
            this.drawCar(
                graphics,
                x(snapshot.player.x),
                snapshot.player.y,
                false,
                0,
                snapshot.player.weapon !== 'none'
            );
        }
    }

    private drawCity(graphics: Phaser.GameObjects.Graphics): void {
        graphics.fillStyle(COLORS.city);
        for (let index = 0; index < 14; index++) {
            const width = 24 + index % 4 * 7;
            const height = 80 + index % 5 * 34;
            const left = index < 7;
            const buildingX = left
                ? index * 18 - 8
                : VIEW_SIZE - (index - 6) * 19 - width + 12;
            graphics.fillRect(buildingX, 140, width, height);
            graphics.fillStyle(index % 3 === 0 ? COLORS.casino : COLORS.cyan, 0.55);
            for (let windowY = 151; windowY < 140 + height - 8; windowY += 15) {
                graphics.fillRect(buildingX + 6, windowY, 4, 6);
                graphics.fillRect(buildingX + 15, windowY, 4, 6);
            }
            graphics.fillStyle(COLORS.city);
        }
    }

    private drawRoad(
        graphics: Phaser.GameObjects.Graphics,
        snapshot: CasinoHeistRenderSnapshot
    ): void {
        const sorted = [...snapshot.road].sort((left, right) => left.farY - right.farY);
        for (const segment of sorted) {
            const halfWidth = x(segment.width) / 2;
            const nearCenter = x(segment.nearCenterX);
            const farCenter = x(segment.farCenterX);
            const points = [
                new Phaser.Math.Vector2(farCenter - halfWidth, segment.farY),
                new Phaser.Math.Vector2(farCenter + halfWidth, segment.farY),
                new Phaser.Math.Vector2(nearCenter + halfWidth, segment.nearY),
                new Phaser.Math.Vector2(nearCenter - halfWidth, segment.nearY)
            ];
            graphics.fillStyle(
                segment.segmentIndex % 2 === 0 ? COLORS.road : COLORS.roadAlternate
            );
            graphics.fillPoints(points, true);
            graphics.lineStyle(7, COLORS.shoulder, 0.95);
            graphics.lineBetween(
                farCenter - halfWidth,
                segment.farY,
                nearCenter - halfWidth,
                segment.nearY
            );
            graphics.lineBetween(
                farCenter + halfWidth,
                segment.farY,
                nearCenter + halfWidth,
                segment.nearY
            );
            graphics.lineStyle(2, COLORS.paper, 0.65);
            for (const laneFraction of [-1 / 6, 1 / 6]) {
                const offset = x(segment.width) * laneFraction;
                graphics.lineBetween(
                    farCenter + offset,
                    segment.farY,
                    nearCenter + offset,
                    segment.nearY
                );
            }
        }
    }

    private drawCasino(graphics: Phaser.GameObjects.Graphics, finishY: number): void {
        if (finishY < -120 || finishY > VIEW_SIZE + 120) return;
        const yPosition = finishY - 58;
        graphics.fillStyle(COLORS.ink, 0.8);
        graphics.fillRoundedRect(222, yPosition - 2, 228, 90, 12);
        graphics.fillStyle(0x482261);
        graphics.fillRoundedRect(228, yPosition, 216, 82, 10);
        graphics.fillStyle(COLORS.casino);
        graphics.fillRoundedRect(250, yPosition + 10, 172, 35, 12);
        graphics.fillStyle(COLORS.gold);
        for (let lamp = 0; lamp < 9; lamp++) {
            graphics.fillCircle(263 + lamp * 18, yPosition + 27, 3);
        }
        graphics.lineStyle(7, COLORS.gold);
        graphics.lineBetween(240, finishY, 432, finishY);
    }

    private drawObstacle(
        graphics: Phaser.GameObjects.Graphics,
        xPosition: number,
        yPosition: number,
        kind: 'nano-crate' | 'security-bollard',
        width: number,
        length: number
    ): void {
        if (kind === 'nano-crate') {
            graphics.fillStyle(COLORS.ink, 0.5);
            graphics.fillRoundedRect(
                xPosition - width / 2 - 3,
                yPosition - length / 2 - 3,
                width + 6,
                length + 6,
                6
            );
            graphics.fillStyle(0x8d6238);
            graphics.fillRoundedRect(
                xPosition - width / 2,
                yPosition - length / 2,
                width,
                length,
                5
            );
            graphics.lineStyle(3, COLORS.gold);
            graphics.lineBetween(
                xPosition - width / 2 + 5,
                yPosition - length / 2 + 5,
                xPosition + width / 2 - 5,
                yPosition + length / 2 - 5
            );
            graphics.lineBetween(
                xPosition + width / 2 - 5,
                yPosition - length / 2 + 5,
                xPosition - width / 2 + 5,
                yPosition + length / 2 - 5
            );
        } else {
            graphics.fillStyle(COLORS.danger);
            for (const offset of [-width * 0.3, 0, width * 0.3]) {
                graphics.fillRoundedRect(xPosition + offset - 7, yPosition - 22, 14, 44, 5);
                graphics.fillStyle(COLORS.paper);
                graphics.fillRect(xPosition + offset - 5, yPosition - 7, 10, 8);
                graphics.fillStyle(COLORS.danger);
            }
        }
    }

    private drawPowerup(
        graphics: Phaser.GameObjects.Graphics,
        xPosition: number,
        yPosition: number,
        kind: 'weapon' | 'ammo'
    ): void {
        const pulse = 1 + Math.sin(this.animationClockMs / 130) * 0.12;
        const color = kind === 'weapon' ? COLORS.weapon : COLORS.ammo;
        graphics.fillStyle(color, 0.2);
        graphics.fillCircle(xPosition, yPosition, 25 * pulse);
        graphics.lineStyle(3, color);
        graphics.strokeRoundedRect(xPosition - 18, yPosition - 18, 36, 36, 8);
        graphics.fillStyle(color);
        if (kind === 'weapon') {
            graphics.fillRoundedRect(xPosition - 12, yPosition - 7, 25, 10, 3);
            graphics.fillTriangle(
                xPosition + 12, yPosition - 7,
                xPosition + 21, yPosition - 2,
                xPosition + 12, yPosition + 3
            );
            graphics.fillRect(xPosition - 5, yPosition + 2, 7, 12);
        } else {
            graphics.fillRect(xPosition - 10, yPosition - 12, 7, 24);
            graphics.fillRect(xPosition + 3, yPosition - 12, 7, 24);
            graphics.fillStyle(COLORS.ink);
            graphics.fillRect(xPosition - 8, yPosition - 9, 3, 16);
            graphics.fillRect(xPosition + 5, yPosition - 9, 3, 16);
        }
    }

    private drawCar(
        graphics: Phaser.GameObjects.Graphics,
        xPosition: number,
        yPosition: number,
        enemy: boolean,
        colorIndex: number,
        armed: boolean
    ): void {
        const color = enemy
            ? ENEMY_COLORS[colorIndex % ENEMY_COLORS.length]!
            : 0xe6424e;
        graphics.fillStyle(COLORS.ink, 0.5);
        graphics.fillRoundedRect(xPosition - 24, yPosition - 35, 48, 73, 13);
        graphics.fillStyle(color);
        graphics.fillRoundedRect(xPosition - 20, yPosition - 34, 40, 68, 11);
        graphics.fillStyle(0x8ee4ed);
        graphics.fillRoundedRect(xPosition - 14, yPosition - 19, 28, 19, 5);
        graphics.fillStyle(COLORS.ink, 0.65);
        graphics.fillRoundedRect(xPosition - 13, yPosition + 7, 26, 14, 4);
        graphics.fillStyle(COLORS.gold);
        graphics.fillRect(xPosition - 15, yPosition - 32, 9, 4);
        graphics.fillRect(xPosition + 6, yPosition - 32, 9, 4);
        graphics.fillStyle(COLORS.ink);
        graphics.fillRoundedRect(xPosition - 27, yPosition - 21, 8, 20, 3);
        graphics.fillRoundedRect(xPosition + 19, yPosition - 21, 8, 20, 3);
        graphics.fillRoundedRect(xPosition - 27, yPosition + 12, 8, 17, 3);
        graphics.fillRoundedRect(xPosition + 19, yPosition + 12, 8, 17, 3);
        if (enemy) {
            graphics.fillStyle(COLORS.paper);
            for (const side of [-1, 1]) {
                graphics.fillTriangle(
                    xPosition + side * 24, yPosition - 11,
                    xPosition + side * 34, yPosition - 5,
                    xPosition + side * 24, yPosition + 1
                );
            }
            graphics.fillStyle(COLORS.danger);
            graphics.fillRect(xPosition - 8, yPosition - 43, 5, 13);
            graphics.fillRect(xPosition + 3, yPosition - 43, 5, 13);
        } else if (armed) {
            graphics.fillStyle(COLORS.cyan);
            graphics.fillRoundedRect(xPosition - 6, yPosition - 47, 12, 22, 4);
            graphics.fillStyle(COLORS.paper);
            graphics.fillRect(xPosition - 2, yPosition - 53, 4, 10);
        }
    }

    private publishTelemetry(): void {
        const canvas = this.game.canvas;
        const snapshot = getCasinoHeistRenderSnapshot(this.state);
        const progress = Phaser.Math.Clamp(
            snapshot.player.distance / snapshot.finishDistance,
            0,
            1
        );
        const nearestPowerup = [...snapshot.powerups]
            .filter(powerup => powerup.y < snapshot.player.y + 40)
            .sort((left, right) => right.y - left.y)[0];
        canvas.dataset.heistStatus = snapshot.status;
        canvas.dataset.heistHealth = String(snapshot.player.health);
        canvas.dataset.heistMaxHealth = String(snapshot.player.maxHealth);
        canvas.dataset.heistWeapon = snapshot.player.weapon;
        canvas.dataset.heistAmmo = String(snapshot.player.ammo);
        canvas.dataset.heistX = String(Math.round(snapshot.player.x));
        canvas.dataset.heistDistance = String(Math.round(snapshot.player.distance));
        canvas.dataset.heistProgress = progress.toFixed(4);
        canvas.dataset.heistPowerupsCollected = String(this.state.telemetry.powerupsCollected);
        canvas.dataset.heistShotsFired = String(this.state.telemetry.shotsFired);
        canvas.dataset.heistEnemiesDestroyed = String(this.state.telemetry.enemiesDestroyed);
        canvas.dataset.heistEnemyShots = String(this.state.telemetry.enemyShotsFired);
        canvas.dataset.heistActiveEnemies = String(snapshot.enemies.length);
        canvas.dataset.heistNearestPowerupX = nearestPowerup ? String(Math.round(nearestPowerup.x)) : '';
        canvas.dataset.heistNearestPowerupY = nearestPowerup ? String(Math.round(nearestPowerup.y)) : '';
        canvas.dataset.heistHelpOpen = String(this.helpOpen);
        canvas.dataset.heistReward = String(snapshot.creditsStolen);
        canvas.dataset.heistCourseSignature =
            canonicalCasinoHeistCourseSignature(this.state.course);
    }

    private clearDatasets(): void {
        const canvas = this.game.canvas;
        delete canvas.dataset.heistStatus;
        delete canvas.dataset.heistHealth;
        delete canvas.dataset.heistMaxHealth;
        delete canvas.dataset.heistWeapon;
        delete canvas.dataset.heistAmmo;
        delete canvas.dataset.heistX;
        delete canvas.dataset.heistDistance;
        delete canvas.dataset.heistProgress;
        delete canvas.dataset.heistPowerupsCollected;
        delete canvas.dataset.heistShotsFired;
        delete canvas.dataset.heistEnemiesDestroyed;
        delete canvas.dataset.heistEnemyShots;
        delete canvas.dataset.heistActiveEnemies;
        delete canvas.dataset.heistNearestPowerupX;
        delete canvas.dataset.heistNearestPowerupY;
        delete canvas.dataset.heistHelpOpen;
        delete canvas.dataset.heistReward;
        delete canvas.dataset.heistCourseSignature;
        delete canvas.dataset.itemBonus;
    }

    private finish(status: 'success' | 'failure' | 'abandoned'): void {
        if (!this.scene.isActive()) return;
        this.finishing = true;
        this.steerLeft = false;
        this.steerRight = false;
        this.fireHeld = false;
        this.finishTimer?.remove(false);
        this.launchData.onComplete(this.createResult(status));
        this.scene.stop();
    }

    private createResult(status: 'success' | 'failure' | 'abandoned'): EncounterResult {
        const elapsedMs = this.state.activeTicks * CASINO_HEIST_FIXED_STEP_MS;
        const effects: OutcomeEffect[] = status === 'success'
            ? [
                {kind: 'change-money', delta: CASINO_HEIST_REWARD_CREDITS},
                {kind: 'adjust-world-system', system: 'securityAlert', delta: -12}
            ]
            : [];
        const score = status === 'success'
            ? Math.max(
                1_000,
                20_000 +
                this.state.player.health * 2_000 +
                this.state.telemetry.enemiesDestroyed * 750 -
                this.state.telemetry.hitsTaken * 1_000 -
                Math.floor(elapsedMs / 20)
            )
            : 0;
        return {
            runId: this.launchData.context.runId,
            definitionId: this.launchData.context.definitionId,
            triggerId: this.launchData.context.trigger.triggerId,
            kind: 'casino-heist',
            status,
            grade: status === 'success' ? gradeHeist(this.state) : 'none',
            score,
            elapsedMs,
            effects
        };
    }
}
