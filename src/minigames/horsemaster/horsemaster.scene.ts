import Phaser from 'phaser';

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
    HORSEMASTER_FIXED_STEP_MS,
    advanceHorsemaster,
    canonicalHorsemasterCourseSignature,
    createHorsemasterCourse,
    createHorsemasterState,
    getHorsemasterRenderSnapshot,
    setHorsemasterPaused,
    type HorsemasterEvent,
    type HorsemasterExerciseKind,
    type HorsemasterOpportunity,
    type HorsemasterRenderVehicle,
    type HorsemasterState
} from './horsemaster-model';

export const HORSEMASTER_SCENE_KEY = 'horsemaster';

export interface HorsemasterLaunchData {
    readonly context: EncounterContext;
    readonly onComplete: (result: EncounterResult) => void;
}

const VIEW_SIZE = 672;
const ROAD_HALF_HEIGHT = 33;
const CAR_COLORS = Object.freeze([
    0xe85d75,
    0x5b8def,
    0xf2a65a,
    0x7ccf89,
    0xa77bd8,
    0x46b8b0,
    0xe6c84f,
    0xb8bdc7
]);

const COLORS = Object.freeze({
    sky: 0x9ed8e6,
    grass: 0x4f8f55,
    grassDark: 0x32633d,
    road: 0x353941,
    roadEdge: 0x20242a,
    stripe: 0xf4d866,
    paper: 0xfff7df,
    ink: 0x181c22,
    horse: 0xa65d32,
    horseLight: 0xe9ae68,
    mane: 0x4c2d22,
    gym: 0x6b4db4,
    gymLight: 0xc59cff,
    easy: 0x67d58a,
    standard: 0xf2ca61,
    hard: 0xef6f6c
});

function opportunityColor(opportunity: HorsemasterOpportunity): number {
    switch (opportunity) {
        case 'easy':
            return COLORS.easy;
        case 'standard':
            return COLORS.standard;
        case 'hard':
            return COLORS.hard;
    }
}

function exerciseLabel(kind: HorsemasterExerciseKind): string {
    switch (kind) {
        case 'treadmill':
            return 'TREADMILL';
        case 'exercise-bike':
            return 'BIKE';
        case 'rowing-machine':
            return 'ROWER';
        case 'elliptical':
            return 'ELLIPTICAL';
        case 'weight-bench':
            return 'BENCH';
        case 'stair-stepper':
            return 'STEPPER';
    }
}

export class HorsemasterScene extends Phaser.Scene {
    private launchData!: HorsemasterLaunchData;
    private state!: HorsemasterState;
    private graphics!: Phaser.GameObjects.Graphics;
    private hudText!: Phaser.GameObjects.Text;
    private messageText!: Phaser.GameObjects.Text;
    private helpObjects: Phaser.GameObjects.GameObject[] = [];
    private helpOpen = false;
    private pendingHorizontal: -1 | 0 | 1 = 0;
    private pendingForward = false;
    private finishing = false;
    private finishTimer: Phaser.Time.TimerEvent | null = null;

    constructor() {
        super({key: HORSEMASTER_SCENE_KEY});
    }

