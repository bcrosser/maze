import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {PNG} from 'pngjs';

const FRAME_SIZE = 32;
const FRAME_COUNT = 8;
const ATLAS_WIDTH = FRAME_SIZE * FRAME_COUNT;
const ATLAS_HEIGHT = FRAME_SIZE;

const COLORS = Object.freeze({
    ink: Object.freeze([16, 23, 29, 255]),
    deepShadow: Object.freeze([24, 31, 37, 210]),
    metalDark: Object.freeze([73, 91, 94, 255]),
    metal: Object.freeze([132, 158, 158, 255]),
    metalLight: Object.freeze([203, 224, 216, 255]),
    liquid: Object.freeze([47, 193, 224, 255]),
    liquidLight: Object.freeze([165, 244, 250, 255]),
    woodDark: Object.freeze([91, 49, 31, 255]),
    wood: Object.freeze([153, 83, 42, 255]),
    woodLight: Object.freeze([207, 128, 60, 255]),
    goldDark: Object.freeze([142, 91, 26, 255]),
    gold: Object.freeze([226, 174, 48, 255]),
    goldLight: Object.freeze([255, 224, 105, 255]),
    hullDark: Object.freeze([48, 71, 102, 255]),
    hull: Object.freeze([94, 147, 184, 255]),
    hullLight: Object.freeze([184, 225, 235, 255]),
    canopy: Object.freeze([74, 221, 218, 255]),
    engine: Object.freeze([232, 92, 48, 255]),
    flame: Object.freeze([255, 192, 63, 255]),
    liftDark: Object.freeze([48, 57, 65, 255]),
    lift: Object.freeze([104, 117, 126, 255]),
    liftLight: Object.freeze([181, 194, 194, 255]),
    indicator: Object.freeze([108, 221, 165, 255]),
    circuitDark: Object.freeze([43, 42, 74, 255]),
    circuitPurple: Object.freeze([137, 93, 214, 255]),
    circuitGreen: Object.freeze([92, 225, 148, 255]),
    circuitPink: Object.freeze([245, 91, 151, 255]),
    horseDark: Object.freeze([72, 43, 29, 255]),
    horse: Object.freeze([156, 91, 48, 255]),
    horseLight: Object.freeze([225, 161, 86, 255]),
    road: Object.freeze([47, 53, 61, 255]),
    roadStripe: Object.freeze([244, 215, 98, 255])
});

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(rootDirectory, 'assets', 'objective-sprites.png');
const atlas = new PNG({
    width: ATLAS_WIDTH,
    height: ATLAS_HEIGHT,
    colorType: 6,
    inputColorType: 6,
    inputHasAlpha: true,
    bitDepth: 8
});
atlas.data.fill(0);

function setPixel(x, y, color) {
    if (x < 0 || x >= ATLAS_WIDTH || y < 0 || y >= ATLAS_HEIGHT) return;
    const offset = (y * ATLAS_WIDTH + x) * 4;
    atlas.data[offset] = color[0];
    atlas.data[offset + 1] = color[1];
    atlas.data[offset + 2] = color[2];
    atlas.data[offset + 3] = color[3];
}

function fillRect(frame, x, y, width, height, color) {
    const frameX = frame * FRAME_SIZE;
    for (let drawY = y; drawY < y + height; drawY++) {
        for (let drawX = x; drawX < x + width; drawX++) {
            setPixel(frameX + drawX, drawY, color);
        }
    }
}

function line(frame, x0, y0, x1, y1, color) {
    const frameX = frame * FRAME_SIZE;
    let currentX = x0;
    let currentY = y0;
    const deltaX = Math.abs(x1 - x0);
    const stepX = x0 < x1 ? 1 : -1;
    const deltaY = -Math.abs(y1 - y0);
    const stepY = y0 < y1 ? 1 : -1;
    let error = deltaX + deltaY;
    while (true) {
        setPixel(frameX + currentX, currentY, color);
        if (currentX === x1 && currentY === y1) break;
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

function fillPolygon(frame, points, color) {
    const minimumY = Math.min(...points.map(([, y]) => y));
    const maximumY = Math.max(...points.map(([, y]) => y));
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
            for (let x = startX; x <= endX; x++) {
                setPixel(frame * FRAME_SIZE + x, y, color);
            }
        }
    }
}

