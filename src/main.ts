import {enterPhaserGame, getGameShell} from './app/game-shell';
import itemSpriteSheetUrl from '../assets/item-sprites.png?url';
import monsterSpriteSheetUrl from '../assets/monster-sprites.png?url';
import objectiveSpriteSheetUrl from '../assets/objective-sprites.png?url';
import spaceAtlasImageUrl from '../assets/space-sprites.png?url';
import spaceAtlasDataUrl from '../assets/space-sprites.json?url';
import {WebCryptoCampaignSeedSource} from './domain/random/seed-derivation';

const shell = getGameShell();
const PENDING_CAMPAIGN_SEED_KEY = 'maze:pending-campaign-seed';
let started = false;

shell.canvas.dataset.runtime = 'phaser';
shell.startButton.addEventListener('click', async () => {
    if (started) return;
    started = true;
    shell.startButton.disabled = true;
    shell.startButton.textContent = 'Loading Phaser...';

    try {
        const [{createMazeGame}, {LocalSaveRepository}, {installPhaserShellControls}] =
            await Promise.all([
                import('./app/create-game'),
                import('./save/local-save-repository'),
                import('./app/phaser-shell-controls')
            ]);
        const saveRepository = new LocalSaveRepository(window.localStorage);
        let initialCampaign;
        try {
            initialCampaign = saveRepository.load('slot-1')?.state;
        } catch (error) {
            shell.gameMain.dataset.saveError = error instanceof Error
                ? error.message
                : 'Save data could not be loaded.';
            console.error(error);
        }
        if (!initialCampaign) {
            shell.startButton.textContent = 'GENERATING MAZE · WILSON v1';
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
        const pendingSeedText = window.sessionStorage.getItem(PENDING_CAMPAIGN_SEED_KEY);
        const pendingSeed = pendingSeedText === null ? null : Number(pendingSeedText);
        const validPendingSeed = pendingSeed !== null &&
            Number.isSafeInteger(pendingSeed) &&
            pendingSeed >= 0 &&
            pendingSeed <= 0xffff_ffff
            ? pendingSeed
            : null;
        const campaignSeed = initialCampaign?.campaignSeed ??
            validPendingSeed ??
            new WebCryptoCampaignSeedSource().nextSeed();
        const canvas = enterPhaserGame(shell);
        const game = createMazeGame(canvas, shell, {
            ...(initialCampaign ? {initialCampaign} : {}),
            campaignSeed,
            itemSpriteSheetUrl,
            monsterSpriteSheetUrl,
            objectiveSpriteSheetUrl,
            spaceAtlasImageUrl,
            spaceAtlasDataUrl,
            onCampaignChanged: state => {
                saveRepository.save('slot-1', state);
                window.sessionStorage.removeItem(PENDING_CAMPAIGN_SEED_KEY);
            }
        });
        const canvasStage = canvas.parentElement;
        if (canvasStage && 'ResizeObserver' in window) {
            let pendingResizeFrame: number | null = null;
            const stageResizeObserver = new ResizeObserver(() => {
                if (pendingResizeFrame !== null) {
                    cancelAnimationFrame(pendingResizeFrame);
                }
                pendingResizeFrame = requestAnimationFrame(() => {
                    pendingResizeFrame = null;
                    game.scale.refresh();
                });
            });
            stageResizeObserver.observe(canvasStage);
            game.events.once('destroy', () => {
                stageResizeObserver.disconnect();
                if (pendingResizeFrame !== null) {
                    cancelAnimationFrame(pendingResizeFrame);
                }
            });
        }
        installPhaserShellControls(game, shell, () => {
            try {
                const nextSeed = new WebCryptoCampaignSeedSource().nextSeed();
                window.sessionStorage.setItem(PENDING_CAMPAIGN_SEED_KEY, String(nextSeed));
                saveRepository.clear('slot-1');
                window.location.reload();
            } catch (error) {
                const detail = error instanceof Error
                    ? error.message
                    : 'Unable to create a random maze.';
                shell.message.textContent =
                    `${detail} The current campaign was not changed.`;
                shell.message.setAttribute('role', 'alert');
                console.error(error);
            }
        });
    } catch (error) {
        started = false;
        shell.startButton.disabled = false;
        shell.startButton.textContent = 'Retry';
        const detail = error instanceof Error
            ? error.message
            : 'Unable to create a random maze.';
        const hint = shell.startPanel.querySelector<HTMLElement>('.hint');
        if (hint) {
            hint.textContent = detail.startsWith('Unable to create a random maze')
                ? `${detail} Your existing save was not changed.`
                : `The game could not start: ${detail}`;
            hint.setAttribute('role', 'alert');
        }
        shell.startPanel.dataset.startError = detail;
        console.error(error);
    }
});
shell.startButton.dataset.appReady = 'true';
