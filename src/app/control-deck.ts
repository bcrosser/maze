import type {DirectionId} from '../domain/overworld/move-player';
import {
    stickRepeatsWhileHeld,
    stickSupportsDirection,
    type ControlButtonSpec,
    type ControlEventHandler,
    type ControlScheme
} from './control-scheme';

/** Fraction of the pad radius the stick must travel before it steers. */
const STICK_DEAD_ZONE = 0.34;
/** Fallback repeat cadence while the stick is held away from centre. */
const DEFAULT_REPEAT_MS = 190;

const DIRECTIONS: readonly DirectionId[] = ['up', 'down', 'left', 'right'];

function isDirection(value: string | undefined): value is DirectionId {
    return value !== undefined && (DIRECTIONS as readonly string[]).includes(value);
}

function requireElement<T extends HTMLElement>(root: ParentNode, selector: string): T {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Expected the control deck to provide ${selector}.`);
    return element;
}

export interface ControlButtonState {
    /** Renders the pressed/armed appearance through `aria-pressed`. */
    readonly pressed?: boolean;
    readonly label?: string;
    readonly disabled?: boolean;
}

export interface QuickSlotView {
    readonly icon: string;
    readonly label: string;
    /** Small trailing detail such as a stack count or charge readout. */
    readonly detail?: string;
}

/**
 * The single on-screen control surface for every scene. Games declare a
 * `ControlScheme`; the deck renders exactly those buttons so a two-button game
 * shows two wide buttons rather than four dead ones, and the movement pad keeps
 * the drag-anywhere behaviour that makes the maze comfortable one-handed.
 */
export interface ControlDeckHost {
    setScheme(scheme: ControlScheme, handler: ControlEventHandler): void;
    /** Removes the scheme only if it is still the active one. */
    clearScheme(schemeId: string): void;
    readonly activeSchemeId: string | null;
    setButtonState(buttonId: string, state: ControlButtonState): void;
    setQuickSlots(slots: readonly (QuickSlotView | null)[]): void;
    setVisible(visible: boolean): void;
    destroy(): void;
}

interface RenderedButton {
    readonly spec: ControlButtonSpec;
    readonly button: HTMLButtonElement;
    readonly labelElement: HTMLElement;
    readonly teardown: () => void;
}

export function installControlDeck(deck: HTMLElement): ControlDeckHost {
    const pad = requireElement<HTMLElement>(deck, '#move-pad');
    const stick = requireElement<HTMLElement>(deck, '#move-stick');
    const actionPad = requireElement<HTMLElement>(deck, '#action-pad');
    const quickSlotRow = requireElement<HTMLElement>(deck, '#quick-slot-row');
    const moveButtons = [...deck.querySelectorAll<HTMLButtonElement>('.move-btn')];

    let scheme: ControlScheme | null = null;
    let handler: ControlEventHandler | null = null;
    let rendered: RenderedButton[] = [];
    let quickSlotButtons: HTMLButtonElement[] = [];

    let activePointerId: number | null = null;
    let steeredWithStick = false;
    let heldDirection: DirectionId | null = null;
    let repeatTimer: number | null = null;

    const emit: ControlEventHandler = event => handler?.(event);

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

    /** Continuous schemes need the matching release edge before a new press. */
    const releaseHeldDirection = (): void => {
        stopRepeat();
        const previous = heldDirection;
        heldDirection = null;
        if (previous === null) return;
        if (scheme && !stickRepeatsWhileHeld(scheme.stick.mode)) {
            emit({kind: 'direction', direction: previous, phase: 'release'});
        }
    };

    const releaseStick = (): void => {
        releaseHeldDirection();
        activePointerId = null;
        stick.style.transform = '';
        pad.dataset.active = 'false';
        highlight(null);
    };

    const steer = (direction: DirectionId): void => {
        if (!scheme || !stickSupportsDirection(scheme.stick.mode, direction)) return;
        if (direction === heldDirection) return;
        releaseHeldDirection();
        heldDirection = direction;
        highlight(direction);
        emit({kind: 'direction', direction, phase: 'press'});
        if (!stickRepeatsWhileHeld(scheme.stick.mode)) return;
        repeatTimer = window.setInterval(() => {
            if (heldDirection) {
                emit({kind: 'direction', direction: heldDirection, phase: 'press'});
            }
        }, scheme.stick.repeatMs ?? DEFAULT_REPEAT_MS);
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
            releaseHeldDirection();
            highlight(null);
            return;
        }
        steeredWithStick = true;
        const mode = scheme?.stick.mode ?? 'none';
        // A narrowed pad must not lose input to its unused axis, so the
        // dominant-axis test only runs when both axes are live.
        const horizontalWins = mode === 'horizontal'
            ? true
            : mode === 'vertical'
                ? false
                : Math.abs(dx) >= Math.abs(dy);
        steer(
            horizontalWins
                ? dx < 0 ? 'left' : 'right'
                : dy < 0 ? 'up' : 'down'
        );
    };

    const handlePointerDown = (event: PointerEvent): void => {
        if (activePointerId !== null || scheme === null) return;
        if (scheme.stick.mode === 'none') return;
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
        if (steeredWithStick || scheme === null) return;
        if (!stickRepeatsWhileHeld(scheme.stick.mode)) return;
        const direction = (event.currentTarget as HTMLElement).dataset['direction'];
        if (!isDirection(direction)) return;
        if (!stickSupportsDirection(scheme.stick.mode, direction)) return;
        emit({kind: 'direction', direction, phase: 'press'});
    };

    /**
     * Continuous schemes treat an arrow as a hold, not a one-shot step. Release
     * is left to the pad, which owns the captured pointer: capturing on the pad
     * immediately fires `pointerleave` on the button under the finger, so a
     * release listener here would cancel the press it just started.
     */
    const handleMoveButtonPointerDown = (event: PointerEvent): void => {
        if (scheme === null || stickRepeatsWhileHeld(scheme.stick.mode)) return;
        const direction = (event.currentTarget as HTMLElement).dataset['direction'];
        if (!isDirection(direction)) return;
        if (!stickSupportsDirection(scheme.stick.mode, direction)) return;
        steer(direction);
    };

    const createActionButton = (spec: ControlButtonSpec): RenderedButton => {
        const button = document.createElement('button');
        button.className = 'action-btn';
        button.type = 'button';
        button.id = `control-${spec.id}`;
        if (spec.accent) button.dataset.stat = spec.accent;
        button.setAttribute('aria-label', spec.ariaLabel ?? spec.label);
        if (spec.behavior === 'toggle') button.setAttribute('aria-pressed', 'false');

        const icon = document.createElement('span');
        icon.className = 'action-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = spec.icon;
        const labelElement = document.createElement('span');
        labelElement.className = 'action-label';
        labelElement.textContent = spec.label;
        button.append(icon, labelElement);

        const listeners: readonly [string, EventListener][] = spec.behavior === 'hold'
            ? [
                ['pointerdown', (event: Event) => {
                    (event as PointerEvent).preventDefault();
                    button.setAttribute('aria-pressed', 'true');
                    emit({kind: 'button', id: spec.id, phase: 'press'});
                }],
                ['pointerup', () => {
                    button.setAttribute('aria-pressed', 'false');
                    emit({kind: 'button', id: spec.id, phase: 'release'});
                }],
                ['pointercancel', () => {
                    button.setAttribute('aria-pressed', 'false');
                    emit({kind: 'button', id: spec.id, phase: 'release'});
                }],
                ['pointerleave', () => {
                    if (button.getAttribute('aria-pressed') !== 'true') return;
                    button.setAttribute('aria-pressed', 'false');
                    emit({kind: 'button', id: spec.id, phase: 'release'});
                }],
                ['keydown', (event: Event) => {
                    const key = (event as KeyboardEvent).key;
                    if (key !== 'Enter' && key !== ' ') return;
                    if ((event as KeyboardEvent).repeat) return;
                    button.setAttribute('aria-pressed', 'true');
                    emit({kind: 'button', id: spec.id, phase: 'press'});
                }],
                ['keyup', (event: Event) => {
                    const key = (event as KeyboardEvent).key;
                    if (key !== 'Enter' && key !== ' ') return;
                    button.setAttribute('aria-pressed', 'false');
                    emit({kind: 'button', id: spec.id, phase: 'release'});
                }]
            ]
            : [
                ['click', () => emit({kind: 'button', id: spec.id, phase: 'press'})]
            ];
        for (const [type, listener] of listeners) {
            button.addEventListener(type, listener);
        }
        // Hold buttons must not also emit the browser's synthetic click.
        if (spec.behavior === 'hold') {
            button.addEventListener('click', preventDefaultListener);
        }

        return {
            spec,
            button,
            labelElement,
            teardown: () => {
                for (const [type, listener] of listeners) {
                    button.removeEventListener(type, listener);
                }
                if (spec.behavior === 'hold') {
                    button.removeEventListener('click', preventDefaultListener);
                }
                button.remove();
            }
        };
    };

    const createQuickSlotButton = (slot: 0 | 1 | 2): HTMLButtonElement => {
        const button = document.createElement('button');
        button.className = 'action-btn quick-slot-btn';
        button.type = 'button';
        button.id = `quick-slot-${slot}`;
        button.dataset.quickSlot = String(slot);
        button.dataset.stat = 'health';
        const icon = document.createElement('span');
        icon.className = 'action-icon';
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'action-label';
        button.append(icon, label);
        button.addEventListener('click', quickSlotListener);
        renderQuickSlot(button, null, slot);
        return button;
    };

    const clearRendered = (): void => {
        for (const entry of rendered) entry.teardown();
        rendered = [];
        for (const button of quickSlotButtons) {
            button.removeEventListener('click', quickSlotListener);
            button.remove();
        }
        quickSlotButtons = [];
    };

    function quickSlotListener(event: Event): void {
        const raw = (event.currentTarget as HTMLElement).dataset['quickSlot'];
        const slot = Number(raw);
        if (slot !== 0 && slot !== 1 && slot !== 2) return;
        emit({kind: 'quick-slot', slot});
    }

    function preventDefaultListener(event: Event): void {
        event.preventDefault();
    }

    function renderQuickSlot(
        button: HTMLButtonElement,
        view: QuickSlotView | null,
        slot: number
    ): void {
        const icon = button.querySelector<HTMLElement>('.action-icon');
        const label = button.querySelector<HTMLElement>('.action-label');
        if (icon) icon.textContent = view?.icon ?? '·';
        const text = view
            ? `${slot + 1} ${view.label}${view.detail ? ` ${view.detail}` : ''}`
            : `${slot + 1} Empty`;
        if (label) label.textContent = text;
        button.disabled = view === null;
        button.dataset.filled = String(view !== null);
        button.setAttribute(
            'aria-label',
            view ? `Quick slot ${slot + 1}: ${view.label}` : `Quick slot ${slot + 1} is empty`
        );
    }

    pad.addEventListener('pointerdown', handlePointerDown);
    pad.addEventListener('pointermove', handlePointerMove);
    pad.addEventListener('pointerup', handlePointerUp);
    pad.addEventListener('pointercancel', handlePointerUp);
    for (const button of moveButtons) {
        button.addEventListener('click', handleMoveButtonClick);
        button.addEventListener('pointerdown', handleMoveButtonPointerDown);
    }
    highlight(null);

    return {
        get activeSchemeId(): string | null {
            return scheme?.id ?? null;
        },
        setScheme(next: ControlScheme, nextHandler: ControlEventHandler): void {
            releaseStick();
            clearRendered();
            scheme = next;
            handler = nextHandler;

            deck.dataset.scheme = next.id;
            deck.dataset.stick = next.stick.mode;
            pad.setAttribute('aria-label', next.stick.label);
            pad.classList.toggle('hidden', next.stick.mode === 'none');
            for (const button of moveButtons) {
                const direction = button.dataset['direction'];
                const usable = isDirection(direction) &&
                    stickSupportsDirection(next.stick.mode, direction);
                button.classList.toggle('hidden', !usable);
                button.disabled = !usable;
            }

            quickSlotRow.classList.toggle('hidden', next.quickSlots !== true);
            if (next.quickSlots === true) {
                quickSlotButtons = ([0, 1, 2] as const).map(createQuickSlotButton);
                quickSlotRow.append(...quickSlotButtons);
            }

            rendered = next.buttons.map(createActionButton);
            // Two buttons should fill the row instead of leaving dead columns.
            actionPad.style.gridTemplateColumns =
                `repeat(${Math.max(1, Math.min(3, rendered.length))}, minmax(0, 1fr))`;
            actionPad.append(...rendered.map(entry => entry.button));
        },
        clearScheme(schemeId: string): void {
            if (scheme?.id !== schemeId) return;
            releaseStick();
            clearRendered();
            scheme = null;
            handler = null;
            delete deck.dataset.scheme;
            delete deck.dataset.stick;
        },
        setButtonState(buttonId: string, state: ControlButtonState): void {
            const entry = rendered.find(candidate => candidate.spec.id === buttonId);
            if (!entry) return;
            if (state.pressed !== undefined) {
                entry.button.setAttribute('aria-pressed', String(state.pressed));
            }
            if (state.label !== undefined) entry.labelElement.textContent = state.label;
            if (state.disabled !== undefined) entry.button.disabled = state.disabled;
        },
        setQuickSlots(slots: readonly (QuickSlotView | null)[]): void {
            quickSlotButtons.forEach((button, index) => {
                renderQuickSlot(button, slots[index] ?? null, index);
            });
        },
        setVisible(visible: boolean): void {
            deck.classList.toggle('hidden', !visible);
            if (!visible) releaseStick();
        },
        destroy(): void {
            releaseStick();
            clearRendered();
            pad.removeEventListener('pointerdown', handlePointerDown);
            pad.removeEventListener('pointermove', handlePointerMove);
            pad.removeEventListener('pointerup', handlePointerUp);
            pad.removeEventListener('pointercancel', handlePointerUp);
            for (const button of moveButtons) {
                button.removeEventListener('click', handleMoveButtonClick);
                button.removeEventListener('pointerdown', handleMoveButtonPointerDown);
            }
            scheme = null;
            handler = null;
        }
    };
}
