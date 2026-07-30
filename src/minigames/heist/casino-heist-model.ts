import {
    randomInteger,
    type RandomSource
} from '../../domain/random/random-source';

export const CASINO_HEIST_WORLD_WIDTH = 720;
export const CASINO_HEIST_WORLD_HEIGHT = 672;
export const CASINO_HEIST_FIXED_STEP_MS = 20;
export const CASINO_HEIST_REWARD_CREDITS = 1_000;
/**
 * A getaway car has to survive a long chase in which police deliberately shove
 * it into things, so it carries more hull than a single mistake's worth.
 */
export const CASINO_HEIST_BASE_HEALTH = 5;
/** How long the car may grind the verge before the bodywork gives out. */
const EDGE_GRIND_TOLERANCE_MS = 420;
export const CASINO_HEIST_RECOVERY_MS = 900;
export const CASINO_HEIST_PLAYER_SPEED = 210;
export const CASINO_HEIST_SEGMENT_LENGTH = 320;
/**
 * One lane, wide enough for the widest vehicle on the road plus room to sit in
 * it without touching the paint on either side.
 */
export const CASINO_HEIST_LANE_WIDTH = 72;
/** The default carriageway takes six vehicles abreast. */
export const CASINO_HEIST_LANE_COUNT = 6;
export const CASINO_HEIST_ROAD_WIDTH = CASINO_HEIST_LANE_WIDTH * CASINO_HEIST_LANE_COUNT;
/**
 * The road breathes between roughly five and seven lanes of tarmac. Both bounds
 * are derived rather than tuned so the world always contains the widest road the
 * waves below can produce.
 */
export const CASINO_HEIST_MIN_ROAD_WIDTH = CASINO_HEIST_ROAD_WIDTH - 56;
export const CASINO_HEIST_MAX_ROAD_WIDTH = CASINO_HEIST_ROAD_WIDTH + 56;
/** Resting screen row for the player's car, and the centre of its travel band. */
export const CASINO_HEIST_PLAYER_SCREEN_Y = 510;
/** How far up and down the screen the car may be driven. */
export const CASINO_HEIST_PLAYER_MIN_SCREEN_Y = 300;
export const CASINO_HEIST_PLAYER_MAX_SCREEN_Y = 600;
export const CASINO_HEIST_MAX_AMMO = 30;
/** Distance before the drain at which the turn-off sign becomes visible. */
export const CASINO_HEIST_TURNOFF_LEAD = 640;
/**
 * Half-width of the drain mouth. It is a big municipal storm drain, and a late
 * police ram must not be able to make an otherwise clean run unwinnable, so the
 * mouth is generous while still demanding real alignment on a 420-wide road.
 */
export const CASINO_HEIST_DRAIN_HALF_WIDTH = 110;

const PLAYER_HALF_WIDTH = 17;
const PLAYER_HALF_LENGTH = 29;
const PURSUER_HALF_WIDTH = 21;
const PURSUER_HALF_LENGTH = 33;
const BASE_STEERING_ACCELERATION = 1_400;
const BASE_LATERAL_SPEED = 260;
const VERTICAL_SPEED = 190;
const PLAYER_FIRE_COOLDOWN_TICKS = 8;
const PROJECTILE_HALF_LENGTH = 7;
const DIVIDER_HALF_WIDTH = 24;
/** Tarmac kept clear of the verge so a lane centre is never on the gravel. */
const VERGE_INSET = 14;
/**
 * How far the road may wander from the middle of the world. Derived from the
 * widest footprint the road can reach — the widest tarmac plus both dividers —
 * so the centreline waves below never have to be clipped, which is what used to
 * put visible corners in the edges of the road.
 */
const MAX_ROAD_FOOTPRINT = CASINO_HEIST_MAX_ROAD_WIDTH + DIVIDER_HALF_WIDTH * 2;
const MAX_CENTER_DRIFT =
    CASINO_HEIST_WORLD_WIDTH / 2 - MAX_ROAD_FOOTPRINT / 2 - 8;
const SMOKE_BLIND_MS = 3_600;
const FLAME_RANGE = 120;
const FLAME_ACTIVE_MS = 700;
const SLICK_LIFETIME_MS = 9_000;
const SLICK_HALF_WIDTH = 34;
const SPIKE_STRIP_LIFETIME_MS = 12_000;
/** Vehicles within this distance of each other are met as one wall of traffic. */
const TRAFFIC_BAND_DISTANCE = 150;
/**
 * Lanes that must stay open in any one band of traffic. Half the road is a lot of
 * clear tarmac, but traffic from neighbouring stretches drifts together as the
 * faster vehicles pull away, and the gap has to survive that.
 */
const MINIMUM_OPEN_LANES = 3;
/** Sampling step for the road ribbon handed to the renderer. */
const ROAD_SAMPLE_DISTANCE = 16;
/** How long a wreck has to get itself off the road before it is gone. */
const WRECK_SLIDE_MS = 2_600;
const WRECK_DRIFT_SPEED = 230;
const WRECK_SPIN_RATE = 5.6;
/**
 * Where the painted lines between lanes sit, measured out from the inner edge of
 * a carriageway. The outermost boundary is the verge, which is drawn separately.
 */
const LANE_MARK_OFFSETS: readonly number[] = Object.freeze(
    Array.from(
        {length: CASINO_HEIST_LANE_COUNT / 2 - 1},
        (_unused, index) => (index + 1) * CASINO_HEIST_LANE_WIDTH
    )
);

export type CasinoHeistStatus = 'active' | 'success' | 'failure';
export type CasinoHeistTerminalReason =
    | 'drain-reached'
    | 'car-destroyed'
    | 'missed-turnoff'
    | null;
/**
 * Lanes are numbered outward from the centreline with no lane sitting on it, so
 * the middle of the road is always either a painted line or, where the road
 * splits, a median. Negative lanes are left of the centreline.
 */
export type CasinoHeistLane = -3 | -2 | -1 | 1 | 2 | 3;
/** Ordinary road users. Every one of them is slower than the getaway car. */
export type CasinoHeistTrafficKind = 'car' | 'bus' | 'truck' | 'motorcycle';
export type CasinoHeistPursuerKind = 'cop-car' | 'swat-van';
export type CasinoHeistPickupKind = 'weapon' | 'ammo' | 'slick' | 'smoke' | 'flame';
export type CasinoHeistDeviceKind = 'oil-slick' | 'smoke-screen' | 'flamethrower';
export type CasinoHeistWeapon = 'none' | 'pulse-cannon';
export type CasinoHeistProjectileAllegiance = 'player' | 'enemy';
export type CasinoHeistDamageSource =
    | 'traffic'
    | 'divider'
    | 'spike-strip'
    | 'enemy-shot'
    | 'ram'
    | 'road-edge';

export const CASINO_HEIST_DEVICE_KINDS: readonly CasinoHeistDeviceKind[] = Object.freeze([
    'oil-slick',
    'smoke-screen',
    'flamethrower'
]);

export interface CasinoHeistItemBonuses {
    /** Extra points of hull supplied by maze items. */
    readonly armor: number;
    /** A normalized 0..1 bonus to steering acceleration and top lateral speed. */
    readonly handling: number;
    /** An additive 0..1 chance for optional road pickups. */
    readonly powerupChance: number;
    /** Ammo (and therefore a weapon) supplied at the start of the getaway. */
    readonly startAmmo: number;
    /** Devices already fitted to the car, from shop purchases. */
    readonly installedDevices: readonly CasinoHeistDeviceKind[];
}

export interface CasinoHeistGenerationConfig {
    readonly segmentCount?: number;
    readonly bonuses?: Partial<CasinoHeistItemBonuses>;
}

export interface CasinoHeistTrafficDefinition {
    readonly id: string;
    readonly kind: CasinoHeistTrafficKind;
    readonly lane: CasinoHeistLane;
    readonly distance: number;
    readonly speed: number;
    readonly width: number;
    readonly length: number;
    /** Shots needed to wreck it: one for a car or bike, two for a truck or bus. */
    readonly health: number;
}

export interface CasinoHeistPickupDefinition {
    readonly id: string;
    readonly kind: CasinoHeistPickupKind;
    readonly x: number;
    readonly distance: number;
    readonly ammo: number;
}

export interface CasinoHeistPursuerDefinition {
    readonly id: string;
    readonly kind: CasinoHeistPursuerKind;
    readonly lane: CasinoHeistLane;
    readonly triggerDistance: number;
    readonly spawnGap: number;
    readonly speed: number;
    readonly fireIntervalTicks: number;
    readonly fireDelayTicks: number;
    readonly health: number;
    readonly colorIndex: number;
}

export interface CasinoHeistHelicopterDefinition {
    readonly id: string;
    readonly triggerDistance: number;
    /** Distance ahead of the player where the aircraft holds station. */
    readonly leadDistance: number;
    /** Ticks it hovers before releasing the spike strip. */
    readonly dropDelayTicks: number;
    /** Lane the strip covers; it never spans the whole road. */
    readonly stripLane: CasinoHeistLane;
    readonly stripHalfWidth: number;
    readonly health: number;
}

export interface CasinoHeistRoadSegment {
    readonly index: number;
    readonly startDistance: number;
    readonly endDistance: number;
    readonly safeLane: CasinoHeistLane;
    readonly traffic: readonly CasinoHeistTrafficDefinition[];
    readonly pickups: readonly CasinoHeistPickupDefinition[];
    readonly pursuers: readonly CasinoHeistPursuerDefinition[];
    readonly helicopters: readonly CasinoHeistHelicopterDefinition[];
}

/**
 * One smooth term of the road's shape. Describing the road as a sum of long
 * sine waves rather than a point per segment is what removes the corners: the
 * centreline and the width are continuous and so are their slopes, at every
 * distance and not merely at the joins.
 */
export interface CasinoHeistRoadWave {
    readonly amplitude: number;
    readonly wavelength: number;
    readonly phase: number;
}

/** A stretch where the road divides around a median the driver may pass either side of. */
export interface CasinoHeistRoadSplit {
    readonly startDistance: number;
    readonly endDistance: number;
    /** Distance over which the median grows from nothing to its full width. */
    readonly taperDistance: number;
}

export interface CasinoHeistRoadShape {
    /** Lateral centre of the corridor the road weaves inside. */
    readonly baseCenterX: number;
    readonly baseWidth: number;
    readonly centerWaves: readonly CasinoHeistRoadWave[];
    readonly widthWaves: readonly CasinoHeistRoadWave[];
    readonly splits: readonly CasinoHeistRoadSplit[];
    readonly segmentCount: number;
}

export interface CasinoHeistCourse {
    readonly generatorId: 'casino-heist-escape-v2';
    readonly width: number;
    readonly segmentLength: number;
    /** Nominal width of the tarmac; the road itself breathes around it. */
    readonly roadWidth: number;
    readonly shape: CasinoHeistRoadShape;
    /** Distance at which the marked turn-off leaves the road. */
    readonly turnoffDistance: number;
    /** Distance of the drain mouth itself, just past the turn-off sign. */
    readonly drainDistance: number;
    /** Road-relative lane the drain sits in. */
    readonly drainLane: CasinoHeistLane;
    /** Overshooting this far past the drain loses the escape. */
    readonly overshootDistance: number;
    readonly startingHealth: number;
    readonly bonuses: CasinoHeistItemBonuses;
    readonly segments: readonly CasinoHeistRoadSegment[];
}

export interface CasinoHeistPlayerState {
    readonly previousX: number;
    readonly x: number;
    readonly previousDistance: number;
    readonly distance: number;
    /** Screen row, which also decides how quickly the car closes on traffic. */
    readonly screenY: number;
    readonly lateralVelocity: number;
    readonly health: number;
    readonly maxHealth: number;
    readonly recoveryMs: number;
    readonly weapon: CasinoHeistWeapon;
    readonly ammo: number;
    readonly fireCooldownTicks: number;
    readonly devices: Readonly<Record<CasinoHeistDeviceKind, number>>;
    readonly armedDevice: CasinoHeistDeviceKind;
    readonly flameMs: number;
    readonly spinOutMs: number;
    /** Continuous time spent scraping the verge, before panels give out. */
    readonly edgeGrindMs: number;
}

export interface CasinoHeistTrafficState {
    readonly definitionId: string;
    readonly previousX: number;
    readonly x: number;
    readonly previousDistance: number;
    readonly distance: number;
    readonly health: number;
    readonly wrecked: boolean;
    readonly wreckMs: number;
    /** Lateral speed a wreck slides off the road at; zero while it is driving. */
    readonly driftX: number;
    /** Accumulated rotation of a wreck, in radians. */
    readonly spin: number;
}

export interface CasinoHeistPursuerState {
    readonly definitionId: string;
    readonly previousX: number;
    readonly x: number;
    readonly previousDistance: number;
    readonly distance: number;
    readonly health: number;
    readonly fireCooldownTicks: number;
    readonly contactCooldownMs: number;
    /** Remaining blindness from a smoke screen; a blinded car peels away. */
    readonly blindedMs: number;
    readonly spinOutMs: number;
    /** How long a wreck stays on screen sliding off the road. */
    readonly wreckMs: number;
    readonly driftX: number;
    readonly spin: number;
}

export interface CasinoHeistHelicopterState {
    readonly definitionId: string;
    readonly x: number;
    readonly distance: number;
    readonly health: number;
    readonly hoverTicks: number;
    readonly dropped: boolean;
    readonly leaving: boolean;
}

export interface CasinoHeistHazardState {
    readonly id: string;
    readonly kind: 'oil-slick' | 'spike-strip';
    readonly x: number;
    readonly halfWidth: number;
    readonly distance: number;
    readonly remainingMs: number;
}

export interface CasinoHeistProjectileState {
    readonly id: string;
    readonly allegiance: CasinoHeistProjectileAllegiance;
    readonly sourceId: string;
    readonly x: number;
    readonly previousDistance: number;
    readonly distance: number;
    /** Positive means the projectile travels away from the casino. */
    readonly forwardVelocity: number;
    /** Non-zero for the side guns that fire out of a rolled-down window. */
    readonly lateralVelocity: number;
    readonly damage: number;
}

export interface CasinoHeistTelemetry {
    readonly powerupsCollected: number;
    readonly ammoCollected: number;
    readonly shotsFired: number;
    readonly enemyShotsFired: number;
    readonly pursuersDestroyed: number;
    readonly pursuersWrecked: number;
    readonly trafficWrecked: number;
    readonly helicoptersDowned: number;
    readonly devicesUsed: number;
    readonly collisions: number;
    readonly hitsTaken: number;
    readonly damageTaken: number;
}

