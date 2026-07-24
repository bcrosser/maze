import type {DirectionId} from '../domain/overworld/move-player';
import type {OverworldControl} from '../scenes/overworld.scene';

/** Fraction of the pad radius the stick must travel before it steers. */
const STICK_DEAD_ZONE = 0.34;
/** Repeat cadence while the stick is held away from centre. */
const STICK_REPEAT_MS = 190;

const DIRECTIONS: readonly DirectionId[] = ['up', 'down', 'left', 'right'];

function isDirection(value: string | undefined): value is DirectionId {
    return value !== undefined && (DIRECTIONS as readonly string[]).includes(value);
}

function requireElement<T extends HTMLElement>(root: ParentNode, selector: string): T {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Expected the control deck to provide ${selector}.`);
    return element;
}

export interface OverworldControlDeck {
    setVisible(visible: boolean): void;
    setAttackTargeting(active: boolean): void;
    destroy(): void;
}

/**
 * Wires the on-screen control deck to overworld actions. The movement pad
 * accepts both discrete arrow taps and a drag-anywhere analogue stick, which
 * is far easier to use one-handed on a phone than small arrow buttons.
 */
export function installOverworldControlDeck(
    deck: HTMLElement,
    dispatch: (control: OverworldControl) => void,
    openMenu: () => void
): OverworldControlDeck {
    const pad = requireElement<HTMLElement>(deck, '#move-pad');
    const stick = requireElement<HTMLElement>(deck, '#move-stick');
    const attackButton = requireElement<HTMLButtonElement>(deck, '#control-attack');
    const moveButtons = [...deck.querySelectorAll<HTMLButtonElement>('.move-btn')];

    let activePointerId: number | null = null;
    let steeredWithStick = false;
    let heldDirection: DirectionId | null = null;
    let repeatTimer: number | null = null;

    const highlight = (direction: DirectionId | null): void => {
        for (const button of moveButtons) {
            button.dataset.pressed = String(button.dataset['direction'] === direction);
        }
    };

    const stopRepeat = (): void => {
        if (repeatTimer !== null) {
            window.clearInterval(repeatTimer);
            repeatTimer = null;
        }
    };

    const releaseStick = (): void => {
        stopRepeat();
        heldDirection = null;
        activePointerId = null;
        stick.style.transform = '';
        pad.dataset.active = 'false';
        highlight(null);
    };

    const steer = (direction: DirectionId): void => {
        if (direction === heldDirection) return;
        heldDirection = direction;
        highlight(direction);
        dispatch({kind: 'move', direction});
        stopRepeat();
        repeatTimer = window.setInterval(() => {
            if (heldDirection) dispatch({kind: 'move', direction: heldDirection});
        }, STICK_REPEAT_MS);
    };

    const handlePointerMove = (event: PointerEvent): void => {
        if (event.pointerId !== activePointerId) return;
        const bounds = pad.getBoundingClientRect();
        const radius = Math.max(1, Math.min(bounds.width, bounds.height) / 2);
        const dx = event.clientX - (bounds.left + bounds.width / 2);
        const dy = event.clientY - (bounds.top + bounds.height / 2);
        const distance = Math.hypot(dx, dy);
        const clamped = Math.min(1, distance / radius);
        stick.style.transform =
            `translate(${(dx / (distance || 1)) * clamped * radius * 0.5}px, ` +
            `${(dy / (distance || 1)) * clamped * radius * 0.5}px)`;
        if (clamped < STICK_DEAD_ZONE) {
            stopRepeat();
            heldDirection = null;
            highlight(null);
            return;
        }
        steeredWithStick = true;
        steer(
            Math.abs(dx) >= Math.abs(dy)
                ? dx < 0 ? 'left' : 'right'
                : dy < 0 ? 'up' : 'down'
        );
    };

    const handlePointerDown = (event: PointerEvent): void => {
        if (activePointerId !== null) return;
        activePointerId = event.pointerId;
        steeredWithStick = false;
        pad.dataset.active = 'true';
        pad.setPointerCapture(event.pointerId);
        handlePointerMove(event);
    };

    const handlePointerUp = (event: PointerEvent): void => {
        if (event.pointerId !== activePointerId) return;
        if (pad.hasPointerCapture(event.pointerId)) {
            pad.releasePointerCapture(event.pointerId);
        }
        releaseStick();
    };

    const handleMoveButtonClick = (event: MouseEvent): void => {
        // A drag already produced movement, so ignore the synthetic tap.
        if (steeredWithStick) return;
        const direction = (event.currentTarget as HTMLElement).dataset['direction'];
        if (isDirection(direction)) dispatch({kind: 'move', direction});
    };

    const actions: readonly {
        readonly selector: string;
        readonly run: () => void;
    }[] = [
        {selector: '#control-attack', run: () => dispatch({kind: 'attack-toggle'})},
        {selector: '#control-use', run: () => dispatch({kind: 'use'})},
        {selector: '#control-interact', run: () => dispatch({kind: 'interact'})},
        {selector: '#control-wait', run: () => dispatch({kind: 'wait'})},
        {selector: '#control-inventory', run: () => dispatch({kind: 'inventory'})},
        {selector: '#control-menu', run: openMenu}
    ];
    const actionListeners = actions.map(action => {
        const button = requireElement<HTMLButtonElement>(deck, action.selector);
        const listener = (): void => action.run();
        button.addEventListener('click', listener);
        return {button, listener};
    });

    pad.addEventListener('pointerdown', handlePointerDown);
    pad.addEventListener('pointermove', handlePointerMove);
    pad.addEventListener('pointerup', handlePointerUp);
    pad.addEventListener('pointercancel', handlePointerUp);
    for (const button of moveButtons) {
        button.addEventListener('click', handleMoveButtonClick);
    }
    highlight(null);

    return {
        setVisible(visible: boolean): void {
            deck.classList.toggle('hidden', !visible);
            if (!visible) releaseStick();
        },
        setAttackTargeting(active: boolean): void {
            attackButton.setAttribute('aria-pressed', String(active));
        },
        destroy(): void {
            releaseStick();
            pad.removeEventListener('pointerdown', handlePointerDown);
            pad.removeEventListener('pointermove', handlePointerMove);
            pad.removeEventListener('pointerup', handlePointerUp);
            pad.removeEventListener('pointercancel', handlePointerUp);
            for (const button of moveButtons) {
                button.removeEventListener('click', handleMoveButtonClick);
            }
            for (const {button, listener} of actionListeners) {
                button.removeEventListener('click', listener);
            }
        }
    };
}
