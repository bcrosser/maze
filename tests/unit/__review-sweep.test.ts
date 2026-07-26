import {describe, expect, it} from 'vitest';
import {Mulberry32Random} from '../../src/domain/random/random-source';
import {
    createHorsemasterCourse,
    validateHorsemasterCourse,
    HORSEMASTER_TRAFFIC_MAX_X,
    HORSEMASTER_TRAFFIC_MIN_X
} from '../../src/minigames/horsemaster/horsemaster-model';

const SPAN = HORSEMASTER_TRAFFIC_MAX_X - HORSEMASTER_TRAFFIC_MIN_X;

function circularEdgeGaps(items: {centerX: number; width: number}[]): number[] {
    const sorted = [...items].sort((a, b) => a.centerX - b.centerX);
    const gaps: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
        const cur = sorted[i]!;
        const next = sorted[(i + 1) % sorted.length]!;
        const d = i === sorted.length - 1
            ? next.centerX + SPAN - cur.centerX
            : next.centerX - cur.centerX;
        gaps.push(d - cur.width / 2 - next.width / 2);
    }
    return gaps;
}

function circularCenterGaps(centers: number[]): number[] {
    const sorted = [...centers].sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
        const cur = sorted[i]!;
        const next = sorted[(i + 1) % sorted.length]!;
        gaps.push(i === sorted.length - 1 ? next + SPAN - cur : next - cur);
    }
    return gaps;
}

describe('review sweep', () => {
    it('generates valid courses across a wide seed range and tracks extremes', () => {
        let minBumper = Infinity;
        let maxSlot = -Infinity;
        let minBike = Infinity;
        let redAtGuard = 0;
        let anyThrow: string | null = null;
        for (let seed = 0; seed < 20000; seed++) {
            let course;
            try {
                course = createHorsemasterCourse(new Mulberry32Random(seed));
            } catch (error) {
                anyThrow = `seed ${seed}: ${(error as Error).message}`;
                break;
            }
            const validation = validateHorsemasterCourse(course);
            if (!validation.valid) {
                anyThrow = `seed ${seed} invalid: ${validation.errors.join('; ')}`;
                break;
            }
            for (const lane of course.vehicleLanes) {
                const bumpers = circularEdgeGaps(lane.vehicles.map(v => ({
                    centerX: v.initialX, width: v.carWidth
                })));
                minBumper = Math.min(minBumper, ...bumpers);
                const slots = circularCenterGaps(lane.vehicles.flatMap(v =>
                    v.slots.map(s => v.initialX + s.offsetX)
                ));
                maxSlot = Math.max(maxSlot, ...slots);
            }
            for (const lane of course.bikeLanes) {
                const gaps = circularEdgeGaps(lane.bicycles.map(b => ({
                    centerX: b.initialX, width: 36
                })));
                minBike = Math.min(minBike, ...gaps);
            }
            if (course.vehicleLanes[0]!.tier === 'red' || course.vehicleLanes[4]!.tier === 'red') {
                redAtGuard++;
            }
        }
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({minBumper, maxSlot, minBike, redAtGuard, anyThrow}));
        expect(anyThrow).toBeNull();
        expect(redAtGuard).toBe(0);
        expect(minBumper).toBeGreaterThanOrEqual(96 - 1e-6);
        expect(maxSlot).toBeLessThanOrEqual(320 + 1e-6);
        expect(minBike).toBeGreaterThanOrEqual(180 - 1e-6);
    });
});
