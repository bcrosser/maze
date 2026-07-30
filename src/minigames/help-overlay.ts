import type Phaser from 'phaser';

/**
 * Shared briefing overlay for the minigames.
 *
 * The canvas is scaled to fit, so a phone renders 672 game pixels into roughly
 * 390 CSS pixels: body text set at 16 game px arrives at about 9 CSS px, which is
 * unreadable. This helper instead starts from a large body size and only shrinks
 * it as far as it must to fit, then sizes the panel around the measured text so a
 * briefing can never spill outside its box. Keeping each briefing to a handful of
 * short lines is what lets it stay at the readable end of that range.
 */
export interface HelpOverlayOptions {
    readonly title: string;
    /** Short lines. An empty string leaves a paragraph gap. */
    readonly lines: readonly string[];
    readonly closeLabel: string;
    /** Panel border, and the colour of the close button's background. */
    readonly accentColor: number;
    readonly titleColor: string;
    readonly bodyColor?: string;
    readonly closeTextColor?: string;
    readonly panelColor?: number;
    readonly viewSize?: number;
    readonly onClose: () => void;
}

export interface HelpOverlay {
    readonly objects: readonly Phaser.GameObjects.GameObject[];
    /** The body font size actually used, in game pixels. */
    readonly bodyFontSize: number;
    readonly panelHeight: number;
    destroy(): void;
}

const DEFAULT_VIEW_SIZE = 672;
/** Largest and smallest body text, in game pixels. */
const MAX_BODY_FONT = 23;
const MIN_BODY_FONT = 15;
const PANEL_MARGIN = 34;
const PANEL_PADDING = 26;

function toColor(value: number): string {
    return `#${value.toString(16).padStart(6, '0')}`;
}

export function createHelpOverlay(
    scene: Phaser.Scene,
    options: HelpOverlayOptions
): HelpOverlay {
    const viewSize = options.viewSize ?? DEFAULT_VIEW_SIZE;
    const panelWidth = Math.min(viewSize - PANEL_MARGIN * 2, 604);
    const wrapWidth = panelWidth - PANEL_PADDING * 2;
    const maxPanelHeight = viewSize - PANEL_MARGIN * 2;
    const bodyText = options.lines.join('\n');

    const titleSize = 25;
    const closeSize = 18;
    const closePadding = 10;
    const titleBlock = titleSize + 20;
    const closeBlock = closeSize + closePadding * 2 + 22;

    // Measure at successively smaller sizes until the whole briefing fits.
    const probe = scene.add.text(-4_000, -4_000, bodyText, {
        fontFamily: 'Georgia, serif',
        fontSize: `${MAX_BODY_FONT}px`,
        align: 'center',
        lineSpacing: 5,
        wordWrap: {width: wrapWidth, useAdvancedWrap: true}
    });
    let bodyFontSize = MAX_BODY_FONT;
    let bodyHeight = probe.height;
    while (
        bodyFontSize > MIN_BODY_FONT &&
        titleBlock + bodyHeight + closeBlock + PANEL_PADDING * 2 > maxPanelHeight
    ) {
        bodyFontSize -= 1;
        probe.setFontSize(bodyFontSize);
        probe.setWordWrapWidth(wrapWidth, true);
        bodyHeight = probe.height;
    }
    probe.destroy();

    const panelHeight = Math.min(
        maxPanelHeight,
        titleBlock + bodyHeight + closeBlock + PANEL_PADDING * 2
    );
    const centerX = viewSize / 2;
    const centerY = viewSize / 2;
    const panelTop = centerY - panelHeight / 2;

    const panel = scene.add.rectangle(
        centerX,
        centerY,
        panelWidth,
        panelHeight,
        options.panelColor ?? 0x101520,
        0.985
    ).setStrokeStyle(4, options.accentColor)
        .setDepth(100)
        .setInteractive({useHandCursor: true});
    const title = scene.add.text(
        centerX,
        panelTop + PANEL_PADDING + titleSize / 2,
        options.title,
        {
            color: options.titleColor,
            fontFamily: 'Georgia, serif',
            fontSize: `${titleSize}px`,
            fontStyle: 'bold',
            align: 'center',
            wordWrap: {width: wrapWidth, useAdvancedWrap: true}
        }
    ).setOrigin(0.5).setDepth(101);
    const body = scene.add.text(
        centerX,
        panelTop + PANEL_PADDING + titleBlock + bodyHeight / 2,
        bodyText,
        {
            color: options.bodyColor ?? '#f4f1e2',
            fontFamily: 'Georgia, serif',
            fontSize: `${bodyFontSize}px`,
            align: 'center',
            lineSpacing: 5,
            wordWrap: {width: wrapWidth, useAdvancedWrap: true}
        }
    ).setOrigin(0.5).setDepth(101);
    const close = scene.add.text(
        centerX,
        panelTop + panelHeight - PANEL_PADDING - closeSize / 2 - closePadding,
        options.closeLabel,
        {
            color: options.closeTextColor ?? '#0d1016',
            backgroundColor: toColor(options.accentColor),
            fontFamily: 'Georgia, serif',
            fontSize: `${closeSize}px`,
            fontStyle: 'bold',
            padding: {x: 20, y: closePadding}
        }
    ).setOrigin(0.5).setDepth(101).setInteractive({useHandCursor: true});

    const dismiss = (): void => options.onClose();
    panel.on('pointerdown', dismiss);
    close.on('pointerdown', dismiss);

    const objects = [panel, title, body, close];
    return {
        objects,
        bodyFontSize,
        panelHeight,
        destroy(): void {
            for (const object of objects) object.destroy();
        }
    };
}
