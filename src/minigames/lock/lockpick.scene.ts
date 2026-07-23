import Phaser from 'phaser';

import type {PerformanceGrade} from '../../domain/campaign/campaign-state';
import {Mulberry32Random} from '../../domain/random/random-source';
import type {EncounterContext, EncounterResult, OutcomeEffect} from '../../encounters/contracts';
import {
    createPinTensionLock,
    probeLockPin,
    setLockTension,
    type LockFeedback,
    type LockLevel,
    type PinTensionLock
} from './lock-model';

export const LOCKPICK_SCENE_KEY = 'lockpick';
export const LOCK_PIN_ORIGIN_X = 156;
export const LOCK_PIN_GAP = 120;
export const LOCK_PIN_TOP = 178;
export const LOCK_PIN_HEIGHT = 278;
export const LOCK_TENSION_Y = 536;

export interface LockpickLaunchData {
    readonly context: EncounterContext;
    readonly onComplete: (result: EncounterResult) => void;
}

const VIEW_SIZE = 672;

function gradeLock(state: PinTensionLock): PerformanceGrade {
    if (state.mistakes === 0 && state.turns <= 15) return 's';
    if (state.mistakes <= 2) return 'a';
    if (state.mistakes <= 5) return 'b';
    return 'c';
}

function feedbackText(feedback: LockFeedback): string {
    switch (feedback) {
        case 'slipping':
            return 'SLIPPING - MORE TENSION';
        case 'binding':
            return 'BINDING - LESS TENSION';
        case 'set':
            return 'PIN SET';
        case 'idle':
            return 'LISTENING FOR THE OLD METAL';
    }
}

export class LockpickScene extends Phaser.Scene {
    private launchData!: LockpickLaunchData;
    private lock!: PinTensionLock;
    private graphics!: Phaser.GameObjects.Graphics;
    private statusText!: Phaser.GameObjects.Text;
    private turnsText!: Phaser.GameObjects.Text;
    private feedback: LockFeedback[] = [];
    private selectedPin = 0;
    private startedAt = 0;
    private finishing = false;

    constructor() {
        super({key: LOCKPICK_SCENE_KEY});
    }