function drawPipe() {
    const frame = 0;
    fillRect(frame, 5, 28, 24, 2, COLORS.deepShadow);

    // Heavy elbow silhouette and flanged ends.
    fillRect(frame, 5, 2, 12, 18, COLORS.ink);
    fillRect(frame, 10, 15, 19, 12, COLORS.ink);
    fillRect(frame, 3, 3, 16, 5, COLORS.ink);
    fillRect(frame, 25, 13, 5, 16, COLORS.ink);

    fillRect(frame, 7, 6, 8, 13, COLORS.metal);
    fillRect(frame, 12, 17, 15, 8, COLORS.metal);
    fillRect(frame, 5, 4, 12, 3, COLORS.metalLight);
    fillRect(frame, 27, 15, 2, 12, COLORS.metalLight);
    fillRect(frame, 8, 8, 2, 9, COLORS.metalLight);
    fillRect(frame, 14, 18, 11, 2, COLORS.metalLight);

    // The bright coolant remains readable as an inset L when desaturated.
    fillRect(frame, 11, 7, 3, 12, COLORS.liquid);
    fillRect(frame, 12, 20, 14, 3, COLORS.liquid);
    fillRect(frame, 12, 8, 1, 8, COLORS.liquidLight);
    fillRect(frame, 16, 20, 8, 1, COLORS.liquidLight);
    fillRect(frame, 6, 4, 2, 2, COLORS.metalDark);
    fillRect(frame, 14, 4, 2, 2, COLORS.metalDark);
    fillRect(frame, 27, 16, 2, 2, COLORS.metalDark);
    fillRect(frame, 27, 24, 2, 2, COLORS.metalDark);
}

function drawChest() {
    const frame = 1;
    fillRect(frame, 4, 28, 24, 2, COLORS.deepShadow);

    // Stepped domed lid gives the frame a strong chest silhouette.
    fillRect(frame, 5, 9, 22, 8, COLORS.ink);
    fillRect(frame, 7, 6, 18, 4, COLORS.ink);
    fillRect(frame, 10, 4, 12, 3, COLORS.ink);
    fillRect(frame, 4, 15, 24, 13, COLORS.ink);
    fillRect(frame, 7, 10, 18, 5, COLORS.wood);
    fillRect(frame, 9, 7, 14, 3, COLORS.woodLight);
    fillRect(frame, 11, 6, 10, 2, COLORS.wood);
    fillRect(frame, 6, 18, 20, 8, COLORS.wood);
    fillRect(frame, 7, 19, 18, 2, COLORS.woodLight);

    fillRect(frame, 5, 14, 22, 4, COLORS.goldDark);
    fillRect(frame, 6, 14, 20, 2, COLORS.gold);
    fillRect(frame, 8, 8, 3, 18, COLORS.gold);
    fillRect(frame, 22, 8, 3, 18, COLORS.gold);

    // Oversized plate/keyhole stays legible at native resolution.
    fillRect(frame, 13, 17, 7, 9, COLORS.goldDark);
    fillRect(frame, 14, 18, 5, 7, COLORS.gold);
    fillRect(frame, 15, 19, 3, 3, COLORS.ink);
    fillRect(frame, 16, 21, 1, 3, COLORS.ink);
    fillRect(frame, 6, 27, 5, 2, COLORS.ink);
    fillRect(frame, 21, 27, 5, 2, COLORS.ink);
    setPixel(frame * FRAME_SIZE + 15, 14, COLORS.goldLight);
    setPixel(frame * FRAME_SIZE + 18, 14, COLORS.goldLight);
}

