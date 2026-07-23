import {enterPhaserGame, getGameShell} from './app/game-shell';
import {getRuntimeMode} from './app/runtime-mode';
import itemSpriteSheetUrl from '../assets/item-sprites.png?url';
import monsterSpriteSheetUrl from '../assets/monster-sprites.png?url';

const shell = getGameShell();
const runtimeMode = getRuntimeMode(window.location.search);
shell.legacyCanvas.dataset.runtime = runtimeMode;
shell.legacyCanvas.dataset.itemSpriteSource = itemSpriteSheetUrl;
shell.legacyCanvas.dataset.monsterSpriteSource = monsterSpriteSheetUrl;

if (runtimeMode === 'phaser') {
    let started = false;
    shell.startButton.addEventListener('click', async () => {
        if (started) return;
        started = true;
        shell.startButton.disabled = true;
        shell.startButton.textContent = 'Loading Phaser...';

        try {
            const [{createMazeGame}, {LocalSaveRepository}, {installPhaserShellControls}] = await Promise.all([
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
            const canvas = enterPhaserGame(shell);
            const game = createMazeGame(canvas, shell, {
                ...(initialCampaign ? {initialCampaign} : {}),
                itemSpriteSheetUrl,
                monsterSpriteSheetUrl,
                onCampaignChanged: state => saveRepository.save('slot-1', state)
            });
            installPhaserShellControls(game, shell, () => {
                saveRepository.clear('slot-1');
                window.location.reload();
            });
        } catch (error) {
            started = false;
            shell.startButton.disabled = false;
            shell.startButton.textContent = 'Start Game';
            throw error;
        }
    });
}