export interface CasinoHeistState {
    readonly course: CasinoHeistCourse;
    readonly player: CasinoHeistPlayerState;
    readonly traffic: readonly CasinoHeistTrafficState[];
    readonly pursuers: readonly CasinoHeistPursuerState[];
    readonly helicopters: readonly CasinoHeistHelicopterState[];
    readonly hazards: readonly CasinoHeistHazardState[];
    readonly projectiles: readonly CasinoHeistProjectileState[];
    readonly spawnedTrafficIds: readonly string[];
    readonly collectedPickupIds: readonly string[];
    readonly spawnedPursuerIds: readonly string[];
    readonly spawnedHelicopterIds: readonly string[];
    readonly activeTicks: number;
    readonly accumulatorMs: number;
    readonly paused: boolean;
    readonly status: CasinoHeistStatus;
    readonly terminalReason: CasinoHeistTerminalReason;
    readonly creditsStolen: number;
    readonly nextProjectileId: number;
    readonly nextHazardId: number;
    readonly telemetry: CasinoHeistTelemetry;
}

export interface CasinoHeistInput {
    /** Continuous steering in the inclusive range -1..1. */
    readonly steer: number;
    /** Continuous throttle in -1..1; negative drops back down the screen. */
    readonly vertical: number;
    /** A level-triggered fire control; the model applies its own cadence. */
    readonly fire: boolean;
    /** Deploys the armed device once per press. */
    readonly deploy: boolean;
    /** Arms the next stocked device. */
    readonly switchDevice: boolean;
}

export const NEUTRAL_CASINO_HEIST_INPUT: CasinoHeistInput = Object.freeze({
    steer: 0,
    vertical: 0,
    fire: false,
    deploy: false,
    switchDevice: false
});

export type CasinoHeistEvent =
    | {readonly kind: 'traffic-spawned'; readonly tick: number; readonly trafficId: string}
    | {readonly kind: 'pursuer-spawned'; readonly tick: number; readonly pursuerId: string}
    | {
        readonly kind: 'helicopter-spawned';
        readonly tick: number;
        readonly helicopterId: string;
    }
    | {
        readonly kind: 'spike-strip-dropped';
        readonly tick: number;
        readonly helicopterId: string;
        readonly hazardId: string;
    }
    | {readonly kind: 'helicopter-downed'; readonly tick: number; readonly helicopterId: string}
    | {readonly kind: 'helicopter-escaped'; readonly tick: number; readonly helicopterId: string}
    | {
        readonly kind: 'pickup-collected';
        readonly tick: number;
        readonly pickupId: string;
        readonly pickupKind: CasinoHeistPickupKind;
        readonly ammo: number;
        readonly weapon: CasinoHeistWeapon;
    }
    | {
        readonly kind: 'player-fired';
        readonly tick: number;
        readonly projectileId: string;
        readonly ammo: number;
    }
    | {
        readonly kind: 'enemy-fired';
        readonly tick: number;
        readonly pursuerId: string;
        readonly projectileId: string;
    }
    | {
        readonly kind: 'device-deployed';
        readonly tick: number;
        readonly device: CasinoHeistDeviceKind;
        readonly remaining: number;
    }
    | {
        readonly kind: 'device-armed';
        readonly tick: number;
        readonly device: CasinoHeistDeviceKind;
    }
    | {
        readonly kind: 'pursuer-blinded';
        readonly tick: number;
        readonly pursuerId: string;
    }
    | {
        readonly kind: 'rammed';
        readonly tick: number;
        readonly pursuerId: string;
        /** Signed lateral shove applied to the player's car. */
        readonly push: number;
    }
    | {
        readonly kind: 'pursuer-wrecked';
        readonly tick: number;
        readonly pursuerId: string;
        readonly cause: 'traffic' | 'oil-slick' | 'flamethrower' | 'gunfire';
    }
    | {
        readonly kind: 'traffic-wrecked';
        readonly tick: number;
        readonly trafficId: string;
        readonly kindLabel: CasinoHeistTrafficKind;
    }
    | {
        readonly kind: 'damage';
        readonly tick: number;
        readonly source: CasinoHeistDamageSource;
        readonly sourceId: string | null;
        readonly amount: number;
        readonly health: number;
    }
    | {readonly kind: 'recovered'; readonly tick: number}
    | {readonly kind: 'turnoff-ahead'; readonly tick: number}
    | {readonly kind: 'success'; readonly tick: number; readonly credits: number}
    | {
        readonly kind: 'failure';
        readonly tick: number;
        readonly reason: 'car-destroyed' | 'missed-turnoff';
    };

export interface CasinoHeistStepResult {
    readonly state: CasinoHeistState;
    readonly events: readonly CasinoHeistEvent[];
}

export interface CasinoHeistValidationResult {
    readonly valid: boolean;
    readonly errors: readonly string[];
}

export interface CasinoHeistRoadGeometry {
    readonly centerX: number;
    /** Width of tarmac, not counting a median. */
    readonly width: number;
    /** Outer edges of the road, median included in the span between them. */
    readonly leftX: number;
    readonly rightX: number;
    /** Zero unless the road is split here; the median spans ±this of centreX. */
    readonly dividerHalfWidth: number;
    readonly split: boolean;
    readonly segmentIndex: number;
}

/**
 * One sampled row of road. The renderer stitches these into a single smooth
 * ribbon, so the road's shape is limited by the sampling step rather than by the
 * length of a segment.
 */
export interface CasinoHeistRenderRoadRow {
    readonly distance: number;
    readonly y: number;
    readonly centerX: number;
    readonly leftX: number;
    readonly rightX: number;
    readonly dividerHalfWidth: number;
}

export interface CasinoHeistRenderEntity {
    readonly id: string;
    readonly x: number;
    readonly y: number;
}

export interface CasinoHeistRenderSnapshot {
    readonly interpolation: number;
    readonly road: readonly CasinoHeistRenderRoadRow[];
    /** Lane-boundary offsets from a carriageway's inner edge, for road markings. */
    readonly laneMarkOffsets: readonly number[];
    readonly player: {
        readonly x: number;
        readonly y: number;
        readonly distance: number;
        readonly health: number;
        readonly maxHealth: number;
        readonly recoveryMs: number;
        readonly weapon: CasinoHeistWeapon;
        readonly ammo: number;
        readonly armedDevice: CasinoHeistDeviceKind;
        readonly deviceCharges: Readonly<Record<CasinoHeistDeviceKind, number>>;
        readonly flameMs: number;
        readonly spinOutMs: number;
    };
    readonly traffic: readonly (CasinoHeistRenderEntity & {
        readonly kind: CasinoHeistTrafficKind;
        readonly width: number;
        readonly length: number;
        readonly wrecked: boolean;
        /** Shot at least once but still driving. */
        readonly damaged: boolean;
        /** Rotation in radians; non-zero only while a wreck slews off the road. */
        readonly spin: number;
    })[];
    readonly powerups: readonly (CasinoHeistRenderEntity & {
        readonly kind: CasinoHeistPickupKind;
        readonly ammo: number;
    })[];
    readonly pursuers: readonly (CasinoHeistRenderEntity & {
        readonly kind: CasinoHeistPursuerKind;
        readonly health: number;
        readonly colorIndex: number;
        readonly blinded: boolean;
        readonly spinningOut: boolean;
        readonly wrecked: boolean;
        readonly spin: number;
    })[];
    readonly helicopters: readonly (CasinoHeistRenderEntity & {
        readonly health: number;
        readonly dropped: boolean;
        readonly leaving: boolean;
    })[];
    readonly hazards: readonly (CasinoHeistRenderEntity & {
        readonly kind: CasinoHeistHazardState['kind'];
        readonly halfWidth: number;
    })[];
    readonly projectiles: readonly (CasinoHeistRenderEntity & {
        readonly allegiance: CasinoHeistProjectileAllegiance;
    })[];
    readonly turnoffY: number;
    readonly drainY: number;
    readonly drainX: number;
    readonly drainHalfWidth: number;
    readonly turnoffVisible: boolean;
    readonly status: CasinoHeistStatus;
    readonly creditsStolen: number;
}

export interface CasinoHeistWitnessResult {
    readonly success: boolean;
    readonly ticks: number;
    readonly state: CasinoHeistState;
}

interface MutablePlayerState {
    previousX: number;
    x: number;
    previousDistance: number;
    distance: number;
    screenY: number;
    lateralVelocity: number;
    health: number;
    maxHealth: number;
    recoveryMs: number;
    weapon: CasinoHeistWeapon;
    ammo: number;
    fireCooldownTicks: number;
    devices: Record<CasinoHeistDeviceKind, number>;
    armedDevice: CasinoHeistDeviceKind;
    flameMs: number;
    spinOutMs: number;
    edgeGrindMs: number;
}

interface MutableTrafficState {
    definitionId: string;
    previousX: number;
    x: number;
    previousDistance: number;
    distance: number;
    health: number;
    wrecked: boolean;
    wreckMs: number;
    driftX: number;
    spin: number;
}

interface MutablePursuerState {
    definitionId: string;
    previousX: number;
    x: number;
    previousDistance: number;
    distance: number;
    health: number;
    fireCooldownTicks: number;
    contactCooldownMs: number;
    blindedMs: number;
    spinOutMs: number;
    wreckMs: number;
    driftX: number;
    spin: number;
}

interface MutableHelicopterState {
    definitionId: string;
    x: number;
    distance: number;
    health: number;
    hoverTicks: number;
    dropped: boolean;
    leaving: boolean;
}

interface MutableHazardState {
    id: string;
    kind: 'oil-slick' | 'spike-strip';
    x: number;
    halfWidth: number;
    distance: number;
    remainingMs: number;
}

interface MutableProjectileState {
    id: string;
    allegiance: CasinoHeistProjectileAllegiance;
    sourceId: string;
    x: number;
    previousDistance: number;
    distance: number;
    forwardVelocity: number;
    lateralVelocity: number;
    damage: number;
}

interface MutableTelemetry {
    powerupsCollected: number;
    ammoCollected: number;
    shotsFired: number;
    enemyShotsFired: number;
    pursuersDestroyed: number;
    pursuersWrecked: number;
    trafficWrecked: number;
    helicoptersDowned: number;
    devicesUsed: number;
    collisions: number;
    hitsTaken: number;
    damageTaken: number;
}

interface MutableCasinoHeistState {
    course: CasinoHeistCourse;
    player: MutablePlayerState;
    traffic: MutableTrafficState[];
    pursuers: MutablePursuerState[];
    helicopters: MutableHelicopterState[];
    hazards: MutableHazardState[];
    projectiles: MutableProjectileState[];
    spawnedTrafficIds: string[];
    collectedPickupIds: string[];
    spawnedPursuerIds: string[];
    spawnedHelicopterIds: string[];
    activeTicks: number;
    accumulatorMs: number;
    paused: boolean;
    status: CasinoHeistStatus;
    terminalReason: CasinoHeistTerminalReason;
    creditsStolen: number;
    nextProjectileId: number;
    nextHazardId: number;
    announcedTurnoff: boolean;
    telemetry: MutableTelemetry;
}

export const CASINO_HEIST_LANES: readonly CasinoHeistLane[] =
    Object.freeze([-3, -2, -1, 1, 2, 3]);

/** Bigger bodywork soaks up more gunfire before it wrecks. */
const TRAFFIC_SHAPES: Readonly<Record<CasinoHeistTrafficKind, {
    readonly width: number;
    readonly length: number;
    readonly speed: number;
    readonly health: number;
}>> = Object.freeze({
    motorcycle: {width: 24, length: 46, speed: 150, health: 1},
    car: {width: 40, length: 62, speed: 130, health: 1},
    truck: {width: 52, length: 96, speed: 105, health: 2},
    bus: {width: 56, length: 124, speed: 92, health: 2}
});

const PURSUER_SHAPES: Readonly<Record<CasinoHeistPursuerKind, {
    readonly health: number;
    readonly speed: number;
    readonly shoots: boolean;
    readonly ramPush: number;
}>> = Object.freeze({
    'cop-car': {health: 2, speed: 262, shoots: true, ramPush: 46},
    'swat-van': {health: 4, speed: 238, shoots: false, ramPush: 74}
});

const PICKUP_DEVICE: Readonly<Record<string, CasinoHeistDeviceKind>> = Object.freeze({
    slick: 'oil-slick',
    smoke: 'smoke-screen',
    flame: 'flamethrower'
});

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function chooseLane(random: RandomSource, lanes: readonly CasinoHeistLane[]): CasinoHeistLane {
    if (lanes.length === 0) throw new Error('Casino Heist lane choice requires candidates.');
    return lanes[randomInteger(random, lanes.length)]!;
}

function resolveBonuses(
    bonuses: Partial<CasinoHeistItemBonuses> | undefined
): CasinoHeistItemBonuses {
    const armor = Math.max(0, Math.trunc(bonuses?.armor ?? 0));
    const handling = clamp(bonuses?.handling ?? 0, 0, 1);
    const powerupChance = clamp(bonuses?.powerupChance ?? 0, 0, 1);
    const startAmmo = Math.max(0, Math.trunc(bonuses?.startAmmo ?? 0));
    const installedDevices = Object.freeze(
        CASINO_HEIST_DEVICE_KINDS.filter(device =>
            bonuses?.installedDevices?.includes(device) === true
        )
    );
    return Object.freeze({armor, handling, powerupChance, startAmmo, installedDevices});
}

function waveSum(waves: readonly CasinoHeistRoadWave[], distance: number): number {
    let total = 0;
    for (const wave of waves) {
        total += wave.amplitude *
            Math.sin((distance / wave.wavelength) * Math.PI * 2 + wave.phase);
    }
    return total;
}

function smoothstep(value: number): number {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
}

/** How wide the median is at this distance; zero everywhere outside a split. */
function dividerHalfWidthAt(shape: CasinoHeistRoadShape, distance: number): number {
    for (const split of shape.splits) {
        if (distance <= split.startDistance || distance >= split.endDistance) continue;
        // The median grows out of the tarmac and shrinks back into it, so a
        // carriageway never appears out of nowhere in front of the car.
        const ramp = Math.min(
            (distance - split.startDistance) / split.taperDistance,
            (split.endDistance - distance) / split.taperDistance
        );
        return DIVIDER_HALF_WIDTH * smoothstep(ramp);
    }
    return 0;
}

