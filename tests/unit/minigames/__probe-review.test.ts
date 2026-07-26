import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    HORSEMASTER_HOP_DURATION_MS,
    advanceHorsemaster,
    createHorsemasterCourse,
    createHorsemasterState,
    horsemasterColumnX,
    horsemasterRowY,
    type HorsemasterState
} from '../../../src/minigames/horsemaster/horsemaster-model';

function placeOnRow(
    state: HorsemasterState,
    row: number,
    column: number
): HorsemasterState {
    const x = horsemasterColumnX(column);
    const y = horsemasterRowY(row);
    return {
        ...state,
        player: {
            ...state.player,
            previousX: x, x, previousY: y, y, row, ride: null, jump: null
        }
    };
}

describe('probe: arrangeSlotLanding back-solve exactness', () => {
    it('measures actual landing distance vs back-solved landing x', () => {
        const course = createHorsemasterCourse(new Mulberry32Random(78));
        const vehicle = course.vehicleLanes[0]!.vehicles[0]!;
        const slot = vehicle.slots[0]!;
        let state = placeOnRow(createHorsemasterState(course), 6, 7);
        // replicate arrangeSlotLanding
        const initialX = 360 - slot.offsetX -
            vehicle.direction * vehicle.speed * (HORSEMASTER_HOP_DURATION_MS / 1_000);
        state = {
            ...state,
            vehicles: state.vehicles.map(v =>
                v.id === vehicle.id ? {...v, previousX: initialX, x: initialX} : v)
        };
        const landed = advanceHorsemaster(state, {horizontal: 0, vertical: 1},
            HORSEMASTER_HOP_DURATION_MS).state;
        const carrier = landed.vehicles.find(c => c.id === vehicle.id)!;
        const slotCenterAtLanding = carrier.x + slot.offsetX;
        // If back-solve is exact, slot center is exactly at 360 when the jump ends.
        // eslint-disable-next-line no-console
        console.log('PROBE distance:', Math.abs(slotCenterAtLanding - 360),
            'ride:', JSON.stringify(landed.player.ride), 'row:', landed.player.row);
        expect(landed.player.row).toBe(7);
    });
});
