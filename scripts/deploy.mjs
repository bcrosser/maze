import {spawnSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync} from 'node:fs';
import {dirname, join, parse, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = join(PROJECT_ROOT, 'dist');
const VITE_BIN = join(PROJECT_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const DEFAULT_TARGET = 'E:\\xampp\\htdocs\\rpg5';
const MEASUREMENT_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

function emptyToNull(rawValue) {
    const value = (rawValue ?? '').trim();
    return value === '' ? null : value;
}

const USAGE = `Usage: npm run deploy -- [options]

Options:
  --target <dir>   Destination directory (default: ${DEFAULT_TARGET}, or DEPLOY_TARGET).
  --ga <id>        Google Analytics measurement id, e.g. G-XXXXXXXXXX.
                   Omit to fall back to GA_MEASUREMENT_ID from the environment
                   or from an untracked .env.local file. Use --no-ga to force it off.
  --no-ga          Build without any analytics tag.
  --clean          Delete the destination contents before copying.
  --skip-build     Copy the existing dist/ output without rebuilding.
  --help           Show this message.`;

function fail(message) {
    console.error(`deploy: ${message}`);
    process.exit(1);
}

function loadLocalEnvironment() {
    if (typeof process.loadEnvFile !== 'function') {
        return;
    }
    for (const fileName of ['.env', '.env.local']) {
        const envFile = join(PROJECT_ROOT, fileName);
        if (existsSync(envFile)) {
            process.loadEnvFile(envFile);
        }
    }
}

function parseArguments(argv) {
    const options = {
        target: emptyToNull(process.env.DEPLOY_TARGET) ?? DEFAULT_TARGET,
        measurementId: undefined,
        disableAnalytics: false,
        clean: false,
        skipBuild: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const separatorAt = argument.indexOf('=');
        const name = separatorAt === -1 ? argument : argument.slice(0, separatorAt);
        const inlineValue = separatorAt === -1 ? null : argument.slice(separatorAt + 1);
        const readValue = () => {
            if (inlineValue !== null) {
                return inlineValue;
            }
            index += 1;
            const next = argv[index];
            if (next === undefined) {
                fail(`${name} requires a value.\n\n${USAGE}`);
            }
            return next;
        };
        switch (name) {
            case '--help':
            case '-h':
                console.log(USAGE);
                process.exit(0);
                break;
            case '--target':
                options.target = readValue();
                break;
            case '--ga':
                options.measurementId = readValue().trim();
                break;
            case '--no-ga':
                options.disableAnalytics = true;
                break;
            case '--clean':
                options.clean = true;
                break;
            case '--skip-build':
                options.skipBuild = true;
                break;
            default:
                fail(`unknown option "${argument}".\n\n${USAGE}`);
        }
    }
    return options;
}

function resolveTarget(rawTarget) {
    const target = resolve(rawTarget.trim());
    const {root} = parse(target);
    const segments = target.slice(root.length).split(/[\\/]/).filter((segment) => segment !== '');
    if (segments.length === 0) {
        fail(`refusing to deploy to the filesystem root "${target}".`);
    }
    return target;
}

function resolveMeasurementId(options) {
    if (options.disableAnalytics) {
        return null;
    }
    const measurementId = emptyToNull(options.measurementId ?? process.env.GA_MEASUREMENT_ID);
    if (measurementId === null) {
        return null;
    }
    if (!MEASUREMENT_ID_PATTERN.test(measurementId)) {
        fail(`the analytics id must look like "G-XXXXXXXXXX" (letters, digits, "-", "_"); received "${measurementId}".`);
    }
    return measurementId;
}

function runBuild(measurementId) {
    if (!existsSync(VITE_BIN)) {
        fail('vite is not installed. Run "npm ci" first.');
    }
    const result = spawnSync(process.execPath, [VITE_BIN, 'build'], {
        cwd: PROJECT_ROOT,
        env: {...process.env, GA_MEASUREMENT_ID: measurementId ?? ''},
        stdio: 'inherit'
    });
    if (result.error !== undefined) {
        fail(`build failed to start: ${result.error.message}`);
    }
    if (result.status !== 0) {
        fail(`build exited with code ${result.status}.`);
    }
}

function countFiles(directory) {
    let total = 0;
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
        total += entry.isDirectory() ? countFiles(join(directory, entry.name)) : 1;
    }
    return total;
}

function main() {
    loadLocalEnvironment();
    const options = parseArguments(process.argv.slice(2));
    const target = resolveTarget(options.target);
    const measurementId = resolveMeasurementId(options);

    if (options.skipBuild) {
        console.log('deploy: skipping build, reusing dist/.');
    } else {
        if (measurementId !== null) {
            console.log(`deploy: building with Google Analytics ${measurementId}.`);
        } else {
            console.log('deploy: building without Google Analytics.');
        }
        runBuild(measurementId);
    }

    if (!existsSync(DIST_DIR) || !statSync(DIST_DIR).isDirectory()) {
        fail('dist/ does not exist. Run without --skip-build.');
    }
    if (existsSync(target) && !statSync(target).isDirectory()) {
        fail(`"${target}" exists but is not a directory.`);
    }
    if (options.clean && existsSync(target)) {
        console.log(`deploy: cleaning ${target}`);
        rmSync(target, {recursive: true, force: true});
    }
    mkdirSync(target, {recursive: true});
    cpSync(DIST_DIR, target, {recursive: true, force: true});
    console.log(`deploy: copied ${countFiles(DIST_DIR)} files to ${target}`);
}

main();
