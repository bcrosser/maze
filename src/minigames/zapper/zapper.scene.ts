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
    ZAPPER_FIXED_STEP_MS,
    ZAPPER_LANE_COUNT,
    ZAPPER_SERVICE_X,
    ZAPPER_WORLD_WIDTH,
    advanceZapper,
    canonicalZapperCourseSignature,
    createZapperCourse,
    createZapperState,
    getZapperRenderSnapshot,
    getZapperTelemetry,
    setZapperPaused,
    type ZapperAlienAppearance,
    type ZapperEvent,
    type ZapperState
} from './zapper-model';

export const ZAPPER_SCENE_KEY = 'zapper';

export interface ZapperLaunchData {
    readonly context: EncounterContext;
    readonly onComplete: (result: EncounterResult) => void;
}

const VIEW_SIZE = 672;
const LANE_TOP = 174;
const LANE_GAP = 94;
const WORLD_LEFT = 15;
const WORLD_RIGHT = VIEW_SIZE - 15;

const COLORS = Object.freeze({
    void: 0x07161a,
    lab: 0x102a2f,
    labLight: 0x18434a,
    counter: 0x17343a,
    counterEdge: 0x43b9ad,
    grid: 0x2c6767,
    slime: 0x79ff4d,
    slimeDark: 0x1f9b45,
    paper: 0xeaffdf,
    ink: 0x07161a,
    danger: 0xff5f6d,
    gold: 0xffd365,
    cyan: 0x58e5ff,
    violet: 0xc28cff
});

const ALIEN_COLORS = Object.freeze([
    0x79ff4d,
    0x58e5ff,
    0xff73cf,
    0xffc857,
    0xb98bff,
    0xff786b
]);

function laneY(laneIndex: number): number {
    return LANE_TOP + laneIndex * LANE_GAP;
}

function sceneX(modelX: number): number {
    return WORLD_LEFT +
        modelX / ZAPPER_WORLD_WIDTH * (WORLD_RIGHT - WORLD_LEFT);
}

function resolveAttemptNumber(runId: string): number {
    const value = Number(runId.split('/').at(-1));
    return Number.isSafeInteger(value) && value >= 0 ? value + 1 : 1;
}

function gradeAttempt(state: ZapperState): PerformanceGrade {
    if (state.status !== 'success') return 'none';
    const elapsedMs = state.activeTicks * ZAPPER_FIXED_STEP_MS;
    const livesLost = state.course.startingLives - state.lives;
    if (livesLost === 0 && elapsedMs <= 90_000) return 's';
    if (livesLost <= 1 && elapsedMs <= 125_000) return 'a';
    if (state.lives >= 2) return 'b';
    return 'c';
}

export class ZapperScene extends Phaser.Scene {
    private launchData!: ZapperLaunchData;
    private state!: ZapperState;
    private graphics!: Phaser.GameObjects.Graphics;
    private hudText!: Phaser.GameObjects.Text;
    private messageText!: Phaser.GameObjects.Text;
    private helpObjects: Phaser.GameObjects.GameObject[] = [];
    private helpOpen = false;
    private chargeHeld = false;
    private pendingLaneDelta: -1 | 0 | 1 = 0;
    private pendingAction = false;
    private finishing = false;
    private finishTimer: Phaser.Time.TimerEvent | null = null;
    private animationClockMs = 0;

    constructor() {
        super({key: ZAPPER_SCENE_KEY});
    }

