export const PLATFORMER_PLAYER_SIZE = Object.freeze({width: 28, height: 40});

export interface PlatformRect {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface PlatformerCollectible {
    readonly id: string;
    readonly x: number;
    readonly y: number;
}

export interface PlatformerLevel {
    readonly width: number;
    readonly height: number;
    readonly spawn: {readonly x: number; readonly y: number};
    readonly platforms: readonly PlatformRect[];
    readonly hazards: readonly PlatformRect[];
    readonly checkpoints: readonly PlatformRect[];
    readonly goal: PlatformRect;
    readonly collectibles: readonly PlatformerCollectible[];
}

export interface PlatformerState {
    readonly x: number;
    readonly y: number;
    readonly velocityX: number;
    readonly velocityY: number;
    readonly grounded: boolean;
    readonly coyoteMs: number;
    readonly jumpBufferMs: number;
    readonly checkpoint: {readonly x: number; readonly y: number};
    readonly deaths: number;
    readonly collectedIds: readonly string[];
    readonly completed: boolean;
}

export interface PlatformerInput {
    readonly horizontal: -1 | 0 | 1;
    readonly jumpPressed: boolean;
    readonly jumpHeld: boolean;
}

export interface PlatformerLevelModifiers {
    readonly powerRouting: number;
    readonly miningPower: number;
    readonly airspaceControl: number;
}

function overlaps(
    x: number,
    y: number,
    width: number,
    height: number,
    rect: PlatformRect
): boolean {
    return x < rect.x + rect.width && x + width > rect.x &&
        y < rect.y + rect.height && y + height > rect.y;
}

export function createActOnePlatformerLevel(
    modifiers: PlatformerLevelModifiers
): PlatformerLevel {
    const platforms: PlatformRect[] = [
        {id: 'ground-1', x: 0, y: 590, width: 360, height: 82},
        {id: 'ground-2', x: 440, y: 590, width: 300, height: 82},
        {id: 'ground-3', x: 840, y: 590, width: 300, height: 82},
        {id: 'ground-4', x: 1230, y: 590, width: 370, height: 82},
        {id: 'memory-ledge', x: 510, y: 485, width: 140, height: 20},
        {id: 'relay-ledge', x: 910, y: 455, width: 130, height: 20},
        {id: 'goal-step', x: 1390, y: 520, width: 180, height: 20}
    ];
    if (modifiers.miningPower >= 2) {
        platforms.push({id: 'tool-bridge', x: 350, y: 590, width: 100, height: 82});
    }
    if (modifiers.airspaceControl >= 60) {
        platforms.push({id: 'supply-drone-bridge', x: 725, y: 590, width: 130, height: 82});
    }
    if (modifiers.powerRouting >= 60) {
        platforms.push({id: 'powered-lift', x: 1125, y: 590, width: 120, height: 82});
    }

    return {
        width: 1600,
        height: 672,
        spawn: {x: 70, y: 550},
        platforms,
        hazards: [
            {id: 'spark-strip', x: 1010, y: 570, width: 34, height: 20},
            {id: 'lower-void', x: 0, y: 665, width: 1600, height: 7}
        ],
        checkpoints: modifiers.airspaceControl >= 60
            ? [{id: 'drone-checkpoint', x: 875, y: 520, width: 36, height: 70}]
            : [],
        goal: {id: 'maintenance-exit', x: 1510, y: 450, width: 48, height: 140},
        collectibles: [
            {id: 'cartridge-red', x: 560, y: 445},
            {id: 'cartridge-blue', x: 960, y: 415},
            {id: 'cartridge-gold', x: 1440, y: 480}
        ]
    };
}

export function createPlatformerState(level: PlatformerLevel): PlatformerState {
    return {
        x: level.spawn.x,
        y: level.spawn.y - PLATFORMER_PLAYER_SIZE.height,
        velocityX: 0,
        velocityY: 0,
        grounded: false,
        coyoteMs: 0,
        jumpBufferMs: 0,
        checkpoint: level.spawn,
        deaths: 0,
        collectedIds: [],
        completed: false
    };
}

function respawn(state: PlatformerState): PlatformerState {
    return {
        ...state,
        x: state.checkpoint.x,
        y: state.checkpoint.y - PLATFORMER_PLAYER_SIZE.height,
        velocityX: 0,
        velocityY: 0,
        grounded: false,
        coyoteMs: 0,
        jumpBufferMs: 0,
        deaths: state.deaths + 1
    };
}

export function stepPlatformer(
    state: PlatformerState,
    input: PlatformerInput,
    level: PlatformerLevel,
    deltaMs: number
): PlatformerState {
    const frameMs = Math.min(32, Math.max(0, deltaMs));
    const seconds = frameMs / 1000;
    let jumpBufferMs = input.jumpPressed ? 120 : Math.max(0, state.jumpBufferMs - frameMs);
    let coyoteMs = state.grounded ? 100 : Math.max(0, state.coyoteMs - frameMs);
    let velocityY = state.velocityY;
    let grounded = false;

    if (jumpBufferMs > 0 && coyoteMs > 0) {
        velocityY = -390;
        jumpBufferMs = 0;
        coyoteMs = 0;
    }
    if (!input.jumpHeld && velocityY < -170) velocityY = -170;
    velocityY = Math.min(700, velocityY + 950 * seconds);
    const velocityX = input.horizontal * 190;
    const previousBottom = state.y + PLATFORMER_PLAYER_SIZE.height;
    let x = Math.max(0, Math.min(level.width - PLATFORMER_PLAYER_SIZE.width, state.x + velocityX * seconds));
    let y = state.y + velocityY * seconds;
    const nextBottom = y + PLATFORMER_PLAYER_SIZE.height;

    if (velocityY >= 0) {
        for (const platform of level.platforms) {
            const horizontalOverlap = x < platform.x + platform.width &&
                x + PLATFORMER_PLAYER_SIZE.width > platform.x;
            if (!horizontalOverlap || previousBottom > platform.y || nextBottom < platform.y) continue;
            y = platform.y - PLATFORMER_PLAYER_SIZE.height;
            velocityY = 0;
            grounded = true;
            coyoteMs = 100;
            break;
        }
    }

    let nextState: PlatformerState = {
        ...state,
        x,
        y,
        velocityX,
        velocityY,
        grounded,
        coyoteMs,
        jumpBufferMs
    };
    const hitHazard = level.hazards.some(hazard => overlaps(
        x,
        y,
        PLATFORMER_PLAYER_SIZE.width,
        PLATFORMER_PLAYER_SIZE.height,
        hazard
    ));
    if (hitHazard || y > level.height) return respawn(nextState);

    const checkpoint = level.checkpoints.find(candidate => overlaps(
        x,
        y,
        PLATFORMER_PLAYER_SIZE.width,
        PLATFORMER_PLAYER_SIZE.height,
        candidate
    ));
    if (checkpoint) {
        nextState = {
            ...nextState,
            checkpoint: {x: checkpoint.x, y: checkpoint.y}
        };
    }

    const collectedIds = new Set(nextState.collectedIds);
    for (const collectible of level.collectibles) {
        if (collectedIds.has(collectible.id)) continue;
        const collectibleRect: PlatformRect = {
            id: collectible.id,
            x: collectible.x - 12,
            y: collectible.y - 12,
            width: 24,
            height: 24
        };
        if (overlaps(x, y, PLATFORMER_PLAYER_SIZE.width, PLATFORMER_PLAYER_SIZE.height, collectibleRect)) {
            collectedIds.add(collectible.id);
        }
    }

    return {
        ...nextState,
        collectedIds: [...collectedIds],
        completed: overlaps(
            x,
            y,
            PLATFORMER_PLAYER_SIZE.width,
            PLATFORMER_PLAYER_SIZE.height,
            level.goal
        )
    };
}