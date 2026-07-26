import Phaser from 'phaser';

import {Mulberry32Random} from '../../domain/random/random-source';
import type {EncounterContext, EncounterResult, OutcomeEffect} from '../../encounters/contracts';
import {
    getEncounterItemBonusLabel,
    getEncounterNumberModifier
} from '../item-bonus';
import {
    advanceTumblerRelayTime,
    createTumblerRelayLock,
    getActiveTumblerIndex,
    gradeTumblerRelay,
    isTumblerInBand,
    pressTumbler,
    scoreTumblerRelay,
    setTumblerRelayPaused,
    tumblerPosition,
    turnTumblerCam,
    type TumblerRelayFeedback,
    type TumblerRelayLock
} from './tumbler-relay-model';

export const TUMBLER_RELAY_SCENE_KEY = 'tumblerrelay';

export interface TumblerRelayLaunchData {
    readonly context: EncounterContext;
    readonly onComplete: (result: EncounterResult) => void;
    readonly onTutorialSeen?: () => void;
}

const VIEW_SIZE = 672;
const TRACK_ORIGIN_X = 152;
const TRACK_GAP = 76;
const TRACK_TOP = 170;
const TRACK_HEIGHT = 240;
const CATCH_CENTER_X = 290;
const TURN_CENTER_X = 500;
const BUTTON_Y = 482;

const COLORS = Object.freeze({
    backdrop: 0x0f110e,
    panel: 0x171918,
    panelBorder: 0x676b60,
    chamber: 0x242724,
    housing: 0x343933,
    metal: 0xb6b09f,
    metalDark: 0x676b60,
    paper: 0xf5f0df,
    accent: 0xefc75e,
    cyan: 0x67d5e8,
    danger: 0xef6f6c,
    warning: 0xef8d6b,
    safe: 0x79c267,
    ink: 0x111310
});

function feedbackText(feedback: TumblerRelayFeedback): string {
    switch (feedback) {
        case 'latched':
            return 'LATCHED — CLEAN CATCH';
        case 'missed':
            return 'MISSED — THE TUMBLER SLIPPED PAST';
        case 'dropped':
            return 'MISSED — AND THE LAST LATCH SHOOK LOOSE';
        case 'turn-ready':
            return 'ALL TUMBLERS LATCHED — TURN THE CAM';
        case 'latch-all-first':
            return 'LATCH EVERY TUMBLER FIRST';
        case 'opened':
            return 'OPEN — THE CAM ROLLED OVER';
        case 'failed':
            return 'LOCK FAILED — THE ALARM WON';
        case 'idle':
            return 'CATCH THE GLOWING TUMBLER INSIDE ITS GOLD BAND';
    }
}

function feedbackColor(feedback: TumblerRelayFeedback): string {
    switch (feedback) {
        case 'missed':
        case 'dropped':
        case 'failed':
            return '#ef6f6c';
        case 'latched':
        case 'turn-ready':
        case 'opened':
            return '#67d5e8';
        case 'latch-all-first':
            return '#f5f0df';
        case 'idle':
            return '#dce8a5';
    }
}

export class TumblerRelayScene extends Phaser.Scene {
    private launchData!: TumblerRelayLaunchData;
    private lock!: TumblerRelayLock;
    private graphics!: Phaser.GameObjects.Graphics;
    private statusText!: Phaser.GameObjects.Text;
    private wearText!: Phaser.GameObjects.Text;
    private alarmText!: Phaser.GameObjects.Text;
    private guidanceText!: Phaser.GameObjects.Text;
    private catchButton!: Phaser.GameObjects.Rectangle;
    private catchText!: Phaser.GameObjects.Text;
    private turnButton!: Phaser.GameObjects.Rectangle;
    private turnText!: Phaser.GameObjects.Text;
    private tumblerLabels: Phaser.GameObjects.Text[] = [];
    private finishing = false;
    private helpOpen = false;
    private pauseOpen = false;
    private tutorialPreviouslySeen = false;
    private tutorialMarkedSeen = false;
    private helpObjects: Phaser.GameObjects.GameObject[] = [];
    private pauseObjects: Phaser.GameObjects.GameObject[] = [];

    constructor() {
        super({key: TUMBLER_RELAY_SCENE_KEY});
    }

