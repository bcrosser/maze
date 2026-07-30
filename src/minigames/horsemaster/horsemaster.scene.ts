import Phaser from 'phaser';

import {getControlDeck} from '../../app/control-deck-host';
import {
    HORSEMASTER_CONTROL_SCHEME,
    type ControlEvent
} from '../../app/control-scheme';
import {drawHorse} from '../../content/horse-art';
import {createHelpOverlay, type HelpOverlay} from '../help-overlay';
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
    HORSEMASTER_CAB_LENGTH,
    HORSEMASTER_FIXED_STEP_MS,
    HORSEMASTER_GOAL_ROW,
    HORSEMASTER_ROW_COUNT,
    HORSEMASTER_SLOT_WIDTH,
    HORSEMASTER_TILE,
    advanceHorsemaster,
    canonicalHorsemasterCourseSignature,
    createHorsemasterCourse,
    createHorsemasterState,
    getHorsemasterRenderSnapshot,
    horsemasterRowKind,
    horsemasterRowY,
    setHorsemasterPaused,
    type HorsemasterEvent,
    type HorsemasterExerciseKind,
    type HorsemasterRenderBicycle,
    type HorsemasterRenderSnapshot,
    type HorsemasterRenderVehicle,
    type HorsemasterState,
    type HorsemasterVehicleTier
} from './horsemaster-model';

export const HORSEMASTER_SCENE_KEY = 'horsemaster';

export interface HorsemasterLaunchData {
    readonly context: EncounterContext;
    readonly onComplete: (result: EncounterResult) => void;
}

const VIEW_SIZE = 672;
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
const BUS_COLORS = Object.freeze([
    0xd9a13b,
    0x5b8def,
    0x8f6fc9,
    0x46b8b0
]);
const BUILDING_COLORS = Object.freeze([
    0xb06a4a,
    0x6e7b8b,
    0xe8dcc0,
    0x4f8a8b
]);

const COLORS = Object.freeze({
    sky: 0x9ed8e6,
    grass: 0x4f8f55,
    grassDark: 0x32633d,
    road: 0x353941,
    roadEdge: 0x20242a,
    curb: 0x9aa0ab,
    sidewalk: 0xcfc8b8,
    sidewalkLine: 0xb5ad9c,
    stripe: 0xf4d866,
    paper: 0xfff7df,
    ink: 0x181c22,
    horse: 0xa65d32,
    horseLight: 0xe9ae68,
    mane: 0x4c2d22,
    rider: 0xe8b88a,
    belt: 0x22262d,
    machineFrame: 0x2b3038,
    deck: 0x454b55,
    railing: 0xd8dde6,
    gym: 0x6b4db4,
    gymLight: 0xc59cff,
    green: 0x67d58a,
    yellow: 0xf2ca61,
    red: 0xef6f6c
});

function tierColor(tier: HorsemasterVehicleTier): number {
    switch (tier) {
        case 'green':
            return COLORS.green;
        case 'yellow':
            return COLORS.yellow;
        case 'red':
            return COLORS.red;
    }
}

function exerciseLabel(kind: HorsemasterExerciseKind): string {
    switch (kind) {
        case 'treadmill':
            return 'TREADMILL';
        case 'exercise-bike':
            return 'EXERCISE BIKE';
    }
}

interface HorsePose {
    readonly kind: 'idle' | 'hop' | 'gallop' | 'pedal';
    readonly clockMs: number;
    readonly hopProgress: number;
    readonly recoveryMs: number;
}

export class HorsemasterScene extends Phaser.Scene {
    private launchData!: HorsemasterLaunchData;
    private state!: HorsemasterState;
    private graphics!: Phaser.GameObjects.Graphics;
    private hudText!: Phaser.GameObjects.Text;
    private messageText!: Phaser.GameObjects.Text;
    private helpOverlay: HelpOverlay | null = null;
    private helpOpen = false;
    private pendingHorizontal: -1 | 0 | 1 = 0;
    private pendingVertical: -1 | 0 | 1 = 0;
    private animationClockMs = 0;
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
        this.pendingVertical = 0;
        this.animationClockMs = 0;
        this.finishing = false;
        this.finishTimer = null;
        this.helpOpen = false;

        this.cameras.main.setBackgroundColor(COLORS.sky);
        this.graphics = this.add.graphics().setDepth(10);

