import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {PNG} from 'pngjs';

const FRAME_SIZE = 64;
const COLUMNS = 8;
const ROWS = 8;
const ATLAS_WIDTH = FRAME_SIZE * COLUMNS;
const ATLAS_HEIGHT = FRAME_SIZE * ROWS;

const FRAME_NAMES = Object.freeze([
    'player-idle',
    'player-thrust-1',
    'player-thrust-2',
    'player-charge-1',
    'player-charge-2',
    'player-hit',
    'player-shield',
    'companion-drone-idle',
    'companion-drone-hit',
    'enemy-scout-idle',
    'enemy-scout-bank',
    'enemy-scout-windup',
    'enemy-scout-hit',
    'enemy-fighter-idle',
    'enemy-fighter-bank',
    'enemy-fighter-windup',
    'enemy-fighter-hit',
    'enemy-turret-idle',
    'enemy-turret-windup',
    'enemy-turret-fire',
    'enemy-turret-hit',
    'enemy-carrier-idle',
    'enemy-carrier-armored',
    'enemy-carrier-windup',
    'enemy-carrier-hit',
    'enemy-mine-idle',
    'enemy-mine-armed',
    'enemy-mine-hit',
    'pickup-splitter-core',
    'pickup-beam-coil',
    'pickup-companion-drone',
    'pickup-shield-cell',
    'pickup-bomb-refill',
    'pickup-unstable-aura',
    'projectile-player-pulse',
    'projectile-player-charge',
    'projectile-player-splitter',
    'projectile-player-drone',
    'projectile-hostile',
    'projectile-hostile-heavy',
    'projectile-boss-bolt',
    'projectile-boss-beam',
    'bomb-icon',
    'bomb-blast',
    'boss-body-phase-1',
    'boss-body-phase-2',
    'boss-body-phase-3',
    'boss-shield-node',
    'boss-shield-node-hit',
    'boss-core-closed',
    'boss-core-open',
    'boss-core-hit',
    'boss-drone',
    'boss-beam-warning',
    'debris-small',
    'debris-large',
    'explosion-1',
    'explosion-2',
    'explosion-3',
    'explosion-4',
    'impact-player',
    'impact-hostile',
    'engine-spark',
    'warning-reticle'
]);

if (FRAME_NAMES.length !== COLUMNS * ROWS) {
    throw new Error('Space atlas frame list must exactly fill its grid.');
}
if (new Set(FRAME_NAMES).size !== FRAME_NAMES.length) {
    throw new Error('Space atlas frame names must be unique.');
}

const COLORS = Object.freeze({
    transparent: Object.freeze([0, 0, 0, 0]),
    ink: Object.freeze([7, 13, 24, 255]),
    deep: Object.freeze([18, 29, 49, 255]),
    steelDark: Object.freeze([45, 65, 91, 255]),
    steel: Object.freeze([78, 111, 143, 255]),
    steelLight: Object.freeze([152, 190, 211, 255]),
    white: Object.freeze([232, 249, 255, 255]),
    cyan: Object.freeze([71, 224, 244, 255]),
    cyanLight: Object.freeze([166, 250, 255, 255]),
    cyanGlow: Object.freeze([71, 224, 244, 110]),
    blue: Object.freeze([49, 114, 207, 255]),
    purpleDark: Object.freeze([74, 43, 105, 255]),
    purple: Object.freeze([178, 99, 225, 255]),
    purpleLight: Object.freeze([229, 184, 255, 255]),
    redDark: Object.freeze([103, 34, 55, 255]),
    red: Object.freeze([238, 74, 87, 255]),
    redLight: Object.freeze([255, 170, 163, 255]),
    redGlow: Object.freeze([238, 74, 87, 105]),
    orange: Object.freeze([255, 126, 58, 255]),
    gold: Object.freeze([255, 203, 74, 255]),
    goldLight: Object.freeze([255, 241, 153, 255]),
    greenDark: Object.freeze([32, 100, 83, 255]),
    green: Object.freeze([82, 219, 155, 255]),
    greenLight: Object.freeze([179, 255, 211, 255]),
    rockDark: Object.freeze([59, 62, 74, 255]),
    rock: Object.freeze([99, 106, 119, 255]),
    rockLight: Object.freeze([155, 162, 170, 255]),
    shadow: Object.freeze([5, 9, 18, 110])
});

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const assetsDirectory = join(rootDirectory, 'assets');
const imagePath = join(assetsDirectory, 'space-sprites.png');
const metadataPath = join(assetsDirectory, 'space-sprites.json');
const atlas = new PNG({
    width: ATLAS_WIDTH,
    height: ATLAS_HEIGHT,
    colorType: 6,
    inputColorType: 6,
    inputHasAlpha: true,
    bitDepth: 8
});
atlas.data.fill(0);

function frameOrigin(frame) {
    return {
        x: (frame % COLUMNS) * FRAME_SIZE,
        y: Math.floor(frame / COLUMNS) * FRAME_SIZE
    };
}

function setPixel(frame, x, y, color) {
    const localX = Math.round(x);
    const localY = Math.round(y);
    if (localX < 0 || localX >= FRAME_SIZE || localY < 0 || localY >= FRAME_SIZE) return;
    const origin = frameOrigin(frame);
    const offset = ((origin.y + localY) * ATLAS_WIDTH + origin.x + localX) * 4;
    atlas.data[offset] = color[0];
    atlas.data[offset + 1] = color[1];
    atlas.data[offset + 2] = color[2];
    atlas.data[offset + 3] = color[3];
}

