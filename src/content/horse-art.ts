import type Phaser from 'phaser';

/**
 * The one true horse. Horsemaster and the campaign victory screen both draw
 * from here so the celebrating horse is recognisably the horse you rode, rather
 * than a differently proportioned animal.
 */
export const HORSE_COLORS = Object.freeze({
    body: 0xb2703c,
    bodyLight: 0xe0a869,
    mane: 0x6c3f22,
    ink: 0x171918,
    bridle: 0xf05b91
});

export interface HorsePoseOptions {
    /** Vertical body offset, used for gallop bob and dance bounce. */
    readonly bob?: number;
    /** Extra head lift or dip. */
    readonly headDip?: number;
    /** Tail swing. */
    readonly tailSway?: number;
    /** Leg offsets from hip to hoof, front-to-back as drawn. */
    readonly legOffsets?: readonly [number, number, number, number];
    /** Uniform scale; 1 draws the ~38px-long Horsemaster horse. */
    readonly scale?: number;
    /** Draws a gym sweatband and bridle strap. */
    readonly bridle?: boolean;
    /** Draws the contact shadow under the hooves. */
    readonly shadow?: boolean;
    /** Shortens the body silhouette for a mid-hop tuck. */
    readonly tucked?: boolean;
}

/**
 * Draws the horse centred on `(x, y)` into an existing Graphics object. Callers
 * own clearing and depth; this only emits shapes.
 */
export function drawHorse(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    options: HorsePoseOptions = {}
): void {
    const scale = options.scale ?? 1;
    const bob = (options.bob ?? 0) * scale;
    const headDip = (options.headDip ?? 0) * scale;
    const tailSway = (options.tailSway ?? 0) * scale;
    const legs = options.legOffsets ?? [-2, 1, -1, 2];
    const at = (offsetX: number, offsetY: number): {x: number; y: number} => ({
        x: x + offsetX * scale,
        y: y + offsetY * scale
    });

    if (options.shadow !== false) {
        graphics.fillStyle(HORSE_COLORS.ink, 0.28);
        graphics.fillEllipse(
            x,
            y + 15 * scale,
            (options.tucked === true ? 26 : 38) * scale,
            7 * scale
        );
    }

    graphics.lineStyle(4 * scale, HORSE_COLORS.mane, 1);
    const tailStart = at(-19, -6);
    const tailEnd = at(-26, 2);
    graphics.lineBetween(
        tailStart.x,
        tailStart.y + bob,
        tailEnd.x,
        tailEnd.y + tailSway
    );

    graphics.fillStyle(HORSE_COLORS.body);
    const barrel = at(-2, -4);
    graphics.fillEllipse(barrel.x, barrel.y + bob, 32 * scale, 16 * scale);
    const haunch = at(-13, -4);
    graphics.fillEllipse(haunch.x, haunch.y + bob, 16 * scale, 15 * scale);
    const neckBottom = at(8, -9);
    const neckTop = at(20, -19);
    const chest = at(14, -1);
    graphics.fillTriangle(
        neckBottom.x, neckBottom.y + bob,
        neckTop.x, neckTop.y + bob + headDip,
        chest.x, chest.y + bob
    );
    const jaw = at(24, -13);
    graphics.fillTriangle(
        neckTop.x, neckTop.y + bob + headDip,
        jaw.x, jaw.y + bob + headDip,
        chest.x, chest.y + bob
    );
    const head = at(22, -19);
    graphics.fillEllipse(head.x, head.y + bob + headDip, 13 * scale, 9 * scale);
    graphics.fillStyle(HORSE_COLORS.bodyLight);
    const muzzle = at(26, -22);
    graphics.fillRoundedRect(
        muzzle.x,
        muzzle.y + bob + headDip,
        9 * scale,
        6 * scale,
        2 * scale
    );
    graphics.fillStyle(HORSE_COLORS.ink);
    const nostril = at(33, -19);
    graphics.fillCircle(nostril.x, nostril.y + bob + headDip, 1 * scale);

    graphics.fillStyle(HORSE_COLORS.mane);
    const ear = [at(18, -25), at(20, -30), at(23, -24)] as const;
    graphics.fillTriangle(
        ear[0].x, ear[0].y + bob + headDip,
        ear[1].x, ear[1].y + bob + headDip,
        ear[2].x, ear[2].y + bob + headDip
    );
    for (const [baseX, tipX, endX, baseY, tipY, endY] of [
        [5, 8, 11, -10, -16, -8],
        [9, 12, 15, -13, -19, -11],
        [13, 16, 19, -16, -22, -14]
    ] as const) {
        const a = at(baseX, baseY);
        const b = at(tipX, tipY);
        const c = at(endX, endY);
        graphics.fillTriangle(a.x, a.y + bob, b.x, b.y + bob, c.x, c.y + bob);
    }

    graphics.fillStyle(HORSE_COLORS.ink);
    const eye = at(21, -21);
    graphics.fillCircle(eye.x, eye.y + bob + headDip, 1.5 * scale);

    graphics.lineStyle(4 * scale, HORSE_COLORS.body, 1);
    const hipY = y + (2 * scale) + bob;
    const hooveY = y + 14 * scale;
    const hips = [-14, -8, 6, 11] as const;
    hips.forEach((hipX, index) => {
        const hip = at(hipX, 0);
        graphics.lineBetween(
            hip.x,
            hipY,
            x + (hipX + (legs[index] ?? 0)) * scale,
            hooveY
        );
    });

    if (options.bridle !== false) {
        graphics.lineStyle(2 * scale, HORSE_COLORS.bridle, 1);
        const strapLeft = at(15, -22);
        const strapRight = at(28, -22);
        graphics.lineBetween(
            strapLeft.x,
            strapLeft.y + bob + headDip,
            strapRight.x,
            strapRight.y + bob + headDip
        );
    }
}