    create(data: TumblerRelayLaunchData): void {
        this.launchData = data;
        const rawTier = data.context.modifiers['levelTier'];
        const levelTier = typeof rawTier === 'number' && Number.isSafeInteger(rawTier)
            ? rawTier
            : 0;
        this.lock = createTumblerRelayLock(
            new Mulberry32Random(data.context.seed),
            {difficulty: data.context.difficulty, levelTier}
        );
        const bandBonus = Math.max(
            0,
            getEncounterNumberModifier(data.context, 'lockBandBonus')
        );
        const alarmBonusMs = Math.max(
            0,
            getEncounterNumberModifier(data.context, 'lockAlarmBonusMs')
        );
        if (bandBonus > 0 || alarmBonusMs > 0) {
            this.lock = {
                ...this.lock,
                config: {
                    ...this.lock.config,
                    // The lantern's wider tension band widens the catch band here.
                    catchHalfWidth: Math.min(
                        0.2,
                        this.lock.config.catchHalfWidth + bandBonus / 2
                    ),
                    alarmWindowMs: this.lock.config.alarmWindowMs + alarmBonusMs
                }
            };
        }
        this.tumblerLabels = [];
        this.finishing = false;
        this.helpOpen = false;
        this.pauseOpen = false;
        this.helpObjects = [];
        this.pauseObjects = [];
        this.tutorialPreviouslySeen =
            data.context.campaignSnapshot.flags.includes('tutorial-lock-tumbler-seen');
        this.tutorialMarkedSeen = this.tutorialPreviouslySeen;

        this.createFrame();
        this.createControls();
        this.bindInput();
        this.drawLock();
        this.updateReadouts();
        this.publishProgress();

        if (!this.tutorialPreviouslySeen) this.showHelp();
    }

    override update(_time: number, delta: number): void {
        if (this.finishing) return;
        const previousAlarm = this.lock.alarm;
        this.lock = advanceTumblerRelayTime(this.lock, delta);
        if (this.lock.status === 'failed') {
            this.statusText
                .setText(this.lock.failureReason === 'wear'
                    ? 'FAILED — THE CATCH LEVER WORE OUT'
                    : 'FAILED — ALARM TRIPPED')
                .setColor('#ef6f6c');
            this.publishProgress();
            this.finish('failure');
            return;
        }

        // Redraw supplies the bouncing tumblers and continuously moving meters.
        this.drawLock();
        if (Math.floor(previousAlarm) !== Math.floor(this.lock.alarm)) {
            this.updateReadouts();
            this.publishProgress();
        }
    }

    private createFrame(): void {
        this.add.rectangle(0, 0, VIEW_SIZE, VIEW_SIZE, COLORS.backdrop, 0.82).setOrigin(0);
        this.add.rectangle(VIEW_SIZE / 2, VIEW_SIZE / 2, 616, 642, COLORS.panel)
            .setStrokeStyle(2, COLORS.panelBorder);
        this.add.text(48, 28, 'RELIC TUMBLERS // TIMING', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '25px'
        });
        const itemBonus = getEncounterItemBonusLabel(this.launchData.context);
        this.add.text(48, 64,
            'Each tumbler bounces. Catch it inside its gold band, left to right.' +
            (itemBonus ? `\nITEM BONUS · ${itemBonus}` : ''),
        {
            color: '#b6b09f',
            fontFamily: 'Georgia, serif',
            fontSize: itemBonus ? '12px' : '15px',
            lineSpacing: 1
        });
        this.game.canvas.dataset.itemBonus = itemBonus ?? '';