function fillRect(frame, x, y, width, height, color) {
    for (let drawY = Math.floor(y); drawY < Math.ceil(y + height); drawY++) {
        for (let drawX = Math.floor(x); drawX < Math.ceil(x + width); drawX++) {
            setPixel(frame, drawX, drawY, color);
        }
    }
}

function strokeRect(frame, x, y, width, height, color, thickness = 1) {
    fillRect(frame, x, y, width, thickness, color);
    fillRect(frame, x, y + height - thickness, width, thickness, color);
    fillRect(frame, x, y, thickness, height, color);
    fillRect(frame, x + width - thickness, y, thickness, height, color);
}

function line(frame, x0, y0, x1, y1, color, thickness = 1) {
    let currentX = Math.round(x0);
    let currentY = Math.round(y0);
    const endX = Math.round(x1);
    const endY = Math.round(y1);
    const deltaX = Math.abs(endX - currentX);
    const stepX = currentX < endX ? 1 : -1;
    const deltaY = -Math.abs(endY - currentY);
    const stepY = currentY < endY ? 1 : -1;
    let error = deltaX + deltaY;
    const radius = Math.floor((thickness - 1) / 2);
    while (true) {
        fillRect(
            frame,
            currentX - radius,
            currentY - radius,
            Math.max(1, thickness),
            Math.max(1, thickness),
            color
        );
        if (currentX === endX && currentY === endY) break;
        const doubledError = error * 2;
        if (doubledError >= deltaY) {
            error += deltaY;
            currentX += stepX;
        }
        if (doubledError <= deltaX) {
            error += deltaX;
            currentY += stepY;
        }
    }
}

function fillCircle(frame, centerX, centerY, radius, color) {
    const radiusSquared = radius * radius;
    for (let y = Math.floor(centerY - radius); y <= Math.ceil(centerY + radius); y++) {
        for (let x = Math.floor(centerX - radius); x <= Math.ceil(centerX + radius); x++) {
            const deltaX = x - centerX;
            const deltaY = y - centerY;
            if (deltaX * deltaX + deltaY * deltaY <= radiusSquared) {
                setPixel(frame, x, y, color);
            }
        }
    }
}

function ring(frame, centerX, centerY, radius, thickness, color) {
    const outerSquared = radius * radius;
    const innerSquared = Math.max(0, radius - thickness) ** 2;
    for (let y = Math.floor(centerY - radius); y <= Math.ceil(centerY + radius); y++) {
        for (let x = Math.floor(centerX - radius); x <= Math.ceil(centerX + radius); x++) {
            const deltaX = x - centerX;
            const deltaY = y - centerY;
            const distance = deltaX * deltaX + deltaY * deltaY;
            if (distance <= outerSquared && distance >= innerSquared) {
                setPixel(frame, x, y, color);
            }
        }
    }
}

function fillEllipse(frame, centerX, centerY, radiusX, radiusY, color) {
    for (let y = Math.floor(centerY - radiusY); y <= Math.ceil(centerY + radiusY); y++) {
        for (let x = Math.floor(centerX - radiusX); x <= Math.ceil(centerX + radiusX); x++) {
            const normalizedX = (x - centerX) / radiusX;
            const normalizedY = (y - centerY) / radiusY;
            if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) {
                setPixel(frame, x, y, color);
            }
        }
    }
}

function fillPolygon(frame, points, color) {
    const minimumY = Math.floor(Math.min(...points.map(([, y]) => y)));
    const maximumY = Math.ceil(Math.max(...points.map(([, y]) => y)));
    for (let y = minimumY; y <= maximumY; y++) {
        const intersections = [];
        for (let index = 0; index < points.length; index++) {
            const [x1, y1] = points[index];
            const [x2, y2] = points[(index + 1) % points.length];
            if (y1 === y2 || y < Math.min(y1, y2) || y >= Math.max(y1, y2)) continue;
            intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
        }
        intersections.sort((left, right) => left - right);
        for (let index = 0; index + 1 < intersections.length; index += 2) {
            const startX = Math.ceil(intersections[index]);
            const endX = Math.floor(intersections[index + 1]);
            for (let x = startX; x <= endX; x++) setPixel(frame, x, y, color);
        }
    }
}

function outlinePolygon(frame, points, color, thickness = 1) {
    for (let index = 0; index < points.length; index++) {
        const [x1, y1] = points[index];
        const [x2, y2] = points[(index + 1) % points.length];
        line(frame, x1, y1, x2, y2, color, thickness);
    }
}

function polygon(frame, points, fill, outline = COLORS.ink, thickness = 2) {
    fillPolygon(frame, points, fill);
    outlinePolygon(frame, points, outline, thickness);
}

function sparkle(frame, centerX, centerY, radius, color) {
    line(frame, centerX - radius, centerY, centerX + radius, centerY, color, 1);
    line(frame, centerX, centerY - radius, centerX, centerY + radius, color, 1);
    if (radius >= 4) {
        line(frame, centerX - 2, centerY - 2, centerX + 2, centerY + 2, color, 1);
        line(frame, centerX + 2, centerY - 2, centerX - 2, centerY + 2, color, 1);
    }
}

