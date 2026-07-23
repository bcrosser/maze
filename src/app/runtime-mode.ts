export type RuntimeMode = 'legacy' | 'phaser';

export function getRuntimeMode(search: string): RuntimeMode {
    const requestedRuntime = new URLSearchParams(search).get('runtime');
    return requestedRuntime === 'legacy' ? 'legacy' : 'phaser';
}