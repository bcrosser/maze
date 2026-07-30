import type {DirectionId} from '../domain/overworld/move-player';

/**
 * How the shared movement pad behaves for a scheme. The maze's discrete
 * repeat-while-held stick is the baseline every game now reuses; the other
 * modes only narrow the axes or drop the repeat for continuous-motion games.
 */
export type ControlStickMode =
    /** Discrete steps with a repeat cadence while the stick stays deflected. */
    | 'four-way-step'
    /** Press/release edges only, for games that integrate held direction. */
    | 'analog'
    /** Up/down only, with the repeat cadence. */
    | 'vertical'
    /** Left/right only, with press/release edges. */
    | 'horizontal'
    | 'none';

export type ControlButtonBehavior =
    /** Fires once per press. */
    | 'tap'
    /** Fires press and release edges so a scene can hold state. */
    | 'hold'
    /** Fires once per press and renders a pressed state the scene owns. */
    | 'toggle';

export interface ControlButtonSpec {
    /** Stable id; the rendered element id is `control-<id>`. */
    readonly id: string;
    readonly label: string;
    /** Single decorative glyph rendered above the label. */
    readonly icon: string;
    readonly behavior: ControlButtonBehavior;
    /**
     * Optional HUD stat token reused for the button's accent stripe, matching
     * the `--stat-accent` custom property already defined in the shell.
     */
    readonly accent?: string;
    readonly ariaLabel?: string;
}

export interface ControlStickSpec {
    readonly mode: ControlStickMode;
    /** Accessible group label for the pad. */
    readonly label: string;
    /** Repeat cadence for the stepped modes. */
    readonly repeatMs?: number;
}

export interface ControlScheme {
    readonly id: string;
    readonly stick: ControlStickSpec;
    /** Renders the three overworld quick-slot buttons above the actions. */
    readonly quickSlots?: boolean;
    readonly buttons: readonly ControlButtonSpec[];
}

export type ControlEventPhase = 'press' | 'release';

export type ControlEvent =
    | {
        readonly kind: 'direction';
        readonly direction: DirectionId;
        readonly phase: ControlEventPhase;
    }
    | {
        readonly kind: 'button';
        readonly id: string;
        readonly phase: ControlEventPhase;
    }
    | {readonly kind: 'quick-slot'; readonly slot: 0 | 1 | 2};

export type ControlEventHandler = (event: ControlEvent) => void;

/** The deck never renders more buttons than the action grid can stay tappable. */
export const MAX_CONTROL_BUTTONS = 6;

const STEP_REPEAT_MS = 190;

function scheme(value: ControlScheme): ControlScheme {
    if (value.buttons.length > MAX_CONTROL_BUTTONS) {
        throw new Error(
            `Control scheme ${value.id} declares more than ${MAX_CONTROL_BUTTONS} buttons.`
        );
    }
    const ids = new Set(value.buttons.map(button => button.id));
    if (ids.size !== value.buttons.length) {
        throw new Error(`Control scheme ${value.id} declares duplicate button ids.`);
    }
    return Object.freeze({
        ...value,
        stick: Object.freeze(value.stick),
        buttons: Object.freeze(value.buttons.map(button => Object.freeze(button)))
    });
}

export const OVERWORLD_CONTROL_SCHEME = scheme({
    id: 'overworld',
    stick: {
        mode: 'four-way-step',
        label: 'Movement pad. Tap an arrow or drag the stick.',
        repeatMs: STEP_REPEAT_MS
    },
    quickSlots: true,
    buttons: [
        {id: 'attack', label: 'Attack', icon: '⚔', behavior: 'toggle', accent: 'weapon'},
        {id: 'interact', label: 'Interact', icon: '◎', behavior: 'tap', accent: 'objective'},
        {id: 'wait', label: 'Wait', icon: '⌚', behavior: 'tap', accent: 'status'},
        {id: 'inventory', label: 'Items', icon: '▤', behavior: 'tap', accent: 'pack'},
        {id: 'menu', label: 'Menu', icon: '☰', behavior: 'tap', accent: 'level'}
    ]
});