function shadow(frame, centerX = 32, centerY = 52, radiusX = 22, radiusY = 4) {
    fillEllipse(frame, centerX, centerY, radiusX, radiusY, COLORS.shadow);
}

function drawPlayer(frame, variant) {
    shadow(frame, 31, 49, 23, 3);
    const flameLength = variant === 'thrust-2' ? 16 : variant === 'thrust-1' ? 11 : 7;
    polygon(frame, [
        [6, 28], [17, 23], [19, 32], [17, 41], [6, 36], [12, 32]
    ], COLORS.orange, COLORS.ink, 2);
    polygon(frame, [
        [17, 22], [30, 17], [43, 19], [58, 30], [58, 34], [43, 45],
        [30, 47], [19, 42], [14, 35], [14, 29]
    ], variant === 'hit' ? COLORS.redLight : COLORS.steel, COLORS.ink, 2);
    polygon(frame, [[26, 18], [42, 20], [48, 29], [28, 29]], COLORS.cyan, COLORS.ink, 1);
    polygon(frame, [[26, 46], [41, 43], [35, 52], [20, 49]], COLORS.steelDark, COLORS.ink, 2);
    fillRect(frame, 46, 29, 12, 6, COLORS.white);
    fillRect(frame, 16 - flameLength, 30, flameLength, 4, COLORS.gold);
    fillRect(frame, 16 - Math.floor(flameLength * 0.65), 31, Math.floor(flameLength * 0.65), 2, COLORS.white);
    fillRect(frame, 28, 21, 8, 2, COLORS.cyanLight);
    if (variant === 'charge-1' || variant === 'charge-2') {
        const radius = variant === 'charge-2' ? 8 : 5;
        fillCircle(frame, 59, 32, radius + 3, COLORS.cyanGlow);
        fillCircle(frame, 59, 32, radius, COLORS.cyan);
        fillCircle(frame, 60, 30, Math.max(1, radius - 4), COLORS.white);
    }
    if (variant === 'hit') {
        line(frame, 20, 16, 26, 25, COLORS.white, 2);
        line(frame, 36, 43, 43, 51, COLORS.gold, 2);
        sparkle(frame, 17, 18, 4, COLORS.redLight);
    }
    if (variant === 'shield') {
        ring(frame, 33, 32, 29, 3, COLORS.cyan);
        ring(frame, 33, 32, 25, 1, COLORS.cyanGlow);
        sparkle(frame, 51, 13, 3, COLORS.white);
    }
}

function drawDrone(frame, hit) {
    shadow(frame, 32, 49, 15, 3);
    polygon(frame, [[12, 32], [21, 22], [43, 22], [53, 32], [43, 42], [21, 42]],
        hit ? COLORS.redLight : COLORS.purple, COLORS.ink, 2);
    fillCircle(frame, 32, 32, 9, COLORS.deep);
    fillCircle(frame, 32, 32, 6, hit ? COLORS.white : COLORS.cyan);
    fillRect(frame, 8, 29, 11, 6, COLORS.steelLight);
    fillRect(frame, 45, 29, 11, 6, COLORS.steelLight);
    fillRect(frame, 30, 17, 4, 6, COLORS.gold);
    if (hit) {
        line(frame, 15, 16, 24, 25, COLORS.white, 2);
        sparkle(frame, 48, 18, 5, COLORS.red);
    } else {
        ring(frame, 32, 32, 15, 1, COLORS.purpleLight);
    }
}

function drawScout(frame, variant) {
    shadow(frame, 32, 48, 20, 3);
    const verticalShift = variant === 'bank' ? -3 : 0;
    polygon(frame, [
        [8, 32], [20, 20 + verticalShift], [49, 24], [57, 32],
        [49, 40], [20, 44 - verticalShift]
    ], variant === 'hit' ? COLORS.redLight : COLORS.red, COLORS.ink, 2);
    polygon(frame, [[18, 22 + verticalShift], [31, 11], [39, 25]], COLORS.redDark, COLORS.ink, 2);
    polygon(frame, [[18, 42 - verticalShift], [31, 53], [39, 39]], COLORS.redDark, COLORS.ink, 2);
    fillEllipse(frame, 43, 32, 8, 6, COLORS.purpleDark);
    fillRect(frame, 48, 30, 7, 4, COLORS.gold);
    if (variant === 'windup') {
        fillCircle(frame, 7, 32, 6, COLORS.redGlow);
        fillCircle(frame, 7, 32, 3, COLORS.goldLight);
    }
    if (variant === 'hit') {
        sparkle(frame, 27, 19, 5, COLORS.white);
        line(frame, 35, 25, 43, 38, COLORS.red, 2);
    }
}

function drawFighter(frame, variant) {
    shadow(frame, 32, 50, 22, 3);
    const wing = variant === 'bank' ? 6 : 0;
    polygon(frame, [
        [7, 32], [18, 26], [31, 13 + wing], [36, 24], [55, 27],
        [59, 32], [55, 37], [36, 40], [31, 51 - wing], [18, 38]
    ], variant === 'hit' ? COLORS.redLight : COLORS.purpleDark, COLORS.ink, 2);
    polygon(frame, [[14, 30], [34, 24], [53, 29], [53, 35], [34, 40], [14, 34]],
        COLORS.purple, COLORS.ink, 1);
    fillEllipse(frame, 42, 32, 9, 6, COLORS.cyan);
    fillRect(frame, 6, 29, 9, 6, COLORS.orange);
    if (variant === 'windup') {
        ring(frame, 55, 32, 7, 2, COLORS.gold);
        fillCircle(frame, 55, 32, 3, COLORS.redLight);
    }
    if (variant === 'hit') {
        sparkle(frame, 19, 19, 5, COLORS.white);
        fillRect(frame, 29, 28, 8, 8, COLORS.red);
    }
}

