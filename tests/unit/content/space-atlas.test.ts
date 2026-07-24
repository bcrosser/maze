import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

import {PNG} from 'pngjs';
import {describe, expect, it} from 'vitest';

const FRAME_SIZE = 64;
const COLUMNS = 8;
const ROWS = 8;
const REQUIRED_FRAMES = [
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
] as const;

interface AtlasFrame {
    readonly frame: {
        readonly x: number;
        readonly y: number;
        readonly w: number;
        readonly h: number;
    };
    readonly rotated: boolean;
    readonly trimmed: boolean;
    readonly spriteSourceSize: {
        readonly x: number;
        readonly y: number;
        readonly w: number;
        readonly h: number;
    };
    readonly sourceSize: {readonly w: number; readonly h: number};
    readonly pivot: {readonly x: number; readonly y: number};
}

interface SpaceAtlasMetadata {
    readonly formatVersion: number;
    readonly contentVersion: string;
    readonly frameSize: number;
    readonly frames: Readonly<Record<string, AtlasFrame>>;
    readonly animations: Readonly<Record<string, readonly string[]>>;
    readonly meta: {
        readonly app: string;
        readonly version: string;
        readonly image: string;
        readonly format: string;
        readonly size: {readonly w: number; readonly h: number};
        readonly scale: string;
    };
}

const rootDirectory = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const imagePath = join(rootDirectory, 'assets', 'space-sprites.png');
const metadataPath = join(rootDirectory, 'assets', 'space-sprites.json');
const generatorPath = join(rootDirectory, 'scripts', 'generate-space-sprites.mjs');

function readMetadata(): SpaceAtlasMetadata {
    return JSON.parse(readFileSync(metadataPath, 'utf8')) as SpaceAtlasMetadata;
}

function frameBytes(image: PNG, frame: AtlasFrame): Buffer {
    const bytes = Buffer.alloc(frame.frame.w * frame.frame.h * 4);
    let outputOffset = 0;
    for (let y = frame.frame.y; y < frame.frame.y + frame.frame.h; y++) {
        const sourceStart = (y * image.width + frame.frame.x) * 4;
        const sourceEnd = sourceStart + frame.frame.w * 4;
        image.data.copy(bytes, outputOffset, sourceStart, sourceEnd);
        outputOffset += frame.frame.w * 4;
    }
    return bytes;
}

