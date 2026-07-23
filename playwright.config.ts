import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    outputDir: './test-results',
    fullyParallel: false,
    workers: 2,
    forbidOnly: Boolean(process.env['CI']),
    retries: process.env['CI'] ? 2 : 0,
    reporter: [['list'], ['html', {open: 'never'}]],
    use: {
        baseURL: 'http://127.0.0.1:5173',
        trace: 'retain-on-failure'
    },
    projects: [
        {
            name: 'desktop-chromium',
            use: {...devices['Desktop Chrome']}
        },
        {
            name: 'mobile-chromium',
            use: {
                browserName: 'chromium',
                viewport: {width: 390, height: 844},
                deviceScaleFactor: 2,
                hasTouch: true,
                isMobile: true
            }
        }
    ],
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: !process.env['CI']
    }
});