function drawTurret(frame, variant) {
    shadow(frame, 32, 53, 22, 4);
    polygon(frame, [[10, 47], [15, 22], [25, 15], [47, 18], [54, 30], [51, 49]],
        variant === 'hit' ? COLORS.redLight : COLORS.steelDark, COLORS.ink, 2);
    fillRect(frame, 18, 28, 24, 17, COLORS.steel);
    strokeRect(frame, 18, 28, 24, 17, COLORS.ink, 2);
    fillCircle(frame, 31, 28, 11, COLORS.purpleDark);
    ring(frame, 31, 28, 10, 2, COLORS.purple);
    line(frame, 31, 27, 56, 27, COLORS.ink, 8);
    line(frame, 33, 27, 58, 27, variant === 'fire' ? COLORS.goldLight : COLORS.steelLight, 4);
    fillRect(frame, 13, 44, 37, 7, COLORS.rockDark);
    if (variant === 'windup') {
        ring(frame, 59, 27, 7, 2, COLORS.red);
        fillCircle(frame, 59, 27, 3, COLORS.gold);
    }
    if (variant === 'fire') {
        polygon(frame, [[58, 20], [63, 27], [58, 34], [60, 27]], COLORS.goldLight, COLORS.orange, 1);
    }
    if (variant === 'hit') {
        sparkle(frame, 23, 18, 5, COLORS.white);
        line(frame, 18, 35, 29, 44, COLORS.red, 2);
    }
}

function drawCarrier(frame, variant) {
    shadow(frame, 32, 52, 27, 4);
    polygon(frame, [
        [4, 32], [14, 18], [31, 11], [49, 16], [60, 27],
        [60, 37], [49, 48], [31, 53], [14, 46]
    ], variant === 'hit' ? COLORS.redLight : COLORS.redDark, COLORS.ink, 2);
    polygon(frame, [[10, 30], [23, 20], [47, 22], [55, 29], [55, 35], [47, 42], [23, 44], [10, 35]],
        COLORS.steelDark, COLORS.ink, 2);
    fillRect(frame, 24, 25, 24, 14, variant === 'armored' ? COLORS.steelLight : COLORS.steel);
    strokeRect(frame, 24, 25, 24, 14, COLORS.ink, 2);
    fillEllipse(frame, 44, 32, 8, 5, COLORS.cyan);
    fillRect(frame, 5, 29, 9, 6, COLORS.orange);
    for (const y of [19, 45]) fillRect(frame, 29, y, 12, 4, COLORS.gold);
    if (variant === 'armored') {
        strokeRect(frame, 20, 20, 32, 24, COLORS.white, 2);
        fillRect(frame, 18, 28, 4, 8, COLORS.gold);
    }
    if (variant === 'windup') {
        ring(frame, 55, 32, 8, 2, COLORS.red);
        sparkle(frame, 55, 32, 4, COLORS.goldLight);
    }
    if (variant === 'hit') {
        sparkle(frame, 17, 17, 6, COLORS.white);
        sparkle(frame, 46, 45, 4, COLORS.orange);
    }
}

function drawMine(frame, variant) {
    shadow(frame, 32, 51, 17, 3);
    const bodyColor = variant === 'hit' ? COLORS.redLight : COLORS.rockDark;
    fillCircle(frame, 32, 32, 15, bodyColor);
    ring(frame, 32, 32, 15, 3, COLORS.ink);
    for (let index = 0; index < 8; index++) {
        const angle = index * Math.PI / 4;
        line(
            frame,
            32 + Math.cos(angle) * 13,
            32 + Math.sin(angle) * 13,
            32 + Math.cos(angle) * 24,
            32 + Math.sin(angle) * 24,
            variant === 'armed' ? COLORS.red : COLORS.steelLight,
            3
        );
    }
    fillCircle(frame, 32, 32, 7, variant === 'armed' ? COLORS.red : COLORS.purpleDark);
    fillCircle(frame, 30, 30, 2, COLORS.white);
    if (variant === 'armed') ring(frame, 32, 32, 27, 2, COLORS.redGlow);
    if (variant === 'hit') {
        sparkle(frame, 46, 17, 5, COLORS.white);
        line(frame, 23, 24, 42, 42, COLORS.red, 3);
    }
}

function pickupShell(frame, unstable = false) {
    shadow(frame, 32, 52, 16, 3);
    const outline = unstable ? COLORS.red : COLORS.green;
    polygon(frame, [[32, 6], [50, 16], [55, 34], [45, 51], [20, 51], [9, 35], [14, 16]],
        COLORS.deep, outline, 3);
    ring(frame, 32, 31, 17, 2, unstable ? COLORS.redGlow : COLORS.cyanGlow);
}

