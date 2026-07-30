import Phaser from 'phaser';

import {getControlDeck} from '../../app/control-deck-host';
import {CASINO_HEIST_CONTROL_SCHEME, type ControlEvent} from '../../app/control-scheme';
import type {PerformanceGrade} from '../../domain/campaign/campaign-state';
import {Mulberry32Random} from '../../domain/random/random-source';
import type {
    EncounterContext,
    EncounterResult,
    OutcomeEffect
} from '../../encounters/contracts';
import {createHelpOverlay, type HelpOverlay} from '../help-overlay';
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
    type CasinoHeistDeviceKind,
    type CasinoHeistEvent,
    type CasinoHeistPickupKind,
    type CasinoHeistRenderRoadRow,
    type CasinoHeistRenderSnapshot,
    type CasinoHeistState,
    type CasinoHeistTrafficKind
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
    warning: 0xffc046,
    ink: 0x080a12
});

/** Ordinary road users read as civilian: warm paint, lit windows, no lightbar. */
const TRAFFIC_COLORS: Readonly<Record<
    CasinoHeistTrafficKind,
    {readonly body: number; readonly glass: number}
>> = Object.freeze({
    car: {body: 0x4c7fd6, glass: 0xbfe4ff},
    motorcycle: {body: 0xd7c84c, glass: 0x2a2f38},
    truck: {body: 0xc06a3c, glass: 0xd8ecff},
    bus: {body: 0x62b56a, glass: 0xe4f6ff}
});

const PICKUP_COLORS: Readonly<Record<CasinoHeistPickupKind, number>> = Object.freeze({
    weapon: 0xa98cff,
    ammo: 0x74ef87,
    slick: 0x8f79c9,
    smoke: 0xc8d2dd,
    flame: 0xff8a2a
});

const DEVICE_LABELS: Readonly<Record<CasinoHeistDeviceKind, string>> = Object.freeze({
    'oil-slick': 'OIL SLICK',
    'smoke-screen': 'SMOKE',
    flamethrower: 'FLAME'
});

