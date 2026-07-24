import Phaser from 'phaser';

import {formatPlayingCard, type PlayingCard} from './cards';

export const CASINO_VIEW_SIZE = 672;

export const CASINO_COLORS = Object.freeze({
    background: 0x102f26,
    felt: 0x174c3b,
    feltLight: 0x246b51,
    rail: 0x6d4226,
    gold: 0xefc75e,
    cream: 0xf5f0df,
    ink: 0x171918,
    red: 0xb8333d,
    purple: 0x382f54,
    muted: 0x806b4f,
    success: 0x5bbf72
});

export function cardColor(card: PlayingCard): string {
    return card.suit === 'hearts' || card.suit === 'diamonds'
        ? '#b8333d'
        : '#171918';
}

export function addPlayingCard(
    scene: Phaser.Scene,
    container: Phaser.GameObjects.Container,
    x: number,
    y: number,
    card: PlayingCard | null,
    faceDown = false,
    scale = 1
): void {
    const width = 58 * scale;
    const height = 82 * scale;
    const background = scene.add.rectangle(
        x,
        y,
        width,
        height,
        faceDown ? 0x382f54 : CASINO_COLORS.cream
    ).setStrokeStyle(2, faceDown ? CASINO_COLORS.gold : CASINO_COLORS.ink);
    container.add(background);
    if (faceDown || !card) {
        container.add(scene.add.text(x, y, '◆', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: `${Math.round(25 * scale)}px`
        }).setOrigin(0.5));
        return;
    }
    container.add(scene.add.text(x, y, formatPlayingCard(card), {
        color: cardColor(card),
        fontFamily: 'Georgia, serif',
        fontSize: `${Math.round(22 * scale)}px`,
        fontStyle: 'bold'
    }).setOrigin(0.5));
}

export function addCasinoButton(
    scene: Phaser.Scene,
    container: Phaser.GameObjects.Container,
    x: number,
    y: number,
    label: string,
    action: () => void,
    options: {
        readonly enabled?: boolean;
        readonly width?: number;
        readonly color?: string;
    } = {}
): Phaser.GameObjects.Text {
    const enabled = options.enabled ?? true;
    const button = scene.add.text(x, y, label, {
        color: enabled ? '#f5f0df' : '#9b9b94',
        backgroundColor: enabled ? (options.color ?? '#382f54') : '#424646',
        fontFamily: 'Georgia, serif',
        fontSize: '16px',
        align: 'center',
        padding: {x: 12, y: 11},
        ...(options.width ? {fixedWidth: options.width} : {})
    }).setOrigin(0.5);
    if (enabled) {
        button.setInteractive({useHandCursor: true});
        button.on('pointerdown', action);
    }
    container.add(button);
    return button;
}