function roadGeometryAt(
    shape: CasinoHeistRoadShape,
    distance: number
): CasinoHeistRoadGeometry {
    const width = shape.baseWidth + waveSum(shape.widthWaves, distance);
    const centerX = shape.baseCenterX + waveSum(shape.centerWaves, distance);
    const dividerHalfWidth = dividerHalfWidthAt(shape, distance);
    const halfFootprint = width / 2 + dividerHalfWidth;
    return {
        centerX,
        width,
        leftX: centerX - halfFootprint,
        rightX: centerX + halfFootprint,
        dividerHalfWidth,
        split: dividerHalfWidth > 0,
        segmentIndex: clamp(
            Math.floor(distance / CASINO_HEIST_SEGMENT_LENGTH),
            0,
            shape.segmentCount - 1
        )
    };
}

/**
 * Where a lane sits at this point of the road. Lanes hold a fixed width, so the
 * outermost one runs out of tarmac where the road narrows and whatever is in it
 * merges inward rather than driving onto the gravel.
 */
export function casinoHeistLaneX(
    geometry: CasinoHeistRoadGeometry,
    lane: CasinoHeistLane,
    halfWidth = 0
): number {
    const side = lane < 0 ? -1 : 1;
    const fromInnerEdge = (Math.abs(lane) - 0.5) * CASINO_HEIST_LANE_WIDTH;
    const raw = geometry.centerX + side * (geometry.dividerHalfWidth + fromInnerEdge);
    const inner = geometry.centerX + side * (geometry.dividerHalfWidth + halfWidth);
    const outer = side < 0
        ? geometry.leftX + halfWidth + VERGE_INSET
        : geometry.rightX - halfWidth - VERGE_INSET;
    return side < 0 ? clamp(raw, outer, inner) : clamp(raw, inner, outer);
}

/** Lane ordering across the road, ignoring the gap where the centreline runs. */
function laneOrdinal(lane: CasinoHeistLane): number {
    return lane < 0 ? lane + 1 : lane;
}

/**
 * The shape of the whole road: two long waves that turn it, two slower ones that
 * widen and narrow it, and the stretches where it divides around a median. The
 * amplitudes are chosen so the widest the road can ever get still fits inside the
 * world, which means nothing here ever has to be clipped.
 */
function createRoadShape(random: RandomSource, segmentCount: number): CasinoHeistRoadShape {
    const longSway = 44 + randomInteger(random, 9);
    const shortSway = 24 + randomInteger(random, 9);
    // Scale the pair down if they could ever add up to more drift than the world
    // has room for, so the road never needs clipping at the edge.
    const swayScale = Math.min(1, MAX_CENTER_DRIFT / (longSway + shortSway));
    // Long wavelengths: the road has to sweep, not weave. A turn the car cannot
    // hold a line through is a turn that just scrapes it along the verge.
    const centerWaves: CasinoHeistRoadWave[] = [
        {
            amplitude: longSway * swayScale,
            wavelength: 2_000 + randomInteger(random, 400),
            phase: random.next() * Math.PI * 2
        },
        {
            amplitude: shortSway * swayScale,
            wavelength: 1_100 + randomInteger(random, 300),
            phase: random.next() * Math.PI * 2
        }
    ];
    const widthWaves: CasinoHeistRoadWave[] = [
        {
            amplitude: 34,
            wavelength: 1_900 + randomInteger(random, 500),
            phase: random.next() * Math.PI * 2
        },
        {
            amplitude: 22,
            wavelength: 820 + randomInteger(random, 260),
            phase: random.next() * Math.PI * 2
        }
    ];
    const roadEnd = segmentCount * CASINO_HEIST_SEGMENT_LENGTH;
    // Splits sit well clear of the start and of the final approach, where the
    // drain mouth needs the full width of one carriageway to itself.
    const splitFrom = CASINO_HEIST_SEGMENT_LENGTH * 2;
    const splitTo = roadEnd - CASINO_HEIST_SEGMENT_LENGTH * 2.5;
    const splits: CasinoHeistRoadSplit[] = [];
    const splitCount = 1 + randomInteger(random, 2);
    for (let index = 0; index < splitCount; index++) {
        const length = CASINO_HEIST_SEGMENT_LENGTH * (2 + randomInteger(random, 2));
        const window = splitTo - splitFrom - length;
        const offsetRoll = randomInteger(random, Math.max(1, Math.floor(window / 40) + 1)) * 40;
        if (window <= 0) break;
        const startDistance = splitFrom + offsetRoll;
        const endDistance = startDistance + length;
        const clashes = splits.some(other =>
            startDistance < other.endDistance + 320 && endDistance > other.startDistance - 320
        );
        if (clashes) continue;
        splits.push({startDistance, endDistance, taperDistance: 150});
    }
    return {
        baseCenterX: CASINO_HEIST_WORLD_WIDTH / 2,
        baseWidth: CASINO_HEIST_ROAD_WIDTH,
        centerWaves,
        widthWaves,
        splits: splits.sort((left, right) => left.startDistance - right.startDistance),
        segmentCount
    };
}

/**
 * Builds the escape route away from the robbed casino. The road turns, widens and
 * narrows, occasionally divides around a median the driver may pass either side
 * of, carries ordinary slower traffic, and ends at a marked turn-off into a storm
 * drain rather than at a destination building.
 */
export function createCasinoHeistCourse(
    random: RandomSource,
    config: CasinoHeistGenerationConfig = {}
): CasinoHeistCourse {
    const segmentCount = config.segmentCount ?? 20;
    if (!Number.isSafeInteger(segmentCount) || segmentCount < 8 || segmentCount > 40) {
        throw new Error('Casino Heist segment count must be an integer from 8 through 40.');
    }
    const bonuses = resolveBonuses(config.bonuses);
    const shape = createRoadShape(random, segmentCount);
    const segments: CasinoHeistRoadSegment[] = [];
    let previousSafeLane = chooseLane(random, CASINO_HEIST_LANES);

    for (let index = 0; index < segmentCount; index++) {
        const startDistance = index * CASINO_HEIST_SEGMENT_LENGTH;
        const endDistance = startDistance + CASINO_HEIST_SEGMENT_LENGTH;
        // The safe line drifts by at most one lane a segment, so it is always
        // reachable from wherever the previous segment left the car.
        const laneChoices = CASINO_HEIST_LANES.filter(lane =>
            Math.abs(laneOrdinal(lane) - laneOrdinal(previousSafeLane)) <= 1
        );
        const safeLane = index === 0 ? previousSafeLane : chooseLane(random, laneChoices);

        const trafficCount = index === 0 ? 0 : 2 + randomInteger(random, 2);
        const traffic: CasinoHeistTrafficDefinition[] = [];
        for (let slot = 0; slot < trafficCount; slot++) {
            const kindRoll = randomInteger(random, 10);
            const kind: CasinoHeistTrafficKind = kindRoll < 4
                ? 'car'
                : kindRoll < 6
                    ? 'motorcycle'
                    : kindRoll < 8 ? 'truck' : 'bus';
            const vehicleShape = TRAFFIC_SHAPES[kind];
            const lane = chooseLane(random, CASINO_HEIST_LANES);
            const distance = startDistance + 60 + slot * 66 + randomInteger(random, 41);
            const speed = vehicleShape.speed + randomInteger(random, 21);
            // Never place a vehicle that would seal every lane of a band, and
            // never stack two in one lane close enough to look like a shunt. The
            // random draws above still happen, so the seed stream stays stable.
            const band = traffic.filter(other =>
                Math.abs(other.distance - distance) < TRAFFIC_BAND_DISTANCE
            );
            if (band.some(other => other.lane === lane)) continue;
            const blocked = new Set([lane, ...band.map(other => other.lane)]);
            if (CASINO_HEIST_LANES.length - blocked.size < MINIMUM_OPEN_LANES) continue;
            traffic.push({
                id: `segment-${index}-traffic-${slot}`,
                kind,
                lane,
                distance,
                speed,
                width: vehicleShape.width,
                length: vehicleShape.length,
                health: vehicleShape.health
            });
        }

        // Draw every pickup random value even when this segment is forced, so
        // powerupChance stays monotonic without perturbing later generation.
        const optionalPickupRoll = random.next();
        const pickupKindRoll = randomInteger(random, 6);
        const pickupAmmoRoll = randomInteger(random, 5);
        const forcedPickupKind: CasinoHeistPickupKind | null =
            index === 0 ? 'weapon' : index % 3 === 0 ? 'ammo' : null;
        const hasOptionalPickup =
            optionalPickupRoll < Math.min(1, 0.24 + bonuses.powerupChance);
        const optionalKind: CasinoHeistPickupKind = pickupKindRoll === 0
            ? 'slick'
            : pickupKindRoll === 1
                ? 'smoke'
                : pickupKindRoll === 2 ? 'flame' : 'ammo';
        const pickupKind: CasinoHeistPickupKind = forcedPickupKind ?? optionalKind;
        const pickupDistance = startDistance + 108;
        const pickups: CasinoHeistPickupDefinition[] =
            forcedPickupKind !== null || hasOptionalPickup
                ? [{
                    id: `segment-${index}-pickup`,
                    kind: pickupKind,
                    x: casinoHeistLaneX(roadGeometryAt(shape, pickupDistance), safeLane, 12),
                    distance: pickupDistance,
                    ammo: pickupKind === 'weapon'
                        ? 12
                        : pickupKind === 'ammo' ? 7 + pickupAmmoRoll : 0
                }]
                : [];

        const pursuerRoll = random.next();
        const pursuerLaneRoll = randomInteger(random, CASINO_HEIST_LANES.length);
        const pursuerTriggerRoll = randomInteger(random, 31);
        const pursuerSpeedRoll = randomInteger(random, 21);
        const pursuerFireRoll = randomInteger(random, 22);
        const pursuerDelayRoll = randomInteger(random, 18);
        const pursuerColorRoll = randomInteger(random, 8);
        const swatRoll = random.next();
        const pursuerKind: CasinoHeistPursuerKind = swatRoll < 0.34 ? 'swat-van' : 'cop-car';
        const pursuerShape = PURSUER_SHAPES[pursuerKind];
        const pursuers: CasinoHeistPursuerDefinition[] =
            index > 0 && pursuerRoll < 0.62
                ? [{
                    id: `segment-${index}-${pursuerKind}`,
                    kind: pursuerKind,
                    lane: CASINO_HEIST_LANES[pursuerLaneRoll]!,
                    triggerDistance: startDistance + 42 + pursuerTriggerRoll,
                    spawnGap: 150,
                    speed: pursuerShape.speed + pursuerSpeedRoll,
                    fireIntervalTicks: 40 + pursuerFireRoll,
                    fireDelayTicks: 12 + pursuerDelayRoll,
                    health: pursuerShape.health,
                    colorIndex: pursuerColorRoll
                }]
                : [];

        const helicopterRoll = random.next();
        const helicopterLaneRoll = randomInteger(random, CASINO_HEIST_LANES.length);
        const helicopterDelayRoll = randomInteger(random, 61);
        const helicopters: CasinoHeistHelicopterDefinition[] =
            index >= 4 && index % 5 === 0 && helicopterRoll < 0.85
                ? [{
                    id: `segment-${index}-helicopter`,
                    triggerDistance: startDistance + 40,
                    leadDistance: 330,
                    dropDelayTicks: 90 + helicopterDelayRoll,
                    stripLane: CASINO_HEIST_LANES[helicopterLaneRoll]!,
                    stripHalfWidth: 74,
                    health: 3
                }]
                : [];

        segments.push({
            index,
            startDistance,
            endDistance,
            safeLane,
            traffic,
            pickups,
            pursuers,
            helicopters
        });
        previousSafeLane = safeLane;
    }

    const roadEnd = segmentCount * CASINO_HEIST_SEGMENT_LENGTH;
    const drainDistance = roadEnd - CASINO_HEIST_SEGMENT_LENGTH / 2;
    const lastSegment = segments[segments.length - 1]!;
    const draft: CasinoHeistCourse = {
        generatorId: 'casino-heist-escape-v2',
        width: CASINO_HEIST_WORLD_WIDTH,
        segmentLength: CASINO_HEIST_SEGMENT_LENGTH,
        roadWidth: CASINO_HEIST_ROAD_WIDTH,
        shape,
        turnoffDistance: drainDistance - 120,
        drainDistance,
        drainLane: lastSegment.safeLane,
        overshootDistance: roadEnd,
        startingHealth: CASINO_HEIST_BASE_HEALTH + bonuses.armor,
        bonuses,
        segments
    };
    const course = relieveBlockedTraffic(draft);
    const validation = validateCasinoHeistCourse(course);
    if (!validation.valid) {
        throw new Error(`Generated invalid Casino Heist escape: ${validation.errors.join('; ')}`);
    }
    return course;
}

export function getCasinoHeistRoadGeometry(
    course: CasinoHeistCourse,
    distance: number
): CasinoHeistRoadGeometry {
    return roadGeometryAt(
        course.shape,
        clamp(distance, 0, Math.max(0, course.overshootDistance - 1e-9))
    );
}

/**
 * Where the drain mouth sits laterally at the moment it is reached. The mouth is
 * far wider than a lane, so it is pulled back inside the tarmac rather than
 * hanging over the verge.
 */
export function getCasinoHeistDrainX(course: CasinoHeistCourse): number {
    const geometry = getCasinoHeistRoadGeometry(course, course.drainDistance);
    const laneX = casinoHeistLaneX(geometry, course.drainLane);
    if (geometry.dividerHalfWidth <= 0) {
        return clamp(
            laneX,
            geometry.leftX + CASINO_HEIST_DRAIN_HALF_WIDTH,
            geometry.rightX - CASINO_HEIST_DRAIN_HALF_WIDTH
        );
    }
    // Defensive: generation keeps medians away from the final approach, so a
    // drain never has to share its carriageway with one.
    const side = course.drainLane < 0 ? -1 : 1;
    const inner = geometry.centerX +
        side * (geometry.dividerHalfWidth + CASINO_HEIST_DRAIN_HALF_WIDTH);
    const outer = side < 0
        ? geometry.leftX + CASINO_HEIST_DRAIN_HALF_WIDTH
        : geometry.rightX - CASINO_HEIST_DRAIN_HALF_WIDTH;
    return side < 0 ? clamp(laneX, outer, inner) : clamp(laneX, inner, outer);
}