function drawPickup(frame, kind) {
    pickupShell(frame, false);
    if (kind === 'splitter') {
        fillCircle(frame, 27, 31, 5, COLORS.gold);
        line(frame, 30, 31, 45, 19, COLORS.goldLight, 3);
        line(frame, 30, 31, 47, 31, COLORS.goldLight, 3);
        line(frame, 30, 31, 45, 43, COLORS.goldLight, 3);
    } else if (kind === 'beam') {
        fillRect(frame, 19, 27, 26, 9, COLORS.cyan);
        fillRect(frame, 24, 29, 25, 5, COLORS.white);
        sparkle(frame, 47, 31, 5, COLORS.cyanLight);
    } else if (kind === 'drone') {
        polygon(frame, [[17, 31], [24, 22], [41, 22], [48, 31], [41, 40], [24, 40]],
            COLORS.purple, COLORS.white, 2);
        fillCircle(frame, 32, 31, 5, COLORS.cyan);
    } else if (kind === 'shield') {
        polygon(frame, [[32, 15], [45, 20], [43, 36], [32, 47], [21, 36], [19, 20]],
            COLORS.blue, COLORS.white, 2);
        line(frame, 32, 20, 32, 41, COLORS.cyanLight, 3);
        line(frame, 24, 30, 40, 30, COLORS.cyanLight, 3);
    } else {
        fillCircle(frame, 31, 34, 12, COLORS.rockDark);
        ring(frame, 31, 34, 12, 2, COLORS.white);
        fillRect(frame, 27, 18, 8, 7, COLORS.gold);
        line(frame, 33, 20, 43, 12, COLORS.orange, 2);
        sparkle(frame, 45, 11, 4, COLORS.goldLight);
    }
}

function drawUnstableAura(frame) {
    ring(frame, 32, 32, 25, 3, COLORS.red);
    ring(frame, 32, 32, 19, 2, COLORS.purple);
    for (let index = 0; index < 8; index++) {
        const angle = index * Math.PI / 4;
        sparkle(
            frame,
            32 + Math.cos(angle) * 27,
            32 + Math.sin(angle) * 27,
            index % 2 === 0 ? 4 : 2,
            index % 2 === 0 ? COLORS.gold : COLORS.redLight
        );
    }
    fillCircle(frame, 32, 32, 7, COLORS.redGlow);
    sparkle(frame, 32, 32, 6, COLORS.white);
}

function drawProjectile(frame, kind) {
    if (kind === 'pulse') {
        fillRect(frame, 12, 28, 38, 8, COLORS.cyanGlow);
        fillRect(frame, 19, 29, 35, 6, COLORS.cyan);
        fillRect(frame, 30, 31, 25, 2, COLORS.white);
    } else if (kind === 'charge') {
        fillEllipse(frame, 31, 32, 25, 13, COLORS.cyanGlow);
        fillEllipse(frame, 36, 32, 19, 9, COLORS.cyan);
        fillEllipse(frame, 41, 30, 10, 4, COLORS.white);
        line(frame, 7, 32, 27, 32, COLORS.cyanLight, 4);
    } else if (kind === 'splitter') {
        polygon(frame, [[12, 32], [42, 24], [57, 32], [42, 40]], COLORS.gold, COLORS.white, 1);
        fillRect(frame, 18, 30, 32, 4, COLORS.goldLight);
    } else if (kind === 'drone') {
        fillEllipse(frame, 34, 32, 19, 7, COLORS.purple);
        fillRect(frame, 12, 30, 34, 4, COLORS.purpleLight);
        fillRect(frame, 30, 31, 22, 2, COLORS.white);
    } else if (kind === 'hostile') {
        fillCircle(frame, 32, 32, 10, COLORS.redGlow);
        fillCircle(frame, 32, 32, 6, COLORS.red);
        fillCircle(frame, 30, 29, 2, COLORS.white);
    } else if (kind === 'hostile-heavy') {
        fillCircle(frame, 32, 32, 16, COLORS.redGlow);
        ring(frame, 32, 32, 13, 4, COLORS.red);
        fillCircle(frame, 32, 32, 7, COLORS.orange);
        sparkle(frame, 32, 32, 4, COLORS.goldLight);
    } else if (kind === 'boss-bolt') {
        polygon(frame, [[8, 32], [24, 21], [54, 25], [61, 32], [54, 39], [24, 43]],
            COLORS.red, COLORS.goldLight, 2);
        fillRect(frame, 19, 30, 35, 4, COLORS.white);
    } else {
        fillRect(frame, 5, 25, 54, 14, COLORS.redGlow);
        fillRect(frame, 4, 29, 56, 6, COLORS.red);
        fillRect(frame, 8, 31, 52, 2, COLORS.white);
        for (const x of [10, 24, 38, 52]) fillRect(frame, x, 24, 3, 16, COLORS.gold);
    }
}

function drawBomb(frame, blast) {
    if (!blast) {
        shadow(frame, 32, 52, 17, 3);
        fillCircle(frame, 30, 34, 16, COLORS.rockDark);
        ring(frame, 30, 34, 16, 3, COLORS.ink);
        fillRect(frame, 25, 13, 10, 8, COLORS.gold);
        line(frame, 34, 15, 47, 8, COLORS.orange, 3);
        sparkle(frame, 50, 7, 5, COLORS.goldLight);
        fillCircle(frame, 25, 29, 4, COLORS.rockLight);
    } else {
        fillCircle(frame, 32, 32, 28, COLORS.cyanGlow);
        ring(frame, 32, 32, 27, 3, COLORS.cyan);
        ring(frame, 32, 32, 18, 3, COLORS.white);
        for (let index = 0; index < 8; index++) {
            const angle = index * Math.PI / 4;
            line(
                frame,
                32 + Math.cos(angle) * 10,
                32 + Math.sin(angle) * 10,
                32 + Math.cos(angle) * 30,
                32 + Math.sin(angle) * 30,
                COLORS.gold,
                2
            );
        }
        fillCircle(frame, 32, 32, 8, COLORS.white);
    }
}

