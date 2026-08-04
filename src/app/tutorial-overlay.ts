import {advanceTutorialStep, type TutorialStep} from './tutorial-steps';

/**
 * Draws the first-run tour over the whole page. The HUD and control deck are DOM
 * siblings of the canvas, so this cannot be a Phaser modal.
 */

export interface TutorialOverlayOptions {
    readonly steps: readonly TutorialStep[];
    readonly onFinished: () => void;
}

interface Box {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

const CARD_GAP = 18;
const VIEWPORT_MARGIN = 12;
const SPOTLIGHT_PADDING = 6;

let overlayActive = false;

function requireElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Expected the game shell to provide ${selector}.`);
    return element;
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(Math.max(value, low), Math.max(low, high));
}

function centreOf(box: Box): {x: number; y: number} {
    return {x: box.left + box.width / 2, y: box.top + box.height / 2};
}

/** Where the ray from a box's centre toward (x, y) crosses that box's border. */
function edgePoint(box: Box, x: number, y: number): {x: number; y: number} {
    const centre = centreOf(box);
    const dx = x - centre.x;
    const dy = y - centre.y;
    if (dx === 0 && dy === 0) return centre;
    const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : box.width / 2 / Math.abs(dx);
    const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : box.height / 2 / Math.abs(dy);
    const scale = Math.min(scaleX, scaleY);
    return {x: centre.x + dx * scale, y: centre.y + dy * scale};
}

function placeSpotlight(spotlight: HTMLElement, anchor: DOMRect | null): Box | null {
    if (anchor === null || anchor.width === 0 || anchor.height === 0) {
        // A zero-size hole keeps the surrounding shade without pointing anywhere.
        spotlight.style.left = `${Math.round(window.innerWidth / 2)}px`;
        spotlight.style.top = `${Math.round(window.innerHeight / 2)}px`;
        spotlight.style.width = '0px';
        spotlight.style.height = '0px';
        return null;
    }
    const box: Box = {
        left: anchor.left - SPOTLIGHT_PADDING,
        top: anchor.top - SPOTLIGHT_PADDING,
        width: anchor.width + SPOTLIGHT_PADDING * 2,
        height: anchor.height + SPOTLIGHT_PADDING * 2
    };
    spotlight.style.left = `${Math.round(box.left)}px`;
    spotlight.style.top = `${Math.round(box.top)}px`;
    spotlight.style.width = `${Math.round(box.width)}px`;
    spotlight.style.height = `${Math.round(box.height)}px`;
    return box;
}

function placeCard(card: HTMLElement, spot: Box | null): Box {
    card.style.left = '0px';
    card.style.top = '0px';
    const measured = card.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let left: number;
    let top: number;
    if (spot === null) {
        left = (viewportWidth - measured.width) / 2;
        top = (viewportHeight - measured.height) / 2;
    } else {
        const roomBelow = viewportHeight - (spot.top + spot.height) - CARD_GAP - VIEWPORT_MARGIN;
        const roomAbove = spot.top - CARD_GAP - VIEWPORT_MARGIN;
        top = roomBelow >= measured.height || roomBelow >= roomAbove
            ? spot.top + spot.height + CARD_GAP
            : spot.top - CARD_GAP - measured.height;
        left = spot.left + spot.width / 2 - measured.width / 2;
    }
    const box: Box = {
        left: clamp(left, VIEWPORT_MARGIN, viewportWidth - measured.width - VIEWPORT_MARGIN),
        top: clamp(top, VIEWPORT_MARGIN, viewportHeight - measured.height - VIEWPORT_MARGIN),
        width: measured.width,
        height: measured.height
    };
    card.style.left = `${Math.round(box.left)}px`;
    card.style.top = `${Math.round(box.top)}px`;
    return box;
}

function drawPointerLine(line: SVGLineElement, card: Box, spot: Box | null): void {
    if (spot === null) {
        line.setAttribute('visibility', 'hidden');
        return;
    }
    const spotCentre = centreOf(spot);
    const cardCentre = centreOf(card);
    const from = edgePoint(card, spotCentre.x, spotCentre.y);
    const to = edgePoint(spot, cardCentre.x, cardCentre.y);
    line.setAttribute('visibility', 'visible');
    line.setAttribute('x1', String(Math.round(from.x)));
    line.setAttribute('y1', String(Math.round(from.y)));
    line.setAttribute('x2', String(Math.round(to.x)));
    line.setAttribute('y2', String(Math.round(to.y)));
}

export function startTutorialOverlay(options: TutorialOverlayOptions): void {
    if (options.steps.length === 0) {
        options.onFinished();
        return;
    }
    if (overlayActive) return;
    overlayActive = true;

    const root = requireElement<HTMLElement>('#tutorial-overlay');
    const spotlight = requireElement<HTMLElement>('#tutorial-spotlight');
    const card = requireElement<HTMLElement>('#tutorial-card');
    const progress = requireElement<HTMLElement>('#tutorial-progress');
    const title = requireElement<HTMLElement>('#tutorial-title');
    const body = requireElement<HTMLElement>('#tutorial-body');
    const backButton = requireElement<HTMLButtonElement>('#tutorial-back');
    const nextButton = requireElement<HTMLButtonElement>('#tutorial-next');
    const skipButton = requireElement<HTMLButtonElement>('#tutorial-skip');
    const line = requireElement<SVGLineElement>('#tutorial-line line');

    let index = 0;

    const layout = (): void => {
        const step = options.steps[index]!;
        const anchor = step.anchorSelector === null
            ? null
            : document.querySelector<HTMLElement>(step.anchorSelector);
        const spot = placeSpotlight(spotlight, anchor?.getBoundingClientRect() ?? null);
        drawPointerLine(line, placeCard(card, spot), spot);
    };

    const render = (): void => {
        const step = options.steps[index]!;
        progress.textContent = `Step ${index + 1} of ${options.steps.length}`;
        title.textContent = step.title;
        body.textContent = step.body;
        backButton.disabled = index === 0;
        nextButton.textContent = index === options.steps.length - 1 ? 'Done' : 'Next';
        root.dataset.step = step.id;
        layout();
    };

    const close = (): void => {
        if (!overlayActive) return;
        overlayActive = false;
        root.classList.add('hidden');
        delete root.dataset.step;
        window.removeEventListener('resize', layout);
        window.removeEventListener('orientationchange', layout);
        window.removeEventListener('keydown', handleKeyDown, true);
        backButton.removeEventListener('click', goBack);
        nextButton.removeEventListener('click', goForward);
        skipButton.removeEventListener('click', close);
        options.onFinished();
    };

    function goForward(): void {
        if (index === options.steps.length - 1) {
            close();
            return;
        }
        index = advanceTutorialStep(index, 1, options.steps.length);
        render();
    }

    function goBack(): void {
        const previous = advanceTutorialStep(index, -1, options.steps.length);
        if (previous === index) return;
        index = previous;
        render();
    }

    function handleKeyDown(event: KeyboardEvent): void {
        // Swallow everything so no key reaches the pause handler or the maze.
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
        }
        const focusedHere = document.activeElement instanceof HTMLButtonElement &&
            root.contains(document.activeElement);
        if (event.key === 'Enter' || event.key === ' ') {
            // A focused button already activates itself; do not advance twice.
            if (focusedHere) return;
            event.preventDefault();
            goForward();
            return;
        }
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            goForward();
            return;
        }
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            goBack();
        }
    }

    backButton.addEventListener('click', goBack);
    nextButton.addEventListener('click', goForward);
    skipButton.addEventListener('click', close);
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', layout);
    window.addEventListener('keydown', handleKeyDown, true);

    root.classList.remove('hidden');
    render();
    // The control deck is built in the same frame the tour opens, so measure
    // again once the browser has settled its layout.
    requestAnimationFrame(layout);
    nextButton.focus();
}
