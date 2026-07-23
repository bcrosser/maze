import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    createShooterMission,
    createShooterProgress,
    hasWonShooterMission,
    recordEnemyEscape,
    recordShooterHit,
    recordShooterKill
} from '../../../src/minigames/shooter/shooter-model';

describe('shoot-em-up mission model', () => {
    it('creates deterministic lane waves from a seed', () => {
        const modifiers = {powerRouting: 50, archiveIntel: false, securityAlert: 0};
        const first = createShooterMission(new Mulberry32Random(99), modifiers);
        const second = createShooterMission(new Mulberry32Random(99), modifiers);

        expect(first).toEqual(second);
        expect(first.waves).toHaveLength(first.targetKills + 4);
    });

    it('turns Pipe power into shields and lock intel into a shorter mission', () => {
        const linked = createShooterMission(new Mulberry32Random(1), {
            powerRouting: 65,
            archiveIntel: true,
            securityAlert: 0
        });
        const unprepared = createShooterMission(new Mulberry32Random(1), {
            powerRouting: 50,
            archiveIntel: false,
            securityAlert: 0
        });

        expect(linked.startingShield).toBe(3);
        expect(linked.targetKills).toBe(6);
        expect(unprepared.startingShield).toBe(1);
        expect(unprepared.targetKills).toBe(8);
    });

    it('absorbs hits with shields before hull damage', () => {
        const mission = createShooterMission(new Mulberry32Random(1), {
            powerRouting: 65,
            archiveIntel: true,
            securityAlert: 0
        });
        let progress = createShooterProgress(mission);
        progress = recordShooterHit(progress);
        progress = recordShooterHit(progress);
        progress = recordShooterHit(progress);
        progress = recordShooterHit(progress);

        expect(progress.shield).toBe(0);
        expect(progress.hull).toBe(2);
    });

    it('scores kills, penalizes escapes, and detects mission completion', () => {
        const mission = createShooterMission(new Mulberry32Random(2), {
            powerRouting: 65,
            archiveIntel: true,
            securityAlert: 0
        });
        let progress = createShooterProgress(mission);
        for (const enemy of mission.waves.slice(0, mission.targetKills)) {
            progress = recordShooterKill(progress, enemy);
        }
        progress = recordEnemyEscape(progress);

        expect(progress.kills).toBe(mission.targetKills);
        expect(progress.escapedEnemies).toBe(1);
        expect(hasWonShooterMission(mission, progress)).toBe(true);
    });
});