export function canonicalCasinoHeistCourseSignature(course: CasinoHeistCourse): string {
    return [
        course.generatorId,
        course.width,
        course.roadWidth,
        course.turnoffDistance,
        course.drainDistance,
        course.drainLane,
        course.startingHealth,
        course.shape.baseCenterX.toFixed(2),
        course.shape.baseWidth.toFixed(2),
        [...course.shape.centerWaves, ...course.shape.widthWaves]
            .map(wave =>
                `${wave.amplitude.toFixed(2)}/${wave.wavelength.toFixed(2)}/${wave.phase.toFixed(4)}`
            )
            .join(','),
        course.shape.splits
            .map(split => `${split.startDistance}-${split.endDistance}@${split.taperDistance}`)
            .join(','),
        ...course.segments.map(segment => [
            segment.index,
            segment.safeLane,
            segment.traffic.map(vehicle =>
                `${vehicle.kind}@${vehicle.lane}:${vehicle.distance}:${vehicle.speed}`
            ).join(','),
            segment.pickups.map(pickup =>
                `${pickup.kind}@${pickup.x.toFixed(1)}:${pickup.distance}:${pickup.ammo}`
            ).join(','),
            segment.pursuers.map(pursuer =>
                `${pursuer.kind}@${pursuer.lane}:${pursuer.triggerDistance}:${pursuer.speed}`
            ).join(','),
            segment.helicopters.map(helicopter =>
                `heli@${helicopter.stripLane}:${helicopter.dropDelayTicks}`
            ).join(',')
        ].join('|'))
    ].join(';');
}

/**
 * The road must never seal itself. At every distance band a car actually meets at
 * once, several of the six lanes have to stay free of traffic, so an unarmed
 * getaway car can always thread through.
 */
export function hasCasinoHeistSafeRoute(course: CasinoHeistCourse): boolean {
    const traffic = course.segments.flatMap(segment => segment.traffic);
    for (const vehicle of traffic) {
        const blocked = new Set(
            traffic
                .filter(other =>
                    Math.abs(other.distance - vehicle.distance) < TRAFFIC_BAND_DISTANCE
                )
                .map(other => other.lane)
        );
        if (CASINO_HEIST_LANES.length - blocked.size < MINIMUM_OPEN_LANES - 1) return false;
    }
    return true;
}

interface LateralInterval {
    readonly from: number;
    readonly to: number;
}

function subtractSpan(
    intervals: readonly LateralInterval[],
    from: number,
    to: number
): LateralInterval[] {
    const remaining: LateralInterval[] = [];
    for (const interval of intervals) {
        if (to <= interval.from || from >= interval.to) {
            remaining.push(interval);
            continue;
        }
        if (from > interval.from) remaining.push({from: interval.from, to: from});
        if (to < interval.to) remaining.push({from: to, to: interval.to});
    }
    return remaining.filter(interval => interval.to - interval.from > 1);
}

/**
 * Sweeps the escape and proves a driveable corridor exists: at every point of
 * the road there is a lateral position inside the tarmac, clear of the divider
 * and of every vehicle the car meets at that moment, and reachable from the
 * previous point at the car's own steering speed. It ends by requiring that
 * corridor to reach the drain mouth.
 *
 * This is a geometric guarantee about generated content, independent of how well
 * anybody drives.
 */
export function hasCasinoHeistDrivableCorridor(course: CasinoHeistCourse): boolean {
    return corridorBreakDistance(course) === null;
}

/**
 * The distance at which the corridor above closes, or null when it runs clear all
 * the way into the drain. Generation uses this to know which piece of traffic to
 * take back off the road.
 */
function corridorBreakDistance(course: CasinoHeistCourse): number | null {
    const stepDistance = 40;
    const stepSeconds = stepDistance / CASINO_HEIST_PLAYER_SPEED;
    const reach = BASE_LATERAL_SPEED * stepSeconds;
    const startGeometry = getCasinoHeistRoadGeometry(course, 0);
    const startX = casinoHeistLaneX(
        startGeometry,
        course.segments[0]!.safeLane,
        PLAYER_HALF_WIDTH
    );
    let intervals: LateralInterval[] = [{from: startX - 2, to: startX + 2}];

    for (let distance = 0; distance <= course.drainDistance; distance += stepDistance) {
        const elapsedSeconds = distance / CASINO_HEIST_PLAYER_SPEED;
        const geometry = getCasinoHeistRoadGeometry(course, distance);
        intervals = intervals
            .map(interval => ({from: interval.from - reach, to: interval.to + reach}))
            .map(interval => ({
                from: Math.max(interval.from, geometry.leftX + PLAYER_HALF_WIDTH),
                to: Math.min(interval.to, geometry.rightX - PLAYER_HALF_WIDTH)
            }))
            .filter(interval => interval.to - interval.from > 1);
        if (geometry.dividerHalfWidth > 0) {
            intervals = subtractSpan(
                intervals,
                geometry.centerX - geometry.dividerHalfWidth - PLAYER_HALF_WIDTH,
                geometry.centerX + geometry.dividerHalfWidth + PLAYER_HALF_WIDTH
            );
        }
        for (const segment of course.segments) {
            for (const vehicle of segment.traffic) {
                const vehicleDistance = vehicle.distance + vehicle.speed * elapsedSeconds;
                if (
                    Math.abs(vehicleDistance - distance) >
                    PLAYER_HALF_LENGTH + vehicle.length / 2 + stepDistance
                ) {
                    continue;
                }
                const vehicleGeometry = getCasinoHeistRoadGeometry(course, vehicleDistance);
                const vehicleX = casinoHeistLaneX(
                    vehicleGeometry,
                    vehicle.lane,
                    vehicle.width / 2
                );
                intervals = subtractSpan(
                    intervals,
                    vehicleX - vehicle.width / 2 - PLAYER_HALF_WIDTH,
                    vehicleX + vehicle.width / 2 + PLAYER_HALF_WIDTH
                );
            }
        }
        if (intervals.length === 0) return distance;
    }

    const drainX = getCasinoHeistDrainX(course);
    const reachesDrain = intervals.some(interval =>
        interval.from <= drainX + CASINO_HEIST_DRAIN_HALF_WIDTH &&
        interval.to >= drainX - CASINO_HEIST_DRAIN_HALF_WIDTH
    );
    return reachesDrain ? null : course.drainDistance;
}

/**
 * Traffic that converges into a wall is generated occasionally: the per-band rule
 * in the generator looks at one stretch of road at a time, while vehicles from
 * neighbouring stretches drift together as the faster ones pull away. Rather than
 * reroll a whole escape, lift out the offending vehicles one at a time. Removing
 * traffic can only ever open the corridor and an empty road always has one, so
 * this terminates.
 */
function relieveBlockedTraffic(course: CasinoHeistCourse): CasinoHeistCourse {
    let current = course;
    for (let attempt = 0; attempt < 60; attempt++) {
        const breakDistance = corridorBreakDistance(current);
        if (breakDistance === null && hasCasinoHeistSafeRoute(current)) return current;
        const relieved = withoutBlockingVehicle(current, breakDistance);
        if (relieved === null) return current;
        current = relieved;
    }
    return current;
}

/** Takes the widest vehicle nearest a blockage back off the road. */
function withoutBlockingVehicle(
    course: CasinoHeistCourse,
    breakDistance: number | null
): CasinoHeistCourse | null {
    const elapsedSeconds = (breakDistance ?? 0) / CASINO_HEIST_PLAYER_SPEED;
    let best: {readonly segmentIndex: number; readonly id: string; readonly score: number} |
        null = null;
    for (const segment of course.segments) {
        for (const vehicle of segment.traffic) {
            const gap = breakDistance === null
                ? 0
                : Math.abs(vehicle.distance + vehicle.speed * elapsedSeconds - breakDistance);
            const score = vehicle.width * 1_000 - gap;
            if (best === null || score > best.score) {
                best = {segmentIndex: segment.index, id: vehicle.id, score};
            }
        }
    }
    if (best === null) return null;
    const target = best;
    return {
        ...course,
        segments: course.segments.map(segment =>
            segment.index === target.segmentIndex
                ? {
                    ...segment,
                    traffic: segment.traffic.filter(vehicle => vehicle.id !== target.id)
                }
                : segment
        )
    };
}

/**
 * Walks the road and checks the properties the rest of the game assumes of it:
 * it stays inside the world, it never narrows below a driveable width, it never
 * turns faster than the car can steer, and every median leaves both carriageways
 * wide enough to use.
 */
function roadShapeErrors(course: CasinoHeistCourse): readonly string[] {
    const errors: string[] = [];
    const shape = course.shape;
    if (shape.segmentCount !== course.segments.length) {
        errors.push('Road shape does not cover the same number of segments as the course.');
    }
    if (shape.baseWidth !== course.roadWidth) {
        errors.push('Road shape base width does not match the course road width.');
    }
    // The centreline turn rate the car has to follow, as lateral pixels per pixel
    // travelled. Anything approaching one would out-steer the car itself.
    const maximumSlope = 0.7;
    let previousCenterX = roadGeometryAt(shape, 0).centerX;
    for (let distance = 0; distance <= course.overshootDistance; distance += 20) {
        const geometry = roadGeometryAt(shape, distance);
        if (geometry.leftX < 0 || geometry.rightX > course.width) {
            errors.push(`Road leaves the world at distance ${Math.round(distance)}.`);
            break;
        }
        if (
            geometry.width < CASINO_HEIST_MIN_ROAD_WIDTH - 1 ||
            geometry.width > CASINO_HEIST_MAX_ROAD_WIDTH + 1
        ) {
            errors.push(`Road width is out of range at distance ${Math.round(distance)}.`);
            break;
        }
        if (Math.abs(geometry.centerX - previousCenterX) / 20 > maximumSlope) {
            errors.push(`Road turns faster than the car can steer at ${Math.round(distance)}.`);
            break;
        }
        // Each carriageway of a split must still take two vehicles side by side.
        if (geometry.dividerHalfWidth > 0 && geometry.width / 2 < CASINO_HEIST_LANE_WIDTH * 2) {
            errors.push(`Median at distance ${Math.round(distance)} leaves too little road.`);
            break;
        }
        previousCenterX = geometry.centerX;
    }
    for (const split of shape.splits) {
        if (split.endDistance <= split.startDistance) {
            errors.push('A road split ends before it starts.');
        }
        if (split.taperDistance <= 0 || split.taperDistance * 2 > split.endDistance - split.startDistance) {
            errors.push('A road split has no room to taper its median in and out.');
        }
        if (split.endDistance > course.turnoffDistance - 320) {
            errors.push('A road split reaches into the final approach to the drain.');
        }
    }
    return errors;
}

export function validateCasinoHeistCourse(
    course: CasinoHeistCourse
): CasinoHeistValidationResult {
    const errors: string[] = [];
    if (course.generatorId !== 'casino-heist-escape-v2') {
        errors.push('Unknown Casino Heist generator.');
    }
    if (course.width !== CASINO_HEIST_WORLD_WIDTH) {
        errors.push('Course width does not match the Casino Heist world.');
    }
    if (course.roadWidth !== CASINO_HEIST_ROAD_WIDTH) {
        errors.push('Course road width does not match the Casino Heist road.');
    }
    if (course.segments.length < 8 || course.segments.length > 40) {
        errors.push('Course does not contain a supported number of road segments.');
    }
    if (course.overshootDistance !== course.segments.length * course.segmentLength) {
        errors.push('Course overshoot distance does not match its segments.');
    }
    if (
        course.drainDistance <= course.turnoffDistance ||
        course.drainDistance >= course.overshootDistance
    ) {
        errors.push('Drain must sit after the marked turn-off and before the road end.');
    }
    if (course.startingHealth < CASINO_HEIST_BASE_HEALTH) {
        errors.push('Course starting health is below the base hull.');
    }
    errors.push(...roadShapeErrors(course));
    const ids = new Set<string>();
    for (const [index, segment] of course.segments.entries()) {
        if (segment.index !== index) errors.push(`Segment ${index} has a mismatched index.`);
        if (segment.startDistance !== index * course.segmentLength) {
            errors.push(`Segment ${index} does not start where the previous one ends.`);
        }
        if (segment.endDistance - segment.startDistance !== course.segmentLength) {
            errors.push(`Segment ${index} has an invalid length.`);
        }
        for (const vehicle of segment.traffic) {
            if (ids.has(vehicle.id)) errors.push(`Duplicate entity id ${vehicle.id}.`);
            ids.add(vehicle.id);
            if (vehicle.speed >= CASINO_HEIST_PLAYER_SPEED) {
                errors.push(`Traffic ${vehicle.id} is not slower than the getaway car.`);
            }
            if (
                vehicle.distance < segment.startDistance ||
                vehicle.distance > segment.endDistance
            ) {
                errors.push(`Traffic ${vehicle.id} sits outside its segment.`);
            }
        }
        for (const pickup of segment.pickups) {
            if (ids.has(pickup.id)) errors.push(`Duplicate entity id ${pickup.id}.`);
            ids.add(pickup.id);
        }
        for (const pursuer of segment.pursuers) {
            if (ids.has(pursuer.id)) errors.push(`Duplicate entity id ${pursuer.id}.`);
            ids.add(pursuer.id);
            if (pursuer.speed <= CASINO_HEIST_PLAYER_SPEED) {
                errors.push(`Pursuer ${pursuer.id} cannot catch the getaway car.`);
            }
            if (pursuer.health < 1) errors.push(`Pursuer ${pursuer.id} has no health.`);
        }
        for (const helicopter of segment.helicopters) {
            if (ids.has(helicopter.id)) errors.push(`Duplicate entity id ${helicopter.id}.`);
            ids.add(helicopter.id);
            if (helicopter.stripHalfWidth * 2 >= course.roadWidth) {
                errors.push(`Spike strip ${helicopter.id} covers the entire road.`);
            }
            if (helicopter.health < 1) {
                errors.push(`Helicopter ${helicopter.id} cannot be shot down.`);
            }
        }
    }
    if (!hasCasinoHeistSafeRoute(course)) {
        errors.push('Course does not leave a drivable route through its traffic.');
    }
    if (errors.length === 0 && !hasCasinoHeistDrivableCorridor(course)) {
        errors.push('Course does not leave a steerable corridor to the drain.');
    }
    return {valid: errors.length === 0, errors};
}

function emptyDevices(): Record<CasinoHeistDeviceKind, number> {
    return {'oil-slick': 0, 'smoke-screen': 0, flamethrower: 0};
}

