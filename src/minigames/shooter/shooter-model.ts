import {randomInteger, type RandomSource} from '../../domain/random/random-source';

export const SHOOTER_LANES = [0, 1, 2, 3, 4] as const;
export type ShooterLane = (typeof SHOOTER_LANES)[number];

export interface ShooterWaveEntry {
    readonly id: string;
    readonly spawnAtMs: number;
    readonly lane: ShooterLane;
    readonly speed: number;
    readonly health: number;
    readonly score: number;
}

export interface ShooterMission {
    readonly targetKills: number;
    readonly startingShield: number;
    readonly waves: readonly ShooterWaveEntry[];
}

export interface ShooterProgress {
    readonly hull: number;
    readonly shield: number;
    readonly kills: number;
    readonly score: number;
    readonly escapedEnemies: number;
}

export interface ShooterMissionModifiers {
    readonly powerRouting: number;
    readonly archiveIntel: boolean;
    readonly securityAlert: number;
}

export function createShooterMission(
    random: RandomSource,
    modifiers: ShooterMissionModifiers
): ShooterMission {
    const targetKills = modifiers.archiveIntel ? 6 : 8;
    const startingShield = modifiers.powerRouting >= 60 ? 3 : 1;
    const speedBonus = Math.floor(modifiers.securityAlert / 20) * 8;
    const waveCount = targetKills + 4;

    return {
        targetKills,
        startingShield,
        waves: Array.from({length: waveCount}, (_, index) => ({
            id: `raider-${index + 1}`,
            spawnAtMs: 500 + index * 900,
            lane: randomInteger(random, SHOOTER_LANES.length) as ShooterLane,
            speed: 72 + speedBonus + randomInteger(random, 25),
            health: index === waveCount - 1 ? 3 : 1,
            score: index === waveCount - 1 ? 500 : 100
        }))
    };
}

export function createShooterProgress(mission: ShooterMission): ShooterProgress {
    return {
        hull: 3,
        shield: mission.startingShield,
        kills: 0,
        score: 0,
        escapedEnemies: 0
    };
}

export function recordShooterKill(
    progress: ShooterProgress,
    enemy: ShooterWaveEntry
): ShooterProgress {
    return {
        ...progress,
        kills: progress.kills + 1,
        score: progress.score + enemy.score
    };
}

export function recordShooterHit(progress: ShooterProgress): ShooterProgress {
    if (progress.shield > 0) return {...progress, shield: progress.shield - 1};
    return {...progress, hull: Math.max(0, progress.hull - 1)};
}

export function recordEnemyEscape(progress: ShooterProgress): ShooterProgress {
    return {...recordShooterHit(progress), escapedEnemies: progress.escapedEnemies + 1};
}

export function hasWonShooterMission(
    mission: ShooterMission,
    progress: ShooterProgress
): boolean {
    return progress.kills >= mission.targetKills;
}