function pickupMessage(kind: CasinoHeistPickupKind, ammo: number): string {
    switch (kind) {
        case 'weapon':
            return `PULSE CANNON ONLINE · ${ammo} SHOTS`;
        case 'ammo':
            return `AMMO RECOVERED · ${ammo} SHOTS`;
        case 'slick':
            return 'OIL SLICK TANK FITTED · DEPLOY BEHIND YOU';
        case 'smoke':
            return 'SMOKE LAUNCHER FITTED · BLINDS THE CHASE';
        case 'flame':
            return 'FLAME NOZZLE FITTED · BURNS THEM OFF YOUR DOORS';
    }
}

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
    private helpOverlay: HelpOverlay | null = null;
    private helpOpen = false;
    private steerLeft = false;
    private steerRight = false;
    private throttleUp = false;
    private throttleDown = false;
    private fireHeld = false;
    private pendingDeploy = false;
    private pendingSwitch = false;
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
        const installedDevices = String(
            data.context.modifiers['heistInstalledDevices'] ?? ''
        )
            .split(',')
            .filter((device): device is CasinoHeistDeviceKind =>
                device === 'oil-slick' ||
                device === 'smoke-screen' ||
                device === 'flamethrower'
            );
        const course = createCasinoHeistCourse(
            new Mulberry32Random(data.context.seed),
            {
                segmentCount: 18 + levelTier * 2,
                bonuses: {
                    armor: hullBonus,
                    handling: Math.min(1, handlingMultiplier - 1),
                    powerupChance: 0,
                    startAmmo: 0,
                    installedDevices
                }
            }
        );
        this.state = createCasinoHeistState(course);
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
        getControlDeck(this)?.setScheme(CASINO_HEIST_CONTROL_SCHEME, this.handleControlEvent);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown);
            this.input.keyboard?.off('keyup', this.handleKeyUp);
            getControlDeck(this)?.clearScheme(CASINO_HEIST_CONTROL_SCHEME.id);
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
        const vertical = this.throttleUp === this.throttleDown
            ? 0
            : this.throttleUp ? 1 : -1;
        const result = advanceCasinoHeist(this.state, {
            steer,
            vertical,
            fire: this.fireHeld,
            deploy: this.pendingDeploy,
            switchDevice: this.pendingSwitch
        }, Math.max(0, delta));
        this.pendingDeploy = false;
        this.pendingSwitch = false;
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
            case 'arrowup':
            case 'w':
                event.preventDefault();
                this.throttleUp = true;
                break;
            case 'arrowdown':
            case 's':
                event.preventDefault();
                this.throttleDown = true;
                break;
            case ' ':
            case 'f':
            case 'enter':
                event.preventDefault();
                this.fireHeld = true;
                break;
            case 'q':
                event.preventDefault();
                this.pendingDeploy = true;
                break;
            case 'e':
                event.preventDefault();
                this.pendingSwitch = true;
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
            case 'arrowup':
            case 'w':
                this.throttleUp = false;
                break;
            case 'arrowdown':
            case 's':
                this.throttleDown = false;
                break;
            case ' ':
            case 'f':
            case 'enter':
                this.fireHeld = false;
                break;
        }
    };

    private createControls(): void {
        // Steering and Fire moved to the shared control deck.
        this.createTapButton(42, 20, 68, 'EXIT', () => this.finish('abandoned'), 0x743943);
        this.createTapButton(630, 20, 68, 'HELP', () => this.showHelp(), 0x285a68);
    }

    private readonly handleControlEvent = (event: ControlEvent): void => {
        if (this.finishing) return;
        if (this.helpOpen) {
            if (event.kind === 'button' && event.phase === 'press') this.closeHelp();
            return;
        }
        if (event.kind === 'direction') {
            const held = event.phase === 'press';
            if (event.direction === 'left') this.steerLeft = held;
            if (event.direction === 'right') this.steerRight = held;
            if (event.direction === 'up') this.throttleUp = held;
            if (event.direction === 'down') this.throttleDown = held;
            return;
        }
        if (event.kind !== 'button') return;
        if (event.id === 'fire') {
            this.fireHeld = event.phase === 'press';
            return;
        }
        if (event.phase !== 'press') return;
        if (event.id === 'deploy') this.pendingDeploy = true;
        if (event.id === 'switch') this.pendingSwitch = true;
    };

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
        this.helpOverlay = createHelpOverlay(this, {
            title: 'GETAWAY DRIVER',
            lines: [
                'You robbed the casino. Now vanish.',
                '',
                'Steer anywhere on the road. UP and DOWN',
                'close on traffic or hang back.',
                '',
                'Shoot any car. Trucks and buses take two.',
                'Police ram you — let them hit traffic.',
                '',
                'DEPLOY spends a device, SWITCH changes it.',
                '',
                'Take the marked TURN-OFF into the drain.'
            ],
            closeLabel: 'ENTER · DRIVE',
            accentColor: COLORS.casino,
            titleColor: '#ff76d2',
            bodyColor: '#f7f1da',
            panelColor: 0x090b18,
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
        this.state = setCasinoHeistPaused(this.state, false);
        this.publishTelemetry();
    }

    private handleEvents(events: readonly CasinoHeistEvent[]): void {
        for (const event of events) {
            switch (event.kind) {
                case 'pursuer-spawned':
                    this.messageText.setText('POLICE ON YOUR TAIL · THEY WILL TRY TO PUSH YOU OFF');
                    break;
                case 'helicopter-spawned':
                    this.messageText.setText('CHOPPER AHEAD · SHOOT IT DOWN OR DODGE THE SPIKES');
                    break;
                case 'spike-strip-dropped':
                    this.messageText.setText('SPIKE STRIP DOWN · IT DOES NOT COVER THE WHOLE ROAD');
                    break;
                case 'helicopter-downed':
                    this.messageText.setText('CHOPPER DOWN · NOTHING DROPPED');
                    break;
                case 'helicopter-escaped':
                    break;
                case 'pickup-collected':
                    this.messageText.setText(pickupMessage(event.pickupKind, event.ammo));
                    break;
                case 'player-fired':
                    break;
                case 'enemy-fired':
                    this.messageText.setText('WINDOW GUN · BREAK LEVEL WITH THEM');
                    break;
                case 'device-deployed':
                    this.messageText.setText(
                        `${DEVICE_LABELS[event.device]} DEPLOYED · ${event.remaining} LEFT`
                    );
                    break;
                case 'device-armed':
                    this.messageText.setText(`${DEVICE_LABELS[event.device]} ARMED`);
                    break;
                case 'pursuer-blinded':
                    this.messageText.setText('THEY CANNOT SEE YOU · THEY ARE PEELING AWAY');
                    break;
                case 'rammed':
                    this.messageText.setText('RAMMED · STEER BACK BEFORE YOU GRIND THE VERGE');
                    break;
                case 'pursuer-wrecked':
                    this.messageText.setText(
                        event.cause === 'traffic'
                            ? 'THEY PILED INTO TRAFFIC'
                            : `PURSUER WRECKED BY ${event.cause.replace('-', ' ').toUpperCase()}`
                    );
                    break;
                case 'damage':
                    this.messageText.setText(
                        `${event.source.replace('-', ' ').toUpperCase()} · ` +
                        `${event.health} HULL LEFT`
                    );
                    break;
                case 'recovered':
                    this.messageText.setText('HULL STABLE · KEEP DRIVING');
                    break;
                case 'turnoff-ahead':
                    this.messageText.setText('TURN-OFF AHEAD · LINE UP ON THE STORM DRAIN');
                    break;
                case 'traffic-spawned':
                    break;
                case 'traffic-wrecked':
                    this.messageText.setText(
                        `${event.kindLabel.toUpperCase()} WRECKED · IT IS SLIDING OFF THE ROAD`
                    );
                    break;
                case 'success':
                    this.messageText.setText(
                        `INTO THE DRAIN · $${event.credits.toLocaleString()} AND GONE`
                    );
                    break;
                case 'failure':
                    this.messageText.setText(
                        event.reason === 'missed-turnoff'
                            ? 'YOU DROVE PAST THE DRAIN · THE ROAD RAN OUT'
                            : 'GETAWAY CAR DESTROYED · THE NEXT ROAD WILL BE NEW'
                    );
                    break;
            }
        }
    }

    private syncPresentation(): void {
        this.drawWorld();
        const snapshot = getCasinoHeistRenderSnapshot(this.state);
        const progress = Phaser.Math.Clamp(
            snapshot.player.distance / this.state.course.drainDistance,
            0,
            1
        );
        const hearts = '♥'.repeat(snapshot.player.health) +
            '♡'.repeat(Math.max(0, snapshot.player.maxHealth - snapshot.player.health));
        const weapon = snapshot.player.weapon === 'none'
            ? 'UNARMED'
            : `PULSE ${snapshot.player.ammo}`;
        const armed = snapshot.player.armedDevice;
        const charges = snapshot.player.deviceCharges[armed];
        this.hudText.setText(
            `HULL ${hearts}  ${weapon}  ` +
            `${DEVICE_LABELS[armed]} ×${charges}  DRAIN ${Math.round(progress * 100)}%`
        );
        const deck = getControlDeck(this);
        deck?.setButtonState('fire', {
            disabled: snapshot.player.weapon === 'none' || snapshot.player.ammo <= 0
        });
        deck?.setButtonState('deploy', {
            label: `${DEVICE_LABELS[armed]} ×${charges}`,
            disabled: charges <= 0
        });
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
        this.drawEscapeRoute(graphics, snapshot);
        for (const hazard of snapshot.hazards) {
            this.drawHazard(graphics, x(hazard.x), hazard.y, hazard.kind, x(hazard.halfWidth));
        }
        for (const powerup of snapshot.powerups) {
            this.drawPowerup(graphics, x(powerup.x), powerup.y, powerup.kind);
        }
        for (const vehicle of snapshot.traffic) {
            this.drawTraffic(
                graphics,
                x(vehicle.x),
                vehicle.y,
                vehicle.kind,
                x(vehicle.width),
                vehicle.length,
                vehicle.wrecked,
                vehicle.damaged,
                vehicle.spin
            );
        }
        for (const pursuer of snapshot.pursuers) {
            this.drawPursuer(graphics, x(pursuer.x), pursuer.y, pursuer);
        }
        for (const helicopter of snapshot.helicopters) {
            this.drawHelicopter(graphics, x(helicopter.x), helicopter.y);
        }
        if (snapshot.player.flameMs > 0) {
            this.drawFlame(graphics, x(snapshot.player.x), snapshot.player.y);
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

    /**
     * The road is one continuous ribbon stitched from the sampled rows the model
     * hands over, so its turns, its changes of width and the medians it divides
     * around all read as smooth rather than as a chain of straight panels.
     */
    private drawRoad(
        graphics: Phaser.GameObjects.Graphics,
        snapshot: CasinoHeistRenderSnapshot
    ): void {
        const rows = snapshot.road;
        if (rows.length < 2) return;

        // Tarmac: one polygon down the left edge and back up the right.
        const outline: Phaser.Math.Vector2[] = [];
        for (const row of rows) outline.push(new Phaser.Math.Vector2(x(row.leftX), row.y));
        for (let index = rows.length - 1; index >= 0; index--) {
            const row = rows[index]!;
            outline.push(new Phaser.Math.Vector2(x(row.rightX), row.y));
        }
        graphics.fillStyle(COLORS.road);
        graphics.fillPoints(outline, true);

        // Dashed lane lines, then the solid line or median down the middle.
        graphics.lineStyle(3, COLORS.paper, 0.5);
        for (const offset of snapshot.laneMarkOffsets) {
            for (const side of [-1, 1]) {
                this.strokeRoadLine(graphics, rows, row =>
                    row.centerX + side * (row.dividerHalfWidth + offset), true);
            }
        }
        graphics.lineStyle(3, COLORS.lane, 0.75);
        this.strokeRoadLine(
            graphics,
            rows.filter(row => row.dividerHalfWidth <= 0),
            row => row.centerX,
            true
        );
        graphics.lineStyle(6, COLORS.shoulder, 0.95);
        this.strokeRoadLine(graphics, rows, row => row.leftX, false);
        this.strokeRoadLine(graphics, rows, row => row.rightX, false);
        this.drawMedian(graphics, rows);
    }

    /**
     * Draws one line following the road. Dashed lines break on world distance
     * rather than on screen position, so the dashes stream past with the road.
     */
    private strokeRoadLine(
        graphics: Phaser.GameObjects.Graphics,
        rows: readonly CasinoHeistRenderRoadRow[],
        at: (row: CasinoHeistRenderRoadRow) => number,
        dashed: boolean
    ): void {
        for (let index = 1; index < rows.length; index++) {
            const previous = rows[index - 1]!;
            const row = rows[index]!;
            if (Math.abs(previous.distance - row.distance) > 40) continue;
            if (dashed && Math.floor(row.distance / 44) % 2 !== 0) continue;
            graphics.lineBetween(x(at(previous)), previous.y, x(at(row)), row.y);
        }
    }

    /** The raised median of a split, tapering in and out with the road. */
    private drawMedian(
        graphics: Phaser.GameObjects.Graphics,
        rows: readonly CasinoHeistRenderRoadRow[]
    ): void {
        const split = rows.filter(row => row.dividerHalfWidth > 0.5);
        if (split.length < 2) return;
        const outline: Phaser.Math.Vector2[] = [];
        for (const row of split) {
            outline.push(new Phaser.Math.Vector2(x(row.centerX - row.dividerHalfWidth), row.y));
        }
        for (let index = split.length - 1; index >= 0; index--) {
            const row = split[index]!;
            outline.push(new Phaser.Math.Vector2(x(row.centerX + row.dividerHalfWidth), row.y));
        }
        graphics.fillStyle(COLORS.city);
        graphics.fillPoints(outline, true);
        graphics.lineStyle(3, COLORS.warning, 0.8);
        this.strokeRoadLine(graphics, split, row => row.centerX - row.dividerHalfWidth, false);
        this.strokeRoadLine(graphics, split, row => row.centerX + row.dividerHalfWidth, false);
        // Hazard stripes up the barrier so a median reads as solid at a glance.
        graphics.fillStyle(COLORS.paper, 0.75);
        for (const row of split) {
            if (Math.floor(row.distance / 34) % 2 !== 0) continue;
            const half = x(row.dividerHalfWidth);
            graphics.fillRect(x(row.centerX) - half, row.y - 2, half * 2, 4);
        }
    }

    /**
     * The marked turn-off and the storm drain that ends the escape. The sign
     * appears well before the mouth so the exit is never a surprise.
     */
    private drawEscapeRoute(
        graphics: Phaser.GameObjects.Graphics,
        snapshot: CasinoHeistRenderSnapshot
    ): void {
        if (!snapshot.turnoffVisible) return;
        const signY = snapshot.turnoffY;
        const drainX = x(snapshot.drainX);
        const drainHalf = x(snapshot.drainHalfWidth);
        if (signY > -60 && signY < VIEW_SIZE + 60) {
            // Chevrons on the road plus a roadside sign board.
            graphics.fillStyle(COLORS.gold, 0.85);
            for (let index = 0; index < 3; index++) {
                const chevronY = signY + index * 22;
                graphics.fillTriangle(
                    drainX, chevronY,
                    drainX - 26, chevronY + 18,
                    drainX + 26, chevronY + 18
                );
            }
            graphics.fillStyle(COLORS.ink, 0.9);
            graphics.fillRoundedRect(drainX + drainHalf + 10, signY - 26, 62, 40, 6);
            graphics.fillStyle(COLORS.gold);
            graphics.fillRoundedRect(drainX + drainHalf + 14, signY - 22, 54, 32, 5);
            graphics.fillStyle(COLORS.ink);
            graphics.fillTriangle(
                drainX + drainHalf + 26, signY - 4,
                drainX + drainHalf + 42, signY - 16,
                drainX + drainHalf + 42, signY + 6
            );
        }
        const drainY = snapshot.drainY;
        if (drainY < -140 || drainY > VIEW_SIZE + 140) return;
        // The drain mouth: a dark opening behind a heavy grate lip.
        graphics.fillStyle(COLORS.ink, 0.95);
        graphics.fillRoundedRect(drainX - drainHalf, drainY - 46, drainHalf * 2, 92, 10);
        graphics.fillStyle(0x05070c);
        graphics.fillRoundedRect(drainX - drainHalf + 8, drainY - 38, drainHalf * 2 - 16, 76, 8);
        graphics.lineStyle(4, 0x8b93a3, 0.95);
        for (let index = 0; index < 5; index++) {
            const barY = drainY - 30 + index * 16;
            graphics.lineBetween(drainX - drainHalf + 12, barY, drainX + drainHalf - 12, barY);
        }
        graphics.lineStyle(5, COLORS.cyan, 0.8);
        graphics.strokeRoundedRect(drainX - drainHalf, drainY - 46, drainHalf * 2, 92, 10);
    }

    private drawTraffic(
        graphics: Phaser.GameObjects.Graphics,
        xPosition: number,
        yPosition: number,
        kind: CasinoHeistTrafficKind,
        width: number,
        length: number,
        wrecked: boolean,
        damaged: boolean,
        spin: number
    ): void {
        const palette = TRAFFIC_COLORS[kind];
        if (wrecked) {
            this.drawWreck(graphics, xPosition, yPosition, width, length, spin, palette.body);
            return;
        }
        const body = damaged
            ? Phaser.Display.Color.ValueToColor(palette.body).darken(38).color
            : palette.body;
        graphics.fillStyle(COLORS.ink, 0.5);
        graphics.fillRoundedRect(
            xPosition - width / 2 - 3,
            yPosition - length / 2 - 3,
            width + 6,
            length + 6,
            8
        );
        graphics.fillStyle(body);
        graphics.fillRoundedRect(
            xPosition - width / 2,
            yPosition - length / 2,
            width,
            length,
            kind === 'motorcycle' ? 9 : 7
        );
        if (kind === 'motorcycle') {
            graphics.fillStyle(COLORS.ink);
            graphics.fillCircle(xPosition, yPosition - length / 2 + 8, width * 0.34);
            graphics.fillCircle(xPosition, yPosition + length / 2 - 8, width * 0.34);
            graphics.fillStyle(palette.glass);
            graphics.fillCircle(xPosition, yPosition, width * 0.3);
        } else {
            // Windows, then roof detail that separates a bus from a truck.
            graphics.fillStyle(palette.glass, 0.9);
            graphics.fillRoundedRect(
                xPosition - width / 2 + 5,
                yPosition - length / 2 + 7,
                width - 10,
                Math.min(22, length * 0.28),
                4
            );
            if (kind === 'bus') {
                graphics.fillStyle(palette.glass, 0.55);
                for (let index = 0; index < 4; index++) {
                    graphics.fillRect(
                        xPosition - width / 2 + 6,
                        yPosition - length / 2 + 34 + index * 18,
                        width - 12,
                        11
                    );
                }
            } else if (kind === 'truck') {
                graphics.fillStyle(0x8d7d63);
                graphics.fillRoundedRect(
                    xPosition - width / 2 + 4,
                    yPosition - length / 2 + 34,
                    width - 8,
                    length - 42,
                    5
                );
            }
            graphics.fillStyle(COLORS.ink);
            for (const side of [-1, 1]) {
                graphics.fillRoundedRect(
                    xPosition + side * (width / 2) - (side < 0 ? 6 : 0),
                    yPosition - length / 2 + 12,
                    6,
                    length * 0.22,
                    2
                );
                graphics.fillRoundedRect(
                    xPosition + side * (width / 2) - (side < 0 ? 6 : 0),
                    yPosition + length / 2 - length * 0.3,
                    6,
                    length * 0.22,
                    2
                );
            }
        }
    }

    /**
     * A wreck slewing off the road: the shell tumbles about its own centre while
     * the model slides it clear, trailing smoke and shedding sparks. Graphics has
     * no transform of its own here, so the body is drawn as a rotated quad.
     */
    private drawWreck(
        graphics: Phaser.GameObjects.Graphics,
        xPosition: number,
        yPosition: number,
        width: number,
        length: number,
        spin: number,
        bodyColor: number
    ): void {
        const corners = (inset: number): Phaser.Math.Vector2[] => {
            const halfWidth = width / 2 - inset;
            const halfLength = length / 2 - inset;
            const cos = Math.cos(spin);
            const sin = Math.sin(spin);
            return [
                [-halfWidth, -halfLength],
                [halfWidth, -halfLength],
                [halfWidth, halfLength],
                [-halfWidth, halfLength]
            ].map(([offsetX, offsetY]) => new Phaser.Math.Vector2(
                xPosition + offsetX! * cos - offsetY! * sin,
                yPosition + offsetX! * sin + offsetY! * cos
            ));
        };
        // Smoke pours off in the direction it is sliding.
        const drift = Math.sign(spin) || 1;
        graphics.fillStyle(0x6f7681, 0.32);
        for (let puff = 1; puff <= 3; puff++) {
            const wobble = Math.sin(this.animationClockMs / 90 + puff) * 6;
            graphics.fillCircle(
                xPosition - drift * puff * 13 + wobble,
                yPosition + puff * 9,
                8 + puff * 3
            );
        }
        graphics.fillStyle(COLORS.ink, 0.5);
        graphics.fillPoints(corners(-3), true);
        graphics.fillStyle(Phaser.Display.Color.ValueToColor(bodyColor).darken(52).color);
        graphics.fillPoints(corners(0), true);
        graphics.fillStyle(0x2a2622);
        graphics.fillPoints(corners(6), true);
        // Sparks where the bodywork is grinding along the road.
        graphics.fillStyle(COLORS.warning, 0.9);
        for (let spark = 0; spark < 3; spark++) {
            const phase = (this.animationClockMs / 40 + spark * 2.1) % 6;
            graphics.fillCircle(
                xPosition + drift * (10 + phase * 7),
                yPosition + Math.sin(phase * 2) * 12,
                Math.max(1, 3 - phase * 0.4)
            );
        }
        graphics.lineStyle(3, COLORS.danger, 0.85);
        const cross = corners(4);
        graphics.lineBetween(cross[0]!.x, cross[0]!.y, cross[2]!.x, cross[2]!.y);
        graphics.lineBetween(cross[1]!.x, cross[1]!.y, cross[3]!.x, cross[3]!.y);
    }

    private drawPursuer(
        graphics: Phaser.GameObjects.Graphics,
        xPosition: number,
        yPosition: number,
        pursuer: CasinoHeistRenderSnapshot['pursuers'][number]
    ): void {
        const swat = pursuer.kind === 'swat-van';
        const width = swat ? 48 : 42;
        const length = swat ? 88 : 72;
        if (pursuer.wrecked) {
            this.drawWreck(
                graphics,
                xPosition,
                yPosition,
                width,
                length,
                pursuer.spin,
                swat ? 0x2b3138 : 0x30363d
            );
            return;
        }
        graphics.fillStyle(COLORS.ink, 0.55);
        graphics.fillRoundedRect(
            xPosition - width / 2 - 3,
            yPosition - length / 2 - 3,
            width + 6,
            length + 6,
            10
        );
        // Black-and-white cruiser, or a slab-sided armoured van.
        graphics.fillStyle(swat ? 0x2b3138 : 0x161a1f);
        graphics.fillRoundedRect(
            xPosition - width / 2,
            yPosition - length / 2,
            width,
            length,
            swat ? 5 : 9
        );
        if (!swat) {
            graphics.fillStyle(0xe9edf2);
            graphics.fillRect(xPosition - width / 2, yPosition - 12, width, 26);
        } else {
            graphics.fillStyle(0x3f474f);
            graphics.fillRoundedRect(
                xPosition - width / 2 + 4,
                yPosition - length / 2 + 26,
                width - 8,
                length - 34,
                4
            );
            graphics.fillStyle(0x9aa3ad, 0.8);
            graphics.fillRect(xPosition - 6, yPosition - length / 2 + 32, 12, length - 46);
        }
        graphics.fillStyle(0x7fd9ff, 0.9);
        graphics.fillRoundedRect(
            xPosition - width / 2 + 6,
            yPosition - length / 2 + 8,
            width - 12,
            18,
            4
        );
        // The light bar flashes red and blue on alternate frames.
        const flash = Math.floor(this.animationClockMs / 140) % 2 === 0;
        graphics.fillStyle(flash ? COLORS.danger : 0x4d7dff);
        graphics.fillRoundedRect(xPosition - 16, yPosition - length / 2 - 8, 14, 9, 3);
        graphics.fillStyle(flash ? 0x4d7dff : COLORS.danger);
        graphics.fillRoundedRect(xPosition + 2, yPosition - length / 2 - 8, 14, 9, 3);
        if (pursuer.blinded) {
            graphics.fillStyle(0xd8d8d8, 0.55);
            graphics.fillCircle(xPosition, yPosition, width * 0.9);
        }
        if (pursuer.spinningOut) {
            graphics.lineStyle(3, COLORS.warning, 0.9);
            graphics.strokeCircle(xPosition, yPosition, width * 0.85);
        }
    }

    private drawHelicopter(
        graphics: Phaser.GameObjects.Graphics,
        xPosition: number,
        yPosition: number
    ): void {
        const spin = Math.sin(this.animationClockMs / 30);
        graphics.fillStyle(COLORS.ink, 0.35);
        graphics.fillEllipse(xPosition, yPosition + 40, 60, 16);
        graphics.fillStyle(0x1f2a33);
        graphics.fillEllipse(xPosition, yPosition, 46, 30);
        graphics.fillRect(xPosition - 6, yPosition + 8, 12, 34);
        graphics.fillStyle(0x7fd9ff, 0.9);
        graphics.fillEllipse(xPosition + 12, yPosition - 4, 18, 14);
        graphics.lineStyle(4, 0xb8c2cc, 0.95);
        graphics.lineBetween(
            xPosition - 62 * Math.abs(spin) - 8,
            yPosition - 18,
            xPosition + 62 * Math.abs(spin) + 8,
            yPosition - 18
        );
        graphics.lineBetween(xPosition - 10, yPosition + 42, xPosition + 10, yPosition + 42);
        graphics.fillStyle(COLORS.danger);
        graphics.fillCircle(xPosition, yPosition + 14, 3);
    }

    private drawHazard(
        graphics: Phaser.GameObjects.Graphics,
        xPosition: number,
        yPosition: number,
        kind: 'oil-slick' | 'spike-strip',
        halfWidth: number
    ): void {
        if (kind === 'oil-slick') {
            graphics.fillStyle(0x0b0d12, 0.85);
            graphics.fillEllipse(xPosition, yPosition, halfWidth * 2, 34);
            graphics.fillStyle(0x3d2f5c, 0.7);
            graphics.fillEllipse(xPosition - 6, yPosition - 4, halfWidth, 16);
            return;
        }
        graphics.fillStyle(0x2c3138);
        graphics.fillRect(xPosition - halfWidth, yPosition - 7, halfWidth * 2, 14);
        graphics.fillStyle(0xd9dee5);
        for (let spike = -halfWidth + 6; spike < halfWidth - 4; spike += 12) {
            graphics.fillTriangle(
                xPosition + spike,
                yPosition - 7,
                xPosition + spike + 5,
                yPosition - 18,
                xPosition + spike + 10,
                yPosition - 7
            );
        }
    }

    /** The side flamethrower's cone, drawn while the burner is live. */
    private drawFlame(
        graphics: Phaser.GameObjects.Graphics,
        xPosition: number,
        yPosition: number
    ): void {
        const flicker = 1 + Math.sin(this.animationClockMs / 40) * 0.15;
        for (const side of [-1, 1]) {
            graphics.fillStyle(0xff8a2a, 0.55);
            graphics.fillTriangle(
                xPosition + side * 18, yPosition - 6,
                xPosition + side * 96 * flicker, yPosition - 34,
                xPosition + side * 96 * flicker, yPosition + 26
            );
            graphics.fillStyle(0xffe08a, 0.6);
            graphics.fillTriangle(
                xPosition + side * 18, yPosition - 2,
                xPosition + side * 58 * flicker, yPosition - 16,
                xPosition + side * 58 * flicker, yPosition + 14
            );
        }
    }

    private drawPowerup(
        graphics: Phaser.GameObjects.Graphics,
        xPosition: number,
        yPosition: number,
        kind: CasinoHeistPickupKind
    ): void {
        const pulse = 1 + Math.sin(this.animationClockMs / 130) * 0.12;
        const color = PICKUP_COLORS[kind];
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
        } else if (kind === 'ammo') {
            graphics.fillRect(xPosition - 10, yPosition - 12, 7, 24);
            graphics.fillRect(xPosition + 3, yPosition - 12, 7, 24);
            graphics.fillStyle(COLORS.ink);
            graphics.fillRect(xPosition - 8, yPosition - 9, 3, 16);
            graphics.fillRect(xPosition + 5, yPosition - 9, 3, 16);
        } else if (kind === 'slick') {
            graphics.fillEllipse(xPosition, yPosition + 4, 26, 12);
            graphics.fillRoundedRect(xPosition - 7, yPosition - 13, 14, 14, 3);
        } else if (kind === 'smoke') {
            graphics.fillCircle(xPosition - 6, yPosition + 2, 8);
            graphics.fillCircle(xPosition + 5, yPosition - 3, 7);
            graphics.fillCircle(xPosition + 2, yPosition + 8, 5);
        } else {
            graphics.fillTriangle(
                xPosition - 12, yPosition + 12,
                xPosition, yPosition - 14,
                xPosition + 12, yPosition + 12
            );
            graphics.fillStyle(COLORS.paper);
            graphics.fillTriangle(
                xPosition - 5, yPosition + 10,
                xPosition, yPosition - 2,
                xPosition + 5, yPosition + 10
            );
        }
    }

    /** The player's getaway car, with its gun turret when one is fitted. */
    private drawCar(
        graphics: Phaser.GameObjects.Graphics,
        xPosition: number,
        yPosition: number,
        armed: boolean
    ): void {
        const color = 0xe6424e;
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
        if (armed) {
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
            snapshot.player.distance / this.state.course.drainDistance,
            0,
            1
        );
        const nearestPowerup = [...snapshot.powerups]
            .filter(powerup => powerup.y < snapshot.player.y + 40)
            .sort((left, right) => right.y - left.y)[0];
        canvas.dataset.heistStatus = snapshot.status;
        canvas.dataset.heistTerminalReason = this.state.terminalReason ?? '';
        canvas.dataset.heistHealth = String(snapshot.player.health);
        canvas.dataset.heistMaxHealth = String(snapshot.player.maxHealth);
        canvas.dataset.heistWeapon = snapshot.player.weapon;
        canvas.dataset.heistAmmo = String(snapshot.player.ammo);
        canvas.dataset.heistArmedDevice = snapshot.player.armedDevice;
        canvas.dataset.heistDeviceCharges = [
            `oil-slick:${snapshot.player.deviceCharges['oil-slick']}`,
            `smoke-screen:${snapshot.player.deviceCharges['smoke-screen']}`,
            `flamethrower:${snapshot.player.deviceCharges.flamethrower}`
        ].join(',');
        canvas.dataset.heistX = String(Math.round(snapshot.player.x));
        canvas.dataset.heistScreenY = String(Math.round(snapshot.player.y));
        canvas.dataset.heistDistance = String(Math.round(snapshot.player.distance));
        canvas.dataset.heistProgress = progress.toFixed(4);
        canvas.dataset.heistPowerupsCollected = String(this.state.telemetry.powerupsCollected);
        canvas.dataset.heistShotsFired = String(this.state.telemetry.shotsFired);
        canvas.dataset.heistPursuersDestroyed =
            String(this.state.telemetry.pursuersDestroyed);
        canvas.dataset.heistPursuersWrecked = String(this.state.telemetry.pursuersWrecked);
        canvas.dataset.heistTrafficWrecked = String(this.state.telemetry.trafficWrecked);
        canvas.dataset.heistHelicoptersDowned =
            String(this.state.telemetry.helicoptersDowned);
        canvas.dataset.heistDevicesUsed = String(this.state.telemetry.devicesUsed);
        canvas.dataset.heistEnemyShots = String(this.state.telemetry.enemyShotsFired);
        canvas.dataset.heistActivePursuers = String(snapshot.pursuers.length);
        canvas.dataset.heistActiveTraffic = String(snapshot.traffic.length);
        canvas.dataset.heistActiveHelicopters = String(snapshot.helicopters.length);
        canvas.dataset.heistTurnoffVisible = String(snapshot.turnoffVisible);
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
        delete canvas.dataset.heistTerminalReason;
        delete canvas.dataset.heistHealth;
        delete canvas.dataset.heistMaxHealth;
        delete canvas.dataset.heistWeapon;
        delete canvas.dataset.heistAmmo;
        delete canvas.dataset.heistArmedDevice;
        delete canvas.dataset.heistDeviceCharges;
        delete canvas.dataset.heistX;
        delete canvas.dataset.heistScreenY;
        delete canvas.dataset.heistDistance;
        delete canvas.dataset.heistProgress;
        delete canvas.dataset.heistPowerupsCollected;
        delete canvas.dataset.heistShotsFired;
        delete canvas.dataset.heistPursuersDestroyed;
        delete canvas.dataset.heistPursuersWrecked;
        delete canvas.dataset.heistHelicoptersDowned;
        delete canvas.dataset.heistDevicesUsed;
        delete canvas.dataset.heistEnemyShots;
        delete canvas.dataset.heistActivePursuers;
        delete canvas.dataset.heistActiveTraffic;
        delete canvas.dataset.heistActiveHelicopters;
        delete canvas.dataset.heistTurnoffVisible;
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
                this.state.telemetry.pursuersDestroyed * 750 +
                this.state.telemetry.pursuersWrecked * 500 +
                this.state.telemetry.helicoptersDowned * 1_200 -
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