export function createCasinoHeistState(course: CasinoHeistCourse): CasinoHeistState {
    const geometry = getCasinoHeistRoadGeometry(course, 0);
    const startX = casinoHeistLaneX(
        geometry,
        course.segments[0]!.safeLane,
        PLAYER_HALF_WIDTH
    );
    const devices = emptyDevices();
    for (const device of course.bonuses.installedDevices) devices[device] = 2;
    const armedDevice = CASINO_HEIST_DEVICE_KINDS.find(device => devices[device] > 0) ??
        'oil-slick';
    return {
        course,
        player: {
            previousX: startX,
            x: startX,
            previousDistance: 0,
            distance: 0,
            screenY: CASINO_HEIST_PLAYER_SCREEN_Y,
            lateralVelocity: 0,
            health: course.startingHealth,
            maxHealth: course.startingHealth,
            recoveryMs: 0,
            weapon: course.bonuses.startAmmo > 0 ? 'pulse-cannon' : 'none',
            ammo: Math.min(CASINO_HEIST_MAX_AMMO, course.bonuses.startAmmo),
            fireCooldownTicks: 0,
            devices: Object.freeze({...devices}),
            armedDevice,
            flameMs: 0,
            spinOutMs: 0,
            edgeGrindMs: 0
        },
        traffic: [],
        pursuers: [],
        helicopters: [],
        hazards: [],
        projectiles: [],
        spawnedTrafficIds: [],
        collectedPickupIds: [],
        spawnedPursuerIds: [],
        spawnedHelicopterIds: [],
        activeTicks: 0,
        accumulatorMs: 0,
        paused: false,
        status: 'active',
        terminalReason: null,
        creditsStolen: 0,
        nextProjectileId: 1,
        nextHazardId: 1,
        telemetry: {
            powerupsCollected: 0,
            ammoCollected: 0,
            shotsFired: 0,
            enemyShotsFired: 0,
            pursuersDestroyed: 0,
            pursuersWrecked: 0,
            trafficWrecked: 0,
            helicoptersDowned: 0,
            devicesUsed: 0,
            collisions: 0,
            hitsTaken: 0,
            damageTaken: 0
        }
    };
}

function cloneState(state: CasinoHeistState): MutableCasinoHeistState {
    return {
        course: state.course,
        player: {...state.player, devices: {...state.player.devices}},
        traffic: state.traffic.map(vehicle => ({...vehicle})),
        pursuers: state.pursuers.map(pursuer => ({...pursuer})),
        helicopters: state.helicopters.map(helicopter => ({...helicopter})),
        hazards: state.hazards.map(hazard => ({...hazard})),
        projectiles: state.projectiles.map(projectile => ({...projectile})),
        spawnedTrafficIds: [...state.spawnedTrafficIds],
        collectedPickupIds: [...state.collectedPickupIds],
        spawnedPursuerIds: [...state.spawnedPursuerIds],
        spawnedHelicopterIds: [...state.spawnedHelicopterIds],
        activeTicks: state.activeTicks,
        accumulatorMs: state.accumulatorMs,
        paused: state.paused,
        status: state.status,
        terminalReason: state.terminalReason,
        creditsStolen: state.creditsStolen,
        nextProjectileId: state.nextProjectileId,
        nextHazardId: state.nextHazardId,
        announcedTurnoff: state.player.distance >= state.course.turnoffDistance,
        telemetry: {...state.telemetry}
    };
}

function freezeState(state: MutableCasinoHeistState): CasinoHeistState {
    return {
        course: state.course,
        player: {...state.player, devices: Object.freeze({...state.player.devices})},
        traffic: state.traffic.map(vehicle => ({...vehicle})),
        pursuers: state.pursuers.map(pursuer => ({...pursuer})),
        helicopters: state.helicopters.map(helicopter => ({...helicopter})),
        hazards: state.hazards.map(hazard => ({...hazard})),
        projectiles: state.projectiles.map(projectile => ({...projectile})),
        spawnedTrafficIds: [...state.spawnedTrafficIds],
        collectedPickupIds: [...state.collectedPickupIds],
        spawnedPursuerIds: [...state.spawnedPursuerIds],
        spawnedHelicopterIds: [...state.spawnedHelicopterIds],
        activeTicks: state.activeTicks,
        accumulatorMs: state.accumulatorMs,
        paused: state.paused,
        status: state.status,
        terminalReason: state.terminalReason,
        creditsStolen: state.creditsStolen,
        nextProjectileId: state.nextProjectileId,
        nextHazardId: state.nextHazardId,
        telemetry: {...state.telemetry}
    };
}

function normalizeInput(input: CasinoHeistInput): CasinoHeistInput {
    const steer = Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0;
    const vertical = Number.isFinite(input.vertical) ? clamp(input.vertical, -1, 1) : 0;
    return {
        steer,
        vertical,
        fire: input.fire === true,
        deploy: input.deploy === true,
        switchDevice: input.switchDevice === true
    };
}

function nextProjectileId(state: MutableCasinoHeistState, prefix: string): string {
    const id = `${prefix}-${state.nextProjectileId}`;
    state.nextProjectileId += 1;
    return id;
}

function nextHazardId(state: MutableCasinoHeistState, prefix: string): string {
    const id = `${prefix}-${state.nextHazardId}`;
    state.nextHazardId += 1;
    return id;
}

function trafficDefinition(
    course: CasinoHeistCourse,
    id: string
): CasinoHeistTrafficDefinition {
    for (const segment of course.segments) {
        const found = segment.traffic.find(vehicle => vehicle.id === id);
        if (found) return found;
    }
    throw new Error(`Unknown Casino Heist traffic ${id}.`);
}

function pursuerDefinition(
    course: CasinoHeistCourse,
    id: string
): CasinoHeistPursuerDefinition {
    for (const segment of course.segments) {
        const found = segment.pursuers.find(pursuer => pursuer.id === id);
        if (found) return found;
    }
    throw new Error(`Unknown Casino Heist pursuer ${id}.`);
}

function helicopterDefinition(
    course: CasinoHeistCourse,
    id: string
): CasinoHeistHelicopterDefinition {
    for (const segment of course.segments) {
        const found = segment.helicopters.find(helicopter => helicopter.id === id);
        if (found) return found;
    }
    throw new Error(`Unknown Casino Heist helicopter ${id}.`);
}

function overlapsMovingLongitudinally(
    firstPrevious: number,
    firstCurrent: number,
    secondPrevious: number,
    secondCurrent: number,
    combinedHalfLength: number
): boolean {
    const previousDelta = firstPrevious - secondPrevious;
    const currentDelta = firstCurrent - secondCurrent;
    return (
        Math.abs(previousDelta) <= combinedHalfLength ||
        Math.abs(currentDelta) <= combinedHalfLength ||
        (previousDelta < -combinedHalfLength && currentDelta > combinedHalfLength) ||
        (previousDelta > combinedHalfLength && currentDelta < -combinedHalfLength)
    );
}

/**
 * The car's screen row shifts where it sits in the world, so driving up the
 * screen genuinely closes on the traffic ahead.
 */
function playerReach(player: MutablePlayerState): number {
    return CASINO_HEIST_PLAYER_SCREEN_Y - player.screenY;
}

function playerFrontDistance(player: MutablePlayerState): number {
    return player.distance + playerReach(player);
}

function applyDamage(
    state: MutableCasinoHeistState,
    source: CasinoHeistDamageSource,
    sourceId: string | null,
    amount: number,
    events: CasinoHeistEvent[]
): boolean {
    if (state.player.recoveryMs > 0 || amount <= 0) return false;
    const applied = Math.min(amount, state.player.health);
    if (applied <= 0) return false;
    state.player.health -= applied;
    state.player.recoveryMs = CASINO_HEIST_RECOVERY_MS;
    state.telemetry.hitsTaken += 1;
    state.telemetry.damageTaken += applied;
    if (source !== 'enemy-shot') state.telemetry.collisions += 1;
    events.push({
        kind: 'damage',
        tick: state.activeTicks,
        source,
        sourceId,
        amount: applied,
        health: state.player.health
    });
    return true;
}

function updatePlayerMotion(
    state: MutableCasinoHeistState,
    input: CasinoHeistInput,
    events: CasinoHeistEvent[]
): void {
    const player = state.player;
    player.previousX = player.x;
    player.previousDistance = player.distance;
    const handlingMultiplier = 1 + state.course.bonuses.handling * 0.5;
    const spinning = player.spinOutMs > 0;
    const maxLateralSpeed = BASE_LATERAL_SPEED * handlingMultiplier;
    const dt = CASINO_HEIST_FIXED_STEP_MS / 1_000;
    player.spinOutMs = Math.max(0, player.spinOutMs - CASINO_HEIST_FIXED_STEP_MS);
    player.flameMs = Math.max(0, player.flameMs - CASINO_HEIST_FIXED_STEP_MS);
    if (!spinning && Math.abs(input.steer) > 1e-6) {
        player.lateralVelocity = clamp(
            player.lateralVelocity +
            input.steer * BASE_STEERING_ACCELERATION * handlingMultiplier * dt,
            -maxLateralSpeed,
            maxLateralSpeed
        );
    } else if (!spinning) {
        player.lateralVelocity *= 0.82;
        if (Math.abs(player.lateralVelocity) < 0.05) player.lateralVelocity = 0;
    }
    player.x += player.lateralVelocity * dt;
    if (!spinning && Math.abs(input.vertical) > 1e-6) {
        player.screenY = clamp(
            player.screenY - input.vertical * VERTICAL_SPEED * dt,
            CASINO_HEIST_PLAYER_MIN_SCREEN_Y,
            CASINO_HEIST_PLAYER_MAX_SCREEN_Y
        );
    }
    const recoverySpeedMultiplier = player.recoveryMs > 0 ? 0.82 : 1;
    player.distance += CASINO_HEIST_PLAYER_SPEED * recoverySpeedMultiplier * dt;

    const geometry = getCasinoHeistRoadGeometry(state.course, playerFrontDistance(player));
    const minimumX = geometry.leftX + PLAYER_HALF_WIDTH;
    const maximumX = geometry.rightX - PLAYER_HALF_WIDTH;
    if (player.x < minimumX || player.x > maximumX) {
        player.x = clamp(player.x, minimumX, maximumX);
        player.lateralVelocity = 0;
        // Brushing the verge scrubs speed; only grinding along it wrecks panels,
        // which leaves room to recover from a police shove.
        player.edgeGrindMs += CASINO_HEIST_FIXED_STEP_MS;
        if (player.edgeGrindMs >= EDGE_GRIND_TOLERANCE_MS) {
            player.edgeGrindMs = 0;
            applyDamage(state, 'road-edge', null, 1, events);
        }
    } else {
        player.edgeGrindMs = Math.max(0, player.edgeGrindMs - CASINO_HEIST_FIXED_STEP_MS * 2);
    }
    if (geometry.dividerHalfWidth > 0) {
        // The median is solid: the car is pushed back to whichever carriageway it
        // came from and takes the hit.
        const dividerCenter = geometry.centerX;
        const barrier = geometry.dividerHalfWidth + PLAYER_HALF_WIDTH;
        if (Math.abs(player.x - dividerCenter) < barrier) {
            const side = player.previousX >= dividerCenter ? 1 : -1;
            // Shove clear of the median at its *full* width, not the width it has
            // reached: one nudge has to settle it, or a growing median would keep
            // catching the car as it tapers in.
            player.x = clamp(
                dividerCenter + side * (DIVIDER_HALF_WIDTH + PLAYER_HALF_WIDTH + 8),
                minimumX,
                maximumX
            );
            player.lateralVelocity = 0;
            applyDamage(state, 'divider', null, 1, events);
        }
    }
}

function spawnTraffic(state: MutableCasinoHeistState, events: CasinoHeistEvent[]): void {
    const front = playerFrontDistance(state.player);
    for (const segment of state.course.segments) {
        for (const definition of segment.traffic) {
            if (state.spawnedTrafficIds.includes(definition.id)) continue;
            if (definition.distance > front + 900) continue;
            const geometry = getCasinoHeistRoadGeometry(state.course, definition.distance);
            state.spawnedTrafficIds.push(definition.id);
            const x = casinoHeistLaneX(geometry, definition.lane, definition.width / 2);
            state.traffic.push({
                definitionId: definition.id,
                previousX: x,
                x,
                previousDistance: definition.distance,
                distance: definition.distance,
                health: definition.health,
                wrecked: false,
                wreckMs: 0,
                driftX: 0,
                spin: 0
            });
            events.push({
                kind: 'traffic-spawned',
                tick: state.activeTicks,
                trafficId: definition.id
            });
        }
    }
}

function updateTraffic(state: MutableCasinoHeistState): void {
    const dt = CASINO_HEIST_FIXED_STEP_MS / 1_000;
    const sliding = new Set<MutableTrafficState>();
    for (const vehicle of state.traffic) {
        const definition = trafficDefinition(state.course, vehicle.definitionId);
        vehicle.previousX = vehicle.x;
        vehicle.previousDistance = vehicle.distance;
        if (vehicle.wrecked) {
            // Coasting, not driving: it keeps rolling but sheds speed as it goes.
            if (slideWreck(vehicle, state, definition.speed * 0.55)) sliding.add(vehicle);
        } else {
            vehicle.distance += definition.speed * dt;
            const geometry = getCasinoHeistRoadGeometry(state.course, vehicle.distance);
            const targetX = casinoHeistLaneX(geometry, definition.lane, definition.width / 2);
            vehicle.x += clamp(targetX - vehicle.x, -3, 3);
            sliding.add(vehicle);
        }
    }
    const front = playerFrontDistance(state.player);
    state.traffic = state.traffic.filter(vehicle =>
        sliding.has(vehicle) &&
        vehicle.distance > front - 320 &&
        vehicle.distance < front + 1_000
    );
}

function spawnPursuers(state: MutableCasinoHeistState, events: CasinoHeistEvent[]): void {
    for (const segment of state.course.segments) {
        for (const definition of segment.pursuers) {
            if (
                state.player.distance < definition.triggerDistance ||
                state.spawnedPursuerIds.includes(definition.id)
            ) {
                continue;
            }
            const distance = state.player.distance - definition.spawnGap;
            const geometry = getCasinoHeistRoadGeometry(state.course, Math.max(0, distance));
            const x = casinoHeistLaneX(geometry, definition.lane, PURSUER_HALF_WIDTH);
            state.spawnedPursuerIds.push(definition.id);
            state.pursuers.push({
                definitionId: definition.id,
                previousX: x,
                x,
                previousDistance: distance,
                distance,
                health: definition.health,
                fireCooldownTicks: definition.fireDelayTicks,
                contactCooldownMs: 0,
                blindedMs: 0,
                spinOutMs: 0,
                wreckMs: 0,
                driftX: 0,
                spin: 0
            });
            events.push({
                kind: 'pursuer-spawned',
                tick: state.activeTicks,
                pursuerId: definition.id
            });
        }
    }
}