function drawBossBody(frame, phase) {
    shadow(frame, 34, 57, 27, 4);
    const bodyColor = phase === 1 ? COLORS.steelDark : phase === 2 ? COLORS.purpleDark : COLORS.redDark;
    polygon(frame, [
        [11, 7], [38, 3], [55, 15], [59, 32], [55, 49], [38, 61],
        [11, 57], [18, 44], [13, 32], [18, 20]
    ], bodyColor, COLORS.ink, 2);
    polygon(frame, [[27, 12], [45, 12], [53, 24], [53, 40], [45, 52], [27, 52], [20, 40], [20, 24]],
        COLORS.steel, COLORS.ink, 2);
    fillCircle(frame, 42, 32, 12, phase === 1 ? COLORS.purpleDark : phase === 2 ? COLORS.cyan : COLORS.red);
    ring(frame, 42, 32, 11, 3, phase === 3 ? COLORS.gold : COLORS.white);
    fillRect(frame, 9, 18, 11, 7, COLORS.gold);
    fillRect(frame, 9, 39, 11, 7, COLORS.gold);
    if (phase >= 2) {
        line(frame, 22, 14, 13, 6, COLORS.red, 3);
        line(frame, 24, 49, 14, 58, COLORS.orange, 3);
    }
    if (phase === 3) {
        sparkle(frame, 12, 31, 5, COLORS.white);
        fillRect(frame, 31, 7, 5, 11, COLORS.redLight);
        fillRect(frame, 31, 46, 5, 11, COLORS.redLight);
    }
}

function drawBossNode(frame, hit) {
    shadow(frame, 32, 53, 18, 3);
    polygon(frame, [[32, 7], [48, 15], [56, 32], [48, 49], [32, 57], [16, 49], [8, 32], [16, 15]],
        hit ? COLORS.redLight : COLORS.purpleDark, COLORS.ink, 2);
    ring(frame, 32, 32, 17, 4, hit ? COLORS.white : COLORS.purple);
    fillCircle(frame, 32, 32, 9, hit ? COLORS.red : COLORS.cyan);
    fillCircle(frame, 29, 29, 3, COLORS.white);
    if (hit) {
        line(frame, 16, 15, 47, 49, COLORS.red, 3);
        sparkle(frame, 48, 14, 5, COLORS.gold);
    }
}

function drawBossCore(frame, variant) {
    shadow(frame, 32, 54, 18, 3);
    fillCircle(frame, 32, 32, 22, COLORS.deep);
    ring(frame, 32, 32, 21, 4, COLORS.steel);
    if (variant === 'closed') {
        polygon(frame, [[14, 17], [31, 27], [31, 37], [14, 47]], COLORS.steelDark, COLORS.ink, 2);
        polygon(frame, [[50, 17], [33, 27], [33, 37], [50, 47]], COLORS.steelDark, COLORS.ink, 2);
        fillRect(frame, 30, 17, 4, 30, COLORS.gold);
    } else {
        fillCircle(frame, 32, 32, 15, variant === 'hit' ? COLORS.red : COLORS.cyan);
        ring(frame, 32, 32, 14, 3, COLORS.white);
        fillCircle(frame, 28, 28, 5, COLORS.cyanLight);
        if (variant === 'hit') {
            sparkle(frame, 46, 17, 6, COLORS.white);
            line(frame, 19, 22, 43, 43, COLORS.gold, 3);
        }
    }
}

function drawBossDrone(frame) {
    shadow(frame, 32, 51, 19, 3);
    polygon(frame, [[7, 31], [18, 18], [46, 18], [57, 31], [46, 44], [18, 44]],
        COLORS.redDark, COLORS.ink, 2);
    fillCircle(frame, 32, 31, 10, COLORS.purple);
    ring(frame, 32, 31, 9, 2, COLORS.white);
    fillRect(frame, 8, 28, 12, 6, COLORS.gold);
    fillRect(frame, 44, 28, 12, 6, COLORS.gold);
    fillCircle(frame, 32, 31, 4, COLORS.redLight);
}

function drawBeamWarning(frame) {
    fillRect(frame, 5, 29, 54, 6, COLORS.redGlow);
    for (let x = 6; x < 60; x += 8) fillRect(frame, x, 27, 4, 10, COLORS.gold);
    line(frame, 5, 32, 59, 32, COLORS.redLight, 2);
    fillCircle(frame, 7, 32, 5, COLORS.redGlow);
    fillCircle(frame, 57, 32, 5, COLORS.redGlow);
}