        this.wearText = this.add.text(48, 101, '', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '14px'
        });
        this.alarmText = this.add.text(362, 101, '', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '14px'
        });
        this.guidanceText = this.add.text(48, 528, '', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '15px'
        });
        this.statusText = this.add.text(48, 558, feedbackText('idle'), {
            color: '#dce8a5',
            fontFamily: 'Georgia, serif',
            fontSize: '17px',
            wordWrap: {width: 576}
        });
        this.add.text(
            48,
            614,
            'Space/Enter catch  •  click a tumbler to catch  •  turn the cam when all glow',
            {
                color: '#8f9489',
                fontFamily: 'Georgia, serif',
                fontSize: '13px'
            }
        );

        const closeButton = this.add.circle(608, 48, 20, 0x2f3430)
            .setStrokeStyle(2, COLORS.panelBorder)
            .setInteractive({useHandCursor: true});
        this.add.text(608, 47, '×', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '24px'
        }).setOrigin(0.5);
        closeButton.on('pointerdown', () => this.showPauseConfirmation());

        const helpButton = this.add.rectangle(564, 102, 88, 30, 0x2f3430)
            .setStrokeStyle(1, COLORS.panelBorder)
            .setInteractive({useHandCursor: true});
        this.add.text(564, 102, 'HELP', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '14px'
        }).setOrigin(0.5);
        helpButton.on('pointerdown', () => {
            if (!this.finishing) this.showHelp();
        });

        this.graphics = this.add.graphics();
    }

    private createControls(): void {
        for (let index = 0; index < this.lock.tumblers.length; index++) {
            const centerX = this.tumblerX(index);
            this.add.rectangle(
                centerX,
                TRACK_TOP + TRACK_HEIGHT / 2,
                58,
                TRACK_HEIGHT,
                0xffffff,
                0.001
            )
                .setInteractive({useHandCursor: true})
                .on('pointerdown', () => {
                    if (!this.canInteract()) return;
                    this.tryCatch();
                });
            this.tumblerLabels.push(
                this.add.text(centerX, TRACK_TOP + TRACK_HEIGHT + 25, `T${index + 1}`, {
                    color: '#8f9489',
                    fontFamily: 'Georgia, serif',
                    fontSize: '12px'
                }).setOrigin(0.5)
            );
        }

        this.catchButton = this.add.rectangle(CATCH_CENTER_X, BUTTON_Y, 150, 48, 0x315e52)
            .setStrokeStyle(2, COLORS.accent)
            .setInteractive({useHandCursor: true})
            .on('pointerdown', () => {
                if (!this.canInteract()) return;
                this.tryCatch();
            });
        this.catchText = this.add.text(CATCH_CENTER_X, BUTTON_Y, 'CATCH ⏺', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '16px'
        }).setOrigin(0.5);

        this.turnButton = this.add.rectangle(TURN_CENTER_X, BUTTON_Y, 104, 48, 0x2f3430)
            .setStrokeStyle(2, COLORS.panelBorder)
            .setInteractive({useHandCursor: true})
            .on('pointerdown', () => {
                if (!this.canInteract()) return;
                this.tryTurnCam();
            });
        this.turnText = this.add.text(TURN_CENTER_X, BUTTON_Y, 'TURN ▶', {
            color: '#8f9489',
            fontFamily: 'Georgia, serif',
            fontSize: '16px'
        }).setOrigin(0.5);
    }

    private bindInput(): void {
        this.input.keyboard?.on('keydown', this.handleKeyDown, this);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown, this);
            delete this.game.canvas.dataset.tumblerFeedback;
            delete this.game.canvas.dataset.tumblerStatus;
            delete this.game.canvas.dataset.tumblerActive;
            delete this.game.canvas.dataset.tumblerLatchedCount;
            delete this.game.canvas.dataset.tumblerCount;
            delete this.game.canvas.dataset.tumblerInBand;
            delete this.game.canvas.dataset.tumblerAlarm;
            delete this.game.canvas.dataset.tumblerWear;
            delete this.game.canvas.dataset.tumblerTurnEnabled;
            delete this.game.canvas.dataset.tumblerHelpOpen;
            delete this.game.canvas.dataset.itemBonus;
        });
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        const key = event.key.toLowerCase();
        if (key === 'escape') {
            if (this.helpOpen) this.hideHelp(false);
            this.showPauseConfirmation();
            event.preventDefault();
            return;
        }
        if (this.helpOpen && (key === 'enter' || key === ' ')) {
            this.hideHelp(true);
            event.preventDefault();
            return;
        }
        if (!this.canInteract()) return;

        if (key === ' ' || key === 'enter') {
            if (this.lock.tumblers.every(tumbler => tumbler.latched)) this.tryTurnCam();
            else this.tryCatch();
        } else {
            return;
        }
        event.preventDefault();
    };

    private canInteract(): boolean {
        return !this.finishing &&
            !this.helpOpen &&
            !this.pauseOpen &&
            this.lock.status === 'active';
    }

    private tumblerX(index: number): number {
        return TRACK_ORIGIN_X + index * TRACK_GAP;
    }

    private tryCatch(): void {
        const result = pressTumbler(this.lock);
        this.lock = result.state;
        this.showModelFeedback(result.feedback);
        if (this.lock.status === 'failed') this.finish('failure');
    }

    private tryTurnCam(): void {
        this.lock = turnTumblerCam(this.lock);
        this.showModelFeedback(this.lock.feedback);
        if (this.lock.status === 'opened') this.finish('success');
    }

    private showModelFeedback(feedback: TumblerRelayFeedback): void {
        this.statusText
            .setText(feedbackText(feedback))
            .setColor(feedbackColor(feedback));
        this.drawLock();
        this.updateReadouts();
        this.publishProgress();
    }

    private drawLock(): void {
        const graphics = this.graphics;
        graphics.clear();
        this.drawMeters(graphics);

        const housingWidth = this.lock.tumblers.length * TRACK_GAP + 40;
        const housingLeft = TRACK_ORIGIN_X - TRACK_GAP / 2 - 20 + TRACK_GAP / 2;
        graphics.fillStyle(COLORS.housing)
            .fillRoundedRect(housingLeft - 30, TRACK_TOP - 16, housingWidth, TRACK_HEIGHT + 32, 26);
        graphics.lineStyle(2, COLORS.panelBorder)
            .strokeRoundedRect(housingLeft - 30, TRACK_TOP - 16, housingWidth, TRACK_HEIGHT + 32, 26);

        const activeIndex = getActiveTumblerIndex(this.lock);
        for (let index = 0; index < this.lock.tumblers.length; index++) {
            const tumbler = this.lock.tumblers[index]!;
            const centerX = this.tumblerX(index);
            const isActive = index === activeIndex;

            graphics.fillStyle(COLORS.chamber)
                .fillRoundedRect(centerX - 24, TRACK_TOP, 48, TRACK_HEIGHT, 8);
            graphics.lineStyle(
                isActive ? 4 : 1,
                isActive ? COLORS.accent : tumbler.latched ? COLORS.cyan : COLORS.metalDark
            ).strokeRoundedRect(centerX - 24, TRACK_TOP, 48, TRACK_HEIGHT, 8);

            // Gold catch band. Position space maps 1 → track top, 0 → bottom.
            const bandTop = TRACK_TOP +
                (1 - (tumbler.bandCenter + this.lock.config.catchHalfWidth)) * TRACK_HEIGHT;
            const bandHeight = this.lock.config.catchHalfWidth * 2 * TRACK_HEIGHT;
            graphics.fillStyle(COLORS.accent, tumbler.latched ? 0.18 : isActive ? 0.5 : 0.28)
                .fillRect(centerX - 22, bandTop, 44, bandHeight);
            graphics.lineStyle(2, COLORS.accent, tumbler.latched ? 0.3 : 0.9)
                .strokeRect(centerX - 22, bandTop, 44, bandHeight);

            const position = tumbler.latched
                ? tumbler.bandCenter
                : tumblerPosition(tumbler, this.lock.activeElapsedMs);
            const ringY = TRACK_TOP + (1 - position) * TRACK_HEIGHT;
            const inBand = !tumbler.latched &&
                Math.abs(position - tumbler.bandCenter) <= this.lock.config.catchHalfWidth;
            const ringColor = tumbler.latched
                ? COLORS.cyan
                : inBand && isActive ? COLORS.accent : COLORS.metal;
            graphics.lineStyle(3, COLORS.metalDark)
                .lineBetween(centerX, TRACK_TOP + 8, centerX, TRACK_TOP + TRACK_HEIGHT - 8);
            graphics.fillStyle(ringColor).fillCircle(centerX, ringY, tumbler.latched ? 11 : 13);
            graphics.fillStyle(COLORS.ink).fillCircle(centerX, ringY, 5);

            if (tumbler.latched) {
                graphics.fillStyle(COLORS.accent).fillCircle(centerX, TRACK_TOP + 14, 5);
            } else if (isActive) {
                graphics.fillStyle(COLORS.accent).fillTriangle(
                    centerX,
                    TRACK_TOP - 4,
                    centerX - 8,
                    TRACK_TOP - 16,
                    centerX + 8,
                    TRACK_TOP - 16
                );
            }
            this.tumblerLabels[index]
                ?.setText(isActive ? `NEXT T${index + 1}` : `T${index + 1}`)
                .setColor(
                    isActive
                        ? '#efc75e'
                        : tumbler.latched ? '#67d5e8' : '#8f9489'
                );
        }

        this.guidanceText
            .setText(activeIndex === null
                ? 'READY — TAP TURN ▶'
                : `NEXT: TUMBLER ${activeIndex + 1} — CATCH IT INSIDE THE GOLD BAND`)
            .setColor(activeIndex === null ? '#67d5e8' : '#efc75e');
        this.updateButtons();
    }

    private drawMeters(graphics: Phaser.GameObjects.Graphics): void {
        const wearRatio = this.lock.wear / this.lock.config.maximumWear;
        const alarmRatio = this.lock.alarm / 100;
        graphics.fillStyle(0x292d29).fillRoundedRect(48, 125, 238, 13, 5);
        graphics.fillStyle(COLORS.safe).fillRoundedRect(48, 125, 238 * wearRatio, 13, 5);
        graphics.fillStyle(0x292d29).fillRoundedRect(362, 125, 226, 13, 5);
        graphics.fillStyle(alarmRatio >= 0.75 ? COLORS.danger : COLORS.warning)
            .fillRoundedRect(362, 125, 226 * alarmRatio, 13, 5);
    }

    private updateButtons(): void {
        const turnEnabled = this.lock.tumblers.every(tumbler => tumbler.latched);
        this.catchButton
            .setFillStyle(turnEnabled ? 0x2f3430 : 0x315e52)
            .setStrokeStyle(2, turnEnabled ? COLORS.panelBorder : COLORS.accent);
        this.catchText.setColor(turnEnabled ? '#8f9489' : '#efc75e');
        this.turnButton
            .setFillStyle(turnEnabled ? 0x315e52 : 0x2f3430)
            .setStrokeStyle(2, turnEnabled ? COLORS.cyan : COLORS.panelBorder);
        this.turnText
            .setText(turnEnabled ? 'TURN NOW ▶' : 'TURN ▶')
            .setColor(turnEnabled ? '#67d5e8' : '#8f9489');
    }

    private updateReadouts(): void {
        this.wearText.setText(
            `LEVER WEAR  ${this.lock.wear}/${this.lock.config.maximumWear}`
        );
        this.alarmText.setText(`ALARM  ${Math.floor(this.lock.alarm)}%`);
    }

    private showHelp(): void {
        if (this.helpOpen || this.finishing) return;
        this.helpOpen = true;
        this.syncPausedState();
        const depth = 100;
        const shade = this.add.rectangle(0, 0, VIEW_SIZE, VIEW_SIZE, 0x080908, 0.82)
            .setOrigin(0)
            .setDepth(depth)
            .setInteractive();
        const panel = this.add.rectangle(336, 332, 528, 414, 0x20231f)
            .setStrokeStyle(3, COLORS.accent)
            .setDepth(depth + 1);
        const title = this.add.text(336, 162, 'HOW TO CATCH THESE TUMBLERS', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '25px'
        }).setOrigin(0.5).setDepth(depth + 2);
        const body = this.add.text(112, 202, [
            '1  Each tumbler bounces up and down its track.',
            '    They latch left to right — follow the gold NEXT marker.',
            '',
            '2  Press CATCH (or Space) while the ring is inside',
            '    its gold band. Latched tumblers glow cyan.',
            '',
            '3  Misses wear the lever and rattle the alarm — a bad',
            '    miss can shake the last latch loose. Latch them all,',
            '    then tap TURN NOW.'
        ], {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '17px',
            lineSpacing: 5
        }).setDepth(depth + 2);
        const note = this.add.text(336, 452, 'Help pauses the tumblers and the alarm.', {
            color: '#b6b09f',
            fontFamily: 'Georgia, serif',
            fontSize: '14px'
        }).setOrigin(0.5).setDepth(depth + 2);

        this.helpObjects = [shade, panel, title, body, note];
        this.helpObjects.push(
            ...this.createOverlayButton(256, 500, 128, 'TRY IT', () => this.hideHelp(true), depth + 2),
            ...this.createOverlayButton(416, 500, 108, 'SKIP', () => this.hideHelp(true), depth + 2)
        );
    }

    private hideHelp(markSeen: boolean): void {
        if (!this.helpOpen) return;
        for (const object of this.helpObjects) object.destroy();
        this.helpObjects = [];
        this.helpOpen = false;
        if (markSeen && !this.tutorialMarkedSeen) {
            this.tutorialMarkedSeen = true;
            this.launchData.onTutorialSeen?.();
        }
        this.syncPausedState();
    }

    private showPauseConfirmation(): void {
        if (this.pauseOpen || this.finishing) return;
        this.pauseOpen = true;
        this.syncPausedState();
        const depth = 120;
        const shade = this.add.rectangle(0, 0, VIEW_SIZE, VIEW_SIZE, 0x080908, 0.76)
            .setOrigin(0)
            .setDepth(depth)
            .setInteractive();
        const panel = this.add.rectangle(336, 336, 430, 220, 0x20231f)
            .setStrokeStyle(2, COLORS.panelBorder)
            .setDepth(depth + 1);
        const title = this.add.text(336, 278, 'PAUSED', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '26px'
        }).setOrigin(0.5).setDepth(depth + 2);
        const copy = this.add.text(336, 316, 'The alarm clock is frozen. Return to the maze?', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '16px'
        }).setOrigin(0.5).setDepth(depth + 2);
        this.pauseObjects = [shade, panel, title, copy];
        this.pauseObjects.push(
            ...this.createOverlayButton(256, 382, 126, 'RESUME', () => {
                this.hidePauseConfirmation();
            }, depth + 2),
            ...this.createOverlayButton(420, 382, 158, 'RETURN TO MAZE', () => {
                this.finish('abandoned');
            }, depth + 2)
        );
    }

    private hidePauseConfirmation(): void {
        if (!this.pauseOpen) return;
        for (const object of this.pauseObjects) object.destroy();
        this.pauseObjects = [];
        this.pauseOpen = false;
        this.syncPausedState();
    }

    private createOverlayButton(
        x: number,
        y: number,
        width: number,
        label: string,
        action: () => void,
        depth: number
    ): readonly Phaser.GameObjects.GameObject[] {
        const button = this.add.rectangle(x, y, width, 38, 0x343934)
            .setStrokeStyle(2, COLORS.panelBorder)
            .setDepth(depth)
            .setInteractive({useHandCursor: true});
        const text = this.add.text(x, y, label, {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '13px'
        }).setOrigin(0.5).setDepth(depth + 1);
        button.on('pointerdown', action);
        return [button, text];
    }

    private syncPausedState(): void {
        this.lock = setTumblerRelayPaused(this.lock, this.helpOpen || this.pauseOpen);
        this.publishProgress();
    }

    private publishProgress(): void {
        const activeIndex = getActiveTumblerIndex(this.lock);
        this.game.canvas.dataset.tumblerFeedback = this.lock.feedback;
        this.game.canvas.dataset.tumblerStatus = this.lock.status;
        this.game.canvas.dataset.tumblerActive =
            activeIndex === null ? 'none' : String(activeIndex);
        this.game.canvas.dataset.tumblerLatchedCount =
            String(this.lock.tumblers.filter(tumbler => tumbler.latched).length);
        this.game.canvas.dataset.tumblerCount = String(this.lock.tumblers.length);
        this.game.canvas.dataset.tumblerInBand = String(
            activeIndex !== null && isTumblerInBand(this.lock, activeIndex)
        );
        this.game.canvas.dataset.tumblerAlarm = String(Math.floor(this.lock.alarm));
        this.game.canvas.dataset.tumblerWear = String(this.lock.wear);
        this.game.canvas.dataset.tumblerTurnEnabled =
            String(this.lock.tumblers.every(tumbler => tumbler.latched));
        this.game.canvas.dataset.tumblerHelpOpen = String(this.helpOpen);
    }

    private finish(status: 'success' | 'failure' | 'abandoned'): void {
        if (this.finishing) return;
        this.finishing = true;
        this.launchData.onComplete(this.createResult(status));
        this.scene.stop();
    }

    private createResult(status: 'success' | 'failure' | 'abandoned'): EncounterResult {
        const tutorialEffects: OutcomeEffect[] =
            this.tutorialMarkedSeen && !this.tutorialPreviouslySeen
                ? [{kind: 'set-flag', flag: 'tutorial-lock-tumbler-seen'}]
                : [];
        let effects: OutcomeEffect[];
        if (status === 'success') {
            effects = [
                {kind: 'upgrade-mining-power', minimum: 2},
                {kind: 'change-resource', resource: 'toolCharge', delta: 6},
                {kind: 'change-resource', resource: 'scrap', delta: 3},
                {kind: 'adjust-world-system', system: 'securityAlert', delta: -10},
                {kind: 'set-flag', flag: 'archive-lock-opened'},
                ...tutorialEffects
            ];
        } else {
            effects = [
                {
                    kind: 'adjust-world-system',
                    system: 'securityAlert',
                    delta: status === 'failure' ? 10 : 7
                },
                {kind: 'set-flag', flag: 'archive-lock-scratched'},
                ...tutorialEffects
            ];
        }

        return {
            runId: this.launchData.context.runId,
            definitionId: this.launchData.context.definitionId,
            triggerId: this.launchData.context.trigger.triggerId,
            kind: 'lock',
            status,
            grade: status === 'success' ? gradeTumblerRelay(this.lock) : 'none',
            score: status === 'success' ? scoreTumblerRelay(this.lock) : 0,
            elapsedMs: this.lock.activeElapsedMs,
            effects
        };
    }
}