function updatePursuers(state: MutableCasinoHeistState, events: CasinoHeistEvent[]): void {
    const dt = CASINO_HEIST_FIXED_STEP_MS / 1_000;
    const front = playerFrontDistance(state.player);
    const onScreen = new Set<MutablePursuerState>();
    for (const pursuer of state.pursuers) {
        const definition = pursuerDefinition(state.course, pursuer.definitionId);
        const shape = PURSUER_SHAPES[definition.kind];
        pursuer.previousX = pursuer.x;
        pursuer.previousDistance = pursuer.distance;
        if (pursuer.health <= 0) {
            // A wrecked patrol car slews off the road rather than blinking out.
            if (slideWreck(pursuer, state, definition.speed * 0.5)) onScreen.add(pursuer);
            continue;
        }
        onScreen.add(pursuer);
        pursuer.contactCooldownMs = Math.max(
            0,
            pursuer.contactCooldownMs - CASINO_HEIST_FIXED_STEP_MS
        );
        pursuer.blindedMs = Math.max(0, pursuer.blindedMs - CASINO_HEIST_FIXED_STEP_MS);
        pursuer.spinOutMs = Math.max(0, pursuer.spinOutMs - CASINO_HEIST_FIXED_STEP_MS);
        pursuer.fireCooldownTicks = Math.max(0, pursuer.fireCooldownTicks - 1);
        if (pursuer.spinOutMs > 0) continue;

        if (pursuer.blindedMs > 0) {
            // A blinded driver slows and drifts for the shoulder.
            pursuer.distance += definition.speed * 0.55 * dt;
            const geometry = getCasinoHeistRoadGeometry(state.course, pursuer.distance);
            const escapeX = pursuer.x >= geometry.centerX
                ? geometry.rightX + 60
                : geometry.leftX - 60;
            pursuer.x += clamp(escapeX - pursuer.x, -5, 5);
            continue;
        }

        pursuer.distance += definition.speed * dt;
        // Ramming: steer straight at the player's current lateral position.
        const targetX = state.player.x;
        pursuer.x += clamp(targetX - pursuer.x, -3.4, 3.4);

        const gapAhead = front - pursuer.distance;
        const alongside = Math.abs(gapAhead) < 90;
        if (
            shape.shoots &&
            pursuer.fireCooldownTicks === 0 &&
            alongside &&
            Math.abs(state.player.x - pursuer.x) > 26 &&
            // A window shot only reaches a car in the next lane or so, which
            // leaves changing speed or lane as a real counter.
            Math.abs(state.player.x - pursuer.x) < 170
        ) {
            // The window rolls down and the shot goes sideways at the player.
            const projectileId = nextProjectileId(state, 'enemy-shot');
            const lateral = state.player.x >= pursuer.x ? 210 : -210;
            state.projectiles.push({
                id: projectileId,
                allegiance: 'enemy',
                sourceId: pursuer.definitionId,
                x: pursuer.x + Math.sign(lateral) * PURSUER_HALF_WIDTH,
                previousDistance: pursuer.distance,
                distance: pursuer.distance,
                forwardVelocity: 60,
                lateralVelocity: lateral,
                damage: 1
            });
            pursuer.fireCooldownTicks = definition.fireIntervalTicks;
            state.telemetry.enemyShotsFired += 1;
            events.push({
                kind: 'enemy-fired',
                tick: state.activeTicks,
                pursuerId: pursuer.definitionId,
                projectileId
            });
        }
    }
    state.pursuers = state.pursuers.filter(pursuer =>
        onScreen.has(pursuer) &&
        pursuer.distance > front - 420 &&
        pursuer.distance < front + 520
    );
}

function spawnHelicopters(state: MutableCasinoHeistState, events: CasinoHeistEvent[]): void {
    for (const segment of state.course.segments) {
        for (const definition of segment.helicopters) {
            if (
                state.player.distance < definition.triggerDistance ||
                state.spawnedHelicopterIds.includes(definition.id)
            ) {
                continue;
            }
            const distance = state.player.distance + definition.leadDistance;
            const geometry = getCasinoHeistRoadGeometry(state.course, distance);
            state.spawnedHelicopterIds.push(definition.id);
            state.helicopters.push({
                definitionId: definition.id,
                x: geometry.centerX,
                distance,
                health: definition.health,
                hoverTicks: 0,
                dropped: false,
                leaving: false
            });
            events.push({
                kind: 'helicopter-spawned',
                tick: state.activeTicks,
                helicopterId: definition.id
            });
        }
    }
}

function updateHelicopters(
    state: MutableCasinoHeistState,
    events: CasinoHeistEvent[]
): void {
    const dt = CASINO_HEIST_FIXED_STEP_MS / 1_000;
    for (const helicopter of state.helicopters) {
        const definition = helicopterDefinition(state.course, helicopter.definitionId);
        if (helicopter.leaving) {
            // Flying means it can simply outrun the car once its work is done.
            helicopter.distance += CASINO_HEIST_PLAYER_SPEED * 2.1 * dt;
            continue;
        }
        // It flies, so it holds station ahead of the car no matter the speed.
        helicopter.distance = state.player.distance + definition.leadDistance;
        const geometry = getCasinoHeistRoadGeometry(state.course, helicopter.distance);
        const targetX = casinoHeistLaneX(
            geometry,
            definition.stripLane,
            definition.stripHalfWidth
        );
        helicopter.x += clamp(targetX - helicopter.x, -4, 4);
        helicopter.hoverTicks += 1;
        if (!helicopter.dropped && helicopter.hoverTicks >= definition.dropDelayTicks) {
            helicopter.dropped = true;
            helicopter.leaving = true;
            const hazardId = nextHazardId(state, 'spike-strip');
            state.hazards.push({
                id: hazardId,
                kind: 'spike-strip',
                x: helicopter.x,
                halfWidth: definition.stripHalfWidth,
                distance: helicopter.distance,
                remainingMs: SPIKE_STRIP_LIFETIME_MS
            });
            events.push({
                kind: 'spike-strip-dropped',
                tick: state.activeTicks,
                helicopterId: helicopter.definitionId,
                hazardId
            });
            events.push({
                kind: 'helicopter-escaped',
                tick: state.activeTicks,
                helicopterId: helicopter.definitionId
            });
        }
    }
    const front = playerFrontDistance(state.player);
    state.helicopters = state.helicopters.filter(helicopter =>
        helicopter.health > 0 && helicopter.distance < front + 1_400
    );
}

function updateHazards(state: MutableCasinoHeistState): void {
    for (const hazard of state.hazards) {
        hazard.remainingMs -= CASINO_HEIST_FIXED_STEP_MS;
    }
    const front = playerFrontDistance(state.player);
    state.hazards = state.hazards.filter(hazard =>
        hazard.remainingMs > 0 && hazard.distance > front - 600
    );
}

function armNextDevice(
    state: MutableCasinoHeistState,
    events: CasinoHeistEvent[]
): void {
    const player = state.player;
    const currentIndex = CASINO_HEIST_DEVICE_KINDS.indexOf(player.armedDevice);
    for (let step = 1; step <= CASINO_HEIST_DEVICE_KINDS.length; step++) {
        const candidate = CASINO_HEIST_DEVICE_KINDS[
            (currentIndex + step) % CASINO_HEIST_DEVICE_KINDS.length
        ]!;
        if (player.devices[candidate] <= 0) continue;
        player.armedDevice = candidate;
        events.push({kind: 'device-armed', tick: state.activeTicks, device: candidate});
        return;
    }
}

function deployDevice(state: MutableCasinoHeistState, events: CasinoHeistEvent[]): void {
    const player = state.player;
    const device = player.armedDevice;
    if (player.devices[device] <= 0) {
        armNextDevice(state, events);
        return;
    }
    player.devices[device] -= 1;
    state.telemetry.devicesUsed += 1;
    events.push({
        kind: 'device-deployed',
        tick: state.activeTicks,
        device,
        remaining: player.devices[device]
    });
    if (device === 'oil-slick') {
        // The slick pools behind the car, where a tailgating pursuer will find it.
        state.hazards.push({
            id: nextHazardId(state, 'oil-slick'),
            kind: 'oil-slick',
            x: player.x,
            halfWidth: SLICK_HALF_WIDTH,
            distance: player.distance - PLAYER_HALF_LENGTH - 12,
            remainingMs: SLICK_LIFETIME_MS
        });
    } else if (device === 'smoke-screen') {
        for (const pursuer of state.pursuers) {
            if (pursuer.distance > playerFrontDistance(player)) continue;
            pursuer.blindedMs = SMOKE_BLIND_MS;
            events.push({
                kind: 'pursuer-blinded',
                tick: state.activeTicks,
                pursuerId: pursuer.definitionId
            });
        }
    } else {
        player.flameMs = FLAME_ACTIVE_MS;
    }
    if (player.devices[device] <= 0) armNextDevice(state, events);
}

function wreckPursuer(
    state: MutableCasinoHeistState,
    pursuer: MutablePursuerState,
    cause: 'traffic' | 'oil-slick' | 'flamethrower' | 'gunfire',
    events: CasinoHeistEvent[]
): void {
    if (pursuer.health <= 0) return;
    pursuer.health = 0;
    pursuer.wreckMs = WRECK_SLIDE_MS;
    pursuer.driftX = wreckDriftDirection(state, pursuer.distance, pursuer.x) * WRECK_DRIFT_SPEED;
    if (cause === 'gunfire') state.telemetry.pursuersDestroyed += 1;
    else state.telemetry.pursuersWrecked += 1;
    events.push({
        kind: 'pursuer-wrecked',
        tick: state.activeTicks,
        pursuerId: pursuer.definitionId,
        cause
    });
}

/**
 * A wreck loses its driver, so it slides off the way it was already leaning and
 * spins as it goes. Nothing wrecked is left parked in a lane: the point of
 * shooting a car is to open the road, not to build a wall out of it.
 */
function wreckTraffic(
    state: MutableCasinoHeistState,
    vehicle: MutableTrafficState,
    kind: CasinoHeistTrafficKind,
    events: CasinoHeistEvent[]
): void {
    if (vehicle.wrecked) return;
    vehicle.health = 0;
    vehicle.wrecked = true;
    vehicle.wreckMs = WRECK_SLIDE_MS;
    vehicle.driftX = wreckDriftDirection(state, vehicle.distance, vehicle.x) * WRECK_DRIFT_SPEED;
    state.telemetry.trafficWrecked += 1;
    events.push({
        kind: 'traffic-wrecked',
        tick: state.activeTicks,
        trafficId: vehicle.definitionId,
        kindLabel: kind
    });
}

/** Wrecks leave by the nearer verge, which is where the momentum already is. */
function wreckDriftDirection(
    state: MutableCasinoHeistState,
    distance: number,
    x: number
): number {
    const geometry = getCasinoHeistRoadGeometry(state.course, distance);
    return x >= geometry.centerX ? 1 : -1;
}

/** Slides one wreck further off the road and returns whether it is still on screen. */
function slideWreck(
    wreck: {x: number; distance: number; wreckMs: number; driftX: number; spin: number},
    state: MutableCasinoHeistState,
    forwardSpeed: number
): boolean {
    const dt = CASINO_HEIST_FIXED_STEP_MS / 1_000;
    wreck.wreckMs = Math.max(0, wreck.wreckMs - CASINO_HEIST_FIXED_STEP_MS);
    wreck.distance += forwardSpeed * dt;
    wreck.x += wreck.driftX * dt;
    wreck.spin += Math.sign(wreck.driftX) * WRECK_SPIN_RATE * dt;
    const geometry = getCasinoHeistRoadGeometry(state.course, wreck.distance);
    const clearOfRoad = wreck.x < geometry.leftX - 70 || wreck.x > geometry.rightX + 70;
    return wreck.wreckMs > 0 && !clearOfRoad;
}

/** Flame reaches out to the sides and just ahead of the car. */
function applyFlamethrower(
    state: MutableCasinoHeistState,
    events: CasinoHeistEvent[]
): void {
    if (state.player.flameMs <= 0) return;
    const front = playerFrontDistance(state.player);
    for (const pursuer of state.pursuers) {
        if (pursuer.health <= 0 || pursuer.spinOutMs > 0) continue;
        if (Math.abs(pursuer.distance - front) > FLAME_RANGE) continue;
        if (Math.abs(pursuer.x - state.player.x) > FLAME_RANGE) continue;
        const definition = pursuerDefinition(state.course, pursuer.definitionId);
        // A light car burns out; an armored van swerves off instead.
        if (PURSUER_SHAPES[definition.kind].health <= 2) {
            wreckPursuer(state, pursuer, 'flamethrower', events);
        } else {
            pursuer.spinOutMs = 1_400;
            pursuer.fireCooldownTicks = Math.max(pursuer.fireCooldownTicks, 90);
        }
    }
    // The flame does not discriminate: anything alongside burns out too.
    for (const vehicle of state.traffic) {
        if (vehicle.wrecked) continue;
        if (Math.abs(vehicle.distance - front) > FLAME_RANGE) continue;
        if (Math.abs(vehicle.x - state.player.x) > FLAME_RANGE) continue;
        const definition = trafficDefinition(state.course, vehicle.definitionId);
        wreckTraffic(state, vehicle, definition.kind, events);
    }
}

function firePlayerWeapon(
    state: MutableCasinoHeistState,
    input: CasinoHeistInput,
    events: CasinoHeistEvent[]
): void {
    state.player.fireCooldownTicks = Math.max(0, state.player.fireCooldownTicks - 1);
    if (
        !input.fire ||
        state.player.weapon === 'none' ||
        state.player.ammo <= 0 ||
        state.player.fireCooldownTicks > 0
    ) {
        return;
    }
    const projectileId = nextProjectileId(state, 'player-shot');
    const front = playerFrontDistance(state.player);
    state.projectiles.push({
        id: projectileId,
        allegiance: 'player',
        sourceId: 'player',
        x: state.player.x,
        previousDistance: front + PLAYER_HALF_LENGTH + 4,
        distance: front + PLAYER_HALF_LENGTH + 4,
        forwardVelocity: 410,
        lateralVelocity: 0,
        damage: 1
    });
    state.player.ammo -= 1;
    state.player.fireCooldownTicks = PLAYER_FIRE_COOLDOWN_TICKS;
    state.telemetry.shotsFired += 1;
    events.push({
        kind: 'player-fired',
        tick: state.activeTicks,
        projectileId,
        ammo: state.player.ammo
    });
}

