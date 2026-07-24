import Phaser from 'phaser';

import {Mulberry32Random} from '../../domain/random/random-source';
import type {EncounterContext, EncounterResult, OutcomeEffect} from '../../encounters/contracts';
import {
    getEncounterItemBonusLabel,
    getEncounterNumberModifier
} from '../item-bonus';
import {
    advanceLockTime,
    createLockPuzzleForFamily,
    getCurrentBindingPinIndex,
    getCurrentTensionBand,
    gradeLock,
    moveLockPick,
    releaseLockPick,
    scoreLock,
    setLockPaused,
    setLockTension,
    turnLockCylinder,
    type LockFeedback,
    type PinTensionLock
} from './lock-model';

export const LOCKPICK_SCENE_KEY = 'lockpick';
export const LOCK_PIN_ORIGIN_X = 160;
export const LOCK_PIN_GAP = 88;
export const LOCK_PIN_TOP = 166;
export const LOCK_PIN_HEIGHT = 244;
export const LOCK_TENSION_Y = 478;

export interface LockpickLaunchData {
    readonly context: EncounterContext;
    readonly onComplete: (result: EncounterResult) => void;
    /**
     * Optional integration hook for hosts that can persist instructional state
     * before the encounter result is committed.
     */
    readonly onTutorialSeen?: () => void;
}

const VIEW_SIZE = 672;
const SHEAR_LINE_Y = 286;
const TENSION_LEFT = 192;
const TENSION_RIGHT = 480;
const TURN_CENTER_X = 550;
const TURN_WIDTH = 104;
const PICK_KEYBOARD_STEP = 0.05;
const TENSION_KEYBOARD_STEP = 0.05;