        const gym = course.buildings[course.gymIndex]!;
        this.add.text(gym.centerX, 58, 'GYM', {
            color: '#fff7df',
            fontFamily: 'Georgia, serif',
            fontSize: '13px',
            fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(12);

        this.add.text(430, 20, 'ULTRA HORSE GYM', {
            color: '#fff7df',
            backgroundColor: '#51358f',
            fontFamily: 'Georgia, serif',
            fontSize: '13px',
            fontStyle: 'bold',
            padding: {x: 8, y: 4}
        }).setOrigin(0.5).setDepth(30);
        const itemBonus = getEncounterItemBonusLabel(data.context);
        if (itemBonus) {
            this.add.text(336, 40, `ITEM BONUS · ${itemBonus}`, {
                color: '#173725',
                backgroundColor: 'rgba(255,247,223,0.88)',
                fontFamily: 'monospace',
                fontSize: '10px',
                padding: {x: 6, y: 2}
            }).setOrigin(0.5).setDepth(30);
        }
        this.game.canvas.dataset.itemBonus = itemBonus ?? '';
        this.hudText = this.add.text(90, 8, '', {
            color: '#fff7df',
            backgroundColor: 'rgba(24,28,34,0.88)',
            fontFamily: 'monospace',
            fontSize: '14px',
            padding: {x: 8, y: 5}
        }).setDepth(30);
        this.messageText = this.add.text(VIEW_SIZE / 2, 98,
            'HOP THE BIKE ROAD · RIDE THE MACHINES · FIND THE GYM DOOR',
            {
                color: '#181c22',
                backgroundColor: 'rgba(255,247,223,0.9)',
                fontFamily: 'Georgia, serif',
                fontSize: '13px',
                fontStyle: 'bold',
                align: 'center',
                padding: {x: 10, y: 4}
            }
        ).setOrigin(0.5, 0).setDepth(30);

        this.createControls();
        this.input.keyboard?.on('keydown', this.handleKeyDown);
        getControlDeck(this)?.setScheme(HORSEMASTER_CONTROL_SCHEME, this.handleControlEvent);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown);
            getControlDeck(this)?.clearScheme(HORSEMASTER_CONTROL_SCHEME.id);
            this.finishTimer?.remove(false);
            this.clearDatasets();
        });
        this.syncPresentation();
        if (data.context.runId.endsWith('/0')) this.showHelp();
    }

    override update(_time: number, delta: number): void {
        this.animationClockMs += Math.max(0, delta);
        if (this.finishing || this.helpOpen) {
            this.drawWorld();
            return;
        }
        const result = advanceHorsemaster(this.state, {
            horizontal: this.pendingHorizontal,
            vertical: this.pendingVertical
        }, Math.max(0, delta));
        this.pendingHorizontal = 0;
        this.pendingVertical = 0;
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
                this.pendingVertical = 1;
                break;
            case 'arrowdown':
            case 's':
                event.preventDefault();
                this.pendingVertical = -1;
                break;
            case 'h':
                event.preventDefault();
                this.showHelp();
                break;
        }
    };

    private createControls(): void {
        // Movement and HOP live on the shared control deck below the canvas;
        // only the corner utilities stay in the scene.
        this.createButton(625, 20, 68, 'HELP', () => this.showHelp(), 36, 0x315b6b);
        this.createButton(42, 20, 68, 'EXIT', () => this.finish('abandoned'), 36, 0x74404a);
    }

    private readonly handleControlEvent = (event: ControlEvent): void => {
        if (this.finishing) return;
        if (this.helpOpen) {
            if (event.kind === 'button' && event.phase === 'press') this.closeHelp();
            return;
        }
        if (event.kind === 'direction') {
            if (event.phase !== 'press') return;
            switch (event.direction) {
                case 'left':
                    this.pendingHorizontal = -1;
                    break;
                case 'right':
                    this.pendingHorizontal = 1;
                    break;
                case 'up':
                    this.pendingVertical = 1;
                    break;
                case 'down':
                    this.pendingVertical = -1;
                    break;
            }
            return;
        }
        if (event.kind === 'button' && event.phase === 'press' && event.id === 'hop') {
            this.pendingVertical = 1;
        }
    };

    private createButton(
        x: number,
        y: number,
        width: number,
        label: string,
        action: () => void,
        height = 48,
        color = 0x263846,
        alpha = 0.96
    ): void {
        const button = this.add.rectangle(x, y, width, height, color, alpha)
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
        this.pendingHorizontal = 0;
        this.pendingVertical = 0;
        this.state = setHorsemasterPaused(this.state, true);
        this.helpOverlay = createHelpOverlay(this, {
            title: 'BECOME HORSEMASTER',
            lines: [
                'Hop one tile with the pad or arrows.',
                '',
                'Dodge the bikes. The median is safe.',
                '',
                'Past it you must RIDE: land on a truck',
                'and the horse takes a machine.',
                '',
                'DOWN hops back a lane, even mid-ride.',
                'Riding off the screen edge costs a heart.',
                '',
                'Finish through the glowing GYM door.'
            ],
            closeLabel: 'ENTER · HOP',
            accentColor: COLORS.gymLight,
            titleColor: '#ffd66b',
            bodyColor: '#fff7df',
            panelColor: 0x151a21,
            viewSize: VIEW_SIZE,
            onClose: () => this.closeHelp()
        });
        this.publishTelemetry();
    }

    private closeHelp(): void {
        if (!this.helpOpen) return;
        this.helpOverlay?.destroy();
        this.helpOverlay = null;
        this.helpOpen = false;
        this.pendingHorizontal = 0;
        this.pendingVertical = 0;
        this.state = setHorsemasterPaused(this.state, false);
        this.publishTelemetry();
    }

    private heartsMessage(prefix: string, lives: number): string {
        return lives > 0
            ? `${prefix} · ${lives} HEART${lives === 1 ? '' : 'S'} LEFT`
            : 'THE ROAD WINS THIS ROUND';
    }

    private handleEvents(events: readonly HorsemasterEvent[]): void {
        for (const event of events) {
            switch (event.kind) {
                case 'aligned':
                    break;
                case 'jump-started':
                    if (event.hop !== 'vehicle') break;
                    this.messageText.setText(
                        event.targetRow >= HORSEMASTER_GOAL_ROW
                            ? 'FINAL LEAP · AIM FOR THE GYM DOOR'
                            : 'AIRBORNE · LAND ON A TRUCK'
                    );
                    break;
                case 'landed': {
                    const machine = this.state.course.vehicleLanes
                        .flatMap(lane => lane.vehicles)
                        .find(vehicle => vehicle.id === event.vehicleId)
                        ?.slots[event.slotIndex]?.exerciseKind;
                    this.messageText.setText(
                        machine
                            ? `${exerciseLabel(machine)} MOUNTED · RIDE ON`
                            : 'MACHINE MOUNTED · RIDE ON'
                    );
                    break;
                }
                case 'road-impact':
                    this.messageText.setText(
                        this.heartsMessage('MISSED THE TRUCK', event.lives)
                    );
                    break;
                case 'bicycle-hit':
                    this.messageText.setText(
                        this.heartsMessage('BICYCLE COLLISION', event.lives)
                    );
                    break;
                case 'carried-off-edge':
                    this.messageText.setText(
                        this.heartsMessage('CARRIED OFF THE ROAD', event.lives)
                    );
                    break;
                case 'wrong-building':
                    this.messageText.setText(
                        this.heartsMessage('WRONG DOOR', event.lives)
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
        const hearts = '♥'.repeat(this.state.player.lives) +
            '♡'.repeat(this.state.course.startingLives - this.state.player.lives);
        this.hudText.setText(
            `ROW ${this.state.player.row}/${HORSEMASTER_GOAL_ROW}  ${hearts}  ${minutes}:${seconds}`
        );
        this.publishTelemetry();
    }

    private drawWorld(): void {
        const graphics = this.graphics;
        const snapshot = getHorsemasterRenderSnapshot(this.state);
        graphics.clear();

        this.drawBackground(graphics);
        this.drawRoadBands(graphics);
        this.drawSidewalks(graphics);
        this.drawBuildings(graphics);

        if (this.state.status === 'active' && this.state.player.row < HORSEMASTER_GOAL_ROW) {
            const nextY = horsemasterRowY(this.state.player.row + 1);
            graphics.lineStyle(2, 0xffffff, 0.22);
            graphics.lineBetween(0, nextY, VIEW_SIZE, nextY);
        }

        for (const bicycle of snapshot.bicycles) this.drawBicycle(graphics, bicycle);
        for (const vehicle of snapshot.vehicles) this.drawVehicle(graphics, vehicle, snapshot);
        this.drawHorse(graphics, snapshot.player.x, snapshot.player.y, {
            kind: snapshot.player.jumping
                ? 'hop'
                : snapshot.player.ridingMachine === 'treadmill'
                    ? 'gallop'
                    : snapshot.player.ridingMachine === 'exercise-bike'
                        ? 'pedal'
                        : 'idle',
            clockMs: this.animationClockMs,
            hopProgress: snapshot.player.hopProgress,
            recoveryMs: snapshot.player.recoveryMs
        });
    }

    private drawBackground(graphics: Phaser.GameObjects.Graphics): void {
        graphics.fillStyle(COLORS.grass);
        graphics.fillRect(0, 0, VIEW_SIZE, VIEW_SIZE);
        graphics.fillStyle(COLORS.grassDark, 0.45);
        for (let x = 0; x < VIEW_SIZE; x += 42) {
            graphics.fillCircle(x + 9, 30 + (x % 3) * 6, 4);
            graphics.fillCircle(x + 20, 660 + (x % 4) * 3, 5);
        }
    }

    private drawRoadBands(graphics: Phaser.GameObjects.Graphics): void {
        const bands = [
            {top: horsemasterRowY(5) - HORSEMASTER_TILE / 2, lanes: 5, firstRow: 1},
            {top: horsemasterRowY(11) - HORSEMASTER_TILE / 2, lanes: 5, firstRow: 7}
        ];
        for (const band of bands) {
            const height = band.lanes * HORSEMASTER_TILE;
            graphics.fillStyle(COLORS.curb);
            graphics.fillRect(0, band.top - 6, VIEW_SIZE, 6);
            graphics.fillRect(0, band.top + height, VIEW_SIZE, 6);
            graphics.fillStyle(COLORS.road);
            graphics.fillRect(0, band.top, VIEW_SIZE, height);
            graphics.fillStyle(COLORS.roadEdge);
            graphics.fillRect(0, band.top, VIEW_SIZE, 3);
            graphics.fillRect(0, band.top + height - 3, VIEW_SIZE, 3);
            graphics.fillStyle(COLORS.stripe, 0.68);
            for (let laneLine = 1; laneLine < band.lanes; laneLine++) {
                const y = band.top + laneLine * HORSEMASTER_TILE;
                for (let x = (laneLine % 2) * 42; x < VIEW_SIZE; x += 84) {
                    graphics.fillRect(x, y - 1, 42, 3);
                }
            }
        }
        const tintedLanes = [
            ...this.state.course.bikeLanes,
            ...this.state.course.vehicleLanes
        ];
        for (const lane of tintedLanes) {
            graphics.fillStyle(tierColor(lane.tier), 0.55);
            for (let x = 8; x < VIEW_SIZE; x += 96) {
                graphics.fillRect(x, lane.y + HORSEMASTER_TILE / 2 - 8, 24, 4);
            }
        }
    }

    private drawSidewalks(graphics: Phaser.GameObjects.Graphics): void {
        const rows = [
            horsemasterRowY(0) - HORSEMASTER_TILE / 2,
            this.state.course.medianY - HORSEMASTER_TILE / 2
        ];
        for (const top of rows) {
            graphics.fillStyle(COLORS.sidewalk);
            graphics.fillRect(0, top, VIEW_SIZE, HORSEMASTER_TILE);
            graphics.fillStyle(COLORS.sidewalkLine);
            for (let x = HORSEMASTER_TILE; x < VIEW_SIZE; x += HORSEMASTER_TILE) {
                graphics.fillRect(x - 1, top, 2, HORSEMASTER_TILE);
            }
        }
        graphics.fillStyle(COLORS.grassDark, 0.4);
        for (let x = 30; x < VIEW_SIZE; x += 130) {
            graphics.fillCircle(x, this.state.course.medianY + 14, 4);
        }
    }

    private drawBuildings(graphics: Phaser.GameObjects.Graphics): void {
        for (const building of this.state.course.buildings) {
            const facade = building.isGym
                ? COLORS.gym
                : BUILDING_COLORS[building.index % BUILDING_COLORS.length]!;
            graphics.fillStyle(COLORS.ink, 0.35);
            graphics.fillRect(building.centerX - 46, 92, 92, 4);
            graphics.fillStyle(facade);
            graphics.fillRect(building.centerX - 45, 44, 90, 52);
            graphics.fillStyle(COLORS.ink, 0.55);
            graphics.fillRect(building.centerX - 48, 40, 96, 7);
            graphics.fillStyle(0xbfe7ef);
            graphics.fillRect(building.centerX - 32, 52, 12, 12);
            graphics.fillRect(building.centerX + 20, 52, 12, 12);
            graphics.fillStyle(COLORS.ink);
            graphics.fillRect(
                building.centerX - 14,
                74,
                28,
                22
            );
            if (building.isGym) {
                graphics.fillStyle(COLORS.gymLight);
                graphics.fillRect(building.centerX - 26, 50, 52, 16);
                const pulse = 0.55 + 0.35 * Math.sin(this.animationClockMs / 220);
                graphics.lineStyle(3, COLORS.gymLight, pulse);
                graphics.strokeRoundedRect(building.centerX - 18, 71, 36, 27, 4);
            }
            else {
                graphics.lineStyle(3, COLORS.roadEdge, 1);
                graphics.lineBetween(
                    building.centerX - 14,
                    85,
                    building.centerX + 14,
                    85
                );
            }
        }
    }

    private drawBicycle(
        graphics: Phaser.GameObjects.Graphics,
        bicycle: HorsemasterRenderBicycle
    ): void {
        const direction = bicycle.definition.direction;
        const x = bicycle.x;
        const y = bicycle.y;
        const dx = (offset: number): number => x + offset * direction;
        // Riders wear their lane's speed color: green slow, yellow medium, red fast.
        const jersey = tierColor(
            this.state.course.bikeLanes[bicycle.definition.laneIndex]!.tier
        );
        const spin = this.animationClockMs / 120 + bicycle.definition.colorIndex * 0.9;

        graphics.fillStyle(COLORS.ink, 0.25);
        graphics.fillEllipse(x, y + 17, 30, 6);
        graphics.lineStyle(2, COLORS.ink, 1);
        graphics.strokeCircle(dx(-10), y + 9, 7);
        graphics.strokeCircle(dx(10), y + 9, 7);
        graphics.lineBetween(
            dx(-10),
            y + 9,
            dx(-10) + Math.cos(spin) * 6,
            y + 9 + Math.sin(spin) * 6
        );
        graphics.lineBetween(
            dx(10),
            y + 9,
            dx(10) + Math.cos(spin + 1.3) * 6,
            y + 9 + Math.sin(spin + 1.3) * 6
        );
        graphics.lineStyle(2, COLORS.ink, 1);
        graphics.lineBetween(dx(-10), y + 9, dx(-2), y - 1);
        graphics.lineBetween(dx(-2), y - 1, dx(10), y + 9);
        graphics.lineBetween(dx(-2), y - 1, dx(-6), y - 8);
        graphics.lineBetween(dx(10), y + 9, dx(8), y - 5);

        graphics.lineStyle(4, jersey, 1);
        graphics.lineBetween(dx(-6), y - 8, dx(3), y - 15);
        graphics.lineStyle(2, jersey, 1);
        graphics.lineBetween(dx(3), y - 14, dx(8), y - 5);
        const pedalAngle = spin * 1.4;
        const crankX = dx(0);
        const crankY = y + 6;
        graphics.lineStyle(3, COLORS.mane, 1);
        graphics.lineBetween(
            dx(-4),
            y - 6,
            crankX + Math.cos(pedalAngle) * 5,
            crankY + Math.sin(pedalAngle) * 5
        );
        graphics.lineBetween(
            dx(-4),
            y - 6,
            crankX - Math.cos(pedalAngle) * 5,
            crankY - Math.sin(pedalAngle) * 5
        );
        graphics.fillStyle(COLORS.rider);
        graphics.fillCircle(dx(5), y - 17, 4);
        graphics.fillStyle(jersey);
        graphics.fillRect(dx(5) - 4, y - 22, 8, 3);
        graphics.fillStyle(COLORS.ink, 0.3);
        graphics.fillRect(dx(-22), y + 4, 6, 2);
        graphics.fillRect(dx(-28), y + 9, 5, 2);
    }

    /**
     * Every vehicle is a flatbed truck: a driver's cab on the leading side
     * and the exercise machines riding in the open bed behind it.
     */
    private drawVehicle(
        graphics: Phaser.GameObjects.Graphics,
        vehicle: HorsemasterRenderVehicle,
        snapshot: HorsemasterRenderSnapshot
    ): void {
        const definition = vehicle.definition;
        const isBig = definition.tier === 'green';
        const bodyColor = isBig
            ? BUS_COLORS[definition.colorIndex % BUS_COLORS.length]!
            : CAR_COLORS[definition.colorIndex % CAR_COLORS.length]!;
        const halfWidth = definition.carWidth / 2;
        const direction = definition.direction;
        const x = vehicle.x;
        const y = vehicle.y;
        const slotSpan = definition.slots.length * HORSEMASTER_SLOT_WIDTH;
        const cabLeft = direction === 1
            ? x + halfWidth
            : x - halfWidth - HORSEMASTER_CAB_LENGTH;

        const shadowLeft = direction === 1
            ? x - halfWidth - 2
            : x - halfWidth - HORSEMASTER_CAB_LENGTH - 2;
        graphics.fillStyle(COLORS.ink, 0.4);
        graphics.fillRoundedRect(
            shadowLeft,
            y + 2,
            definition.carWidth + HORSEMASTER_CAB_LENGTH + 4,
            22,
            7
        );
        const wheelXs = isBig
            ? [x - halfWidth * 0.65, x + halfWidth * 0.1, x + halfWidth * 0.7]
            : [x - halfWidth * 0.5, x + halfWidth * 0.55];
        wheelXs.push(x + direction * (halfWidth + HORSEMASTER_CAB_LENGTH * 0.55));
        graphics.fillStyle(COLORS.ink);
        for (const wheelX of wheelXs) graphics.fillCircle(wheelX, y + 22, 6);
        graphics.fillStyle(0xb8bdc7);
        for (const wheelX of wheelXs) graphics.fillCircle(wheelX, y + 22, 2.5);

        // Flatbed chassis in the truck's paint color, with a darker bed floor.
        graphics.fillStyle(bodyColor);
        graphics.fillRoundedRect(x - halfWidth, y + 6, definition.carWidth, 16, 4);
        graphics.fillStyle(COLORS.belt);
        graphics.fillRoundedRect(x - halfWidth + 2, y + 2, definition.carWidth - 4, 8, 3);

        // Driver's cab, taller than the bed, on the leading side.
        graphics.fillStyle(bodyColor);
        graphics.fillRoundedRect(cabLeft, y - 12, HORSEMASTER_CAB_LENGTH, 34, 5);
        graphics.fillStyle(COLORS.ink, 0.35);
        graphics.fillRect(cabLeft + 2, y - 12, HORSEMASTER_CAB_LENGTH - 4, 3);
        graphics.fillStyle(0xbfe7ef);
        const windshieldX = direction === 1
            ? cabLeft + HORSEMASTER_CAB_LENGTH - 8
            : cabLeft + 2;
        graphics.fillRoundedRect(windshieldX, y - 8, 6, 12, 2);
        graphics.fillRoundedRect(
            cabLeft + (direction === 1 ? 3 : 9),
            y - 8,
            14,
            11,
            2
        );
        // The driver: head, cap, and a hand on the wheel.
        const driverX = cabLeft + HORSEMASTER_CAB_LENGTH / 2 + (direction === 1 ? -2 : 2);
        graphics.fillStyle(COLORS.rider);
        graphics.fillCircle(driverX, y - 3, 3.5);
        graphics.fillStyle(COLORS.ink);
        graphics.fillRect(driverX - 4, y - 8, 8, 3);
        graphics.lineStyle(2, COLORS.rider, 1);
        graphics.lineBetween(driverX + direction * 3, y - 1, driverX + direction * 7, y + 1);

        graphics.fillStyle(COLORS.deck);
        graphics.fillRoundedRect(x - slotSpan / 2 - 4, y - 16, slotSpan + 8, 22, 4);
        graphics.lineStyle(2, COLORS.railing, 0.9);
        graphics.lineBetween(x - slotSpan / 2 - 4, y - 16, x + slotSpan / 2 + 4, y - 16);
        for (
            let post = x - slotSpan / 2 - 4;
            post <= x + slotSpan / 2 + 4;
            post += 16
        ) {
            graphics.lineBetween(post, y - 16, post, y - 13);
        }

        const padColor = tierColor(definition.tier);
        for (const slot of definition.slots) {
            const slotX = x + slot.offsetX;
            graphics.fillStyle(padColor, 0.2);
            graphics.fillRoundedRect(slotX - 22, y - 14, 44, 20, 4);
            graphics.lineStyle(2, padColor, 1);
            graphics.strokeRoundedRect(slotX - 22, y - 14, 44, 20, 4);
            const ridden = !snapshot.player.jumping &&
                snapshot.player.ride?.vehicleId === definition.id &&
                snapshot.player.ride.slotIndex === slot.index;
            this.drawMachine(graphics, slotX, y, slot.exerciseKind, padColor, ridden);
        }
        if (definition.slots.length === 2) {
            graphics.lineStyle(2, COLORS.roadEdge, 0.8);
            graphics.lineBetween(x, y - 14, x, y + 6);
        }
    }

    private drawMachine(
        graphics: Phaser.GameObjects.Graphics,
        x: number,
        y: number,
        kind: HorsemasterExerciseKind,
        consoleColor: number,
        ridden: boolean
    ): void {
        const clock = this.animationClockMs;
        if (kind === 'treadmill') {
            graphics.fillStyle(COLORS.belt);
            graphics.fillRoundedRect(x - 18, y + 2, 36, 8, 3);
            graphics.lineStyle(2, COLORS.railing, 0.8);
            graphics.lineBetween(x - 18, y + 2, x + 18, y + 2);
            const scroll = (clock / (ridden ? 12 : 45)) % 9;
            graphics.fillStyle(COLORS.ink);
            for (let tick = 0; tick < 4; tick++) {
                graphics.fillRect(x - 16 + ((tick * 9 + scroll) % 33), y + 4, 2, 4);
            }
            graphics.lineStyle(3, COLORS.machineFrame, 1);
            graphics.lineBetween(x + 16, y + 2, x + 16, y - 12);
            graphics.fillStyle(consoleColor);
            graphics.fillRect(x + 8, y - 17, 14, 6);
            graphics.lineStyle(2, COLORS.machineFrame, 1);
            graphics.lineBetween(x + 8, y - 14, x - 2, y - 9);
        }
        else {
            const crank = clock / (ridden ? 140 : 500);
            graphics.fillStyle(COLORS.machineFrame);
            graphics.fillCircle(x - 8, y + 4, 6);
            graphics.fillStyle(COLORS.railing);
            graphics.fillCircle(x - 8, y + 4, 2);
            graphics.lineStyle(3, COLORS.machineFrame, 1);
            graphics.lineBetween(x - 8, y + 4, x + 3, y - 6);
            graphics.lineBetween(x + 3, y - 6, x + 11, y + 5);
            graphics.lineBetween(x + 11, y + 5, x + 15, y - 11);
            graphics.lineStyle(2, COLORS.machineFrame, 1);
            graphics.lineBetween(x - 10, y - 7, x - 6, y + 3);
            graphics.fillStyle(COLORS.belt);
            graphics.fillRoundedRect(x - 15, y - 10, 10, 4, 2);
            graphics.fillStyle(consoleColor);
            graphics.fillRect(x + 9, y - 16, 12, 5);
            graphics.fillStyle(COLORS.ink);
            graphics.fillCircle(x + 2 + Math.cos(crank) * 5, y + 5 + Math.sin(crank) * 5, 2);
            graphics.fillCircle(x + 2 - Math.cos(crank) * 5, y + 5 - Math.sin(crank) * 5, 2);
        }
    }

    private drawHorse(
        graphics: Phaser.GameObjects.Graphics,
        x: number,
        y: number,
        pose: HorsePose
    ): void {
        if (pose.recoveryMs > 0 && Math.floor(pose.recoveryMs / 90) % 2 === 0) return;
        const clock = pose.clockMs;
        const hop = pose.kind === 'hop';
        const gallop = pose.kind === 'gallop';
        const pedal = pose.kind === 'pedal';
        const bob = gallop
            ? Math.sin(clock / 45) * 1.5
            : pedal
                ? Math.sin(clock / 140) * 2
                : 0;
        const stride = gallop ? 7 : 0;
        const phase = clock / 90;
        const pump = Math.sin(clock / 140) * 3;
        // Riding a machine tucks the forelegs onto the pedals; a hop pulls all
        // four in; otherwise the legs stride with the gallop cycle.
        const legOffsets: readonly [number, number, number, number] = pedal
            ? [-1 + pump, 1 - pump, 6, 5]
            : hop
                ? [3, 3, 2, 2]
                : gallop
                    ? [
                        Math.sin(phase) * stride,
                        Math.sin(phase + 2.2) * stride,
                        Math.sin(phase + 3.6) * stride,
                        Math.sin(phase + 5.1) * stride
                    ]
                    : [-2, 1, -1, 2];
        drawHorse(graphics, x, y, {
            bob,
            headDip: pose.kind === 'idle' ? Math.sin(clock / 650) : 0,
            tailSway: Math.sin(clock / 400) * 2,
            legOffsets,
            tucked: hop
        });
    }

    private publishTelemetry(): void {
        const canvas = this.game.canvas;
        const snapshot = getHorsemasterRenderSnapshot(this.state);
        const ride = this.state.player.ride;
        const kind = horsemasterRowKind(this.state.player.row);
        const section = kind === 'bike'
            ? 'bikes'
            : kind === 'vehicle'
                ? 'traffic'
                : kind;
        canvas.dataset.horsemasterStatus = this.state.status;
        canvas.dataset.horsemasterRow = String(this.state.player.row);
        canvas.dataset.horsemasterRowCount = String(HORSEMASTER_ROW_COUNT);
        canvas.dataset.horsemasterSection = section;
        canvas.dataset.horsemasterLives = String(this.state.player.lives);
        canvas.dataset.horsemasterHopping = String(this.state.player.jump !== null);
        canvas.dataset.horsemasterRidingVehicle = ride?.vehicleId ?? '';
        canvas.dataset.horsemasterRidingSlot = ride === null ? '' : String(ride.slotIndex);
        canvas.dataset.horsemasterRidingMachine = snapshot.player.ridingMachine ?? '';
        canvas.dataset.horsemasterX = String(Math.round(snapshot.player.x));
        canvas.dataset.horsemasterY = String(Math.round(snapshot.player.y));
        canvas.dataset.horsemasterVehicleCount = String(this.state.vehicles.length);
        canvas.dataset.horsemasterBicycleCount = String(this.state.bicycles.length);
        canvas.dataset.horsemasterLaneCount = String(
            this.state.course.bikeLanes.length + this.state.course.vehicleLanes.length
        );
        canvas.dataset.horsemasterGymBuilding = String(this.state.course.gymIndex);
        canvas.dataset.horsemasterGymDoorX = String(
            this.state.course.buildings[this.state.course.gymIndex]!.centerX
        );
        canvas.dataset.horsemasterHelpOpen = String(this.helpOpen);
        canvas.dataset.horsemasterCourseSignature =
            canonicalHorsemasterCourseSignature(this.state.course);
    }

    private clearDatasets(): void {
        const canvas = this.game.canvas;
        delete canvas.dataset.horsemasterStatus;
        delete canvas.dataset.horsemasterRow;
        delete canvas.dataset.horsemasterRowCount;
        delete canvas.dataset.horsemasterSection;
        delete canvas.dataset.horsemasterLives;
        delete canvas.dataset.horsemasterHopping;
        delete canvas.dataset.horsemasterRidingVehicle;
        delete canvas.dataset.horsemasterRidingSlot;
        delete canvas.dataset.horsemasterRidingMachine;
        delete canvas.dataset.horsemasterX;
        delete canvas.dataset.horsemasterY;
        delete canvas.dataset.horsemasterVehicleCount;
        delete canvas.dataset.horsemasterBicycleCount;
        delete canvas.dataset.horsemasterLaneCount;
        delete canvas.dataset.horsemasterGymBuilding;
        delete canvas.dataset.horsemasterGymDoorX;
        delete canvas.dataset.horsemasterHelpOpen;
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
        const roadLanes = this.state.course.bikeLanes.length +
            this.state.course.vehicleLanes.length;
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
                roadLanes * 250
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