function updateProjectiles(state: MutableCasinoHeistState): void {
    const dt = CASINO_HEIST_FIXED_STEP_MS / 1_000;
    for (const projectile of state.projectiles) {
        projectile.previousDistance = projectile.distance;
        projectile.distance += projectile.forwardVelocity * dt;
        projectile.x += projectile.lateralVelocity * dt;
    }
}

function collectPowerups(
    state: MutableCasinoHeistState,
    events: CasinoHeistEvent[]
): void {
    const player = state.player;
    const front = playerFrontDistance(player);
    const previousFront = player.previousDistance + playerReach(player);
    for (const segment of state.course.segments) {
        for (const pickup of segment.pickups) {
            if (state.collectedPickupIds.includes(pickup.id)) continue;
            if (
                !overlapsMovingLongitudinally(
                    previousFront,
                    front,
                    pickup.distance,
                    pickup.distance,
                    PLAYER_HALF_LENGTH + 18
                ) ||
                Math.abs(player.x - pickup.x) > PLAYER_HALF_WIDTH + 20
            ) {
                continue;
            }
            state.collectedPickupIds.push(pickup.id);
            const device = PICKUP_DEVICE[pickup.kind];
            if (device) {
                player.devices[device] += 2;
                if (player.devices[player.armedDevice] <= 0) player.armedDevice = device;
            } else {
                player.weapon = 'pulse-cannon';
                player.ammo = Math.min(CASINO_HEIST_MAX_AMMO, player.ammo + pickup.ammo);
                state.telemetry.ammoCollected += pickup.ammo;
            }
            state.telemetry.powerupsCollected += 1;
            events.push({
                kind: 'pickup-collected',
                tick: state.activeTicks,
                pickupId: pickup.id,
                pickupKind: pickup.kind,
                ammo: player.ammo,
                weapon: player.weapon
            });
        }
    }
}

function collideWithTraffic(
    state: MutableCasinoHeistState,
    events: CasinoHeistEvent[]
): void {
    const player = state.player;
    const front = playerFrontDistance(player);
    const previousFront = player.previousDistance + playerReach(player);
    for (const vehicle of state.traffic) {
        const definition = trafficDefinition(state.course, vehicle.definitionId);
        if (
            !overlapsMovingLongitudinally(
                previousFront,
                front,
                vehicle.previousDistance,
                vehicle.distance,
                PLAYER_HALF_LENGTH + definition.length / 2
            ) ||
            Math.abs(player.x - vehicle.x) > PLAYER_HALF_WIDTH + definition.width / 2
        ) {
            continue;
        }
        const damaged = applyDamage(state, 'traffic', vehicle.definitionId, 1, events);
        // Cars do not pass through cars: the impact deflects the getaway car clear
        // of the one it clipped, which also stops a single collision from being
        // charged again every time the recovery window lapses. It deflects to
        // whichever side has room, so a clip never wedges the car against the
        // verge where it would grind itself to pieces.
        const geometry = getCasinoHeistRoadGeometry(state.course, front);
        const clearance = definition.width / 2 + PLAYER_HALF_WIDTH + 8;
        const natural = player.x >= vehicle.x ? 1 : -1;
        const fits = (side: number): boolean =>
            vehicle.x + side * clearance >= geometry.leftX + PLAYER_HALF_WIDTH &&
            vehicle.x + side * clearance <= geometry.rightX - PLAYER_HALF_WIDTH;
        const side = fits(natural) ? natural : fits(-natural) ? -natural : natural;
        player.x = clamp(
            vehicle.x + side * clearance,
            geometry.leftX + PLAYER_HALF_WIDTH,
            geometry.rightX - PLAYER_HALF_WIDTH
        );
        player.lateralVelocity = side * 150;
        if (damaged) {
            // Clipping something much heavier spins the getaway car.
            player.spinOutMs = definition.kind === 'bus' || definition.kind === 'truck'
                ? 520
                : 260;
        }
    }
}

/**
 * No vehicle passes through another. A pursuer that piles into ordinary traffic
 * wrecks both of them, which is the main way a chase thins itself out.
 */
function resolveVehicleCollisions(
    state: MutableCasinoHeistState,
    events: CasinoHeistEvent[]
): void {
    for (const pursuer of state.pursuers) {
        if (pursuer.health <= 0) continue;
        const pursuerShape = pursuerDefinition(state.course, pursuer.definitionId);
        for (const vehicle of state.traffic) {
            if (vehicle.wrecked) continue;
            const definition = trafficDefinition(state.course, vehicle.definitionId);
            if (
                !overlapsMovingLongitudinally(
                    pursuer.previousDistance,
                    pursuer.distance,
                    vehicle.previousDistance,
                    vehicle.distance,
                    PURSUER_HALF_LENGTH + definition.length / 2
                ) ||
                Math.abs(pursuer.x - vehicle.x) > PURSUER_HALF_WIDTH + definition.width / 2
            ) {
                continue;
            }
            wreckTraffic(state, vehicle, definition.kind, events);
            wreckPursuer(state, pursuer, 'traffic', events);
            break;
        }
        if (pursuer.health <= 0) continue;
        for (const other of state.pursuers) {
            if (other === pursuer || other.health <= 0) continue;
            if (
                !overlapsMovingLongitudinally(
                    pursuer.previousDistance,
                    pursuer.distance,
                    other.previousDistance,
                    other.distance,
                    PURSUER_HALF_LENGTH * 2
                ) ||
                Math.abs(pursuer.x - other.x) > PURSUER_HALF_WIDTH * 2
            ) {
                continue;
            }
            wreckPursuer(state, pursuer, 'traffic', events);
            wreckPursuer(state, other, 'traffic', events);
            break;
        }
        if (pursuer.health <= 0) continue;
        void pursuerShape;
    }
}

function resolveHazards(state: MutableCasinoHeistState, events: CasinoHeistEvent[]): void {
    const player = state.player;
    const front = playerFrontDistance(player);
    const previousFront = player.previousDistance + playerReach(player);
    for (const hazard of state.hazards) {
        if (hazard.kind === 'spike-strip') {
            if (
                overlapsMovingLongitudinally(
                    previousFront,
                    front,
                    hazard.distance,
                    hazard.distance,
                    PLAYER_HALF_LENGTH + 10
                ) &&
                Math.abs(player.x - hazard.x) <= hazard.halfWidth + PLAYER_HALF_WIDTH
            ) {
                hazard.remainingMs = 0;
                applyDamage(state, 'spike-strip', hazard.id, 1, events);
            }
            continue;
        }
        for (const pursuer of state.pursuers) {
            if (pursuer.health <= 0 || pursuer.spinOutMs > 0) continue;
            if (
                !overlapsMovingLongitudinally(
                    pursuer.previousDistance,
                    pursuer.distance,
                    hazard.distance,
                    hazard.distance,
                    PURSUER_HALF_LENGTH + 10
                ) ||
                Math.abs(pursuer.x - hazard.x) > hazard.halfWidth + PURSUER_HALF_WIDTH
            ) {
                continue;
            }
            hazard.remainingMs = 0;
            wreckPursuer(state, pursuer, 'oil-slick', events);
        }
    }
    state.hazards = state.hazards.filter(hazard => hazard.remainingMs > 0);
}

function resolveProjectileHits(
    state: MutableCasinoHeistState,
    events: CasinoHeistEvent[]
): void {
    const removedProjectileIds = new Set<string>();
    const player = state.player;
    const front = playerFrontDistance(player);
    const previousFront = player.previousDistance + playerReach(player);
    for (const projectile of state.projectiles) {
        if (projectile.allegiance === 'enemy') {
            if (
                overlapsMovingLongitudinally(
                    projectile.previousDistance,
                    projectile.distance,
                    previousFront,
                    front,
                    PLAYER_HALF_LENGTH + PROJECTILE_HALF_LENGTH
                ) &&
                Math.abs(projectile.x - player.x) <= PLAYER_HALF_WIDTH + 4
            ) {
                removedProjectileIds.add(projectile.id);
                applyDamage(state, 'enemy-shot', projectile.sourceId, projectile.damage, events);
            }
            continue;
        }
        let consumed = false;
        for (const helicopter of state.helicopters) {
            if (helicopter.health <= 0) continue;
            if (
                Math.abs(projectile.distance - helicopter.distance) > 40 ||
                Math.abs(projectile.x - helicopter.x) > 34
            ) {
                continue;
            }
            removedProjectileIds.add(projectile.id);
            consumed = true;
            helicopter.health -= projectile.damage;
            if (helicopter.health <= 0) {
                state.telemetry.helicoptersDowned += 1;
                events.push({
                    kind: 'helicopter-downed',
                    tick: state.activeTicks,
                    helicopterId: helicopter.definitionId
                });
            }
            break;
        }
        if (consumed) continue;
        for (const pursuer of state.pursuers) {
            if (pursuer.health <= 0) continue;
            if (
                !overlapsMovingLongitudinally(
                    projectile.previousDistance,
                    projectile.distance,
                    pursuer.previousDistance,
                    pursuer.distance,
                    PURSUER_HALF_LENGTH + PROJECTILE_HALF_LENGTH
                ) ||
                Math.abs(projectile.x - pursuer.x) > PURSUER_HALF_WIDTH + 4
            ) {
                continue;
            }
            removedProjectileIds.add(projectile.id);
            consumed = true;
            pursuer.health -= projectile.damage;
            // Restore a point so wreckPursuer sees a live car and does the whole
            // job of wrecking it: telemetry, event, and the slide off the road.
            if (pursuer.health <= 0) {
                pursuer.health = 1;
                wreckPursuer(state, pursuer, 'gunfire', events);
            }
            break;
        }
        if (consumed) continue;
        // Anything on the road can be shot. A car or bike goes down to one hit and
        // a truck or bus needs two; either way the wreck slews off the road.
        for (const vehicle of state.traffic) {
            if (vehicle.wrecked) continue;
            const definition = trafficDefinition(state.course, vehicle.definitionId);
            if (
                !overlapsMovingLongitudinally(
                    projectile.previousDistance,
                    projectile.distance,
                    vehicle.previousDistance,
                    vehicle.distance,
                    definition.length / 2 + PROJECTILE_HALF_LENGTH
                ) ||
                Math.abs(projectile.x - vehicle.x) > definition.width / 2 + 4
            ) {
                continue;
            }
            removedProjectileIds.add(projectile.id);
            vehicle.health -= projectile.damage;
            if (vehicle.health <= 0) wreckTraffic(state, vehicle, definition.kind, events);
            break;
        }
    }
    state.helicopters = state.helicopters.filter(helicopter => helicopter.health > 0);
    state.projectiles = state.projectiles.filter(projectile =>
        !removedProjectileIds.has(projectile.id) &&
        projectile.distance > front - 240 &&
        projectile.distance < front + 760 &&
        projectile.x > -80 &&
        projectile.x < CASINO_HEIST_WORLD_WIDTH + 80
    );
}

/**
 * A ram is a shove, not a hit. Police cars try to put the getaway car into the
 * shoulder, the divider, or oncoming traffic; the consequence comes from where
 * the shove lands, which keeps the chase survivable for a careful driver.
 */
function collideWithPursuers(
    state: MutableCasinoHeistState,
    events: CasinoHeistEvent[]
): void {
    const player = state.player;
    const front = playerFrontDistance(player);
    const previousFront = player.previousDistance + playerReach(player);
    const geometry = getCasinoHeistRoadGeometry(state.course, front);
    for (const pursuer of state.pursuers) {
        const definition = pursuerDefinition(state.course, pursuer.definitionId);
        if (
            pursuer.contactCooldownMs > 0 ||
            pursuer.spinOutMs > 0 ||
            !overlapsMovingLongitudinally(
                previousFront,
                front,
                pursuer.previousDistance,
                pursuer.distance,
                PLAYER_HALF_LENGTH + PURSUER_HALF_LENGTH
            ) ||
            Math.abs(player.x - pursuer.x) > PLAYER_HALF_WIDTH + PURSUER_HALF_WIDTH
        ) {
            continue;
        }
        pursuer.contactCooldownMs = CASINO_HEIST_RECOVERY_MS;
        const direction = player.x >= pursuer.x ? 1 : -1;
        const push = PURSUER_SHAPES[definition.kind].ramPush;
        player.x = clamp(
            player.x + direction * push,
            geometry.leftX + PLAYER_HALF_WIDTH,
            geometry.rightX - PLAYER_HALF_WIDTH
        );
        player.lateralVelocity = direction * 140;
        state.telemetry.collisions += 1;
        events.push({
            kind: 'rammed',
            tick: state.activeTicks,
            pursuerId: pursuer.definitionId,
            push: direction * push
        });
    }
}

function resolveEscape(state: MutableCasinoHeistState, events: CasinoHeistEvent[]): void {
    const course = state.course;
    const player = state.player;
    const front = playerFrontDistance(player);
    if (!state.announcedTurnoff && front >= course.turnoffDistance - CASINO_HEIST_TURNOFF_LEAD) {
        state.announcedTurnoff = true;
        events.push({kind: 'turnoff-ahead', tick: state.activeTicks});
    }
    const previousFront = player.previousDistance + playerReach(player);
    const drainX = getCasinoHeistDrainX(course);
    const crossedDrain = previousFront < course.drainDistance &&
        front >= course.drainDistance;
    if (crossedDrain && Math.abs(player.x - drainX) <= CASINO_HEIST_DRAIN_HALF_WIDTH) {
        state.status = 'success';
        state.terminalReason = 'drain-reached';
        state.creditsStolen = CASINO_HEIST_REWARD_CREDITS;
        events.push({
            kind: 'success',
            tick: state.activeTicks,
            credits: CASINO_HEIST_REWARD_CREDITS
        });
        return;
    }
    if (player.health <= 0) {
        state.status = 'failure';
        state.terminalReason = 'car-destroyed';
        events.push({kind: 'failure', tick: state.activeTicks, reason: 'car-destroyed'});
        return;
    }
    if (front >= course.overshootDistance) {
        state.status = 'failure';
        state.terminalReason = 'missed-turnoff';
        events.push({kind: 'failure', tick: state.activeTicks, reason: 'missed-turnoff'});
    }
}