export const PIPE_CONTROL_SCHEME = scheme({
    id: 'pipe',
    stick: {
        mode: 'four-way-step',
        label: 'Pipe cursor pad. Drag or tap to move the placement cursor.',
        repeatMs: STEP_REPEAT_MS
    },
    buttons: [
        {id: 'place', label: 'Place', icon: '■', behavior: 'tap', accent: 'objective'},
        {id: 'finish', label: 'Finish', icon: '✔', behavior: 'tap', accent: 'exit'}
    ]
});

export const LOCKPICK_CONTROL_SCHEME = scheme({
    id: 'lockpick',
    stick: {
        mode: 'four-way-step',
        label: 'Pick pad. Left and right choose a pin; up and down lift it.',
        repeatMs: 130
    },
    buttons: [
        {id: 'set', label: 'Set Pin', icon: '◉', behavior: 'tap', accent: 'objective'},
        {id: 'ease', label: 'Ease', icon: '◀', behavior: 'tap', accent: 'status'},
        {id: 'grip', label: 'Grip', icon: '▶', behavior: 'tap', accent: 'health'},
        {id: 'turn', label: 'Turn', icon: '↻', behavior: 'tap', accent: 'exit'}
    ]
});

export const SAFE_DIAL_CONTROL_SCHEME = scheme({
    id: 'safe-dial',
    stick: {
        mode: 'four-way-step',
        label: 'Dial pad. Left and right nudge one click; up and down move five.',
        repeatMs: 150
    },
    buttons: [
        {id: 'set', label: 'Set Gate', icon: '◉', behavior: 'tap', accent: 'objective'},
        {id: 'handle', label: 'Handle', icon: '↻', behavior: 'tap', accent: 'exit'}
    ]
});

export const TUMBLER_RELAY_CONTROL_SCHEME = scheme({
    id: 'tumbler-relay',
    stick: {mode: 'none', label: 'The tumbler relay is a timing game with buttons only.'},
    buttons: [
        {id: 'latch', label: 'Latch', icon: '⬟', behavior: 'tap', accent: 'objective'},
        {id: 'turn', label: 'Turn Cam', icon: '↻', behavior: 'tap', accent: 'exit'}
    ]
});

export const CIRCUIT_CONTROL_SCHEME = scheme({
    id: 'circuit',
    stick: {
        mode: 'four-way-step',
        label: 'Board cursor pad. Move the chip cursor.',
        repeatMs: STEP_REPEAT_MS
    },
    buttons: [
        {id: 'swap', label: 'Swap', icon: '⇄', behavior: 'tap', accent: 'objective'},
        {id: 'extra', label: 'Overclock', icon: '⚡', behavior: 'tap', accent: 'weapon'},
        {id: 'hint', label: 'Trace', icon: '↗', behavior: 'tap', accent: 'status'},
        {id: 'pulse', label: 'Pulse', icon: '✹', behavior: 'toggle', accent: 'health'},
        {id: 'shuffle', label: 'Reroute', icon: '↺', behavior: 'tap', accent: 'pack'}
    ]
});

export const SHOOTER_CONTROL_SCHEME = scheme({
    id: 'shooter',
    stick: {
        mode: 'analog',
        label: 'Flight pad. Drag to fly the ship.'
    },
    buttons: [
        {id: 'fire', label: 'Fire', icon: '▶', behavior: 'hold', accent: 'weapon'},
        // Action games fire on the press edge, which also lets a bomb land as a
        // third simultaneous contact alongside the stick and Fire.
        {id: 'bomb', label: 'Bomb', icon: '✹', behavior: 'hold', accent: 'health'}
    ]
});

export const PLATFORMER_CONTROL_SCHEME = scheme({
    id: 'platformer',
    stick: {
        mode: 'analog',
        label: 'Movement pad. Drag to run; hold down to drop through a platform.'
    },
    buttons: [
        {id: 'jump', label: 'Jump', icon: '⤴', behavior: 'hold', accent: 'objective'},
        {id: 'fire', label: 'Fire', icon: '▶', behavior: 'hold', accent: 'weapon'}
    ]
});

