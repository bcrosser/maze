import type Phaser from 'phaser';

import type {GameShell} from './game-shell';

export interface PhaserShellControls {
    openMenu(): void;
    closeMenu(): void;
    destroy(): void;
}

export function installPhaserShellControls(
    game: Phaser.Game,
    shell: GameShell,
    onRestart: () => void
): PhaserShellControls {
    const pausedSceneKeys = new Set<string>();
    let menuOpen = false;

    const setMenuVisible = (visible: boolean): void => {
        shell.pausePanel.classList.toggle('hidden', !visible);
        shell.pauseBackdrop.classList.toggle('hidden', !visible);
        shell.menuButton.classList.toggle('hidden', visible);
        shell.menuButton.setAttribute('aria-expanded', String(visible));
    };

    const openMenu = (): void => {
        if (menuOpen) return;
        menuOpen = true;
        for (const scene of game.scene.getScenes(true)) {
            const sceneKey = scene.sys.settings.key;
            if (game.scene.isPaused(sceneKey)) continue;
            game.scene.pause(sceneKey);
            pausedSceneKeys.add(sceneKey);
        }
        setMenuVisible(true);
    };

    const closeMenu = (): void => {
        if (!menuOpen) return;
        menuOpen = false;
        for (const sceneKey of pausedSceneKeys) {
            if (game.scene.isPaused(sceneKey)) game.scene.resume(sceneKey);
        }
        pausedSceneKeys.clear();
        setMenuVisible(false);
    };

    const handleEscape = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || shell.gameMain.dataset.encounter) return;
        if (menuOpen) closeMenu();
        else openMenu();
        event.preventDefault();
    };
    const handleBlur = (): void => openMenu();
    const handleRestart = (): void => onRestart();

    shell.menuButton.addEventListener('click', openMenu);
    shell.resumeButton.addEventListener('click', closeMenu);
    shell.pauseBackdrop.addEventListener('click', closeMenu);
    shell.restartButton.addEventListener('click', handleRestart);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('blur', handleBlur);
    setMenuVisible(false);

    return {
        openMenu,
        closeMenu,
        destroy(): void {
            shell.menuButton.removeEventListener('click', openMenu);
            shell.resumeButton.removeEventListener('click', closeMenu);
            shell.pauseBackdrop.removeEventListener('click', closeMenu);
            shell.restartButton.removeEventListener('click', handleRestart);
            window.removeEventListener('keydown', handleEscape);
            window.removeEventListener('blur', handleBlur);
        }
    };
}