    create(data: HorsemasterLaunchData): void {
        this.launchData = data;
        const course = createHorsemasterCourse(
            new Mulberry32Random(data.context.seed),
            {
                startingLives: 3 + Math.max(
                    0,
                    Math.floor(getEncounterNumberModifier(
                        data.context,
                        'horsemasterLifeBonus'
                    ))
                )
            }
        );
        this.state = createHorsemasterState(course);
        this.pendingHorizontal = 0;
        this.pendingForward = false;
        this.finishing = false;
        this.finishTimer = null;
        this.helpObjects = [];
        this.helpOpen = false;

        this.cameras.main.setBackgroundColor(COLORS.sky);
        this.graphics = this.add.graphics().setDepth(10);
        this.add.text(VIEW_SIZE / 2, 22, 'ULTRA HORSE GYM', {
            color: '#fff7df',
            backgroundColor: '#51358f',
            fontFamily: 'Georgia, serif',
            fontSize: '25px',
            fontStyle: 'bold',
            padding: {x: 18, y: 8}
        }).setOrigin(0.5).setDepth(30);
        const itemBonus = getEncounterItemBonusLabel(data.context);
        if (itemBonus) {
            this.add.text(VIEW_SIZE / 2, 58, `ITEM BONUS · ${itemBonus}`, {
                color: '#173725',
                backgroundColor: 'rgba(255,247,223,0.88)',
                fontFamily: 'monospace',
                fontSize: '10px',
                padding: {x: 6, y: 3}
            }).setOrigin(0.5).setDepth(30);
        }
        this.game.canvas.dataset.itemBonus = itemBonus ?? '';
        this.hudText = this.add.text(14, 82, '', {
            color: '#fff7df',
            backgroundColor: 'rgba(24,28,34,0.88)',
            fontFamily: 'monospace',
            fontSize: '15px',
            padding: {x: 9, y: 6}
        }).setDepth(30);
        this.messageText = this.add.text(VIEW_SIZE / 2, 91,
            'TIME YOUR JUMP · LAND ON THE EXERCISE MACHINE',
            {
                color: '#181c22',
                backgroundColor: 'rgba(255,247,223,0.9)',
                fontFamily: 'Georgia, serif',
                fontSize: '14px',
                fontStyle: 'bold',
                align: 'center',
                padding: {x: 10, y: 5}
            }
        ).setOrigin(0.5, 0).setDepth(30);

        this.createControls();
        this.input.keyboard?.on('keydown', this.handleKeyDown);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown);
            this.finishTimer?.remove(false);
            this.clearDatasets();
        });
        this.syncPresentation();
        if (data.context.runId.endsWith('/0')) this.showHelp();
    }

    override update(_time: number, delta: number): void {
        if (this.finishing || this.helpOpen) {
            this.drawWorld();
            return;
        }
        const result = advanceHorsemaster(this.state, {
            horizontal: this.pendingHorizontal,
            forwardPressed: this.pendingForward
        }, Math.max(0, delta));
        this.pendingHorizontal = 0;
        this.pendingForward = false;
        this.state = result.state;
        this.handleEvents(result.events);
        this.syncPresentation();

        if (this.state.status !== 'active' && !this.finishing) {
            const terminalStatus = this.state.status;
            this.finishing = true;
            this.finishTimer = this.time.delayedCall(650, () => {
                this.finish(terminalStatus);
            });
        }
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (this.finishing) return;
        if (this.helpOpen) {
            if (event.key === 'Enter' || event.key === ' ' || event.key.toLowerCase() === 'h') {
                event.preventDefault();
                this.closeHelp();
            }
            return;
        }
        switch (event.key.toLowerCase()) {
            case 'arrowleft':
            case 'a':
                event.preventDefault();
                this.pendingHorizontal = -1;
                break;
            case 'arrowright':
            case 'd':
                event.preventDefault();
                this.pendingHorizontal = 1;
                break;
            case 'arrowup':
            case 'w':
            case ' ':
                event.preventDefault();
                this.pendingForward = true;
                break;
            case 'h':
                event.preventDefault();
                this.showHelp();
                break;
        }
    };

    private createControls(): void {
        this.createButton(66, 627, 92, '◀ ALIGN', () => {
            this.pendingHorizontal = -1;
        });
        this.createButton(170, 627, 92, 'ALIGN ▶', () => {
            this.pendingHorizontal = 1;
        });
        this.createButton(556, 619, 190, 'JUMP TO NEXT LANE', () => {
            this.pendingForward = true;
        }, 56, 0x51358f);
        this.createButton(625, 20, 68, 'HELP', () => this.showHelp(), 36, 0x315b6b);
        this.createButton(42, 20, 68, 'EXIT', () => this.finish('abandoned'), 36, 0x74404a);
    }

    private createButton(
        x: number,
        y: number,
        width: number,
        label: string,
        action: () => void,
        height = 48,
        color = 0x263846
    ): void {
        const button = this.add.rectangle(x, y, width, height, color, 0.96)
            .setStrokeStyle(2, 0xffe59a)
            .setDepth(40)
            .setInteractive({useHandCursor: true});
        const text = this.add.text(x, y, label, {
            color: '#fff7df',
            fontFamily: 'Georgia, serif',
            fontSize: width > 120 ? '15px' : '13px',
            fontStyle: 'bold',
            align: 'center'
        }).setOrigin(0.5).setDepth(41);
        button.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.preventDefault();
            if (!this.finishing && !this.helpOpen) action();
        });
        text.setInteractive({useHandCursor: true}).on('pointerdown', () => {
            if (!this.finishing && !this.helpOpen) action();
        });
    }

    private showHelp(): void {
        if (this.helpOpen || this.finishing) return;
        this.helpOpen = true;
        this.state = setHorsemasterPaused(this.state, true);
        const panel = this.add.rectangle(
            VIEW_SIZE / 2,
            VIEW_SIZE / 2,
            584,
            374,
            0x151a21,
            0.98
        ).setStrokeStyle(4, COLORS.gymLight).setDepth(100)
            .setInteractive({useHandCursor: true});
        const title = this.add.text(VIEW_SIZE / 2, 194, 'HOW TO BECOME HORSEMASTER', {
            color: '#ffd66b',
            fontFamily: 'Georgia, serif',
            fontSize: '24px',
            fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(101);
        const body = this.add.text(VIEW_SIZE / 2, 332,
            'UP / W / SPACE or JUMP leaps one lane toward the gym.\n\n' +
            'LEFT and RIGHT adjust your position on a machine or in midair.\n\n' +
            'GREEN machines are wide and slow. RED machines are fast and narrow.\n\n' +
            'Miss a machine and a car sends you back to the roadside.\n' +
            'Reach ULTRA HORSE GYM before all three hearts are gone.',
            {
                color: '#fff7df',
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                align: 'center',
                lineSpacing: 4,
                wordWrap: {width: 520, useAdvancedWrap: true}
            }
        ).setOrigin(0.5).setDepth(101);
        const close = this.add.text(VIEW_SIZE / 2, 484, 'ENTER · START JUMPING', {
            color: '#fff7df',
            backgroundColor: '#51358f',
            fontFamily: 'Georgia, serif',
            fontSize: '18px',
            padding: {x: 18, y: 11}
        }).setOrigin(0.5).setDepth(101).setInteractive({useHandCursor: true});
        const closeHelp = (): void => this.closeHelp();
        panel.on('pointerdown', closeHelp);
        close.on('pointerdown', closeHelp);
        this.helpObjects = [panel, title, body, close];
        this.publishTelemetry();
    }

    private closeHelp(): void {
        if (!this.helpOpen) return;
        for (const object of this.helpObjects) object.destroy();
        this.helpObjects = [];
        this.helpOpen = false;
        this.state = setHorsemasterPaused(this.state, false);
        this.publishTelemetry();
    }

    private handleEvents(events: readonly HorsemasterEvent[]): void {
        for (const event of events) {
            switch (event.kind) {
                case 'aligned':
                    break;
                case 'jump-started':
                    this.messageText.setText(
                        event.targetLaneIndex >= this.state.course.lanes.length
                            ? 'FINAL LEAP · ULTRA HORSE GYM!'
                            : `AIRBORNE · AIM FOR LANE ${event.targetLaneIndex + 1}`
                    );
                    break;
                case 'landed': {
                    const platform = this.state.course.lanes[event.laneIndex]?.vehicles
                        .find(vehicle => vehicle.id === event.platformId);
                    this.messageText.setText(
                        platform
                            ? `${exerciseLabel(platform.exerciseKind)} LANDED · KEEP CLIMBING`
                            : 'MACHINE LANDED · KEEP CLIMBING'
                    );
                    break;
                }
                case 'road-impact':
                    this.messageText.setText(
                        event.lives > 0
                            ? `CAR IMPACT · ${event.lives} HEART${event.lives === 1 ? '' : 'S'} LEFT`
                            : 'THE ROAD WINS THIS ROUND'
                    );
                    break;
                case 'reset':
                    break;
                case 'success':
                    this.messageText.setText('ULTRA HORSE GYM REACHED · MAXIMUM HORSE');
                    break;
                case 'failure':
                    this.messageText.setText('HORSE TRAINING ENDED · A NEW ROAD AWAITS');
                    break;
            }
        }
    }

    private syncPresentation(): void {
        this.drawWorld();
        const elapsedSeconds = Math.floor(
            this.state.activeTicks * HORSEMASTER_FIXED_STEP_MS / 1_000
        );
        const minutes = Math.floor(elapsedSeconds / 60);
        const seconds = String(elapsedSeconds % 60).padStart(2, '0');
        const lane = Math.max(0, this.state.player.laneIndex + 1);
        const hearts = '♥'.repeat(this.state.player.lives) +
            '♡'.repeat(this.state.course.startingLives - this.state.player.lives);
        this.hudText.setText(
            `LANE ${lane}/${this.state.course.lanes.length}  ${hearts}  ${minutes}:${seconds}`
        );
        this.publishTelemetry();
    }

    private drawWorld(): void {
        const graphics = this.graphics;
        const snapshot = getHorsemasterRenderSnapshot(this.state);
        graphics.clear();

        graphics.fillStyle(COLORS.grass);
        graphics.fillRect(0, 0, VIEW_SIZE, VIEW_SIZE);
        graphics.fillStyle(COLORS.grassDark, 0.45);
        for (let x = 0; x < VIEW_SIZE; x += 42) {
            graphics.fillCircle(x + 9, 68 + (x % 3) * 6, 4);
            graphics.fillCircle(x + 20, 596 + (x % 4) * 5, 5);
        }
        graphics.fillStyle(COLORS.gym);
        graphics.fillRoundedRect(216, 8, 240, 72, 14);
        graphics.fillStyle(COLORS.gymLight);
        graphics.fillRect(304, 57, 64, 24);
        graphics.fillStyle(COLORS.ink);
        graphics.fillRect(321, 59, 30, 22);

        for (const lane of this.state.course.lanes) {
            graphics.fillStyle(COLORS.roadEdge);
            graphics.fillRect(0, lane.y - ROAD_HALF_HEIGHT - 3, VIEW_SIZE, 72);
            graphics.fillStyle(COLORS.road);
            graphics.fillRect(0, lane.y - ROAD_HALF_HEIGHT, VIEW_SIZE, 66);
            graphics.fillStyle(COLORS.stripe, 0.68);
            for (let x = (lane.index % 2) * 42; x < VIEW_SIZE; x += 84) {
                graphics.fillRect(x, lane.y + ROAD_HALF_HEIGHT - 5, 42, 3);
            }
        }

        const nextLane = Math.min(
            this.state.course.lanes.length - 1,
            this.state.player.laneIndex + 1
        );
        const nextY = this.state.course.lanes[nextLane]?.y;
        if (nextY !== undefined && this.state.status === 'active') {
            graphics.lineStyle(2, 0xffffff, 0.26);
            graphics.lineBetween(0, nextY, VIEW_SIZE, nextY);
        }

        for (const vehicle of snapshot.vehicles) this.drawVehicle(graphics, vehicle);
        this.drawHorse(
            graphics,
            snapshot.player.x,
            snapshot.player.y,
            snapshot.player.jumping,
            snapshot.player.recoveryMs
        );
    }

    private drawVehicle(
        graphics: Phaser.GameObjects.Graphics,
        vehicle: HorsemasterRenderVehicle
    ): void {
        const {definition} = vehicle;
        const carColor = CAR_COLORS[definition.colorIndex % CAR_COLORS.length]!;
        const bodyY = vehicle.y + 20;
        graphics.fillStyle(COLORS.ink, 0.55);
        graphics.fillRoundedRect(
            vehicle.x - definition.carWidth / 2 - 3,
            bodyY - 3,
            definition.carWidth + 6,
            definition.carHeight + 6,
            9
        );
        graphics.fillStyle(carColor);
        graphics.fillRoundedRect(
            vehicle.x - definition.carWidth / 2,
            bodyY,
            definition.carWidth,
            definition.carHeight,
            8
        );
        graphics.fillStyle(0xbfe7ef);
        const windshieldX = definition.direction > 0
            ? vehicle.x + definition.carWidth * 0.12
            : vehicle.x - definition.carWidth * 0.37;
        graphics.fillRoundedRect(
            windshieldX,
            bodyY + 5,
            definition.carWidth * 0.25,
            12,
            3
        );
        graphics.fillStyle(COLORS.ink);
        graphics.fillCircle(vehicle.x - definition.carWidth * 0.3, bodyY + definition.carHeight, 9);
        graphics.fillCircle(vehicle.x + definition.carWidth * 0.3, bodyY + definition.carHeight, 9);
        graphics.fillStyle(0xb8bdc7);
        graphics.fillCircle(vehicle.x - definition.carWidth * 0.3, bodyY + definition.carHeight, 4);
        graphics.fillCircle(vehicle.x + definition.carWidth * 0.3, bodyY + definition.carHeight, 4);

        const machineColor = opportunityColor(definition.opportunity);
        graphics.fillStyle(machineColor, 0.18);
        graphics.fillRoundedRect(
            vehicle.x - definition.machineWidth / 2 - 4,
            vehicle.y - 18,
            definition.machineWidth + 8,
            39,
            7
        );
        graphics.lineStyle(3, machineColor, 1);
        graphics.strokeRoundedRect(
            vehicle.x - definition.machineWidth / 2,
            vehicle.y + 11,
            definition.machineWidth,
            8,
            3
        );
        this.drawExerciseMachine(graphics, vehicle);
    }

    private drawExerciseMachine(
        graphics: Phaser.GameObjects.Graphics,
        vehicle: HorsemasterRenderVehicle
    ): void {
        const x = vehicle.x;
        const y = vehicle.y + 9;
        const color = opportunityColor(vehicle.definition.opportunity);
        graphics.lineStyle(3, color, 1);
        switch (vehicle.definition.exerciseKind) {
            case 'treadmill':
                graphics.strokeRoundedRect(
                    x - vehicle.definition.machineWidth * 0.38,
                    y - 4,
                    vehicle.definition.machineWidth * 0.76,
                    9,
                    3
                );
                graphics.lineBetween(x + 18, y - 4, x + 27, y - 24);
                graphics.lineBetween(x + 27, y - 24, x + 36, y - 24);
                break;
            case 'exercise-bike':
                graphics.strokeCircle(x - 18, y - 2, 10);
                graphics.strokeCircle(x + 15, y - 2, 10);
                graphics.lineBetween(x - 18, y - 2, x, y - 20);
                graphics.lineBetween(x, y - 20, x + 15, y - 2);
                graphics.lineBetween(x, y - 20, x + 13, y - 20);
                break;
            case 'rowing-machine':
                graphics.lineBetween(x - 34, y + 2, x + 34, y + 2);
                graphics.strokeRoundedRect(x - 5, y - 6, 19, 8, 2);
                graphics.lineBetween(x + 4, y - 6, x + 26, y - 25);
                break;
            case 'elliptical':
                graphics.strokeCircle(x - 10, y - 1, 11);
                graphics.strokeCircle(x + 12, y - 1, 11);
                graphics.lineBetween(x, y - 4, x, y - 26);
                graphics.lineBetween(x, y - 24, x + 17, y - 15);
                break;
            case 'weight-bench':
                graphics.strokeRoundedRect(x - 28, y - 8, 56, 10, 3);
                graphics.lineBetween(x - 22, y + 2, x - 26, y + 12);
                graphics.lineBetween(x + 22, y + 2, x + 26, y + 12);
                graphics.lineBetween(x - 35, y - 22, x + 35, y - 22);
                graphics.fillStyle(color);
                graphics.fillCircle(x - 38, y - 22, 6);
                graphics.fillCircle(x + 38, y - 22, 6);
                break;
            case 'stair-stepper':
                graphics.strokeRoundedRect(x - 24, y - 7, 20, 9, 3);
                graphics.strokeRoundedRect(x + 4, y - 13, 20, 15, 3);
                graphics.lineBetween(x, y - 8, x, y - 27);
                graphics.lineBetween(x, y - 26, x + 15, y - 26);
                break;
        }
    }

    private drawHorse(
        graphics: Phaser.GameObjects.Graphics,
        x: number,
        y: number,
        jumping: boolean,
        recoveryMs: number
    ): void {
        if (recoveryMs > 0 && Math.floor(recoveryMs / 90) % 2 === 0) return;
        const lift = jumping ? -5 : 0;
        graphics.fillStyle(COLORS.ink, 0.28);
        graphics.fillEllipse(x, y + 19, jumping ? 31 : 43, 10);
        graphics.fillStyle(COLORS.horse);
        graphics.fillEllipse(x - 2, y - 3 + lift, 43, 25);
        graphics.fillRoundedRect(x + 12, y - 29 + lift, 14, 31, 5);
        graphics.fillStyle(COLORS.horseLight);
        graphics.fillEllipse(x + 23, y - 32 + lift, 24, 17);
        graphics.fillStyle(COLORS.mane);
        graphics.fillTriangle(
            x + 7, y - 28 + lift,
            x + 15, y - 39 + lift,
            x + 17, y - 22 + lift
        );
        graphics.fillTriangle(
            x + 18, y - 39 + lift,
            x + 23, y - 49 + lift,
            x + 27, y - 37 + lift
        );
        graphics.fillStyle(COLORS.ink);
        graphics.fillCircle(x + 29, y - 34 + lift, 2);
        graphics.lineStyle(5, COLORS.horse, 1);
        const legSpread = jumping ? 13 : 7;
        graphics.lineBetween(x - 13, y + 6 + lift, x - 17 - legSpread, y + 19 + lift);
        graphics.lineBetween(x + 7, y + 6 + lift, x + 9 + legSpread, y + 19 + lift);
        graphics.lineStyle(3, 0xf05b91, 1);
        graphics.lineBetween(x + 12, y - 24 + lift, x + 34, y - 24 + lift);
    }

    private publishTelemetry(): void {
        const canvas = this.game.canvas;
        const snapshot = getHorsemasterRenderSnapshot(this.state);
        const nextLane = this.state.course.lanes[this.state.player.laneIndex + 1];
        const nextEasy = nextLane?.vehicles.find(vehicle => vehicle.opportunity === 'easy');
        const nextEasyState = nextEasy === undefined
            ? undefined
            : snapshot.vehicles.find(vehicle => vehicle.id === nextEasy.id);
        canvas.dataset.horsemasterStatus = this.state.status;
        canvas.dataset.horsemasterLane = String(this.state.player.laneIndex);
        canvas.dataset.horsemasterLives = String(this.state.player.lives);
        canvas.dataset.horsemasterJumping = String(this.state.player.jump !== null);
        canvas.dataset.horsemasterPlatform = this.state.player.platformId ?? '';
        canvas.dataset.horsemasterX = String(Math.round(snapshot.player.x));
        canvas.dataset.horsemasterY = String(Math.round(snapshot.player.y));
        canvas.dataset.horsemasterVehicleCount = String(this.state.vehicles.length);
        canvas.dataset.horsemasterLaneCount = String(this.state.course.lanes.length);
        canvas.dataset.horsemasterHelpOpen = String(this.helpOpen);
        canvas.dataset.horsemasterNextEasyX = nextEasyState === undefined
            ? ''
            : String(Math.round(nextEasyState.x));
        canvas.dataset.horsemasterCourseSignature =
            canonicalHorsemasterCourseSignature(this.state.course);
    }

    private clearDatasets(): void {
        const canvas = this.game.canvas;
        delete canvas.dataset.horsemasterStatus;
        delete canvas.dataset.horsemasterLane;
        delete canvas.dataset.horsemasterLives;
        delete canvas.dataset.horsemasterJumping;
        delete canvas.dataset.horsemasterPlatform;
        delete canvas.dataset.horsemasterX;
        delete canvas.dataset.horsemasterY;
        delete canvas.dataset.horsemasterVehicleCount;
        delete canvas.dataset.horsemasterLaneCount;
        delete canvas.dataset.horsemasterHelpOpen;
        delete canvas.dataset.horsemasterNextEasyX;
        delete canvas.dataset.horsemasterCourseSignature;
        delete canvas.dataset.itemBonus;
    }

    private finish(status: 'success' | 'failure' | 'abandoned'): void {
        if (!this.scene.isActive()) return;
        this.finishing = true;
        this.finishTimer?.remove(false);
        this.launchData.onComplete(this.createResult(status));
        this.scene.stop();
    }

    private createResult(status: 'success' | 'failure' | 'abandoned'): EncounterResult {
        const elapsedMs = this.state.activeTicks * HORSEMASTER_FIXED_STEP_MS;
        const hits = this.state.course.startingLives - this.state.player.lives;
        const grade = status !== 'success'
            ? 'none'
            : hits === 0 && elapsedMs <= 45_000
                ? 's'
                : hits <= 1 && elapsedMs <= 75_000
                    ? 'a'
                    : this.state.player.lives >= 2
                        ? 'b'
                        : 'c';
        const effects: OutcomeEffect[] = status === 'success'
            ? [
                {kind: 'change-resource', resource: 'scrap', delta: 5},
                {
                    kind: 'adjust-world-system',
                    system: 'structuralStability',
                    delta: 10
                }
            ]
            : [];
        const score = status === 'success'
            ? Math.max(
                1_000,
                12_000 -
                Math.floor(elapsedMs / 12) -
                hits * 1_500 +
                this.state.course.lanes.length * 250
            )
            : 0;
        return {
            runId: this.launchData.context.runId,
            definitionId: this.launchData.context.definitionId,
            triggerId: this.launchData.context.trigger.triggerId,
            kind: 'horsemaster',
            status,
            grade,
            score,
            elapsedMs,
            effects
        };
    }
}