function drawSpaceship() {
    const frame = 2;
    fillRect(frame, 3, 27, 25, 2, COLORS.deepShadow);

    // Exhaust plume, then a compact right-facing ship silhouette.
    fillPolygon(frame, [[1, 14], [7, 11], [9, 15], [7, 20], [1, 18], [4, 16]], COLORS.ink);
    fillPolygon(frame, [[2, 15], [7, 13], [7, 18], [2, 17], [5, 16]], COLORS.engine);
    fillPolygon(frame, [[2, 16], [6, 15], [6, 17]], COLORS.flame);

    fillPolygon(
        frame,
        [[6, 11], [12, 9], [20, 9], [24, 12], [31, 15], [31, 17],
            [24, 20], [18, 20], [13, 24], [8, 24], [10, 19], [6, 18]],
        COLORS.ink
    );
    fillPolygon(
        frame,
        [[8, 12], [13, 11], [20, 11], [24, 14], [28, 15], [28, 17],
            [23, 18], [17, 18], [12, 22], [10, 22], [12, 18], [8, 17]],
        COLORS.hull
    );
    fillPolygon(frame, [[15, 10], [20, 10], [23, 14], [16, 14]], COLORS.canopy);
    fillRect(frame, 17, 11, 3, 1, COLORS.hullLight);
    fillPolygon(frame, [[13, 18], [21, 18], [17, 22], [10, 22]], COLORS.hullDark);
    fillRect(frame, 7, 13, 3, 4, COLORS.metalDark);
    fillRect(frame, 24, 15, 5, 2, COLORS.hullLight);
    fillRect(frame, 10, 13, 4, 1, COLORS.hullLight);
    setPixel(frame * FRAME_SIZE + 29, 15, COLORS.goldLight);
}

function drawElevator() {
    const frame = 3;
    fillRect(frame, 3, 29, 26, 2, COLORS.deepShadow);

    // Tall frame and split doors read as a lift even in monochrome.
    fillRect(frame, 5, 2, 22, 28, COLORS.ink);
    fillRect(frame, 7, 4, 18, 24, COLORS.lift);
    fillRect(frame, 9, 10, 14, 17, COLORS.liftDark);
    fillRect(frame, 10, 11, 6, 15, COLORS.metalDark);
    fillRect(frame, 17, 11, 5, 15, COLORS.metalDark);
    fillRect(frame, 15, 10, 2, 17, COLORS.ink);
    fillRect(frame, 10, 11, 1, 15, COLORS.liftLight);
    fillRect(frame, 21, 11, 1, 15, COLORS.liftLight);
    fillRect(frame, 7, 27, 18, 2, COLORS.metalLight);

    fillRect(frame, 11, 5, 10, 4, COLORS.ink);
    fillRect(frame, 12, 6, 8, 2, COLORS.indicator);
    fillPolygon(frame, [[13, 8], [15, 5], [17, 8]], COLORS.metalLight);
    fillPolygon(frame, [[17, 5], [19, 8], [21, 5]], COLORS.gold);
    fillRect(frame, 3, 27, 26, 3, COLORS.ink);
    fillRect(frame, 5, 27, 22, 1, COLORS.gold);
    fillRect(frame, 24, 15, 2, 5, COLORS.goldDark);
    setPixel(frame * FRAME_SIZE + 24, 16, COLORS.goldLight);
}