function drawDebris(frame, large) {
    shadow(frame, 32, 54, large ? 22 : 15, 3);
    const points = large
        ? [[8, 27], [17, 11], [38, 7], [56, 20], [52, 43], [37, 56], [14, 48]]
        : [[15, 29], [22, 17], [39, 14], [50, 27], [44, 44], [25, 48], [13, 39]];
    polygon(frame, points, COLORS.rock, COLORS.ink, 2);
    fillPolygon(frame, large ? [[17, 17], [35, 11], [31, 25], [13, 31]] : [[22, 22], [37, 18], [32, 30], [18, 33]],
        COLORS.rockLight);
    fillCircle(frame, large ? 41 : 36, large ? 37 : 38, large ? 8 : 6, COLORS.rockDark);
    ring(frame, large ? 41 : 36, large ? 37 : 38, large ? 8 : 6, 2, COLORS.ink);
    line(frame, 18, 40, 31, 47, COLORS.steelDark, 2);
}

function drawExplosion(frame, stage) {
    const radius = [7, 14, 22, 28][stage - 1];
    const inner = Math.max(3, radius - 8);
    fillCircle(frame, 32, 32, radius, stage === 4 ? COLORS.redGlow : COLORS.orange);
    if (stage >= 2) ring(frame, 32, 32, radius, 3, COLORS.gold);
    fillCircle(frame, 32, 32, inner, stage === 1 ? COLORS.white : COLORS.goldLight);
    for (let index = 0; index < stage * 2 + 2; index++) {
        const angle = (index / (stage * 2 + 2)) * Math.PI * 2;
        const start = Math.max(4, radius - 4);
        const end = Math.min(30, radius + 5 + (index % 3) * 2);
        line(
            frame,
            32 + Math.cos(angle) * start,
            32 + Math.sin(angle) * start,
            32 + Math.cos(angle) * end,
            32 + Math.sin(angle) * end,
            index % 2 === 0 ? COLORS.white : COLORS.redLight,
            2
        );
    }
}

function drawImpact(frame, player) {
    const primary = player ? COLORS.cyan : COLORS.red;
    const secondary = player ? COLORS.white : COLORS.goldLight;
    for (let index = 0; index < 10; index++) {
        const angle = index / 10 * Math.PI * 2;
        line(
            frame,
            32 + Math.cos(angle) * 5,
            32 + Math.sin(angle) * 5,
            32 + Math.cos(angle) * (17 + index % 3 * 4),
            32 + Math.sin(angle) * (17 + index % 3 * 4),
            index % 2 === 0 ? primary : secondary,
            index % 3 === 0 ? 3 : 2
        );
    }
    fillCircle(frame, 32, 32, 7, secondary);
}

function drawEngineSpark(frame) {
    polygon(frame, [[5, 32], [22, 24], [35, 28], [57, 32], [35, 36], [22, 40]],
        COLORS.orange, COLORS.goldLight, 1);
    fillRect(frame, 10, 30, 37, 4, COLORS.gold);
    fillRect(frame, 26, 31, 28, 2, COLORS.white);
    sparkle(frame, 14, 21, 3, COLORS.cyan);
    sparkle(frame, 20, 44, 2, COLORS.redLight);
}

function drawWarningReticle(frame) {
    ring(frame, 32, 32, 23, 2, COLORS.red);
    ring(frame, 32, 32, 13, 1, COLORS.gold);
    line(frame, 32, 4, 32, 20, COLORS.redLight, 2);
    line(frame, 32, 44, 32, 60, COLORS.redLight, 2);
    line(frame, 4, 32, 20, 32, COLORS.redLight, 2);
    line(frame, 44, 32, 60, 32, COLORS.redLight, 2);
    fillCircle(frame, 32, 32, 3, COLORS.goldLight);
}