    create(data: LockpickLaunchData): void {
        this.launchData = data;
        this.lock = createPinTensionLock(new Mulberry32Random(data.context.seed));
        this.feedback = this.lock.pins.map(() => 'idle');
        this.selectedPin = 0;
        this.startedAt = this.time.now;
        this.finishing = false;

        this.add.rectangle(0, 0, VIEW_SIZE, VIEW_SIZE, 0x0f110e, 0.78).setOrigin(0);
        this.add.rectangle(VIEW_SIZE / 2, VIEW_SIZE / 2, 560, 610, 0x171918)
            .setStrokeStyle(2, 0x676b60);
        this.add.text(78, 48, 'ARCHIVE LOCK // PROPERTY OF NOBODY', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '25px'
        });
        this.add.text(78, 86, 'The key was downsized in 2091. It still receives severance.', {
            color: '#b6b09f',
            fontFamily: 'Georgia, serif',
            fontSize: '16px'
        });
        this.statusText = this.add.text(78, 606, feedbackText('idle'), {
            color: '#dce8a5',
            fontFamily: 'Georgia, serif',
            fontSize: '17px'
        });
        this.turnsText = this.add.text(494, 606, 'Turns 0', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '17px'
        });

        const closeButton = this.add.circle(594, 70, 20, 0x2f3430)
            .setStrokeStyle(2, 0x676b60)
            .setInteractive({useHandCursor: true});
        this.add.text(594, 69, 'X', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '18px'
        }).setOrigin(0.5);
        closeButton.on('pointerdown', () => this.finish('abandoned'));

        this.graphics = this.add.graphics();
        for (let pinIndex = 0; pinIndex < this.lock.pins.length; pinIndex++) {
            this.add.rectangle(
                LOCK_PIN_ORIGIN_X + pinIndex * LOCK_PIN_GAP,
                LOCK_PIN_TOP + LOCK_PIN_HEIGHT / 2,
                82,
                LOCK_PIN_HEIGHT,
                0xffffff,
                0.001
            ).setInteractive({useHandCursor: true})
                .on('pointerdown', () => this.probePin(pinIndex));
        }
        for (const tension of [1, 2, 3] as const) {
            const x = 240 + (tension - 1) * 96;
            const button = this.add.circle(x, LOCK_TENSION_Y, 28, 0x2f3430)
                .setStrokeStyle(2, 0x676b60)
                .setInteractive({useHandCursor: true});
            this.add.text(x, LOCK_TENSION_Y, String(tension), {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '20px'
            }).setOrigin(0.5);
            button.on('pointerdown', () => this.changeTension(tension));
        }

        this.input.keyboard?.on('keydown', this.handleKeyDown, this);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown, this);
        });
        this.drawLock();
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            this.finish('abandoned');
            event.preventDefault();
            return;
        }
        if (event.key === 'ArrowLeft' || event.key === 'a') {
            this.selectedPin = Math.max(0, this.selectedPin - 1);
        } else if (event.key === 'ArrowRight' || event.key === 'd') {
            this.selectedPin = Math.min(this.lock.pins.length - 1, this.selectedPin + 1);
        } else if (event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            this.probePin(this.selectedPin);
            event.preventDefault();
            return;
        } else if (event.key === 'q') {
            this.changeTension(Math.max(1, this.lock.tension - 1) as LockLevel);
            event.preventDefault();
            return;
        } else if (event.key === 'e') {
            this.changeTension(Math.min(3, this.lock.tension + 1) as LockLevel);
            event.preventDefault();
            return;
        } else {
            return;
        }
        this.drawLock();
        event.preventDefault();
    };

    private changeTension(tension: LockLevel): void {
        if (this.finishing || tension === 0) return;
        this.lock = setLockTension(this.lock, tension);
        this.statusText.setText(`TENSION ${tension} HELD`).setColor('#dce8a5');
        this.turnsText.setText(`Turns ${this.lock.turns}`);
        this.drawLock();
    }

    private probePin(pinIndex: number): void {
        if (this.finishing) return;
        this.selectedPin = pinIndex;
        const result = probeLockPin(this.lock, pinIndex);
        this.lock = result.state;
        this.feedback[pinIndex] = result.feedback;
        this.statusText.setText(feedbackText(result.feedback)).setColor(
            result.feedback === 'binding' ? '#ef8d6b' :
                result.feedback === 'set' ? '#67d5e8' : '#dce8a5'
        );
        this.turnsText.setText(`Turns ${this.lock.turns}`);
        this.drawLock();
        if (result.completed) {
            this.finishing = true;
            this.statusText.setText('LOCK OPEN - SALVAGE RIGHTS RESTORED').setColor('#67d5e8');
            this.time.delayedCall(500, () => this.finish('success'));
        }
    }

    private drawLock(): void {
        this.graphics.clear();
        for (let pinIndex = 0; pinIndex < this.lock.pins.length; pinIndex++) {
            const pin = this.lock.pins[pinIndex]!;
            const centerX = LOCK_PIN_ORIGIN_X + pinIndex * LOCK_PIN_GAP;
            const top = LOCK_PIN_TOP;
            const bottom = top + LOCK_PIN_HEIGHT;
            this.graphics.fillStyle(0x2f3430).fillRect(centerX - 41, top, 82, LOCK_PIN_HEIGHT);
            this.graphics.lineStyle(
                pinIndex === this.selectedPin ? 3 : 1,
                pinIndex === this.selectedPin ? 0xf5f0df : 0x676b60
            ).strokeRect(centerX - 41, top, 82, LOCK_PIN_HEIGHT);

            const pinHeight = (pin.height / 3) * 176;
            const pinColor = pin.set ? 0xefc75e :
                this.feedback[pinIndex] === 'binding' ? 0xef8d6b : 0xb6b09f;
            this.graphics.fillStyle(pinColor).fillRect(centerX - 11, bottom - 28 - pinHeight, 22, 28 + pinHeight);
            this.graphics.fillStyle(0x171918).fillCircle(centerX, bottom - 18, 6);
        }

        for (const tension of [1, 2, 3] as const) {
            const x = 240 + (tension - 1) * 96;
            this.graphics.lineStyle(
                this.lock.tension === tension ? 4 : 1,
                this.lock.tension === tension ? 0xefc75e : 0x676b60
            ).strokeCircle(x, LOCK_TENSION_Y, 29);
        }
    }

    private finish(status: 'success' | 'abandoned'): void {
        if (status === 'abandoned' && this.finishing) return;
        this.finishing = true;
        this.launchData.onComplete(this.createResult(status));
        this.scene.stop();
    }

    private createResult(status: 'success' | 'abandoned'): EncounterResult {
        const effects: OutcomeEffect[] = status === 'success'
            ? [
                {kind: 'upgrade-mining-power', minimum: 2},
                {kind: 'change-resource', resource: 'toolCharge', delta: 6},
                {kind: 'change-resource', resource: 'scrap', delta: 3},
                {kind: 'adjust-world-system', system: 'securityAlert', delta: -10},
                {kind: 'set-flag', flag: 'archive-lock-opened'},
                {
                    kind: 'set-trigger-state',
                    triggerId: this.launchData.context.trigger.triggerId,
                    state: 'resolved'
                }
            ]
            : [
                {kind: 'adjust-world-system', system: 'securityAlert', delta: 7},
                {kind: 'set-flag', flag: 'archive-lock-scratched'}
            ];
        return {
            runId: this.launchData.context.runId,
            definitionId: this.launchData.context.definitionId,
            triggerId: this.launchData.context.trigger.triggerId,
            kind: 'lock',
            status,
            grade: status === 'success' ? gradeLock(this.lock) : 'none',
            score: status === 'success'
                ? Math.max(500, 4_500 - this.lock.turns * 120 - this.lock.mistakes * 250)
                : 0,
            elapsedMs: Math.max(0, this.time.now - this.startedAt),
            effects
        };
    }
}