describe('Space sprite atlas', () => {
    it('is byte-for-byte deterministic under the Node-based generator', () => {
        const checkedInImage = readFileSync(imagePath);
        const checkedInMetadata = readFileSync(metadataPath);
        const result = spawnSync(process.execPath, [generatorPath], {
            cwd: rootDirectory,
            encoding: 'utf8'
        });

        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('Generated 64-frame 512x512 Space atlas and metadata.');
        expect(readFileSync(imagePath)).toEqual(checkedInImage);
        expect(readFileSync(metadataPath)).toEqual(checkedInMetadata);
    });

    it('contains the complete named-frame contract in stable grid order', () => {
        const metadata = readMetadata();
        expect(metadata.formatVersion).toBe(1);
        expect(metadata.contentVersion).toBe('space-atlas-v1');
        expect(metadata.frameSize).toBe(FRAME_SIZE);
        expect(metadata.meta).toEqual({
            app: 'maze-space-atlas-generator',
            version: '1.0',
            image: 'space-sprites.png',
            format: 'RGBA8888',
            size: {w: FRAME_SIZE * COLUMNS, h: FRAME_SIZE * ROWS},
            scale: '1'
        });
        expect(Object.keys(metadata.frames)).toEqual(REQUIRED_FRAMES);

        const occupiedCells = new Set<string>();
        REQUIRED_FRAMES.forEach((name, index) => {
            const definition = metadata.frames[name];
            expect(definition, `Missing frame ${name}`).toBeDefined();
            expect(definition?.frame).toEqual({
                x: index % COLUMNS * FRAME_SIZE,
                y: Math.floor(index / COLUMNS) * FRAME_SIZE,
                w: FRAME_SIZE,
                h: FRAME_SIZE
            });
            expect(definition?.rotated).toBe(false);
            expect(definition?.trimmed).toBe(false);
            expect(definition?.spriteSourceSize).toEqual({
                x: 0,
                y: 0,
                w: FRAME_SIZE,
                h: FRAME_SIZE
            });
            expect(definition?.sourceSize).toEqual({w: FRAME_SIZE, h: FRAME_SIZE});
            expect(definition?.pivot).toEqual({x: 0.5, y: 0.5});

            const cell = `${definition?.frame.x},${definition?.frame.y}`;
            expect(occupiedCells.has(cell)).toBe(false);
            occupiedCells.add(cell);
            expect((definition?.frame.x ?? -1) + (definition?.frame.w ?? 0))
                .toBeLessThanOrEqual(metadata.meta.size.w);
            expect((definition?.frame.y ?? -1) + (definition?.frame.h ?? 0))
                .toBeLessThanOrEqual(metadata.meta.size.h);
        });
        expect(occupiedCells.size).toBe(COLUMNS * ROWS);
    });

    it('provides only valid animation references', () => {
        const metadata = readMetadata();
        expect(metadata.animations).toEqual({
            'player-thrust': ['player-thrust-1', 'player-thrust-2'],
            'player-charge': ['player-charge-1', 'player-charge-2'],
            'scout-flight': ['enemy-scout-idle', 'enemy-scout-bank'],
            'fighter-flight': ['enemy-fighter-idle', 'enemy-fighter-bank'],
            'turret-attack': ['enemy-turret-windup', 'enemy-turret-fire'],
            'carrier-attack': ['enemy-carrier-windup', 'enemy-carrier-idle'],
            'mine-warning': ['enemy-mine-idle', 'enemy-mine-armed'],
            explosion: ['explosion-1', 'explosion-2', 'explosion-3', 'explosion-4']
        });
        for (const animation of Object.values(metadata.animations)) {
            expect(animation.length).toBeGreaterThanOrEqual(2);
            for (const frameName of animation) {
                expect(metadata.frames[frameName], `Unknown animation frame ${frameName}`)
                    .toBeDefined();
            }
        }
    });

    it('is a transparent 8-bit RGBA PNG with non-empty, distinct frames', () => {
        const image = PNG.sync.read(readFileSync(imagePath));
        const metadata = readMetadata();
        expect(image.width).toBe(FRAME_SIZE * COLUMNS);
        expect(image.height).toBe(FRAME_SIZE * ROWS);
        expect(image.colorType).toBe(6);
        expect(image.alpha).toBe(true);
        expect(image.depth).toBe(8);
        expect(image.bpp).toBe(4);

        const hashes = new Set<string>();
        for (const name of REQUIRED_FRAMES) {
            const definition = metadata.frames[name]!;
            const bytes = frameBytes(image, definition);
            let visiblePixels = 0;
            let transparentPixels = 0;
            const visibleColors = new Set<string>();
            for (let offset = 0; offset < bytes.length; offset += 4) {
                const alpha = bytes[offset + 3]!;
                if (alpha === 0) {
                    transparentPixels++;
                    continue;
                }
                visiblePixels++;
                visibleColors.add(
                    `${bytes[offset]},${bytes[offset + 1]},${bytes[offset + 2]},${alpha}`
                );
            }

            expect(visiblePixels, `${name} should contain visible art`).toBeGreaterThan(20);
            expect(transparentPixels, `${name} should preserve transparency`)
                .toBeGreaterThan(300);
            expect(visibleColors.size, `${name} should not be a flat placeholder`)
                .toBeGreaterThan(1);
            hashes.add(createHash('sha256').update(bytes).digest('hex'));
        }
        expect(hashes.size).toBe(REQUIRED_FRAMES.length);
    });
});