const DRAWERS = Object.freeze({
    'player-idle': frame => drawPlayer(frame, 'idle'),
    'player-thrust-1': frame => drawPlayer(frame, 'thrust-1'),
    'player-thrust-2': frame => drawPlayer(frame, 'thrust-2'),
    'player-charge-1': frame => drawPlayer(frame, 'charge-1'),
    'player-charge-2': frame => drawPlayer(frame, 'charge-2'),
    'player-hit': frame => drawPlayer(frame, 'hit'),
    'player-shield': frame => drawPlayer(frame, 'shield'),
    'companion-drone-idle': frame => drawDrone(frame, false),
    'companion-drone-hit': frame => drawDrone(frame, true),
    'enemy-scout-idle': frame => drawScout(frame, 'idle'),
    'enemy-scout-bank': frame => drawScout(frame, 'bank'),
    'enemy-scout-windup': frame => drawScout(frame, 'windup'),
    'enemy-scout-hit': frame => drawScout(frame, 'hit'),
    'enemy-fighter-idle': frame => drawFighter(frame, 'idle'),
    'enemy-fighter-bank': frame => drawFighter(frame, 'bank'),
    'enemy-fighter-windup': frame => drawFighter(frame, 'windup'),
    'enemy-fighter-hit': frame => drawFighter(frame, 'hit'),
    'enemy-turret-idle': frame => drawTurret(frame, 'idle'),
    'enemy-turret-windup': frame => drawTurret(frame, 'windup'),
    'enemy-turret-fire': frame => drawTurret(frame, 'fire'),
    'enemy-turret-hit': frame => drawTurret(frame, 'hit'),
    'enemy-carrier-idle': frame => drawCarrier(frame, 'idle'),
    'enemy-carrier-armored': frame => drawCarrier(frame, 'armored'),
    'enemy-carrier-windup': frame => drawCarrier(frame, 'windup'),
    'enemy-carrier-hit': frame => drawCarrier(frame, 'hit'),
    'enemy-mine-idle': frame => drawMine(frame, 'idle'),
    'enemy-mine-armed': frame => drawMine(frame, 'armed'),
    'enemy-mine-hit': frame => drawMine(frame, 'hit'),
    'pickup-splitter-core': frame => drawPickup(frame, 'splitter'),
    'pickup-beam-coil': frame => drawPickup(frame, 'beam'),
    'pickup-companion-drone': frame => drawPickup(frame, 'drone'),
    'pickup-shield-cell': frame => drawPickup(frame, 'shield'),
    'pickup-bomb-refill': frame => drawPickup(frame, 'bomb'),
    'pickup-unstable-aura': drawUnstableAura,
    'projectile-player-pulse': frame => drawProjectile(frame, 'pulse'),
    'projectile-player-charge': frame => drawProjectile(frame, 'charge'),
    'projectile-player-splitter': frame => drawProjectile(frame, 'splitter'),
    'projectile-player-drone': frame => drawProjectile(frame, 'drone'),
    'projectile-hostile': frame => drawProjectile(frame, 'hostile'),
    'projectile-hostile-heavy': frame => drawProjectile(frame, 'hostile-heavy'),
    'projectile-boss-bolt': frame => drawProjectile(frame, 'boss-bolt'),
    'projectile-boss-beam': frame => drawProjectile(frame, 'boss-beam'),
    'bomb-icon': frame => drawBomb(frame, false),
    'bomb-blast': frame => drawBomb(frame, true),
    'boss-body-phase-1': frame => drawBossBody(frame, 1),
    'boss-body-phase-2': frame => drawBossBody(frame, 2),
    'boss-body-phase-3': frame => drawBossBody(frame, 3),
    'boss-shield-node': frame => drawBossNode(frame, false),
    'boss-shield-node-hit': frame => drawBossNode(frame, true),
    'boss-core-closed': frame => drawBossCore(frame, 'closed'),
    'boss-core-open': frame => drawBossCore(frame, 'open'),
    'boss-core-hit': frame => drawBossCore(frame, 'hit'),
    'boss-drone': drawBossDrone,
    'boss-beam-warning': drawBeamWarning,
    'debris-small': frame => drawDebris(frame, false),
    'debris-large': frame => drawDebris(frame, true),
    'explosion-1': frame => drawExplosion(frame, 1),
    'explosion-2': frame => drawExplosion(frame, 2),
    'explosion-3': frame => drawExplosion(frame, 3),
    'explosion-4': frame => drawExplosion(frame, 4),
    'impact-player': frame => drawImpact(frame, true),
    'impact-hostile': frame => drawImpact(frame, false),
    'engine-spark': drawEngineSpark,
    'warning-reticle': drawWarningReticle
});

for (let frame = 0; frame < FRAME_NAMES.length; frame++) {
    const name = FRAME_NAMES[frame];
    const draw = DRAWERS[name];
    if (draw === undefined) throw new Error(`Missing Space atlas drawer for ${name}.`);
    draw(frame);
}

const frames = {};
for (let index = 0; index < FRAME_NAMES.length; index++) {
    const name = FRAME_NAMES[index];
    const origin = frameOrigin(index);
    frames[name] = {
        frame: {x: origin.x, y: origin.y, w: FRAME_SIZE, h: FRAME_SIZE},
        rotated: false,
        trimmed: false,
        spriteSourceSize: {x: 0, y: 0, w: FRAME_SIZE, h: FRAME_SIZE},
        sourceSize: {w: FRAME_SIZE, h: FRAME_SIZE},
        pivot: {x: 0.5, y: 0.5}
    };
}

const metadata = {
    formatVersion: 1,
    contentVersion: 'space-atlas-v1',
    frameSize: FRAME_SIZE,
    frames,
    animations: {
        'player-thrust': ['player-thrust-1', 'player-thrust-2'],
        'player-charge': ['player-charge-1', 'player-charge-2'],
        'scout-flight': ['enemy-scout-idle', 'enemy-scout-bank'],
        'fighter-flight': ['enemy-fighter-idle', 'enemy-fighter-bank'],
        'turret-attack': ['enemy-turret-windup', 'enemy-turret-fire'],
        'carrier-attack': ['enemy-carrier-windup', 'enemy-carrier-idle'],
        'mine-warning': ['enemy-mine-idle', 'enemy-mine-armed'],
        explosion: ['explosion-1', 'explosion-2', 'explosion-3', 'explosion-4']
    },
    meta: {
        app: 'maze-space-atlas-generator',
        version: '1.0',
        image: 'space-sprites.png',
        format: 'RGBA8888',
        size: {w: ATLAS_WIDTH, h: ATLAS_HEIGHT},
        scale: '1'
    }
};

mkdirSync(assetsDirectory, {recursive: true});
const encoded = PNG.sync.write(atlas, {
    colorType: 6,
    inputColorType: 6,
    inputHasAlpha: true,
    bitDepth: 8,
    filterType: 4,
    deflateLevel: 9,
    deflateStrategy: 3
});
writeFileSync(imagePath, encoded);
writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
console.log(
    `Generated ${FRAME_NAMES.length}-frame ${ATLAS_WIDTH}x${ATLAS_HEIGHT} Space atlas and metadata.`
);