    create(data: ZapperLaunchData): void {
        this.launchData = data;
        const difficulty = Phaser.Math.Clamp(
            Math.floor(getEncounterNumberModifier(data.context, 'levelTier', 1)),
            1,
            5
        );
        const fillSpeedMultiplier = Math.max(
            0.5,
            getEncounterNumberModifier(data.context, 'zapperFillMultiplier', 1)
        );
        const catchTolerancePx = Math.max(
            0,
            getEncounterNumberModifier(data.context, 'zapperCatchBonus')
        );
        const course = createZapperCourse(
            new Mulberry32Random(data.context.seed),
            {
                difficulty,
                completionQuota: 10 + Math.min(4, difficulty - 1),
                bonuses: {
                    fillSpeedMultiplier,
                    catchTolerancePx
                }
            }
        );
        this.state = createZapperState(course);
        this.helpObjects = [];
        this.helpOpen = false;
        this.chargeHeld = false;
        this.pendingLaneDelta = 0;
        this.pendingAction = false;
        this.finishing = false;
        this.finishTimer = null;
        this.animationClockMs = 0;

        this.cameras.main.setBackgroundColor(COLORS.void);
        this.graphics = this.add.graphics().setDepth(10);
        this.add.text(VIEW_SIZE / 2, 20, 'ZAPPER · XENOTECH SERVICE SHIFT', {
            color: '#eaffdf',
            backgroundColor: '#163e45',
            fontFamily: 'Georgia, serif',
            fontSize: '22px',
            fontStyle: 'bold',
            padding: {x: 15, y: 7}
        }).setOrigin(0.5).setDepth(30);

        const itemBonus = getEncounterItemBonusLabel(data.context);
        if (itemBonus) {
            this.add.text(VIEW_SIZE / 2, 55, `ITEM BONUS · ${itemBonus}`, {
                color: '#07161a',
                backgroundColor: 'rgba(121,255,77,0.9)',
                fontFamily: 'monospace',
                fontSize: '10px',
                padding: {x: 7, y: 3}
            }).setOrigin(0.5).setDepth(30);
        }
        this.game.canvas.dataset.itemBonus = itemBonus ?? '';
        this.hudText = this.add.text(14, 84, '', {
            color: '#eaffdf',
            backgroundColor: 'rgba(7,22,26,0.92)',
            fontFamily: 'monospace',
            fontSize: '14px',
            padding: {x: 9, y: 6}
        }).setDepth(30);
        this.messageText = this.add.text(VIEW_SIZE / 2, 118,
            'HOLD FILL · SLIDE A FULL BLASTER INTO THE CORRECT LANE',
            {
                color: '#07161a',
                backgroundColor: 'rgba(234,255,223,0.92)',
                fontFamily: 'Georgia, serif',
                fontSize: '13px',
                fontStyle: 'bold',
                align: 'center',
                padding: {x: 10, y: 5},
                wordWrap: {width: 470, useAdvancedWrap: true}
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
        const result = advanceZapper(this.state, {
            laneDelta: this.pendingLaneDelta,
            chargeHeld: this.chargeHeld,
            actionPressed: this.pendingAction
        }, Math.max(0, delta));
        this.pendingLaneDelta = 0;
        this.pendingAction = false;
        this.state = result.state;
        this.handleEvents(result.events);
        this.syncPresentation();

        if (this.state.status !== 'active' && !this.finishing) {
            const terminal = this.state.status;
            this.finishing = true;
            this.finishTimer = this.time.delayedCall(850, () => this.finish(terminal));
        }
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (this.finishing) return;
        if (this.helpOpen) {
            if (['enter', ' ', 'h'].includes(event.key.toLowerCase())) {
                event.preventDefault();
                this.closeHelp();
            }
            return;
        }
        switch (event.key.toLowerCase()) {
            case 'arrowup':
            case 'w':
                event.preventDefault();
                this.pendingLaneDelta = -1;
                break;
            case 'arrowdown':
            case 's':
                event.preventDefault();
                this.pendingLaneDelta = 1;
                break;
            case 'f':
                event.preventDefault();
                this.chargeHeld = true;
                break;
            case ' ':
            case 'enter':
            case 'e':
                event.preventDefault();
                this.pendingAction = true;
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
        if (event.key.toLowerCase() === 'f') this.chargeHeld = false;
    };

    private createControls(): void {
        this.createButton(55, 610, 78, '▲ LANE', () => {
            this.pendingLaneDelta = -1;
        });
        this.createButton(143, 610, 78, '▼ LANE', () => {
            this.pendingLaneDelta = 1;
        });
        const fill = this.createButton(307, 610, 210, 'HOLD · FILL WITH SLIME', () => {}, 54, 0x267b49);
        const startFill = (): void => {
            if (!this.finishing && !this.helpOpen) this.chargeHeld = true;
        };
        const stopFill = (): void => {
            this.chargeHeld = false;
        };
        fill.button.removeAllListeners('pointerdown');
        fill.button.on('pointerdown', startFill);
        fill.button.on('pointerup', stopFill);
        fill.button.on('pointerout', stopFill);
        fill.button.on('pointerupoutside', stopFill);
        this.createButton(548, 610, 214, 'SLIDE / HAND OFF', () => {
            this.pendingAction = true;
        }, 54, 0x60408f);
        this.createButton(42, 20, 68, 'EXIT', () => this.finish('abandoned'), 34, 0x743943);
        this.createButton(630, 20, 68, 'HELP', () => this.showHelp(), 34, 0x285a68);
    }

    private createButton(
        x: number,
        y: number,
        width: number,
        label: string,
        action: () => void,
        height = 46,
        color = 0x24494f
    ): {
        readonly button: Phaser.GameObjects.Rectangle;
        readonly text: Phaser.GameObjects.Text;
    } {
        const button = this.add.rectangle(x, y, width, height, color, 0.97)
            .setStrokeStyle(2, COLORS.cyan)
            .setDepth(40)
            .setInteractive({useHandCursor: true});
        const text = this.add.text(x, y, label, {
            color: '#eaffdf',
            fontFamily: 'Georgia, serif',
            fontSize: width >= 180 ? '14px' : '12px',
            fontStyle: 'bold',
            align: 'center'
        }).setOrigin(0.5).setDepth(41);
        const invoke = (): void => {
            if (!this.finishing && !this.helpOpen) action();
        };
        button.on('pointerdown', invoke);
        return {button, text};
    }

    private showHelp(): void {
        if (this.helpOpen || this.finishing) return;
        this.helpOpen = true;
        this.chargeHeld = false;
        this.state = setZapperPaused(this.state, true);
        const panel = this.add.rectangle(VIEW_SIZE / 2, VIEW_SIZE / 2, 590, 410, 0x07161a, 0.985)
            .setStrokeStyle(4, COLORS.slime)
            .setDepth(100)
            .setInteractive({useHandCursor: true});
        const title = this.add.text(VIEW_SIZE / 2, 164, 'NANOTECH SHIFT BRIEFING', {
            color: '#79ff4d',
            fontFamily: 'Georgia, serif',
            fontSize: '24px',
            fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(101);
        const body = this.add.text(VIEW_SIZE / 2, 332,
            '1 · Move UP or DOWN to an alien’s laboratory table.\n\n' +
            '2 · Hold FILL until the slime tank reaches 100%.\n\n' +
            '3 · Press SLIDE to send the blaster across that lane. A bad slide costs a life.\n\n' +
            '4 · The alien assembles it and slides it back. Be in the same lane to catch it.\n\n' +
            '5 · Press HAND OFF while still in that lane to complete the order.\n\n' +
            'Finish the quota before three blasters break or aliens reach the service desk.',
            {
                color: '#eaffdf',
                fontFamily: 'Georgia, serif',
                fontSize: '16px',
                align: 'center',
                lineSpacing: 3,
                wordWrap: {width: 520, useAdvancedWrap: true}
            }
        ).setOrigin(0.5).setDepth(101);
        const close = this.add.text(VIEW_SIZE / 2, 511, 'ENTER · OPEN THE LAB', {
            color: '#07161a',
            backgroundColor: '#79ff4d',
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
        this.state = setZapperPaused(this.state, false);
        this.publishTelemetry();
    }

    private handleEvents(events: readonly ZapperEvent[]): void {
        for (const event of events) {
            switch (event.kind) {
                case 'wave-started':
                    this.messageText.setText(`WAVE ${event.waveIndex + 1} · INCOMING CUSTOMERS`);
                    break;
                case 'alien-spawned':
                    this.messageText.setText(`LANE ${event.laneIndex + 1} · ALIEN ORDER INCOMING`);
                    break;
                case 'lane-changed':
                    break;
                case 'blaster-ready':
                    this.messageText.setText('BLASTER FULL · SLIDE IT INTO AN OCCUPIED LANE');
                    break;
                case 'outgoing-launched':
                    this.messageText.setText(`LANE ${event.laneIndex + 1} · BLASTER SLIDING`);
                    break;
                case 'alien-received':
                    this.messageText.setText('ALIEN ASSEMBLING · WATCH FOR THE RETURN');
                    break;
                case 'return-launched':
                    this.messageText.setText('COMPLETED BLASTER RETURNING · MATCH ITS LANE');
                    break;
                case 'return-caught':
                    this.messageText.setText('CAUGHT · PRESS HAND OFF IN THIS LANE');
                    break;
                case 'handoff-complete':
                    this.messageText.setText(
                        `ORDER COMPLETE · ${event.completedOrders}/${event.quota}`
                    );
                    break;
                case 'action-rejected':
                    this.messageText.setText(
                        event.reason === 'blaster-not-full'
                            ? 'KEEP FILLING · THE BLASTER IS NOT READY'
                            : event.reason === 'handoff-wrong-lane'
                                ? 'FIND THE WAITING ALIEN’S LANE'
                                : 'THAT CUSTOMER HAS LEFT'
                    );
                    break;
                case 'life-lost':
                    this.messageText.setText(
                        `EQUIPMENT LOST · ${event.lives} ${event.lives === 1 ? 'LIFE' : 'LIVES'} LEFT`
                    );
                    break;
                case 'success':
                    this.messageText.setText('SHIFT COMPLETE · EVERY BLASTER DELIVERED');
                    break;
                case 'failure':
                    this.messageText.setText('SHIFT FAILED · THE NEXT LAB LAYOUT WILL BE NEW');
                    break;
            }
        }
    }

    private syncPresentation(): void {
        this.drawWorld();
        const telemetry = getZapperTelemetry(this.state);
        const seconds = Math.floor(telemetry.elapsedMs / 1_000);
        const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        const hearts = '♥'.repeat(telemetry.lives) +
            '♡'.repeat(this.state.course.startingLives - telemetry.lives);
        const held = telemetry.heldCompletedOrderId ? ' · CARRYING RETURN' : '';
        this.hudText.setText(
            `ORDERS ${telemetry.completedOrders}/${telemetry.completionQuota}  ` +
            `${hearts}  ${time}${held}`
        );
        this.publishTelemetry();
    }

    private drawWorld(): void {
        const graphics = this.graphics;
        const snapshot = getZapperRenderSnapshot(this.state);
        graphics.clear();

        graphics.fillStyle(COLORS.lab);
        graphics.fillRect(0, 0, VIEW_SIZE, VIEW_SIZE);
        graphics.fillStyle(COLORS.labLight, 0.6);
        for (let x = 8; x < VIEW_SIZE; x += 32) {
            for (let y = 68; y < 574; y += 32) {
                graphics.fillCircle(x, y, 1.5);
            }
        }
        graphics.fillStyle(0x092026, 0.9);
        graphics.fillRect(0, 145, VIEW_SIZE, 395);

        for (let lane = 0; lane < ZAPPER_LANE_COUNT; lane++) {
            const y = laneY(lane);
            graphics.fillStyle(COLORS.counter);
            graphics.fillRoundedRect(35, y - 24, VIEW_SIZE - 65, 48, 9);
            graphics.lineStyle(2, lane === this.state.player.laneIndex ? COLORS.slime : COLORS.counterEdge, 0.9);
            graphics.strokeRoundedRect(35, y - 24, VIEW_SIZE - 65, 48, 9);
            graphics.lineStyle(1, COLORS.grid, 0.75);
            for (let x = 112; x < VIEW_SIZE - 30; x += 38) {
                graphics.lineBetween(x, y - 19, x + 20, y + 19);
            }
            graphics.fillStyle(COLORS.cyan, 0.22);
            graphics.fillCircle(21, y, 13);
            graphics.fillStyle(COLORS.paper);
            graphics.fillCircle(21, y, 3);
        }

        this.drawServiceStation(graphics);
        for (const alien of snapshot.aliens) {
            this.drawAlien(graphics, sceneX(alien.x), laneY(alien.laneIndex), alien.appearance, alien.phase);
        }
        for (const projectile of snapshot.projectiles) {
            this.drawBlaster(
                graphics,
                sceneX(projectile.x),
                laneY(projectile.laneIndex),
                projectile.kind === 'returning'
            );
        }
    }

    private drawServiceStation(graphics: Phaser.GameObjects.Graphics): void {
        const y = laneY(this.state.player.laneIndex);
        const x = sceneX(ZAPPER_SERVICE_X);
        graphics.fillStyle(0x061115, 0.55);
        graphics.fillRoundedRect(4, 145, 96, 395, 10);
        graphics.lineStyle(3, COLORS.cyan, 0.8);
        graphics.strokeRoundedRect(4, 145, 96, 395, 10);
        graphics.fillStyle(COLORS.violet);
        graphics.fillRoundedRect(x - 26, y - 39, 52, 78, 12);
        graphics.fillStyle(COLORS.ink);
        graphics.fillRoundedRect(x - 18, y - 28, 36, 52, 8);
        const fillHeight = 46 * this.state.player.fillProgress;
        graphics.fillStyle(COLORS.slimeDark);
        graphics.fillRoundedRect(x - 14, y + 19 - fillHeight, 28, fillHeight, 5);
        graphics.fillStyle(COLORS.slime, 0.9);
        for (let bubble = 0; bubble < 4; bubble++) {
            const phase = (this.animationClockMs / 20 + bubble * 13) % 38;
            const bubbleY = y + 16 - Math.min(fillHeight - 2, phase);
            if (fillHeight > phase + 2) graphics.fillCircle(x - 8 + bubble * 5, bubbleY, 2);
        }
        graphics.lineStyle(3, COLORS.gold);
        graphics.lineBetween(x + 24, y - 5, x + 39, y - 5);
        graphics.fillStyle(this.state.player.fillProgress >= 1 ? COLORS.gold : COLORS.paper);
        graphics.fillTriangle(x + 40, y - 11, x + 54, y - 5, x + 40, y + 1);
        if (this.state.player.heldCompletedOrderId) {
            this.drawBlaster(graphics, x + 1, y - 52, true);
        }
    }

    private drawAlien(
        graphics: Phaser.GameObjects.Graphics,
        x: number,
        y: number,
        appearance: ZapperAlienAppearance,
        phase: 'approaching' | 'assembling' | 'waiting-return'
    ): void {
        const color = ALIEN_COLORS[appearance.bodyColorIndex % ALIEN_COLORS.length]!;
        const bob = Math.sin(this.animationClockMs / 180 + x * 0.03) * 3;
        const bodyY = y - 36 + bob;
        graphics.fillStyle(COLORS.ink, 0.45);
        graphics.fillEllipse(x, y + 16, 52, 10);
        graphics.fillStyle(color);
        if (appearance.species === 'jelly' || appearance.species === 'orb') {
            graphics.fillCircle(x, bodyY, appearance.species === 'orb' ? 24 : 27);
        } else if (appearance.species === 'crystal') {
            graphics.fillTriangle(x, bodyY - 30, x - 27, bodyY + 18, x + 27, bodyY + 18);
        } else {
            graphics.fillRoundedRect(x - 25, bodyY - 22, 50, 45, 15);
        }
        graphics.lineStyle(3, color);
        for (let antenna = 0; antenna < appearance.antennaCount; antenna++) {
            const offset = (antenna - (appearance.antennaCount - 1) / 2) * 11;
            graphics.lineBetween(x + offset, bodyY - 20, x + offset * 1.3, bodyY - 35);
            graphics.fillCircle(x + offset * 1.3, bodyY - 37, 3);
        }
        graphics.fillStyle(COLORS.ink);
        for (let eye = 0; eye < appearance.eyeCount; eye++) {
            const offset = (eye - (appearance.eyeCount - 1) / 2) * 9;
            graphics.fillCircle(x + offset, bodyY - 4, 3);
        }
        graphics.lineStyle(4, color);
        const legs = appearance.species === 'tripod' ? 3 : 2;
        for (let leg = 0; leg < legs; leg++) {
            const offset = (leg - (legs - 1) / 2) * 16;
            graphics.lineBetween(x + offset * 0.6, bodyY + 18, x + offset, y + 10);
        }
        if (phase !== 'approaching') {
            graphics.fillStyle(phase === 'assembling' ? COLORS.gold : COLORS.slime);
            graphics.fillCircle(x + 31, bodyY - 24, 9);
            graphics.fillStyle(COLORS.ink);
            graphics.fillCircle(x + 31, bodyY - 24, 3);
        }
    }

    private drawBlaster(
        graphics: Phaser.GameObjects.Graphics,
        x: number,
        y: number,
        completed: boolean
    ): void {
        graphics.fillStyle(COLORS.ink, 0.45);
        graphics.fillRoundedRect(x - 22, y - 8, 48, 20, 6);
        graphics.fillStyle(completed ? COLORS.gold : COLORS.violet);
        graphics.fillRoundedRect(x - 21, y - 12, 42, 18, 5);
        graphics.fillStyle(COLORS.slime);
        graphics.fillRoundedRect(x - 7, y - 9, 17, 11, 3);
        graphics.fillStyle(COLORS.cyan);
        graphics.fillTriangle(x + 20, y - 11, x + 31, y - 3, x + 20, y + 4);
        graphics.lineStyle(5, completed ? COLORS.gold : COLORS.violet);
        graphics.lineBetween(x - 10, y + 5, x - 6, y + 17);
    }

    private publishTelemetry(): void {
        const canvas = this.game.canvas;
        const telemetry = getZapperTelemetry(this.state);
        canvas.dataset.zapperStatus = telemetry.status;
        canvas.dataset.zapperLane = String(telemetry.laneIndex);
        canvas.dataset.zapperLives = String(telemetry.lives);
        canvas.dataset.zapperFill = telemetry.fillProgress.toFixed(3);
        canvas.dataset.zapperReady = String(telemetry.blasterReady);
        canvas.dataset.zapperHeldOrder = telemetry.heldCompletedOrderId ?? '';
        canvas.dataset.zapperCompleted = String(telemetry.completedOrders);
        canvas.dataset.zapperQuota = String(telemetry.completionQuota);
        canvas.dataset.zapperAliens = String(telemetry.activeAliens);
        canvas.dataset.zapperReturns = String(telemetry.returningBlasters);
        canvas.dataset.zapperHelpOpen = String(this.helpOpen);
        canvas.dataset.zapperCourseSignature = canonicalZapperCourseSignature(this.state.course);
    }

    private clearDatasets(): void {
        const canvas = this.game.canvas;
        delete canvas.dataset.zapperStatus;
        delete canvas.dataset.zapperLane;
        delete canvas.dataset.zapperLives;
        delete canvas.dataset.zapperFill;
        delete canvas.dataset.zapperReady;
        delete canvas.dataset.zapperHeldOrder;
        delete canvas.dataset.zapperCompleted;
        delete canvas.dataset.zapperQuota;
        delete canvas.dataset.zapperAliens;
        delete canvas.dataset.zapperReturns;
        delete canvas.dataset.zapperHelpOpen;
        delete canvas.dataset.zapperCourseSignature;
        delete canvas.dataset.itemBonus;
    }

    private finish(status: 'success' | 'failure' | 'abandoned'): void {
        if (!this.scene.isActive()) return;
        this.finishing = true;
        this.chargeHeld = false;
        this.finishTimer?.remove(false);
        this.launchData.onComplete(this.createResult(status));
        this.scene.stop();
    }

    private createResult(status: 'success' | 'failure' | 'abandoned'): EncounterResult {
        const elapsedMs = this.state.activeTicks * ZAPPER_FIXED_STEP_MS;
        const effects: OutcomeEffect[] = status === 'success'
            ? [
                {kind: 'change-resource', resource: 'scrap', delta: 8},
                {kind: 'adjust-world-system', system: 'powerRouting', delta: 8}
            ]
            : [];
        const score = status === 'success'
            ? Math.max(
                1_000,
                this.state.completedOrders * 1_000 +
                this.state.lives * 1_500 -
                Math.floor(elapsedMs / 20)
            )
            : 0;
        return {
            runId: this.launchData.context.runId,
            definitionId: this.launchData.context.definitionId,
            triggerId: this.launchData.context.trigger.triggerId,
            kind: 'zapper',
            status,
            grade: status === 'success' ? gradeAttempt(this.state) : 'none',
            score,
            elapsedMs,
            effects
        };
    }
}
