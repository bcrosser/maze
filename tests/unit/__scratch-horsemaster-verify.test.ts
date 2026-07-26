import {describe, expect, it} from 'vitest';
import {Mulberry32Random} from '../../src/domain/random/random-source';
import {
    createHorsemasterCourse,
    canonicalHorsemasterCourseSignature,
    validateHorsemasterCourse,
    stepHorsemaster,
    createHorsemasterState,
    HORSEMASTER_TRAFFIC_MAX_X,
    HORSEMASTER_TRAFFIC_MIN_X
} from '../../src/minigames/horsemaster/horsemaster-model';

const SPAN = HORSEMASTER_TRAFFIC_MAX_X - HORSEMASTER_TRAFFIC_MIN_X;

function circularGaps(centers: number[]): number[] {
    const sorted = [...centers].sort((a, b) => a - b);
    return sorted.map((c, i) =>
        i === sorted.length - 1 ? sorted[0]! + SPAN - c : sorted[i + 1]! - c
    );
}

describe('scratch verify', () => {
    it('generation never throws and invariants hold across 30000 seeds', () => {
        let minBumper = Infinity;
        let maxSlot = -Infinity;
        let minBike = Infinity;
        const signatures = new Set<string>();
        const compositions = new Set<string>();
        for (let seed = 0; seed < 30000; seed++) {
            const course = createHorsemasterCourse(new Mulberry32Random(seed));
            const v = validateHorsemasterCourse(course);
            expect(v.errors).toEqual([]);
            const sig = canonicalHorsemasterCourseSignature(course);
            expect(signatures.has(sig)).toBe(false);
            signatures.add(sig);
            const g = course.vehicleLanes.filter(l => l.tier === 'green').length;
            const y = course.vehicleLanes.filter(l => l.tier === 'yellow').length;
            const r = course.vehicleLanes.filter(l => l.tier === 'red').length;
            compositions.add(`${g},${y},${r}`);
            expect(course.vehicleLanes[0]!.tier).not.toBe('red');
            expect(course.vehicleLanes[4]!.tier).not.toBe('red');
            for (const lane of course.vehicleLanes) {
                const centers = lane.vehicles.map(vh => vh.initialX);
                const width = lane.tier === 'green' ? 120 : 72;
                for (const gap of circularGaps(centers)) {
                    minBumper = Math.min(minBumper, gap - width);
                }
                const slotCenters = lane.vehicles.flatMap(vh =>
                    vh.slots.map(s => vh.initialX + s.offsetX)
                );
                // recompute slot gaps with proper wrapping onto the circle
                const wrapped = slotCenters.map(c => {
                    let w = c;
                    while (w >= HORSEMASTER_TRAFFIC_MAX_X) w -= SPAN;
                    while (w < HORSEMASTER_TRAFFIC_MIN_X) w += SPAN;
                    return w;
                });
                for (const gap of circularGaps(wrapped)) {
                    maxSlot = Math.max(maxSlot, gap);
                }
            }
            for (const lane of course.bikeLanes) {
                for (const gap of circularGaps(lane.bicycles.map(b => b.initialX))) {
                    minBike = Math.min(minBike, gap - 36);
                }
            }
            // gym runway
            const topDir = course.vehicleLanes[4]!.direction;
            const gym = course.buildings.find(b => b.isGym)!;
            const runway = topDir === 1 ? gym.centerX : 672 - gym.centerX;
            expect(runway).toBeGreaterThanOrEqual(336);
        }
        // Report the observed extremes so the reviewer can see the margins.
        console.log('minBumper', minBumper, 'maxSlot', maxSlot, 'minBike', minBike);
        console.log('compositions seen', [...compositions].sort());
        expect(minBumper).toBeGreaterThanOrEqual(96 - 1e-6);
        expect(maxSlot).toBeLessThanOrEqual(320 + 1e-6);
        expect(minBike).toBeGreaterThanOrEqual(180 - 1e-6);
    });

    it('per-lane gaps are time-invariant over long simulation', () => {
        const course = createHorsemasterCourse(new Mulberry32Random(1234));
        let state = createHorsemasterState(course);
        const initialGaps = course.vehicleLanes.map(lane =>
            circularGaps(lane.vehicles.map(vh => vh.initialX)).sort((a, b) => a - b)
        );
        for (let i = 0; i < 30000; i++) {
            state = stepHorsemaster(state, {horizontal: 0, vertical: 0}).state;
        }
        const byId = new Map(state.vehicles.map(vh => [vh.id, vh.x] as const));
        course.vehicleLanes.forEach((lane, li) => {
            const gaps = circularGaps(lane.vehicles.map(vh => byId.get(vh.id)!))
                .sort((a, b) => a - b);
            gaps.forEach((gap, gi) => {
                expect(Math.abs(gap - initialGaps[li]![gi]!)).toBeLessThan(1e-6);
            });
        });
    });
});