const COLORS = Object.freeze({
    backdrop: 0x0f110e,
    panel: 0x171918,
    panelBorder: 0x676b60,
    chamber: 0x242724,
    cylinder: 0x343933,
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

function feedbackText(feedback: LockFeedback): string {
    switch (feedback) {
        case 'springy':
            return 'SPRINGY — THIS PIN IS NOT BINDING YET';
        case 'loose':
        case 'slipping':
            return 'LOOSE — ADD A LITTLE TENSION';
        case 'binding':
            return 'BINDING — ALIGN THE SEAM WITH THE GOLD LINE';
        case 'jammed':
            return 'JAMMED — EASE OFF THE WRENCH';
        case 'set':
            return 'SET — CLEAN CLICK';
        case 'turn-ready':
            return 'ALL PINS SET — TURN THE CYLINDER';
        case 'set-all-pins-first':
            return 'SET ALL PINS FIRST';
        case 'opened':
            return 'OPEN — ARCHIVE LATCH RELEASED';
        case 'failed':
            return 'LOCK FAILED — THE ALARM WON';
        case 'idle':
            return 'SET TENSION, FIND THE TREMBLING PIN, THEN LIFT';
    }
}

function feedbackColor(feedback: LockFeedback): string {
    switch (feedback) {
        case 'jammed':
        case 'failed':
            return '#ef6f6c';
        case 'loose':
        case 'slipping':
        case 'springy':
            return '#ef8d6b';
        case 'set':
        case 'turn-ready':
        case 'opened':
            return '#67d5e8';
        case 'binding':
            return '#efc75e';
        case 'set-all-pins-first':
            return '#f5f0df';
        case 'idle':
            return '#dce8a5';
    }
}

export class LockpickScene extends Phaser.Scene {
    private launchData!: LockpickLaunchData;
    private lock!: PinTensionLock;
    private graphics!: Phaser.GameObjects.Graphics;
    private statusText!: Phaser.GameObjects.Text;
    private integrityText!: Phaser.GameObjects.Text;
    private alarmText!: Phaser.GameObjects.Text;
    private guidanceText!: Phaser.GameObjects.Text;
    private turnButton!: Phaser.GameObjects.Rectangle;
    private turnText!: Phaser.GameObjects.Text;
    private pinLabels: Phaser.GameObjects.Text[] = [];
    private draggingPinIndex: number | null = null;
    private draggingTension = false;
    private finishing = false;
    private helpOpen = false;
    private pauseOpen = false;
    private tutorialPreviouslySeen = false;
    private tutorialMarkedSeen = false;
    private lastReleasedHeight = 0;
    private helpObjects: Phaser.GameObjects.GameObject[] = [];
    private pauseObjects: Phaser.GameObjects.GameObject[] = [];

    constructor() {
        super({key: LOCKPICK_SCENE_KEY});
    }

    create(data: LockpickLaunchData): void {
        this.launchData = data;
        const rawTier = data.context.modifiers['levelTier'];
        const levelTier = typeof rawTier === 'number' && Number.isSafeInteger(rawTier)
            ? rawTier
            : 0;
        const rawFamily = data.context.modifiers['lockFamily'];
        const lockFamily = typeof rawFamily === 'string' ? rawFamily : 'pin-tension';
        this.lock = createLockPuzzleForFamily(
            new Mulberry32Random(data.context.seed),
            lockFamily,
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
                    tensionBandWidth: Math.min(
                        0.4,
                        this.lock.config.tensionBandWidth + bandBonus
                    ),
                    alarmWindowMs: this.lock.config.alarmWindowMs + alarmBonusMs
                },
                tensionBands: this.lock.tensionBands.map(band => ({
                    center: band.center,
                    minimum: Math.max(0, band.minimum - bandBonus / 2),
                    maximum: Math.min(1, band.maximum + bandBonus / 2)
                }))
            };
        }
        this.draggingPinIndex = null;
        this.draggingTension = false;
        this.pinLabels = [];
        this.finishing = false;
        this.helpOpen = false;
        this.pauseOpen = false;
        this.helpObjects = [];
        this.pauseObjects = [];
        this.lastReleasedHeight = 0;
        this.tutorialPreviouslySeen =
            data.context.campaignSnapshot.flags.includes('tutorial-lock-seen');
        this.tutorialMarkedSeen = this.tutorialPreviouslySeen;

        this.createFrame();
        this.createLockInputs();
        this.bindInput();
        this.drawLock();
        this.updateReadouts();
        this.publishProgress();

        if (!this.tutorialPreviouslySeen) this.showHelp();
    }

    override update(_time: number, delta: number): void {
        if (this.finishing) return;
        const previousAlarm = this.lock.alarm;
        this.lock = advanceLockTime(this.lock, delta);
        if (this.lock.status === 'failed') {
            this.statusText
                .setText(this.lock.failureReason === 'integrity'
                    ? 'FAILED — THE PICK SNAPPED'
                    : 'FAILED — ALARM TRIPPED')
                .setColor('#ef6f6c');
            this.publishProgress();
            this.finish('failure');
            return;
        }

        // Redraw supplies the binding-pin tremble and continuously moving meters.
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
        this.add.text(48, 28, 'ARCHIVE LOCK // CUTAWAY', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '25px'
        });
        const itemBonus = getEncounterItemBonusLabel(this.launchData.context);
        this.add.text(48, 64,
            'Follow NEXT. Balance the wrench. Lift each seam to gold.' +
            (itemBonus ? `\nITEM BONUS · ${itemBonus}` : ''),
        {
            color: '#b6b09f',
            fontFamily: 'Georgia, serif',
            fontSize: itemBonus ? '12px' : '15px',
            lineSpacing: 1
        });
        this.game.canvas.dataset.itemBonus = itemBonus ?? '';

        this.integrityText = this.add.text(48, 101, '', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '14px'
        });
        this.alarmText = this.add.text(362, 101, '', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '14px'
        });
        this.guidanceText = this.add.text(48, 520, '', {
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
            'A/D or ←/→ select  •  ↑/↓ lift  •  Q/E tension  •  Enter set/turn',
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

    private createLockInputs(): void {
        for (let pinIndex = 0; pinIndex < this.lock.pins.length; pinIndex++) {
            const centerX = this.pinX(pinIndex);
            this.add.rectangle(
                centerX,
                LOCK_PIN_TOP + LOCK_PIN_HEIGHT / 2,
                62,
                LOCK_PIN_HEIGHT,
                0xffffff,
                0.001
            )
                .setInteractive({useHandCursor: true})
                .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
                    if (!this.canInteract()) return;
                    this.draggingPinIndex = pinIndex;
                    this.movePickFromPointer(pinIndex, pointer);
                })
                .on('pointerup', () => {
                    this.releaseDraggedPin(pinIndex);
                });
            this.pinLabels.push(
                this.add.text(centerX, LOCK_PIN_TOP + LOCK_PIN_HEIGHT + 25, `PIN ${pinIndex + 1}`, {
                    color: '#8f9489',
                    fontFamily: 'Georgia, serif',
                    fontSize: '12px'
                }).setOrigin(0.5)
            );
        }

        this.add.rectangle(
            (TENSION_LEFT + TENSION_RIGHT) / 2,
            LOCK_TENSION_Y,
            TENSION_RIGHT - TENSION_LEFT + 28,
            54,
            0xffffff,
            0.001
        )
            .setInteractive({useHandCursor: true})
            .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
                if (!this.canInteract()) return;
                this.draggingTension = true;
                this.moveTensionFromPointer(pointer);
            });

        this.turnButton = this.add.rectangle(
            TURN_CENTER_X,
            LOCK_TENSION_Y,
            TURN_WIDTH,
            48,
            0x2f3430
        )
            .setStrokeStyle(2, COLORS.panelBorder)
            .setInteractive({useHandCursor: true})
            .on('pointerdown', () => {
                if (!this.canInteract()) return;
                this.tryTurnCylinder();
            });
        this.turnText = this.add.text(TURN_CENTER_X, LOCK_TENSION_Y, 'TURN ▶', {
            color: '#8f9489',
            fontFamily: 'Georgia, serif',
            fontSize: '16px'
        }).setOrigin(0.5);
    }

    private bindInput(): void {
        this.input.keyboard?.on('keydown', this.handleKeyDown, this);
        this.input.on('pointermove', this.handlePointerMove, this);
        this.input.on('pointerup', this.handlePointerUp, this);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown, this);
            this.input.off('pointermove', this.handlePointerMove, this);
            this.input.off('pointerup', this.handlePointerUp, this);
            delete this.game.canvas.dataset.lockFeedback;
            delete this.game.canvas.dataset.lockStatus;
            delete this.game.canvas.dataset.lockSelectedPin;
            delete this.game.canvas.dataset.lockAlarm;
            delete this.game.canvas.dataset.lockIntegrity;
            delete this.game.canvas.dataset.lockBindingPin;
            delete this.game.canvas.dataset.lockSetCount;
            delete this.game.canvas.dataset.lockTurnEnabled;
            delete this.game.canvas.dataset.lockHelpOpen;
            delete this.game.canvas.dataset.lockLastReleaseHeight;
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
            this.selectPin(this.lock.selectedPinIndex - 1);
        } else if (key === 'arrowright' || key === 'd') {
            this.selectPin(this.lock.selectedPinIndex + 1);
        } else if (key === 'arrowup') {
            this.moveSelectedPick(this.lock.pickHeight + PICK_KEYBOARD_STEP);
        } else if (key === 'arrowdown') {
            this.moveSelectedPick(this.lock.pickHeight - PICK_KEYBOARD_STEP);
        } else if (key === 'q') {
            this.changeTension(this.lock.tension - TENSION_KEYBOARD_STEP);
        } else if (key === 'e') {
            this.changeTension(this.lock.tension + TENSION_KEYBOARD_STEP);
        } else if (key === 'enter') {
            if (this.lock.pins.every(pin => pin.set)) this.tryTurnCylinder();
            else this.releaseSelectedPin();
        } else {
            return;
        }
        event.preventDefault();
    };

    private readonly handlePointerMove = (pointer: Phaser.Input.Pointer): void => {
        if (!this.canInteract()) return;
        if (this.draggingPinIndex !== null) {
            this.movePickFromPointer(this.draggingPinIndex, pointer);
        } else if (this.draggingTension) {
            this.moveTensionFromPointer(pointer);
        }
    };

    private readonly handlePointerUp = (): void => {
        if (this.draggingPinIndex !== null) {
            this.releaseDraggedPin(this.draggingPinIndex);
        }
        this.draggingTension = false;
    };

    private releaseDraggedPin(pinIndex: number): void {
        if (this.draggingPinIndex !== pinIndex) return;
        this.draggingPinIndex = null;
        if (!this.canInteract()) return;
        this.releaseSelectedPin();
    }

    private canInteract(): boolean {
        return !this.finishing &&
            !this.helpOpen &&
            !this.pauseOpen &&
            this.lock.status === 'active';
    }

    private pinX(pinIndex: number): number {
        return LOCK_PIN_ORIGIN_X + pinIndex * LOCK_PIN_GAP;
    }

    private selectPin(pinIndex: number): void {
        const selected = clamp(pinIndex, 0, this.lock.pins.length - 1);
        const pin = this.lock.pins[selected]!;
        this.lock = moveLockPick(this.lock, selected, pin.set ? pin.targetHeight : 0);
        this.showModelFeedback(this.lock.feedback);
    }

    private moveSelectedPick(height: number): void {
        this.lock = moveLockPick(
            this.lock,
            this.lock.selectedPinIndex,
            clamp(height, 0, 1)
        );
        this.showModelFeedback(this.lock.feedback);
    }

    private movePickFromPointer(pinIndex: number, pointer: Phaser.Input.Pointer): void {
        const height = clamp(
            (LOCK_PIN_TOP + LOCK_PIN_HEIGHT - pointer.y) / LOCK_PIN_HEIGHT,
            0,
            1
        );
        this.lock = moveLockPick(this.lock, pinIndex, height);
        this.showModelFeedback(this.lock.feedback);
    }

    private moveTensionFromPointer(pointer: Phaser.Input.Pointer): void {
        const tension = clamp(
            (pointer.x - TENSION_LEFT) / (TENSION_RIGHT - TENSION_LEFT),
            0,
            1
        );
        this.changeTension(tension);
    }

    private changeTension(tension: number): void {
        this.lock = setLockTension(this.lock, clamp(tension, 0, 1));
        this.showModelFeedback(this.lock.feedback);
    }

    private releaseSelectedPin(): void {
        if (!this.canInteract()) return;
        this.lastReleasedHeight = this.lock.pickHeight;
        const result = releaseLockPick(this.lock);
        this.lock = result.state;
        this.showModelFeedback(result.feedback);
        this.updateReadouts();
        this.publishProgress();
        if (this.lock.status === 'failed') this.finish('failure');
    }

    private tryTurnCylinder(): void {
        if (!this.canInteract()) return;
        this.lock = turnLockCylinder(this.lock);
        this.showModelFeedback(this.lock.feedback);
        this.publishProgress();
        if (this.lock.status === 'opened') this.finish('success');
    }

    private showModelFeedback(feedback: LockFeedback): void {
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
        graphics.fillStyle(COLORS.cylinder)
            .fillRoundedRect(105, LOCK_PIN_TOP - 16, 532, LOCK_PIN_HEIGHT + 32, 26);
        graphics.lineStyle(2, COLORS.panelBorder)
            .strokeRoundedRect(105, LOCK_PIN_TOP - 16, 532, LOCK_PIN_HEIGHT + 32, 26);

        graphics.lineStyle(4, COLORS.accent, 0.95)
            .lineBetween(116, SHEAR_LINE_Y, 626, SHEAR_LINE_Y);
        this.addShearLineTicks(graphics);

        const bindingPinIndex = getCurrentBindingPinIndex(this.lock);
        for (let pinIndex = 0; pinIndex < this.lock.pins.length; pinIndex++) {
            const pin = this.lock.pins[pinIndex]!;
            const selected = pinIndex === this.lock.selectedPinIndex;
            const binding = pinIndex === bindingPinIndex && !pin.set;
            const trembling = binding &&
                !pin.set &&
                !this.lock.paused;
            const tremble = trembling ? Math.sin(this.time.now / 30) * 2.5 : 0;
            const centerX = this.pinX(pinIndex) + tremble;
            const chamberLeft = centerX - 27;
            const chamberTop = LOCK_PIN_TOP;
            const chamberBottom = chamberTop + LOCK_PIN_HEIGHT;

            graphics.fillStyle(COLORS.chamber).fillRoundedRect(
                chamberLeft,
                chamberTop,
                54,
                LOCK_PIN_HEIGHT,
                8
            );
            graphics.lineStyle(
                binding ? 4 : selected ? 3 : 1,
                binding ? COLORS.accent : selected ? COLORS.paper : COLORS.metalDark
            ).strokeRoundedRect(chamberLeft, chamberTop, 54, LOCK_PIN_HEIGHT, 8);

            const restSeamY = SHEAR_LINE_Y + pin.targetHeight * 116;
            const seamY = pin.set
                ? SHEAR_LINE_Y
                : restSeamY - pin.height * 116;
            const driverTop = chamberTop + 28 + Math.round(pin.targetHeight * 22);
            const driverBottom = Math.max(driverTop + 20, seamY - 5);
            const keyTop = Math.min(chamberBottom - 28, seamY + 5);
            const keyWidth = 20 + Math.round((1 - pin.targetHeight) * 8);
            const pinColor = pin.set
                ? COLORS.cyan
                : selected && this.lock.feedback === 'binding'
                    ? COLORS.accent
                    : COLORS.metal;

            graphics.lineStyle(2, binding ? COLORS.accent : COLORS.cyan, pin.set ? 0.7 : 0.3)
                .lineBetween(centerX + 21, restSeamY, centerX + 21, seamY);
            graphics.lineStyle(2, COLORS.warning, 0.45)
                .lineBetween(centerX - 19, restSeamY, centerX + 19, restSeamY);
            this.drawSpring(graphics, centerX, chamberTop + 8, driverTop);
            graphics.fillStyle(pinColor).fillRoundedRect(
                centerX - 10,
                driverTop,
                20,
                driverBottom - driverTop,
                3
            );
            graphics.fillStyle(pinColor).fillRoundedRect(
                centerX - keyWidth / 2,
                keyTop,
                keyWidth,
                chamberBottom - keyTop - 14,
                4
            );
            graphics.fillStyle(COLORS.ink).fillRect(centerX - 13, seamY - 2, 26, 4);

            if (pin.set) {
                graphics.fillStyle(COLORS.accent).fillCircle(centerX, chamberTop + 18, 6);
            } else if (binding) {
                graphics.fillStyle(COLORS.accent).fillTriangle(
                    centerX,
                    chamberTop - 2,
                    centerX - 8,
                    chamberTop - 14,
                    centerX + 8,
                    chamberTop - 14
                );
            }
            graphics.fillStyle(COLORS.paper, selected ? 1 : 0.65)
                .fillCircle(centerX, chamberBottom + 9, selected ? 5 : 3);
            this.pinLabels[pinIndex]
                ?.setText(binding ? `NEXT ${pinIndex + 1}` : `PIN ${pinIndex + 1}`)
                .setColor(
                    binding
                        ? '#efc75e'
                        : pin.set ? '#67d5e8' : selected ? '#f5f0df' : '#8f9489'
                );
        }

        this.guidanceText
            .setText(bindingPinIndex === null
                ? 'READY — TAP TURN ▶'
                : `NEXT BINDING: PIN ${bindingPinIndex + 1} — LIFT ITS SEAM TO GOLD`)
            .setColor(bindingPinIndex === null ? '#67d5e8' : '#efc75e');
        this.drawPick(graphics);
        this.drawTensionControl(graphics);
        this.updateTurnControl();
    }

    private drawMeters(graphics: Phaser.GameObjects.Graphics): void {
        const integrityRatio = this.lock.integrity / this.lock.config.maximumIntegrity;
        const alarmRatio = this.lock.alarm / 100;
        graphics.fillStyle(0x292d29).fillRoundedRect(48, 125, 238, 13, 5);
        graphics.fillStyle(COLORS.safe).fillRoundedRect(48, 125, 238 * integrityRatio, 13, 5);
        graphics.fillStyle(0x292d29).fillRoundedRect(362, 125, 226, 13, 5);
        graphics.fillStyle(alarmRatio >= 0.75 ? COLORS.danger : COLORS.warning)
            .fillRoundedRect(362, 125, 226 * alarmRatio, 13, 5);
    }

    private addShearLineTicks(graphics: Phaser.GameObjects.Graphics): void {
        for (let x = 116; x <= 626; x += 18) {
            graphics.lineStyle(1, COLORS.paper, 0.7)
                .lineBetween(x, SHEAR_LINE_Y - 5, x, SHEAR_LINE_Y + 5);
        }
    }

    private drawSpring(
        graphics: Phaser.GameObjects.Graphics,
        centerX: number,
        top: number,
        bottom: number
    ): void {
        graphics.lineStyle(2, COLORS.metalDark);
        const segments = 6;
        let previousX = centerX;
        let previousY = top;
        for (let segment = 1; segment <= segments; segment++) {
            const y = top + ((bottom - top) * segment) / segments;
            const x = centerX + (segment % 2 === 0 ? -7 : 7);
            graphics.lineBetween(previousX, previousY, x, y);
            previousX = x;
            previousY = y;
        }
    }

    private drawPick(graphics: Phaser.GameObjects.Graphics): void {
        const pin = this.lock.pins[this.lock.selectedPinIndex];
        if (!pin) return;
        const selectedX = this.pinX(this.lock.selectedPinIndex);
        const tipY = SHEAR_LINE_Y + pin.targetHeight * 116 - pin.height * 116 + 17;
        graphics.lineStyle(5, COLORS.paper)
            .lineBetween(619, 424, selectedX + 5, tipY)
            .lineBetween(619, 424, 646, 438);
        graphics.fillStyle(COLORS.paper).fillCircle(selectedX + 5, tipY, 5);
    }

    private drawTensionControl(graphics: Phaser.GameObjects.Graphics): void {
        const band = getCurrentTensionBand(this.lock);
        graphics.lineStyle(8, COLORS.metalDark)
            .lineBetween(TENSION_LEFT, LOCK_TENSION_Y, TENSION_RIGHT, LOCK_TENSION_Y);

        if (band && this.lock.config.difficulty !== 'expert') {
            const expansion = this.lock.config.difficulty === 'standard' ? 0.055 : 0;
            const displayMinimum = clamp(band.minimum - expansion, 0, 1);
            const displayMaximum = clamp(band.maximum + expansion, 0, 1);
            const startX = TENSION_LEFT +
                displayMinimum * (TENSION_RIGHT - TENSION_LEFT);
            const endX = TENSION_LEFT +
                displayMaximum * (TENSION_RIGHT - TENSION_LEFT);
            graphics.lineStyle(12, COLORS.safe, this.lock.config.difficulty === 'story' ? 0.8 : 0.35)
                .lineBetween(startX, LOCK_TENSION_Y, endX, LOCK_TENSION_Y);
        }

        const knobX = TENSION_LEFT + this.lock.tension * (TENSION_RIGHT - TENSION_LEFT);
        graphics.fillStyle(COLORS.accent).fillCircle(knobX, LOCK_TENSION_Y, 13);
        graphics.lineStyle(4, COLORS.accent)
            .lineBetween(knobX, LOCK_TENSION_Y, knobX + 25, LOCK_TENSION_Y - 27);
        graphics.fillStyle(COLORS.paper).fillCircle(TENSION_LEFT, LOCK_TENSION_Y, 5);
        graphics.fillStyle(COLORS.paper).fillCircle(TENSION_RIGHT, LOCK_TENSION_Y, 5);
    }

    private updateTurnControl(): void {
        const enabled = this.lock.pins.every(pin => pin.set);
        this.turnButton
            .setFillStyle(enabled ? 0x315e52 : 0x2f3430)
            .setStrokeStyle(2, enabled ? COLORS.cyan : COLORS.panelBorder);
        this.turnText
            .setText(enabled ? 'TURN NOW ▶' : 'TURN ▶')
            .setColor(enabled ? '#67d5e8' : '#8f9489');
    }

    private updateReadouts(): void {
        this.integrityText.setText(
            `PICK INTEGRITY  ${this.lock.integrity}/${this.lock.config.maximumIntegrity}`
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
        const title = this.add.text(336, 162, 'HOW TO READ THIS LOCK', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '25px'
        }).setOrigin(0.5).setDepth(depth + 2);
        const body = this.add.text(112, 202, [
            '1  Set the wrench inside the working band.',
            '    The slider stays where you put it — one finger is enough.',
            '',
            '2  Follow the gold NEXT marker.',
            '    The binding pin trembles and is selected automatically.',
            '',
            '3  Lift its seam to the gold line.',
            '    Release to set it. When all are cyan, tap TURN NOW.'
        ], {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '17px',
            lineSpacing: 5
        }).setDepth(depth + 2);
        const note = this.add.text(336, 428, 'Help pauses the alarm.', {
            color: '#b6b09f',
            fontFamily: 'Georgia, serif',
            fontSize: '14px'
        }).setOrigin(0.5).setDepth(depth + 2);

        this.helpObjects = [shade, panel, title, body, note];
        this.helpObjects.push(
            ...this.createOverlayButton(176, 494, 128, 'TRY IT', () => this.hideHelp(true), depth + 2),
            ...this.createOverlayButton(336, 494, 148, 'REPLAY HELP', () => {
                body.setAlpha(0.35);
                this.tweens.add({targets: body, alpha: 1, duration: 450});
                this.statusText.setText('HELP REPLAYED — THE ALARM REMAINS PAUSED');
            }, depth + 2),
            ...this.createOverlayButton(496, 494, 108, 'SKIP', () => this.hideHelp(true), depth + 2)
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
        this.lock = setLockPaused(this.lock, this.helpOpen || this.pauseOpen);
        this.publishProgress();
    }

    private publishProgress(): void {
        const bindingPin = getCurrentBindingPinIndex(this.lock);
        this.game.canvas.dataset.lockFeedback = this.lock.feedback;
        this.game.canvas.dataset.lockStatus = this.lock.status;
        this.game.canvas.dataset.lockSelectedPin = String(this.lock.selectedPinIndex);
        this.game.canvas.dataset.lockAlarm = String(Math.floor(this.lock.alarm));
        this.game.canvas.dataset.lockIntegrity = String(this.lock.integrity);
        this.game.canvas.dataset.lockBindingPin =
            bindingPin === null ? 'none' : String(bindingPin);
        this.game.canvas.dataset.lockSetCount =
            String(this.lock.pins.filter(pin => pin.set).length);
        this.game.canvas.dataset.lockTurnEnabled =
            String(this.lock.pins.every(pin => pin.set));
        this.game.canvas.dataset.lockHelpOpen = String(this.helpOpen);
        this.game.canvas.dataset.lockLastReleaseHeight = String(this.lastReleasedHeight);
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
                ? [{kind: 'set-flag', flag: 'tutorial-lock-seen'}]
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
            grade: status === 'success' ? gradeLock(this.lock) : 'none',
            score: status === 'success' ? scoreLock(this.lock) : 0,
            elapsedMs: this.lock.activeElapsedMs,
            effects
        };
    }
}
