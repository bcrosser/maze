import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

import {PNG} from 'pngjs';
import {describe, expect, it} from 'vitest';

import {OBJECTIVE_DEFINITIONS} from '../../../src/domain/overworld/level-objectives';

const FRAME_SIZE = 32;
const FRAME_COUNT = 8;
const rootDirectory = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const atlasPath = join(rootDirectory, 'assets', 'objective-sprites.png');
const generatorPath = join(rootDirectory, 'scripts', 'generate-objective-sprites.mjs');

describe('objective icon atlas', () => {
    it('assigns every objective a unique in-range integer frame', () => {
        expect(OBJECTIVE_DEFINITIONS).toHaveLength(FRAME_COUNT);

        const iconFrames = OBJECTIVE_DEFINITIONS.map(definition => definition.iconFrame);
        for (const iconFrame of iconFrames) {
            expect(Number.isInteger(iconFrame)).toBe(true);
            expect(iconFrame).toBeGreaterThanOrEqual(0);
            expect(iconFrame).toBeLessThan(FRAME_COUNT);
        }
        expect(new Set(iconFrames).size).toBe(FRAME_COUNT);
    });

    it('is deterministically generated as eight 32x32 RGBA frames', () => {
        const checkedInBytes = readFileSync(atlasPath);
        const result = spawnSync(process.execPath, [generatorPath], {
            cwd: rootDirectory,
            encoding: 'utf8'
        });

        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('Generated 8-frame 256x32 objective atlas.');
        expect(readFileSync(atlasPath)).toEqual(checkedInBytes);

        const atlas = PNG.sync.read(checkedInBytes);
        expect(atlas.width).toBe(FRAME_SIZE * FRAME_COUNT);
        expect(atlas.height).toBe(FRAME_SIZE);
        expect(atlas.width / FRAME_SIZE).toBe(FRAME_COUNT);
        expect(atlas.colorType).toBe(6);
        expect(atlas.alpha).toBe(true);
        expect(atlas.depth).toBe(8);
        expect(atlas.bpp).toBe(4);
    });

    it('contains eight non-empty, silhouette-distinct transparent frames', () => {
        const atlas = PNG.sync.read(readFileSync(atlasPath));
        const alphaSignatures = new Set<string>();

        for (let frame = 0; frame < FRAME_COUNT; frame++) {
            const alphaMask: string[] = [];
            let opaquePixels = 0;
            let transparentPixels = 0;
            for (let y = 0; y < FRAME_SIZE; y++) {
                for (let x = 0; x < FRAME_SIZE; x++) {
                    const pixelOffset = (
                        y * atlas.width + frame * FRAME_SIZE + x
                    ) * 4;
                    const alpha = atlas.data[pixelOffset + 3]!;
                    const visible = alpha > 0;
                    alphaMask.push(visible ? '1' : '0');
                    if (visible) opaquePixels++;
                    else transparentPixels++;
                }
            }

            expect(opaquePixels).toBeGreaterThan(100);
            expect(transparentPixels).toBeGreaterThan(300);
            alphaSignatures.add(alphaMask.join(''));
        }

        expect(alphaSignatures.size).toBe(FRAME_COUNT);
    });
});
