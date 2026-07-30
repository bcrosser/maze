import Phaser from 'phaser';

import {getControlDeck} from '../../app/control-deck-host';
import {SAFE_DIAL_CONTROL_SCHEME, type ControlEvent} from '../../app/control-scheme';
import {Mulberry32Random} from '../../domain/random/random-source';
import type {EncounterContext, EncounterResult, OutcomeEffect} from '../../encounters/contracts';
import {
    getEncounterItemBonusLabel,
    getEncounterNumberModifier
} from '../item-bonus';
import {
    DIAL_SIZE,
    advanceSafeDialTime,
    createSafeDialLock,
    getCurrentGate,
    getDialSignalStrength,
    gradeSafeDial,
    pullHandle,
    rotateDial,
    scoreSafeDial,
    setDialPosition,
    setSafeDialPaused,
    tryGate,
    type SafeDialFeedback,
    type SafeDialLock
} from './safe-dial-model';

export const SAFE_DIAL_SCENE_KEY = 'safedial';

export interface SafeDialLaunchData {
    readonly context: EncounterContext;
    readonly onComplete: (result: EncounterResult) => void;
    readonly onTutorialSeen?: () => void;
}

const VIEW_SIZE = 672;
const DIAL_CENTER_X = 336;
const DIAL_CENTER_Y = 296;
const DIAL_RADIUS = 148;
const GAUGE_LEFT = 96;
const GAUGE_RIGHT = 400;
const GAUGE_Y = 492;
const LOCK_IN_X = 490;
const HANDLE_X = 592;
const BUTTON_Y = 492;