function simulateStep(
    state: MutableCasinoHeistState,
    input: CasinoHeistInput,
    events: CasinoHeistEvent[]
): void {
    if (state.status !== 'active' || state.paused) return;
    state.activeTicks += 1;
    const wasRecovering = state.player.recoveryMs > 0;
    state.player.recoveryMs = Math.max(
        0,
        state.player.recoveryMs - CASINO_HEIST_FIXED_STEP_MS
    );
    if (wasRecovering && state.player.recoveryMs === 0) {
        events.push({kind: 'recovered', tick: state.activeTicks});
    }
    if (input.switchDevice) armNextDevice(state, events);
    updatePlayerMotion(state, input, events);
    spawnTraffic(state, events);
    updateTraffic(state);
    spawnPursuers(state, events);
    updatePursuers(state, events);
    spawnHelicopters(state, events);
    updateHelicopters(state, events);
    if (input.deploy) deployDevice(state, events);
    applyFlamethrower(state, events);
    firePlayerWeapon(state, input, events);
    updateProjectiles(state);
    updateHazards(state);
    collectPowerups(state, events);
    collideWithTraffic(state, events);
    resolveVehicleCollisions(state, events);
    resolveHazards(state, events);
    resolveProjectileHits(state, events);
    collideWithPursuers(state, events);
    resolveEscape(state, events);
}

export function stepCasinoHeist(
    state: CasinoHeistState,
    input: CasinoHeistInput
): CasinoHeistStepResult {
    if (state.status !== 'active' || state.paused) return {state, events: []};
    const next = cloneState(state);
    const events: CasinoHeistEvent[] = [];
    simulateStep(next, normalizeInput(input), events);
    return {state: freezeState(next), events};
}

export function advanceCasinoHeist(
    state: CasinoHeistState,
    input: CasinoHeistInput,
    deltaMs: number
): CasinoHeistStepResult {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
        throw new Error('Casino Heist frame delta must be a non-negative finite number.');
    }
    if (state.status !== 'active' || state.paused) {
        return {state, events: []};
    }
    const next = cloneState(state);
    const events: CasinoHeistEvent[] = [];
    const normalized = normalizeInput(input);
    next.accumulatorMs += Math.min(deltaMs, 250);
    let deployConsumed = false;
    let switchConsumed = false;
    while (next.accumulatorMs >= CASINO_HEIST_FIXED_STEP_MS && next.status === 'active') {
        next.accumulatorMs -= CASINO_HEIST_FIXED_STEP_MS;
        // Level-triggered controls fire once per frame, not once per fixed step.
        simulateStep(next, {
            ...normalized,
            deploy: normalized.deploy && !deployConsumed,
            switchDevice: normalized.switchDevice && !switchConsumed
        }, events);
        if (normalized.deploy) deployConsumed = true;
        if (normalized.switchDevice) switchConsumed = true;
    }
    return {state: freezeState(next), events};
}

export function setCasinoHeistPaused(
    state: CasinoHeistState,
    paused: boolean
): CasinoHeistState {
    if (state.paused === paused) return state;
    return {...state, paused, accumulatorMs: 0};
}

function renderY(distance: number, playerFront: number, playerScreenY: number): number {
    return playerScreenY - (distance - playerFront);
}

export function getCasinoHeistRenderSnapshot(
    state: CasinoHeistState
): CasinoHeistRenderSnapshot {
    const interpolation = clamp(state.accumulatorMs / CASINO_HEIST_FIXED_STEP_MS, 0, 1);
    const player = state.player;
    const playerFront = player.distance + (CASINO_HEIST_PLAYER_SCREEN_Y - player.screenY);
    const visibleFrom = playerFront - 260;
    const visibleTo = playerFront + 620;
    // Sample the road finely enough that its curve is limited by the screen, not
    // by the length of a segment. The rows are ordered far to near so a renderer
    // can stitch them straight into one ribbon.
    const road: CasinoHeistRenderRoadRow[] = [];
    for (let distance = visibleTo; distance >= visibleFrom; distance -= ROAD_SAMPLE_DISTANCE) {
        const geometry = getCasinoHeistRoadGeometry(state.course, distance);
        road.push({
            distance,
            y: renderY(distance, playerFront, player.screenY),
            centerX: geometry.centerX,
            leftX: geometry.leftX,
            rightX: geometry.rightX,
            dividerHalfWidth: geometry.dividerHalfWidth
        });
    }
    const powerups = state.course.segments.flatMap(segment =>
        segment.pickups
            .filter(pickup =>
                !state.collectedPickupIds.includes(pickup.id) &&
                pickup.distance > visibleFrom &&
                pickup.distance < visibleTo
            )
            .map(pickup => ({
                id: pickup.id,
                x: pickup.x,
                y: renderY(pickup.distance, playerFront, player.screenY),
                kind: pickup.kind,
                ammo: pickup.ammo
            }))
    );
    return {
        interpolation,
        road,
        laneMarkOffsets: LANE_MARK_OFFSETS,
        player: {
            x: player.x,
            y: player.screenY,
            distance: player.distance,
            health: player.health,
            maxHealth: player.maxHealth,
            recoveryMs: player.recoveryMs,
            weapon: player.weapon,
            ammo: player.ammo,
            armedDevice: player.armedDevice,
            deviceCharges: player.devices,
            flameMs: player.flameMs,
            spinOutMs: player.spinOutMs
        },
        traffic: state.traffic.map(vehicle => {
            const definition = trafficDefinition(state.course, vehicle.definitionId);
            return {
                id: vehicle.definitionId,
                x: vehicle.x,
                y: renderY(vehicle.distance, playerFront, player.screenY),
                kind: definition.kind,
                width: definition.width,
                length: definition.length,
                wrecked: vehicle.wrecked,
                damaged: !vehicle.wrecked && vehicle.health < definition.health,
                spin: vehicle.spin
            };
        }),
        powerups,
        pursuers: state.pursuers.map(pursuer => {
            const definition = pursuerDefinition(state.course, pursuer.definitionId);
            return {
                id: pursuer.definitionId,
                x: pursuer.x,
                y: renderY(pursuer.distance, playerFront, player.screenY),
                kind: definition.kind,
                health: pursuer.health,
                colorIndex: definition.colorIndex,
                blinded: pursuer.blindedMs > 0,
                spinningOut: pursuer.spinOutMs > 0,
                wrecked: pursuer.health <= 0,
                spin: pursuer.spin
            };
        }),
        helicopters: state.helicopters.map(helicopter => ({
            id: helicopter.definitionId,
            x: helicopter.x,
            y: renderY(helicopter.distance, playerFront, player.screenY),
            health: helicopter.health,
            dropped: helicopter.dropped,
            leaving: helicopter.leaving
        })),
        hazards: state.hazards.map(hazard => ({
            id: hazard.id,
            x: hazard.x,
            y: renderY(hazard.distance, playerFront, player.screenY),
            kind: hazard.kind,
            halfWidth: hazard.halfWidth
        })),
        projectiles: state.projectiles.map(projectile => ({
            id: projectile.id,
            x: projectile.x,
            y: renderY(projectile.distance, playerFront, player.screenY),
            allegiance: projectile.allegiance
        })),
        turnoffY: renderY(state.course.turnoffDistance, playerFront, player.screenY),
        drainY: renderY(state.course.drainDistance, playerFront, player.screenY),
        drainX: getCasinoHeistDrainX(state.course),
        drainHalfWidth: CASINO_HEIST_DRAIN_HALF_WIDTH,
        turnoffVisible:
            playerFront >= state.course.turnoffDistance - CASINO_HEIST_TURNOFF_LEAD,
        status: state.status,
        creditsStolen: state.creditsStolen
    };
}

/**
 * Steering is an acceleration, not a position, so aiming straight at a target
 * lags behind a road that is itself moving sideways. Ask for a lateral speed that
 * closes the gap *and* matches whatever the target is doing, then steer on the
 * error in that speed — which is what a driver does looking into a bend.
 */
function steerToward(
    player: CasinoHeistPlayerState,
    targetX: number,
    targetVelocity = 0
): number {
    const offset = targetX - player.x;
    if (
        Math.abs(offset) < 1.5 &&
        Math.abs(player.lateralVelocity - targetVelocity) < 8
    ) {
        return 0;
    }
    const desiredVelocity = clamp(
        offset * 10 + targetVelocity,
        -BASE_LATERAL_SPEED,
        BASE_LATERAL_SPEED
    );
    return clamp((desiredVelocity - player.lateralVelocity) / 40, -1, 1);
}

/** How fast the centreline is sliding sideways under a car at this point. */
function roadLateralSpeed(course: CasinoHeistCourse, distance: number): number {
    const ahead = getCasinoHeistRoadGeometry(course, distance + 30).centerX;
    const here = getCasinoHeistRoadGeometry(course, distance).centerX;
    return (ahead - here) / 30 * CASINO_HEIST_PLAYER_SPEED;
}

/**
 * The witness driver: hold the clear lane, dodge whatever is directly ahead, and
 * line up on the drain before the turn-off. It proves a generated escape is
 * completable without using any weapon or device.
 */
export function chooseCasinoHeistWitnessInput(state: CasinoHeistState): CasinoHeistInput {
    const player = state.player;
    const front = player.distance + (CASINO_HEIST_PLAYER_SCREEN_Y - player.screenY);
    const geometry = getCasinoHeistRoadGeometry(state.course, front);
    const drainX = getCasinoHeistDrainX(state.course);
    const drainGap = state.course.drainDistance - front;
    const committedToDrain = drainGap > 0 && drainGap < 420;
    const preferredX = drainGap < 900
        ? drainX
        : casinoHeistLaneX(
            geometry,
            state.course.segments[geometry.segmentIndex]!.safeLane,
            PLAYER_HALF_WIDTH
        );

    // Everything the car must not touch, projected onto the lateral axis.
    const threats = [
        ...state.traffic.map(vehicle => ({
            x: vehicle.x,
            distance: vehicle.distance,
            halfWidth: trafficDefinition(state.course, vehicle.definitionId).width / 2
        })),
        ...state.hazards
            .filter(hazard => hazard.kind === 'spike-strip')
            .map(hazard => ({
                x: hazard.x,
                distance: hazard.distance,
                halfWidth: hazard.halfWidth
            })),
    ].filter(threat =>
        threat.distance > front - 90 && threat.distance < front + 420
    );

    const minimumX = geometry.leftX + PLAYER_HALF_WIDTH + 10;
    const maximumX = geometry.rightX - PLAYER_HALF_WIDTH - 10;
    // Inside the final approach the drain is the only thing that matters: a
    // clean line that misses the mouth still loses the escape.
    if (drainGap > 0 && drainGap < 520) {
        return {
            steer: steerToward(
                player,
                clamp(drainX, minimumX, maximumX),
                roadLateralSpeed(state.course, front)
            ),
            vertical: 0,
            fire: false,
            deploy: false,
            switchDevice: false
        };
    }
    // Score a spread of lateral positions the way a driver reads a busy road: how
    // far can I run in that line before I catch anything, and am I touching
    // anything right now. Distance to the next obstruction matters far more than
    // raw lateral clearance, or a lorry four seconds ahead weighs as heavily as
    // the bumper in front.
    const samples = 25;
    let bestX = preferredX;
    let bestScore = Number.NEGATIVE_INFINITY;
    // Look at the road the car is about to enter as well as the one under it. Once
    // a median is anywhere in sight the car commits to the carriageway it is
    // already on, measured against the median's *full* width so a barrier growing
    // out of the tarmac never catches it mid-taper.
    const dividerZones = [front, front + 240, front + 460]
        .map(lookahead => getCasinoHeistRoadGeometry(state.course, lookahead))
        .filter(candidate => candidate.split)
        .map(candidate => candidate.centerX);
    let laneMinimumX = minimumX;
    let laneMaximumX = maximumX;
    for (const centerX of dividerZones) {
        const barrier = centerX +
            (player.x >= centerX ? 1 : -1) * (DIVIDER_HALF_WIDTH + PLAYER_HALF_WIDTH + 8);
        if (player.x >= centerX) laneMinimumX = Math.max(laneMinimumX, barrier);
        else laneMaximumX = Math.min(laneMaximumX, barrier);
    }
    if (laneMaximumX - laneMinimumX < 40) {
        laneMinimumX = minimumX;
        laneMaximumX = maximumX;
    }
    const preferenceWeight = committedToDrain ? 4 : 1;
    for (let index = 0; index < samples; index++) {
        const candidateX =
            laneMinimumX + (laneMaximumX - laneMinimumX) * (index / (samples - 1));
        let clearRun = 520;
        let intrusion = 0;
        for (const threat of threats) {
            const lateralGap =
                Math.abs(candidateX - threat.x) - threat.halfWidth - PLAYER_HALF_WIDTH;
            if (lateralGap >= 8) continue;
            const ahead = threat.distance - front;
            if (ahead < -70) continue;
            clearRun = Math.min(clearRun, Math.max(0, ahead));
            if (lateralGap < 0) intrusion = Math.max(intrusion, -lateralGap);
        }
        const score = clearRun * 2 -
            intrusion * 40 -
            preferenceWeight * Math.abs(candidateX - preferredX) / 8;
        if (score > bestScore) {
            bestScore = score;
            bestX = candidateX;
        }
    }
    const steer = steerToward(player, bestX, roadLateralSpeed(state.course, front));
    // Dropping back stretches the gap to a pursuer drawing level, which is the
    // counter to a window gun.
    const harried = state.pursuers.some(pursuer =>
        Math.abs(pursuer.distance - front) < 130 &&
        Math.abs(pursuer.x - player.x) < 200
    );
    const vertical = committedToDrain ? 0 : harried ? -1 : 0;
    return {steer, vertical, fire: false, deploy: false, switchDevice: false};
}

/**
 * The same escape with the police called off. The road, its traffic, its
 * dividers, and its drain are static content whose drivability is a property of
 * generation; a live pursuit is adversarial and balanced separately.
 */
export function withoutCasinoHeistPursuit(course: CasinoHeistCourse): CasinoHeistCourse {
    return {
        ...course,
        segments: course.segments.map(segment => ({
            ...segment,
            pursuers: [],
            helicopters: []
        }))
    };
}

export function replayCasinoHeistWitness(
    course: CasinoHeistCourse,
    maximumTicks = Math.ceil(
        course.overshootDistance /
        (CASINO_HEIST_PLAYER_SPEED * (CASINO_HEIST_FIXED_STEP_MS / 1_000))
    ) + 600
): CasinoHeistWitnessResult {
    let state = createCasinoHeistState(course);
    let ticks = 0;
    while (state.status === 'active' && ticks < maximumTicks) {
        state = stepCasinoHeist(state, chooseCasinoHeistWitnessInput(state)).state;
        ticks += 1;
    }
    return {success: state.status === 'success', ticks, state};
}