function drawCircuit() {
    const frame = 4;
    fillRect(frame, 3, 28, 26, 2, COLORS.deepShadow);

    // A beveled processor package with bright branching traces.
    fillRect(frame, 5, 5, 22, 22, COLORS.ink);
    fillRect(frame, 7, 7, 18, 18, COLORS.circuitDark);
    fillRect(frame, 9, 9, 14, 14, COLORS.circuitPurple);
    fillRect(frame, 11, 11, 10, 10, COLORS.ink);
    fillRect(frame, 13, 13, 6, 6, COLORS.circuitGreen);
    fillRect(frame, 14, 14, 4, 4, COLORS.metalLight);

    for (const offset of [8, 13, 18, 23]) {
        fillRect(frame, offset, 2, 2, 4, COLORS.metal);
        fillRect(frame, offset, 26, 2, 4, COLORS.metal);
        fillRect(frame, 2, offset, 4, 2, COLORS.metal);
        fillRect(frame, 26, offset, 4, 2, COLORS.metal);
    }

    line(frame, 6, 9, 11, 9, COLORS.circuitGreen);
    line(frame, 11, 9, 11, 12, COLORS.circuitGreen);
    line(frame, 21, 9, 25, 9, COLORS.circuitPink);
    line(frame, 21, 9, 21, 12, COLORS.circuitPink);
    line(frame, 6, 22, 12, 22, COLORS.liquid);
    line(frame, 12, 22, 12, 20, COLORS.liquid);
    line(frame, 20, 20, 20, 23, COLORS.goldLight);
    line(frame, 20, 23, 25, 23, COLORS.goldLight);
    fillRect(frame, 4, 8, 3, 3, COLORS.circuitGreen);
    fillRect(frame, 24, 8, 3, 3, COLORS.circuitPink);
    fillRect(frame, 4, 21, 3, 3, COLORS.liquid);
    fillRect(frame, 24, 22, 3, 3, COLORS.goldLight);
}

function drawHorse() {
    const frame = 5;
    fillRect(frame, 2, 28, 28, 2, COLORS.deepShadow);

    // Road/car base keeps the Frogger-like objective readable at a glance.
    fillRect(frame, 2, 22, 28, 6, COLORS.ink);
    fillRect(frame, 4, 23, 24, 4, COLORS.road);
    fillRect(frame, 7, 24, 7, 1, COLORS.roadStripe);
    fillRect(frame, 18, 24, 7, 1, COLORS.roadStripe);
    fillRect(frame, 6, 27, 5, 3, COLORS.ink);
    fillRect(frame, 22, 27, 5, 3, COLORS.ink);

    // Upright horse head, mane, ear, muzzle, and bright gym headband.
    fillPolygon(
        frame,
        [[9, 21], [8, 12], [10, 5], [13, 2], [16, 7], [21, 5],
            [22, 12], [25, 15], [23, 21]],
        COLORS.ink
    );
    fillPolygon(
        frame,
        [[11, 20], [10, 12], [12, 7], [14, 5], [16, 9], [20, 7],
            [20, 13], [23, 16], [21, 20]],
        COLORS.horse
    );
    fillPolygon(frame, [[10, 12], [8, 8], [11, 5], [13, 12]], COLORS.horseDark);
    fillPolygon(frame, [[18, 15], [24, 15], [26, 18], [23, 21], [18, 20]], COLORS.horseLight);
    fillRect(frame, 11, 10, 10, 3, COLORS.circuitPink);
    fillRect(frame, 12, 10, 8, 1, COLORS.goldLight);
    fillRect(frame, 18, 12, 2, 2, COLORS.ink);
    fillRect(frame, 23, 17, 2, 1, COLORS.ink);
    fillRect(frame, 12, 20, 3, 3, COLORS.horseDark);
    fillRect(frame, 19, 20, 3, 3, COLORS.horseDark);
}