const COLORS = Object.freeze({
    backdrop: 0x0f110e,
    panel: 0x171918,
    panelBorder: 0x676b60,
    chamber: 0x242724,
    dialFace: 0x343933,
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

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function feedbackText(feedback: SafeDialFeedback): string {
    switch (feedback) {
        case 'cold':
            return 'COLD — THE MECHANISM IS SILENT';
        case 'faint':
            return 'FAINT TICKING — KEEP TURNING';
        case 'warm':
            return 'WARM — THE NEEDLE IS STIRRING';
        case 'hot':
            return 'HOT — LOCK IT IN';
        case 'gate-set':
            return 'GATE SET — A WHEEL DROPPED INTO PLACE';
        case 'false-gate':
            return 'FALSE GATE — THE MECHANISM RATTLED';
        case 'handle-ready':
            return 'ALL GATES SET — PULL THE HANDLE';
        case 'lock-gates-first':
            return 'LOCK EVERY GATE FIRST';
        case 'opened':
            return 'OPEN — THE VAULT DOOR SWINGS';
        case 'failed':
            return 'CRACK FAILED — THE ALARM WON';
        case 'idle':
            return 'TURN THE DIAL AND LISTEN FOR THE HOT ZONE';
    }
}

function feedbackColor(feedback: SafeDialFeedback): string {
    switch (feedback) {
        case 'false-gate':
        case 'failed':
            return '#ef6f6c';
        case 'cold':
            return '#8f9489';
        case 'faint':
            return '#b6b09f';
        case 'warm':
            return '#ef8d6b';
        case 'hot':
            return '#efc75e';
        case 'gate-set':
        case 'handle-ready':
        case 'opened':
            return '#67d5e8';
        case 'lock-gates-first':
            return '#f5f0df';
        case 'idle':
            return '#dce8a5';
    }
}

export class SafeDialScene extends Phaser.Scene {
    private launchData!: SafeDialLaunchData;
    private lock!: SafeDialLock;
    private graphics!: Phaser.GameObjects.Graphics;
    private statusText!: Phaser.GameObjects.Text;
    private focusText!: Phaser.GameObjects.Text;
    private alarmText!: Phaser.GameObjects.Text;
    private guidanceText!: Phaser.GameObjects.Text;
    private dialText!: Phaser.GameObjects.Text;
    private numberLabels: Phaser.GameObjects.Text[] = [];
    private lockInButton!: Phaser.GameObjects.Rectangle;
    private lockInText!: Phaser.GameObjects.Text;
    private handleButton!: Phaser.GameObjects.Rectangle;
    private handleText!: Phaser.GameObjects.Text;
    private draggingDial = false;
    private lastPointerAngle = 0;
    private dialAccumulator = 0;
    private finishing = false;
    private helpOpen = false;
    private pauseOpen = false;
    private tutorialPreviouslySeen = false;
    private tutorialMarkedSeen = false;
    private helpObjects: Phaser.GameObjects.GameObject[] = [];
    private pauseObjects: Phaser.GameObjects.GameObject[] = [];

    constructor() {
        super({key: SAFE_DIAL_SCENE_KEY});
    }

    create(data: SafeDialLaunchData): void {
        this.launchData = data;
        const rawTier = data.context.modifiers['levelTier'];
        const levelTier = typeof rawTier === 'number' && Number.isSafeInteger(rawTier)
            ? rawTier
            : 0;
        this.lock = createSafeDialLock(
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
                    // The lantern's wider tension band becomes one extra number
                    // of gate tolerance here.
                    gateTolerance: this.lock.config.gateTolerance + (bandBonus > 0 ? 1 : 0),
                    alarmWindowMs: this.lock.config.alarmWindowMs + alarmBonusMs
                }
            };
        }
        this.draggingDial = false;
        this.dialAccumulator = 0;
        this.numberLabels = [];
        this.finishing = false;
        this.helpOpen = false;
        this.pauseOpen = false;
        this.helpObjects = [];
        this.pauseObjects = [];
        this.tutorialPreviouslySeen =
            data.context.campaignSnapshot.flags.includes('tutorial-lock-dial-seen');
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
        this.lock = advanceSafeDialTime(this.lock, delta);
        if (this.lock.status === 'failed') {
            this.statusText
                .setText(this.lock.failureReason === 'focus'
                    ? 'FAILED — YOU LOST THE SOUND'
                    : 'FAILED — ALARM TRIPPED')
                .setColor('#ef6f6c');
            this.publishProgress();
            this.finish('failure');
            return;
        }

        // Redraw supplies the quivering needle and continuously moving meters.
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
        this.add.text(48, 28, 'VAULT DIAL // STETHOSCOPE', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '25px'
        });
        const itemBonus = getEncounterItemBonusLabel(this.launchData.context);
        this.add.text(48, 64,
            'Turn the dial. Follow the needle from cold to hot, then lock in.' +
            (itemBonus ? `\nITEM BONUS · ${itemBonus}` : ''),
        {
            color: '#b6b09f',
            fontFamily: 'Georgia, serif',
            fontSize: itemBonus ? '12px' : '15px',
            lineSpacing: 1
        });
        this.game.canvas.dataset.itemBonus = itemBonus ?? '';

        this.focusText = this.add.text(48, 101, '', {
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
            '←/→ turn  •  ↑/↓ turn fast  •  Enter lock in / pull handle  •  drag the dial',
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
        this.dialText = this.add.text(DIAL_CENTER_X, DIAL_CENTER_Y, '0', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '30px'
        }).setOrigin(0.5).setDepth(2);
        for (let tens = 0; tens < 10; tens++) {
            this.numberLabels.push(
                this.add.text(DIAL_CENTER_X, DIAL_CENTER_Y, String(tens * 10), {
                    color: '#b6b09f',
                    fontFamily: 'Georgia, serif',
                    fontSize: '13px'
                }).setOrigin(0.5).setDepth(2)
            );
        }
    }

    private createControls(): void {
        this.add.circle(DIAL_CENTER_X, DIAL_CENTER_Y, DIAL_RADIUS + 18, 0xffffff, 0.001)
            .setInteractive({useHandCursor: true})
            .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
                if (!this.canInteract()) return;
                this.draggingDial = true;
                this.lastPointerAngle = this.pointerAngle(pointer);
                this.dialAccumulator = this.lock.dial;
            });

        this.lockInButton = this.add.rectangle(LOCK_IN_X, BUTTON_Y, 108, 48, 0x2f3430)
            .setStrokeStyle(2, COLORS.panelBorder)
            .setInteractive({useHandCursor: true})
            .on('pointerdown', () => {
                if (!this.canInteract()) return;
                this.tryCurrentGate();
            });
        this.lockInText = this.add.text(LOCK_IN_X, BUTTON_Y, 'LOCK IN', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '15px'
        }).setOrigin(0.5);

        this.handleButton = this.add.rectangle(HANDLE_X, BUTTON_Y, 88, 48, 0x2f3430)
            .setStrokeStyle(2, COLORS.panelBorder)
            .setInteractive({useHandCursor: true})
            .on('pointerdown', () => {
                if (!this.canInteract()) return;
                this.tryPullHandle();
            });
        this.handleText = this.add.text(HANDLE_X, BUTTON_Y, 'HANDLE', {
            color: '#8f9489',
            fontFamily: 'Georgia, serif',
            fontSize: '14px'
        }).setOrigin(0.5);
    }

    /** Dragging the dial stays in the canvas; the deck adds stepped clicks. */
    private readonly handleControlEvent = (event: ControlEvent): void => {
        if (this.helpOpen) {
            if (event.kind === 'button' && event.phase === 'press') this.hideHelp(true);
            return;
        }
        if (!this.canInteract()) return;
        if (event.kind === 'direction') {
            if (event.phase !== 'press') return;
            const clicks = event.direction === 'left'
                ? -1
                : event.direction === 'right'
                    ? 1
                    : event.direction === 'up' ? 5 : -5;
            this.turnDial(clicks);
            return;
        }
        if (event.kind !== 'button' || event.phase !== 'press') return;
        if (event.id === 'set') this.tryCurrentGate();
        if (event.id === 'handle') this.tryPullHandle();
    };

    private bindInput(): void {
        this.input.keyboard?.on('keydown', this.handleKeyDown, this);
        this.input.on('pointermove', this.handlePointerMove, this);
        this.input.on('pointerup', this.handlePointerUp, this);
        getControlDeck(this)?.setScheme(SAFE_DIAL_CONTROL_SCHEME, this.handleControlEvent);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown, this);
            this.input.off('pointermove', this.handlePointerMove, this);
            this.input.off('pointerup', this.handlePointerUp, this);
            getControlDeck(this)?.clearScheme(SAFE_DIAL_CONTROL_SCHEME.id);
            delete this.game.canvas.dataset.dialFeedback;
            delete this.game.canvas.dataset.dialStatus;
            delete this.game.canvas.dataset.dialPosition;
            delete this.game.canvas.dataset.dialGatesLocked;
            delete this.game.canvas.dataset.dialGateCount;
            delete this.game.canvas.dataset.dialSignal;
            delete this.game.canvas.dataset.dialAlarm;
            delete this.game.canvas.dataset.dialFocus;
            delete this.game.canvas.dataset.dialHandleEnabled;
            delete this.game.canvas.dataset.dialHelpOpen;
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

        if (key === 'arrowleft' || key === 'a') {
            this.turnDial(-1);
        } else if (key === 'arrowright' || key === 'd') {
            this.turnDial(1);
        } else if (key === 'arrowup' || key === 'w') {
            this.turnDial(5);
        } else if (key === 'arrowdown' || key === 's') {
            this.turnDial(-5);
        } else if (key === 'enter') {
            if (this.lock.gatesLocked >= this.lock.gates.length) this.tryPullHandle();
            else this.tryCurrentGate();
        } else {
            return;
        }
        event.preventDefault();
    };

    private readonly handlePointerMove = (pointer: Phaser.Input.Pointer): void => {
        if (!this.canInteract() || !this.draggingDial) return;
        const angle = this.pointerAngle(pointer);
        let delta = angle - this.lastPointerAngle;
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        this.lastPointerAngle = angle;
        this.dialAccumulator += (delta / (Math.PI * 2)) * DIAL_SIZE;
        this.lock = setDialPosition(this.lock, Math.round(this.dialAccumulator));
        this.showModelFeedback(this.lock.feedback);
    };

    private readonly handlePointerUp = (): void => {
        this.draggingDial = false;
    };

    private pointerAngle(pointer: Phaser.Input.Pointer): number {
        return Math.atan2(pointer.y - DIAL_CENTER_Y, pointer.x - DIAL_CENTER_X);
    }

    private canInteract(): boolean {
        return !this.finishing &&
            !this.helpOpen &&
            !this.pauseOpen &&
            this.lock.status === 'active';
    }

    private turnDial(delta: number): void {
        this.lock = rotateDial(this.lock, delta);
        this.dialAccumulator = this.lock.dial;
        this.showModelFeedback(this.lock.feedback);
    }

    private tryCurrentGate(): void {
        const result = tryGate(this.lock);
        this.lock = result.state;
        this.showModelFeedback(result.feedback);
        if (this.lock.status === 'failed') this.finish('failure');
    }

    private tryPullHandle(): void {
        this.lock = pullHandle(this.lock);
        this.showModelFeedback(this.lock.feedback);
        if (this.lock.status === 'opened') this.finish('success');
    }

    private showModelFeedback(feedback: SafeDialFeedback): void {
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
        this.drawDial(graphics);
        this.drawGateProgress(graphics);
        this.drawSignalGauge(graphics);
        this.updateButtons();

        const remaining = this.lock.gates.length - this.lock.gatesLocked;
        this.guidanceText
            .setText(remaining <= 0
                ? 'READY — PULL THE HANDLE'
                : `GATE ${this.lock.gatesLocked + 1} OF ${this.lock.gates.length} — ` +
                  'FIND THE HOT ZONE, THEN LOCK IN')
            .setColor(remaining <= 0 ? '#67d5e8' : '#efc75e');
    }

    private drawMeters(graphics: Phaser.GameObjects.Graphics): void {
        const focusRatio = this.lock.focus / this.lock.config.maximumFocus;
        const alarmRatio = this.lock.alarm / 100;
        graphics.fillStyle(0x292d29).fillRoundedRect(48, 125, 238, 13, 5);
        graphics.fillStyle(COLORS.safe).fillRoundedRect(48, 125, 238 * focusRatio, 13, 5);
        graphics.fillStyle(0x292d29).fillRoundedRect(362, 125, 226, 13, 5);
        graphics.fillStyle(alarmRatio >= 0.75 ? COLORS.danger : COLORS.warning)
            .fillRoundedRect(362, 125, 226 * alarmRatio, 13, 5);
    }

    private drawDial(graphics: Phaser.GameObjects.Graphics): void {
        graphics.fillStyle(COLORS.chamber)
            .fillCircle(DIAL_CENTER_X, DIAL_CENTER_Y, DIAL_RADIUS + 14);
        graphics.lineStyle(2, COLORS.panelBorder)
            .strokeCircle(DIAL_CENTER_X, DIAL_CENTER_Y, DIAL_RADIUS + 14);
        graphics.fillStyle(COLORS.dialFace)
            .fillCircle(DIAL_CENTER_X, DIAL_CENTER_Y, DIAL_RADIUS);
        graphics.lineStyle(3, COLORS.metal)
            .strokeCircle(DIAL_CENTER_X, DIAL_CENTER_Y, DIAL_RADIUS);

        // Number n sits at the top pointer when the dial reads n; larger
        // numbers advance clockwise past it.
        for (let n = 0; n < DIAL_SIZE; n += 5) {
            const angle = -Math.PI / 2 +
                ((n - this.lock.dial + DIAL_SIZE) % DIAL_SIZE) / DIAL_SIZE * Math.PI * 2;
            const isMajor = n % 10 === 0;
            const outer = DIAL_RADIUS - 4;
            const inner = outer - (isMajor ? 18 : 10);
            graphics.lineStyle(isMajor ? 3 : 1, isMajor ? COLORS.paper : COLORS.metalDark)
                .lineBetween(
                    DIAL_CENTER_X + Math.cos(angle) * inner,
                    DIAL_CENTER_Y + Math.sin(angle) * inner,
                    DIAL_CENTER_X + Math.cos(angle) * outer,
                    DIAL_CENTER_Y + Math.sin(angle) * outer
                );
            if (isMajor) {
                const label = this.numberLabels[n / 10];
                label?.setPosition(
                    DIAL_CENTER_X + Math.cos(angle) * (inner - 16),
                    DIAL_CENTER_Y + Math.sin(angle) * (inner - 16)
                );
            }
        }

        graphics.fillStyle(COLORS.ink).fillCircle(DIAL_CENTER_X, DIAL_CENTER_Y, 42);
        graphics.lineStyle(2, COLORS.metalDark)
            .strokeCircle(DIAL_CENTER_X, DIAL_CENTER_Y, 42);
        this.dialText.setText(String(this.lock.dial));

        graphics.fillStyle(COLORS.accent).fillTriangle(
            DIAL_CENTER_X,
            DIAL_CENTER_Y - DIAL_RADIUS + 26,
            DIAL_CENTER_X - 9,
            DIAL_CENTER_Y - DIAL_RADIUS - 2,
            DIAL_CENTER_X + 9,
            DIAL_CENTER_Y - DIAL_RADIUS - 2
        );
    }

    private drawGateProgress(graphics: Phaser.GameObjects.Graphics): void {
        const total = this.lock.gates.length;
        const startX = DIAL_CENTER_X - (total - 1) * 20;
        for (let index = 0; index < total; index++) {
            const x = startX + index * 40;
            const locked = index < this.lock.gatesLocked;
            graphics.fillStyle(locked ? COLORS.cyan : 0x292d29)
                .fillCircle(x, DIAL_CENTER_Y + DIAL_RADIUS + 36, 9);
            graphics.lineStyle(2, locked ? COLORS.cyan : COLORS.metalDark)
                .strokeCircle(x, DIAL_CENTER_Y + DIAL_RADIUS + 36, 9);
        }
    }

    private drawSignalGauge(graphics: Phaser.GameObjects.Graphics): void {
        const strength = getDialSignalStrength(this.lock);
        const gate = getCurrentGate(this.lock);
        graphics.fillStyle(0x292d29)
            .fillRoundedRect(GAUGE_LEFT, GAUGE_Y - 9, GAUGE_RIGHT - GAUGE_LEFT, 18, 7);
        const fillColor = strength >= 0.85
            ? COLORS.accent
            : strength >= 0.6 ? COLORS.warning : COLORS.metalDark;
        graphics.fillStyle(fillColor, 0.9).fillRoundedRect(
            GAUGE_LEFT,
            GAUGE_Y - 9,
            Math.max(10, (GAUGE_RIGHT - GAUGE_LEFT) * strength),
            18,
            7
        );
        // The needle quivers harder as the dial closes in on the gate.
        const quiver = gate === null || this.lock.paused
            ? 0
            : Math.sin(this.time.now / 28) * strength * 7;
        const needleX = GAUGE_LEFT + (GAUGE_RIGHT - GAUGE_LEFT) * strength + quiver;
        graphics.lineStyle(4, COLORS.paper)
            .lineBetween(
                clamp(needleX, GAUGE_LEFT, GAUGE_RIGHT),
                GAUGE_Y - 17,
                clamp(needleX, GAUGE_LEFT, GAUGE_RIGHT),
                GAUGE_Y + 17
            );
    }

    private updateButtons(): void {
        const handleEnabled = this.lock.gatesLocked >= this.lock.gates.length;
        this.lockInButton
            .setFillStyle(handleEnabled ? 0x2f3430 : 0x315e52)
            .setStrokeStyle(2, handleEnabled ? COLORS.panelBorder : COLORS.accent);
        this.lockInText.setColor(handleEnabled ? '#8f9489' : '#efc75e');
        this.handleButton
            .setFillStyle(handleEnabled ? 0x315e52 : 0x2f3430)
            .setStrokeStyle(2, handleEnabled ? COLORS.cyan : COLORS.panelBorder);
        this.handleText
            .setText(handleEnabled ? 'PULL ▶' : 'HANDLE')
            .setColor(handleEnabled ? '#67d5e8' : '#8f9489');
    }

    private updateReadouts(): void {
        this.focusText.setText(
            `STETHOSCOPE FOCUS  ${this.lock.focus}/${this.lock.config.maximumFocus}`
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
        const title = this.add.text(336, 168, 'HOW TO CRACK THIS SAFE', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '25px'
        }).setOrigin(0.5).setDepth(depth + 2);
        // Short lines at a large size so the briefing survives phone scaling.
        const body = this.add.text(336, 300, [
            '1  Turn the dial.',
            'Drag it, or use the pad.',
            '',
            '2  Watch the needle below.',
            'It fills as you close in.',
            '',
            '3  At HOT, press SET GATE.',
            'All gates set: pull the HANDLE.'
        ], {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '22px',
            align: 'center',
            lineSpacing: 6
        }).setOrigin(0.5).setDepth(depth + 2);
        const note = this.add.text(336, 452, 'Help pauses the alarm.', {
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
        this.lock = setSafeDialPaused(this.lock, this.helpOpen || this.pauseOpen);
        this.publishProgress();
    }

    private publishProgress(): void {
        this.game.canvas.dataset.dialFeedback = this.lock.feedback;
        this.game.canvas.dataset.dialStatus = this.lock.status;
        this.game.canvas.dataset.dialPosition = String(this.lock.dial);
        this.game.canvas.dataset.dialGatesLocked = String(this.lock.gatesLocked);
        this.game.canvas.dataset.dialGateCount = String(this.lock.gates.length);
        this.game.canvas.dataset.dialSignal = getDialSignalStrength(this.lock).toFixed(2);
        this.game.canvas.dataset.dialAlarm = String(Math.floor(this.lock.alarm));
        this.game.canvas.dataset.dialFocus = String(this.lock.focus);
        this.game.canvas.dataset.dialHandleEnabled =
            String(this.lock.gatesLocked >= this.lock.gates.length);
        this.game.canvas.dataset.dialHelpOpen = String(this.helpOpen);
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
                ? [{kind: 'set-flag', flag: 'tutorial-lock-dial-seen'}]
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
            grade: status === 'success' ? gradeSafeDial(this.lock) : 'none',
            score: status === 'success' ? scoreSafeDial(this.lock) : 0,
            elapsedMs: this.lock.activeElapsedMs,
            effects
        };
    }
}
