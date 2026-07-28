import {loadEnv, type HtmlTagDescriptor, type Plugin} from 'vite';
import {defineConfig} from 'vitest/config';

const MEASUREMENT_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

function readMeasurementId(rawValue: string | undefined): string | null {
    const measurementId = (rawValue ?? '').trim();
    if (measurementId === '') {
        return null;
    }
    if (!MEASUREMENT_ID_PATTERN.test(measurementId)) {
        throw new Error(
            `GA_MEASUREMENT_ID must look like "G-XXXXXXXXXX" (letters, digits, "-", "_"); received "${measurementId}".`
        );
    }
    return measurementId;
}

function googleAnalyticsPlugin(measurementId: string): Plugin {
    const tags: HtmlTagDescriptor[] = [
        {
            tag: 'script',
            attrs: {
                async: true,
                src: `https://www.googletagmanager.com/gtag/js?id=${measurementId}`
            },
            injectTo: 'head'
        },
        {
            tag: 'script',
            children: [
                'window.dataLayer = window.dataLayer || [];',
                'function gtag(){dataLayer.push(arguments);}',
                "gtag('js', new Date());",
                `gtag('config', '${measurementId}');`
            ].join('\n'),
            injectTo: 'head'
        }
    ];
    return {
        name: 'maze-google-analytics',
        transformIndexHtml() {
            return tags;
        }
    };
}

export default defineConfig(({mode}) => {
    const measurementId = readMeasurementId(loadEnv(mode, process.cwd(), '').GA_MEASUREMENT_ID);
    return {
        base: './',
        plugins: measurementId === null ? [] : [googleAnalyticsPlugin(measurementId)],
        test: {
            environment: 'node',
            include: ['tests/unit/**/*.test.ts'],
            coverage: {
                provider: 'v8',
                reporter: ['text', 'html']
            }
        }
    };
});