function drawZapper() {
    const frame = 6;
    fillRect(frame, 2, 28, 28, 2, COLORS.deepShadow);

    // Nanotech workbench with a bright slime reservoir.
    fillRect(frame, 2, 21, 28, 7, COLORS.ink);
    fillRect(frame, 4, 22, 24, 4, COLORS.metalDark);
    fillRect(frame, 5, 22, 22, 1, COLORS.metalLight);
    fillRect(frame, 6, 26, 3, 4, COLORS.ink);
    fillRect(frame, 23, 26, 3, 4, COLORS.ink);
    fillRect(frame, 4, 5, 8, 15, COLORS.ink);
    fillRect(frame, 6, 7, 4, 11, COLORS.circuitGreen);
    fillRect(frame, 7, 8, 2, 7, COLORS.liquidLight);
    fillRect(frame, 5, 3, 6, 4, COLORS.metal);

    // Right-facing space blaster fed by the slime hose.
    fillPolygon(
        frame,
        [[10, 11], [20, 9], [27, 11], [30, 14], [27, 17], [20, 17],
            [18, 21], [13, 21], [14, 17], [10, 16]],
        COLORS.ink
    );
    fillPolygon(
        frame,
        [[12, 12], [20, 11], [26, 12], [28, 14], [26, 15], [19, 15],
            [17, 19], [15, 19], [16, 15], [12, 15]],
        COLORS.hull
    );
    fillRect(frame, 19, 12, 6, 2, COLORS.hullLight);
    fillRect(frame, 27, 13, 4, 3, COLORS.circuitPink);
    line(frame, 9, 17, 13, 18, COLORS.circuitGreen);
    line(frame, 13, 18, 16, 16, COLORS.circuitGreen);
    fillRect(frame, 12, 13, 3, 2, COLORS.circuitGreen);
    setPixel(frame * FRAME_SIZE + 29, 12, COLORS.goldLight);
}

function drawCasinoHeist() {
    const frame = 7;
    fillRect(frame, 2, 28, 28, 2, COLORS.deepShadow);

    // Neon casino marquee above a compact getaway car.
    fillPolygon(frame, [[16, 2], [25, 8], [16, 14], [7, 8]], COLORS.ink);
    fillPolygon(frame, [[16, 4], [22, 8], [16, 12], [10, 8]], COLORS.circuitPurple);
    fillRect(frame, 15, 5, 2, 6, COLORS.goldLight);
    fillRect(frame, 13, 7, 6, 2, COLORS.goldLight);

    fillRect(frame, 1, 23, 30, 5, COLORS.ink);
    fillRect(frame, 3, 24, 26, 3, COLORS.road);
    fillRect(frame, 5, 25, 6, 1, COLORS.roadStripe);
    fillRect(frame, 21, 25, 6, 1, COLORS.roadStripe);
    fillPolygon(
        frame,
        [[4, 21], [8, 17], [20, 16], [25, 20], [29, 21], [29, 25],
            [3, 25], [3, 22]],
        COLORS.ink
    );
    fillPolygon(
        frame,
        [[6, 21], [10, 18], [19, 18], [23, 21], [27, 22], [27, 23],
            [5, 23]],
        COLORS.engine
    );
    fillPolygon(frame, [[11, 18], [18, 18], [21, 21], [9, 21]], COLORS.canopy);
    fillRect(frame, 14, 18, 1, 3, COLORS.ink);
    fillRect(frame, 6, 23, 5, 5, COLORS.ink);
    fillRect(frame, 22, 23, 5, 5, COLORS.ink);
    fillRect(frame, 7, 24, 3, 2, COLORS.metalLight);
    fillRect(frame, 23, 24, 3, 2, COLORS.metalLight);
    fillRect(frame, 26, 20, 3, 2, COLORS.goldLight);
}

drawPipe();
drawChest();
drawSpaceship();
drawElevator();
drawCircuit();
drawHorse();
drawZapper();
drawCasinoHeist();

mkdirSync(dirname(outputPath), {recursive: true});
const encoded = PNG.sync.write(atlas, {
    colorType: 6,
    inputColorType: 6,
    inputHasAlpha: true,
    bitDepth: 8,
    filterType: 4,
    deflateLevel: 9,
    deflateStrategy: 3
});
writeFileSync(outputPath, encoded);
console.log(`Generated ${FRAME_COUNT}-frame ${ATLAS_WIDTH}x${ATLAS_HEIGHT} objective atlas.`);