export const HORSEMASTER_CONTROL_SCHEME = scheme({
    id: 'horsemaster',
    stick: {
        mode: 'four-way-step',
        label: 'Hop pad. Drag or tap a direction to hop the horse.',
        repeatMs: 240
    },
    buttons: [
        {id: 'hop', label: 'Hop', icon: '⤴', behavior: 'tap', accent: 'objective'}
    ]
});

export const ZAPPER_CONTROL_SCHEME = scheme({
    id: 'zapper',
    stick: {
        mode: 'vertical',
        label: 'Lane pad. Drag up or down to change bench lane.',
        repeatMs: 220
    },
    buttons: [
        {id: 'fill', label: 'Fill', icon: '●', behavior: 'hold', accent: 'health'},
        {id: 'slide', label: 'Slide', icon: '▶', behavior: 'tap', accent: 'weapon'}
    ]
});

export const CASINO_HEIST_CONTROL_SCHEME = scheme({
    id: 'casino-heist',
    stick: {
        mode: 'analog',
        label: 'Driving pad. Drag to steer and to move up or down the road.'
    },
    buttons: [
        {id: 'fire', label: 'Fire', icon: '▶', behavior: 'hold', accent: 'weapon'},
        {id: 'deploy', label: 'Deploy', icon: '✹', behavior: 'hold', accent: 'health'},
        {id: 'switch', label: 'Switch', icon: '↻', behavior: 'tap', accent: 'pack'}
    ]
});

export const BLACKJACK_CONTROL_SCHEME = scheme({
    id: 'blackjack',
    stick: {
        mode: 'horizontal',
        label: 'Wager pad. Left and right change the wager before dealing.'
    },
    buttons: [
        {id: 'deal', label: 'Deal', icon: '♣', behavior: 'tap', accent: 'money'},
        {id: 'hit', label: 'Hit', icon: '➕', behavior: 'tap', accent: 'health'},
        {id: 'stand', label: 'Stand', icon: '✋', behavior: 'tap', accent: 'status'},
        {id: 'double', label: 'Double', icon: '✖', behavior: 'tap', accent: 'weapon'}
    ]
});

export const HOLDEM_CONTROL_SCHEME = scheme({
    id: 'holdem',
    stick: {
        mode: 'horizontal',
        label: 'Ante pad. Left and right change the ante before dealing.'
    },
    buttons: [
        {id: 'deal', label: 'Deal', icon: '♠', behavior: 'tap', accent: 'money'},
        {id: 'check', label: 'Check', icon: '✋', behavior: 'tap', accent: 'status'},
        {id: 'bet', label: 'Bet', icon: '➕', behavior: 'tap', accent: 'health'},
        {id: 'raise', label: 'Raise', icon: '⤴', behavior: 'tap', accent: 'weapon'},
        {id: 'fold', label: 'Fold', icon: '✖', behavior: 'tap', accent: 'pack'}
    ]
});

export const CONTROL_SCHEMES: readonly ControlScheme[] = Object.freeze([
    OVERWORLD_CONTROL_SCHEME,
    PIPE_CONTROL_SCHEME,
    LOCKPICK_CONTROL_SCHEME,
    SAFE_DIAL_CONTROL_SCHEME,
    TUMBLER_RELAY_CONTROL_SCHEME,
    CIRCUIT_CONTROL_SCHEME,
    SHOOTER_CONTROL_SCHEME,
    PLATFORMER_CONTROL_SCHEME,
    HORSEMASTER_CONTROL_SCHEME,
    ZAPPER_CONTROL_SCHEME,
    CASINO_HEIST_CONTROL_SCHEME,
    BLACKJACK_CONTROL_SCHEME,
    HOLDEM_CONTROL_SCHEME
]);

/** True when the scheme's stick can produce the direction at all. */
export function stickSupportsDirection(
    mode: ControlStickMode,
    direction: DirectionId
): boolean {
    switch (mode) {
        case 'none':
            return false;
        case 'vertical':
            return direction === 'up' || direction === 'down';
        case 'horizontal':
            return direction === 'left' || direction === 'right';
        default:
            return true;
    }
}

/** Stepped modes repeat while held; continuous modes report edges instead. */
export function stickRepeatsWhileHeld(mode: ControlStickMode): boolean {
    return mode === 'four-way-step' || mode === 'vertical';
}
