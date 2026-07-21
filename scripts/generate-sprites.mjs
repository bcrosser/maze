import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const TILE_SIZE = 32;
const COLUMNS = 10;
const ROWS = 5;
const CAPACITY = COLUMNS * ROWS;
const INK = '#17191d';
const HIGHLIGHT = '#f8f1d4';

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const assetsDirectory = join(rootDirectory, 'assets');

function rect(x, y, width, height, fill, stroke = INK, strokeWidth = 1) {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
}

function circle(cx, cy, radius, fill, stroke = INK, strokeWidth = 1) {
    return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
}

function ellipse(cx, cy, radiusX, radiusY, fill, stroke = INK, strokeWidth = 1) {
    return `<ellipse cx="${cx}" cy="${cy}" rx="${radiusX}" ry="${radiusY}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
}

function polygon(points, fill, stroke = INK, strokeWidth = 1) {
    return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
}

function path(data, fill, stroke = INK, strokeWidth = 1) {
    return `<path d="${data}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function line(x1, y1, x2, y2, stroke = INK, strokeWidth = 2) {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="square"/>`;
}

function shadow() {
    return ellipse(16, 28, 10, 2, '#101216', 'none', 0);
}

function sparkle(x, y, color = HIGHLIGHT) {
    return `${rect(x - 1, y - 3, 2, 6, color, 'none', 0)}${rect(x - 3, y - 1, 6, 2, color, 'none', 0)}`;
}

function eye(x, y, iris = '#e9f1df') {
    return `${rect(x, y, 4, 3, iris, INK)}${rect(x + 2, y + 1, 1, 2, INK, 'none', 0)}`;
}

function bottle(bodyColor, emblem) {
    return [
        shadow(),
        rect(12, 4, 8, 4, '#b89058'),
        rect(13, 8, 6, 4, '#dce9df'),
        path('M10 12 H22 L25 17 V25 L22 28 H10 L7 25 V17 Z', bodyColor, INK, 2),
        path('M10 15 H22 L23 18 H9 Z', '#ffffff', 'none', 0),
        emblem
    ].join('');
}

function shield(bodyColor, emblem) {
    return [
        shadow(),
        path('M7 6 L16 3 L25 6 V16 C25 22 21 26 16 29 C11 26 7 22 7 16 Z', bodyColor, INK, 2),
        path('M10 8 L16 6 L22 8 V15 C22 19 20 22 16 25 C12 22 10 19 10 15 Z', '#ffffff22', 'none', 0),
        emblem
    ].join('');
}

function key(bodyColor, jewelColor) {
    return [
        shadow(),
        circle(10, 10, 6, bodyColor, INK, 2),
        circle(10, 10, 2, jewelColor, INK),
        line(14, 14, 25, 25, bodyColor, 5),
        line(20, 21, 24, 17, bodyColor, 3),
        line(23, 24, 27, 20, bodyColor, 3)
    ].join('');
}

function scroll(paperColor, runeColor, magical = false) {
    return [
        shadow(),
        rect(7, 6, 18, 20, paperColor, INK, 2),
        ellipse(9, 6, 3, 2, '#b68a53', INK),
        ellipse(23, 26, 3, 2, '#b68a53', INK),
        line(11, 11, 21, 11, runeColor, 2),
        line(11, 15, 18, 15, runeColor, 2),
        magical ? sparkle(18, 20, runeColor) : path('M11 20 L14 18 L17 21 L21 17', 'none', runeColor, 2)
    ].join('');
}

function gem(bodyColor, lightColor, points = '16,4 25,12 21,25 16,29 11,25 7,12') {
    return [
        shadow(),
        polygon(points, bodyColor, INK, 2),
        polygon('16,7 21,12 18,21 11,12', lightColor, 'none', 0),
        sparkle(20, 9)
    ].join('');
}

function weapon(bladeColor, gripColor, bladePoints) {
    return [
        shadow(),
        polygon(bladePoints, bladeColor, INK, 2),
        line(10, 22, 6, 26, gripColor, 4),
        line(7, 20, 13, 26, '#d3a645', 2)
    ].join('');
}

function humanoid(bodyColor, skinColor, headExtra = '', bodyExtra = '') {
    return [
        shadow(),
        circle(16, 9, 6, skinColor, INK, 2),
        headExtra,
        path('M9 16 L13 14 H19 L23 16 L25 26 H7 Z', bodyColor, INK, 2),
        bodyExtra,
        rect(12, 8, 2, 2, '#f2e86d', 'none', 0),
        rect(18, 8, 2, 2, '#f2e86d', 'none', 0)
    ].join('');
}

function slime(bodyColor, spotColor) {
    return [
        shadow(),
        path('M5 25 C5 18 8 10 16 9 C24 10 27 18 27 25 L23 28 L19 26 L15 28 L11 26 L8 28 Z', bodyColor, INK, 2),
        circle(11, 14, 2, spotColor, 'none', 0),
        circle(21, 20, 2, spotColor, 'none', 0),
        eye(10, 19),
        eye(18, 19)
    ].join('');
}

function golem(stoneColor, coreColor, crown = '') {
    return [
        shadow(),
        polygon('8,5 14,3 20,5 23,12 20,17 11,17 7,12', stoneColor, INK, 2),
        crown,
        polygon('5,16 11,13 21,14 27,18 25,27 7,27', stoneColor, INK, 2),
        rect(14, 18, 5, 5, coreColor, INK),
        rect(10, 9, 3, 2, coreColor, 'none', 0),
        rect(18, 9, 3, 2, coreColor, 'none', 0)
    ].join('');
}

function wraith(bodyColor, glowColor, crown = '') {
    return [
        shadow(),
        path('M9 7 C11 3 21 3 23 7 L25 16 L28 26 L22 23 L18 28 L14 23 L9 27 L6 22 L8 15 Z', bodyColor, INK, 2),
        crown,
        eye(10, 11, glowColor),
        eye(18, 11, glowColor),
        path('M12 18 Q16 21 20 18', 'none', glowColor, 2)
    ].join('');
}

function beetle(shellColor, accentColor, horns = '') {
    return [
        shadow(),
        line(9, 14, 4, 10), line(9, 19, 3, 19), line(10, 23, 5, 27),
        line(23, 14, 28, 10), line(23, 19, 29, 19), line(22, 23, 27, 27),
        ellipse(16, 19, 8, 10, shellColor, INK, 2),
        circle(16, 8, 5, accentColor, INK, 2),
        line(16, 10, 16, 28, accentColor, 2),
        horns
    ].join('');
}

function serpent(bodyColor, bellyColor, headExtra = '') {
    return [
        shadow(),
        path('M7 25 C7 18 24 21 24 14 C24 9 18 10 17 14 C15 19 12 24 18 28', 'none', bodyColor, 7),
        path('M8 25 C11 22 16 25 18 27', 'none', bellyColor, 2),
        ellipse(22, 9, 7, 5, bodyColor, INK, 2),
        headExtra,
        rect(24, 8, 2, 2, '#f4e36c', 'none', 0),
        line(27, 11, 30, 13, '#d22f35', 1)
    ].join('');
}

const itemSprites = [
    {name: 'health-potion', draw: () => bottle('#d93649', `${rect(14, 17, 4, 9, '#ffe9df', 'none', 0)}${rect(11, 20, 10, 3, '#ffe9df', 'none', 0)}`)},
    {name: 'mining-pick', draw: () => `${shadow()}${line(10, 27, 21, 9, '#8a542f', 4)}${path('M5 9 Q16 2 28 9 L25 13 Q16 8 7 14 Z', '#aeb8bd', INK, 2)}${rect(17, 8, 4, 4, '#dce6e5')}`},
    {name: 'mana-potion', draw: () => bottle('#5d52cf', sparkle(16, 21, '#87e7ff'))},
    {name: 'antidote', draw: () => bottle('#4ca94f', path('M12 23 Q12 15 21 15 Q20 23 12 23 Z', '#d8ee74', 'none', 0))},
    {name: 'fire-ward', draw: () => shield('#c93d24', path('M16 23 C10 20 13 15 16 10 C17 15 22 16 19 22 Z', '#ffd33d', INK))},
    {name: 'ice-ward', draw: () => shield('#5faaca', `${line(16, 9, 16, 23, '#e8ffff', 2)}${line(10, 16, 22, 16, '#e8ffff', 2)}${line(11, 11, 21, 21, '#e8ffff', 2)}${line(21, 11, 11, 21, '#e8ffff', 2)}`)},
    {name: 'lightning-ward', draw: () => shield('#c5a92e', polygon('18,8 11,18 16,18 14,25 22,14 17,14', '#fff25b', INK))},
    {name: 'torch', draw: () => `${shadow()}${line(13, 27, 18, 12, '#87502d', 5)}${path('M11 12 C8 7 14 4 17 2 C16 7 23 7 20 14 Z', '#ff7628', INK, 2)}${path('M14 11 C13 8 16 6 18 5 C18 9 20 9 18 12 Z', '#ffe456', 'none', 0)}`},
    {name: 'lantern', draw: () => `${shadow()}${path('M11 8 Q16 2 21 8', 'none', '#b78534', 3)}${rect(9, 9, 14, 17, '#9b672e', INK, 2)}${rect(12, 12, 8, 11, '#ffd95a', INK)}${line(9, 16, 23, 16, '#d4a84d', 2)}`},
    {name: 'iron-key', draw: () => key('#89939b', '#d9e0df')},
    {name: 'gold-key', draw: () => key('#e4b92e', '#fff18a')},
    {name: 'crystal-key', draw: () => key('#53c9d4', '#e6ffff')},
    {name: 'compass', draw: () => `${shadow()}${circle(16, 16, 11, '#d5b76a', INK, 2)}${circle(16, 16, 8, '#ece4c9', INK)}${polygon('16,6 19,16 16,14 13,16', '#d6403b', INK)}${polygon('16,26 13,16 16,18 19,16', '#3d5268', INK)}`},
    {name: 'map-scroll', draw: () => scroll('#e5c98c', '#735439')},
    {name: 'spell-scroll', draw: () => scroll('#ddd6af', '#7251cb', true)},
    {name: 'tome', draw: () => `${shadow()}${path('M6 7 L16 5 L26 7 V27 L16 25 L6 27 Z', '#5f356e', INK, 2)}${line(16, 5, 16, 25, '#cda85e', 2)}${circle(21, 15, 3, '#64d2cc', INK)}${sparkle(21, 15, '#eefeff')}`},
    {name: 'coin', draw: () => `${shadow()}${circle(16, 16, 10, '#e5b92e', INK, 2)}${circle(16, 16, 6, '#f6d45b', '#9f741f')}${rect(14, 10, 4, 12, '#c89220', 'none', 0)}`},
    {name: 'diamond', draw: () => gem('#8ce1e9', '#e7ffff')},
    {name: 'ruby', draw: () => gem('#c93448', '#ff7b79')},
    {name: 'sapphire', draw: () => gem('#356cc9', '#75c7fa')},
    {name: 'emerald', draw: () => gem('#329c5b', '#83e689')},
    {name: 'bread', draw: () => `${shadow()}${path('M6 22 C5 15 8 9 14 8 C20 6 27 11 27 19 V25 H7 Z', '#c9893d', INK, 2)}${path('M11 12 L13 17 M17 10 L19 15 M22 11 L24 16', 'none', '#f0c36c', 2)}`},
    {name: 'apple', draw: () => `${shadow()}${path('M8 15 C9 9 14 10 16 12 C20 8 26 11 25 18 C24 25 20 28 16 26 C12 29 7 24 7 18 Z', '#cf3942', INK, 2)}${line(16, 12, 18, 5, '#79502c', 3)}${path('M18 7 Q24 4 25 9 Q21 11 18 7 Z', '#4f9d48', INK)}`},
    {name: 'mushroom', draw: () => `${shadow()}${path('M6 14 C7 6 25 5 27 14 L24 17 H8 Z', '#c64c4b', INK, 2)}${circle(12, 11, 2, '#f5e7c5', 'none', 0)}${circle(21, 12, 2, '#f5e7c5', 'none', 0)}${path('M13 16 L20 16 L22 27 H11 Z', '#e8d6ad', INK, 2)}`},
    {name: 'meat', draw: () => `${shadow()}${path('M7 9 C12 5 21 8 23 14 C26 21 19 27 12 24 C5 22 3 14 7 9 Z', '#b94f42', INK, 2)}${circle(20, 10, 5, '#f2d2ad', INK, 2)}${circle(20, 10, 2, '#ece4cf', 'none', 0)}`},
    {name: 'water-flask', draw: () => bottle('#338bc9', `${path('M9 21 Q16 17 23 21 V26 H9 Z', '#65cae8', 'none', 0)}${sparkle(18, 18)}`)},
    {name: 'bomb', draw: () => `${shadow()}${circle(15, 19, 10, '#343941', INK, 2)}${rect(12, 6, 7, 5, '#8b6334')}${path('M17 7 Q21 2 25 6', 'none', '#b9843f', 2)}${sparkle(26, 5, '#ffcf42')}`},
    {name: 'snare', draw: () => `${shadow()}${ellipse(16, 18, 11, 8, 'none', '#a77b43', 3)}${ellipse(16, 18, 6, 4, 'none', '#d5aa69', 2)}${line(5, 18, 27, 18, '#72502e', 2)}${line(16, 10, 16, 26, '#72502e', 2)}`},
    {name: 'rope', draw: () => `${shadow()}${circle(16, 16, 10, 'none', '#b98a4d', 4)}${circle(16, 16, 5, 'none', '#79552f', 2)}${path('M21 22 Q28 24 25 29', 'none', '#b98a4d', 3)}`},
    {name: 'shovel', draw: () => `${shadow()}${line(11, 25, 22, 7, '#8a542f', 4)}${path('M5 21 L13 18 L17 25 L11 29 Z', '#929da1', INK, 2)}${path('M19 8 Q23 3 27 7 L24 12 Z', 'none', '#8a542f', 3)}`},
    {name: 'axe', draw: () => `${shadow()}${line(11, 27, 19, 6, '#8a542f', 4)}${path('M8 7 Q15 3 22 7 L20 16 Q14 12 7 15 Z', '#aab5b9', INK, 2)}`},
    {name: 'sword', draw: () => weapon('#c7d2d2', '#76502f', '23,3 25,5 13,22 9,18')},
    {name: 'dagger', draw: () => weapon('#aeb9bd', '#613d2d', '21,7 23,9 14,21 10,17')},
    {name: 'spear', draw: () => `${shadow()}${line(7, 27, 24, 7, '#8b5a30', 3)}${polygon('22,3 29,3 27,10 23,12 20,8', '#b9c5c6', INK, 2)}`},
    {name: 'bow', draw: () => `${shadow()}${path('M8 5 Q25 16 8 27', 'none', '#9e6333', 4)}${line(8, 5, 8, 27, '#e5d5a7', 1)}${line(5, 17, 27, 14, '#8f9ca0', 2)}${polygon('27,14 22,11 23,17', '#c6d2d1', INK)}`},
    {name: 'arrow-bundle', draw: () => `${shadow()}${line(8, 26, 22, 5, '#8b5a30', 2)}${line(13, 28, 25, 7, '#8b5a30', 2)}${line(5, 23, 19, 3, '#8b5a30', 2)}${polygon('19,3 25,3 22,8', '#b9c5c6', INK)}${polygon('22,6 28,7 24,11', '#b9c5c6', INK)}${rect(8, 19, 10, 5, '#a84635')}`},
    {name: 'shield', draw: () => shield('#4d7189', circle(16, 15, 4, '#d3a743', INK))},
    {name: 'helmet', draw: () => `${shadow()}${path('M7 18 C7 6 25 5 26 18 V22 H20 V16 H13 V27 H8 Z', '#90999b', INK, 2)}${path('M10 14 H25', 'none', '#d0d8d5', 2)}${rect(19, 18, 8, 3, '#c39b3a')}`},
    {name: 'boots', draw: () => `${shadow()}${path('M7 6 H15 V21 L20 24 V28 H6 L5 24 L9 20 Z', '#6e432d', INK, 2)}${path('M18 5 H25 V20 L29 23 V27 H17 L16 23 L20 19 Z', '#865438', INK, 2)}`},
    {name: 'gloves', draw: () => `${shadow()}${path('M5 9 L9 8 L12 17 L12 6 H16 V17 L18 7 H21 V18 L23 11 H26 V23 L21 28 H10 L6 22 Z', '#a96b3f', INK, 2)}${line(12, 20, 22, 20, '#e0a865', 2)}`},
    {name: 'ring', draw: () => `${shadow()}${ellipse(16, 19, 8, 7, 'none', '#e2b72f', 4)}${gem('#57c5d0', '#dfffff', '16,3 22,9 19,14 13,14 10,9')}`},
    {name: 'amulet', draw: () => `${shadow()}${path('M7 5 Q16 13 25 5', 'none', '#d2aa38', 2)}${line(16, 10, 16, 15, '#d2aa38', 2)}${gem('#8b4ac4', '#dc9cff', '16,13 23,19 20,27 12,27 9,19')}`},
    {name: 'crown', draw: () => `${shadow()}${polygon('5,10 10,17 15,7 20,17 27,9 24,26 8,26', '#e0b62c', INK, 2)}${circle(10, 20, 2, '#d3424e', INK)}${circle(16, 20, 2, '#4fc5d2', INK)}${circle(22, 20, 2, '#65ae4b', INK)}`},
    {name: 'hourglass', draw: () => `${shadow()}${rect(8, 4, 16, 4, '#8b6134')}${rect(8, 25, 16, 4, '#8b6134')}${path('M11 8 H21 C21 13 18 15 16 16 C19 18 21 20 21 25 H11 C11 20 13 18 16 16 C13 14 11 12 11 8 Z', '#d9e1d4', INK, 2)}${polygon('12,22 20,22 16,17', '#e0b750', 'none', 0)}`},
    {name: 'mirror', draw: () => `${shadow()}${ellipse(16, 13, 9, 11, '#83c4d4', '#c6a247', 3)}${path('M11 10 Q16 5 21 8', 'none', '#e8ffff', 2)}${line(16, 24, 16, 29, '#c6a247', 4)}${line(12, 29, 20, 29, '#c6a247', 3)}`},
    {name: 'feather', draw: () => `${shadow()}${path('M7 25 Q9 7 27 4 Q27 19 9 26 Z', '#e7e0c1', INK, 2)}${line(8, 27, 23, 9, '#79694f', 2)}${line(13, 20, 9, 16, '#a9a087', 1)}${line(17, 16, 22, 15, '#a9a087', 1)}`},
    {name: 'bone', draw: () => `${shadow()}${circle(7, 9, 4, '#e5dec2', INK)}${circle(10, 6, 4, '#e5dec2', INK)}${line(9, 9, 23, 23, '#e5dec2', 6)}${circle(22, 26, 4, '#e5dec2', INK)}${circle(26, 22, 4, '#e5dec2', INK)}`},
    {name: 'seed', draw: () => `${shadow()}${ellipse(16, 19, 7, 9, '#8b5b2d', INK, 2)}${path('M16 13 Q15 6 8 5 Q8 12 16 13 Z', '#58a24f', INK)}${path('M17 13 Q20 7 26 9 Q24 15 17 13 Z', '#77bd58', INK)}${line(13, 17, 18, 23, '#c89854', 2)}`},
    {name: 'gear', draw: () => `${shadow()}${polygon('13,3 19,3 20,7 24,8 27,6 30,12 26,15 27,19 30,22 26,28 21,25 18,29 12,29 11,25 7,24 4,26 1,20 5,17 4,13 2,10 7,5 11,8', '#8f9693', INK, 2)}${circle(16, 16, 6, '#d1b55d', INK, 2)}${circle(16, 16, 2, INK, 'none', 0)}`},
    {name: 'mystery-orb', draw: () => `${shadow()}${circle(16, 16, 11, '#583794', INK, 2)}${circle(14, 13, 7, '#8958c7', 'none', 0)}${path('M12 11 C12 6 22 6 22 12 C22 17 16 16 16 21', 'none', '#f4e76d', 3)}${circle(16, 25, 2, '#f4e76d', 'none', 0)}${sparkle(10, 9)}`}
];

const monsterSprites = [
    {name: 'moss-slime', draw: () => slime('#4f9d47', '#87c65b')},
    {name: 'ember-hound', draw: () => `${shadow()}${path('M5 21 L8 13 L13 11 L17 6 L23 8 L28 15 L25 23 L21 26 H15 L12 22 L8 27 Z', '#b83f2d', INK, 2)}${polygon('17,7 19,2 22,8', '#ee7a2a', INK)}${polygon('23,9 27,5 27,13', '#ee7a2a', INK)}${eye(20, 11, '#ffd84b')}${path('M6 18 Q2 12 7 8', 'none', '#ef7a28', 3)}${path('M10 17 L16 16 L13 21', '#f2ad38', 'none', 0)}`},
    {name: 'stone-golem', draw: () => golem('#777c78', '#e3b943')},
    {name: 'vine-crawler', draw: () => `${shadow()}${ellipse(16, 18, 9, 6, '#5f8c39', INK, 2)}${path('M8 18 Q2 10 5 6 M10 21 Q5 28 2 24 M23 18 Q29 10 27 6 M22 21 Q27 28 30 24', 'none', '#367237', 3)}${polygon('4,6 9,7 6,11', '#74b94d', INK)}${polygon('27,6 23,10 29,11', '#74b94d', INK)}${eye(10, 16, '#f2e95d')}${eye(18, 16, '#f2e95d')}`},
    {name: 'skeleton', draw: () => `${shadow()}${circle(16, 8, 6, '#ddd8bd', INK, 2)}${rect(12, 7, 3, 3, INK, 'none', 0)}${rect(18, 7, 3, 3, INK, 'none', 0)}${rect(15, 12, 3, 2, INK, 'none', 0)}${line(16, 14, 16, 24, '#ddd8bd', 3)}${line(9, 18, 23, 18, '#ddd8bd', 3)}${line(16, 23, 10, 28, '#ddd8bd', 3)}${line(16, 23, 23, 28, '#ddd8bd', 3)}${line(12, 17, 12, 23, '#ddd8bd', 1)}${line(20, 17, 20, 23, '#ddd8bd', 1)}`},
    {name: 'specter', draw: () => wraith('#8f94ad', '#93ecdc')},
    {name: 'cave-bat', draw: () => `${shadow()}${path('M14 13 L8 8 L2 10 L5 20 L12 18 L16 24 L20 18 L27 20 L30 10 L24 8 L18 13 Z', '#535068', INK, 2)}${circle(16, 14, 5, '#6b637c', INK)}${polygon('12,11 13,5 16,10', '#766c85', INK)}${polygon('17,10 20,5 20,12', '#766c85', INK)}${rect(13, 13, 2, 2, '#e84b4b', 'none', 0)}${rect(18, 13, 2, 2, '#e84b4b', 'none', 0)}`},
    {name: 'giant-spider', draw: () => `${shadow()}${line(11, 13, 3, 7)}${line(10, 17, 2, 15)}${line(11, 21, 4, 27)}${line(21, 13, 29, 7)}${line(22, 17, 30, 15)}${line(21, 21, 28, 27)}${ellipse(16, 19, 7, 8, '#49384c', INK, 2)}${circle(16, 10, 5, '#65506a', INK, 2)}${rect(12, 8, 2, 2, '#e24a45', 'none', 0)}${rect(15, 7, 2, 2, '#e24a45', 'none', 0)}${rect(18, 8, 2, 2, '#e24a45', 'none', 0)}`},
    {name: 'tunnel-rat', draw: () => `${shadow()}${ellipse(16, 20, 10, 6, '#76665d', INK, 2)}${circle(23, 15, 6, '#8a7468', INK, 2)}${circle(22, 9, 3, '#c28e91', INK)}${circle(28, 17, 2, '#d98f91', INK)}${rect(23, 14, 2, 2, INK, 'none', 0)}${path('M7 20 Q1 13 4 9', 'none', '#b98d7e', 2)}${line(27, 19, 31, 18, '#ddd2bc', 1)}`},
    {name: 'viper', draw: () => serpent('#49864d', '#a9c65b')},
    {name: 'sporeling', draw: () => `${shadow()}${path('M8 12 C8 4 24 4 25 12 L22 16 H10 Z', '#af4e68', INK, 2)}${circle(13, 9, 2, '#eacb9d', 'none', 0)}${circle(20, 11, 2, '#eacb9d', 'none', 0)}${path('M12 15 L21 15 L23 27 H9 Z', '#d2c18a', INK, 2)}${eye(11, 19, '#eef1cf')}${eye(18, 19, '#eef1cf')}`},
    {name: 'frost-wraith', draw: () => wraith('#a8d9e2', '#f1ffff', polygon('10,7 13,2 16,7 20,2 23,8', '#d8f7ff', INK))},
    {name: 'storm-wisp', draw: () => `${shadow()}${path('M16 3 C25 7 27 14 21 19 C17 22 20 26 16 29 C16 24 8 25 7 18 C5 11 11 7 16 3 Z', '#7468c3', INK, 2)}${polygon('18,7 11,17 16,17 13,25 23,13 18,13', '#fff05c', INK)}${sparkle(24, 8, '#9fe8ff')}`},
    {name: 'water-elemental', draw: () => `${shadow()}${path('M16 3 C21 10 27 14 26 21 C25 28 8 30 6 21 C5 15 12 10 16 3 Z', '#3b91ca', INK, 2)}${path('M8 21 Q16 15 24 21 Q17 27 8 21 Z', '#71d4e7', 'none', 0)}${eye(10, 16, '#e9ffff')}${eye(18, 16, '#e9ffff')}`},
    {name: 'earth-elemental', draw: () => golem('#806343', '#83b34f', polygon('10,5 12,1 15,5 19,1 21,6', '#4e843d', INK))},
    {name: 'shadow-stalker', draw: () => `${shadow()}${path('M7 27 L9 12 L13 5 L19 4 L24 12 L27 27 L21 24 L16 28 L11 24 Z', '#242039', INK, 2)}${polygon('9,12 16,7 24,12 21,18 11,18', '#332a50', 'none', 0)}${rect(11, 12, 4, 2, '#d94f69', 'none', 0)}${rect(18, 12, 4, 2, '#d94f69', 'none', 0)}`},
    {name: 'crystal-beetle', draw: () => beetle('#48b8c8', '#8de4e8', polygon('12,6 16,1 20,6', '#d9ffff', INK))},
    {name: 'iron-beetle', draw: () => beetle('#667077', '#9da5a5', `${line(12, 5, 8, 1, '#717a80', 2)}${line(20, 5, 24, 1, '#717a80', 2)}`)},
    {name: 'scarab', draw: () => beetle('#b58b31', '#4f8f6a', polygon('12,7 16,2 20,7', '#e1bd4b', INK))},
    {name: 'cave-raider', draw: () => humanoid('#6b513c', '#a37b59', polygon('8,10 11,3 23,4 25,11', '#493b31', INK), line(7, 19, 26, 13, '#a8b0ad', 2))},
    {name: 'lizard-warrior', draw: () => humanoid('#557142', '#68a555', polygon('21,7 28,10 22,12', '#68a555', INK), shield('#7d633c', ''))},
    {name: 'horned-brute', draw: () => humanoid('#7b493a', '#9a654e', `${polygon('11,6 5,2 8,11', '#e0d2a8', INK)}${polygon('21,6 27,2 24,11', '#e0d2a8', INK)}`, line(8, 19, 24, 19, '#d3a248', 3))},
    {name: 'cyclops', draw: () => `${shadow()}${circle(16, 10, 8, '#a47c56', INK, 2)}${ellipse(16, 9, 5, 3, '#f0e8c5', INK)}${circle(16, 9, 2, '#4e6d3d', INK)}${path('M7 17 L11 14 H21 L25 18 L27 27 H5 Z', '#6e563c', INK, 2)}${line(9, 21, 23, 21, '#b38a4c', 2)}`},
    {name: 'minotaur', draw: () => humanoid('#74452f', '#87553d', `${polygon('11,7 3,3 8,12', '#ded2ab', INK)}${polygon('21,7 29,3 24,12', '#ded2ab', INK)}${ellipse(16, 12, 5, 3, '#5a3429', INK)}`, line(7, 19, 25, 19, '#a66c3e', 3))},
    {name: 'harpy', draw: () => `${shadow()}${circle(16, 8, 5, '#d2a078', INK, 2)}${path('M13 13 L7 12 L2 20 L9 19 L5 26 L14 21 Z', '#8d6556', INK, 2)}${path('M19 13 L25 12 L30 20 L23 19 L27 26 L18 21 Z', '#8d6556', INK, 2)}${path('M12 13 H20 L23 27 H9 Z', '#a97862', INK, 2)}${line(13, 27, 10, 30, '#d6b16f', 2)}${line(19, 27, 22, 30, '#d6b16f', 2)}`},
    {name: 'gargoyle', draw: () => `${shadow()}${path('M8 14 L2 8 L4 21 L10 20 L13 27 H20 L23 20 L29 21 L30 8 L24 14 Z', '#686d70', INK, 2)}${circle(16, 10, 6, '#787d7e', INK, 2)}${polygon('11,6 10,1 15,5', '#787d7e', INK)}${polygon('20,5 24,1 22,8', '#787d7e', INK)}${rect(12, 9, 3, 2, '#e1b543', 'none', 0)}${rect(19, 9, 3, 2, '#e1b543', 'none', 0)}`},
    {name: 'mimic', draw: () => `${shadow()}${rect(5, 12, 22, 14, '#87522f', INK, 2)}${path('M5 12 Q16 3 27 12 V17 H5 Z', '#a86c38', INK, 2)}${polygon('8,17 12,22 15,17 18,22 22,17 25,21 27,17', '#e7dbb8', INK)}${rect(14, 11, 5, 6, '#d5a73a', INK)}${rect(9, 9, 3, 2, '#df4944', 'none', 0)}${rect(21, 9, 3, 2, '#df4944', 'none', 0)}`},
    {name: 'floating-eye', draw: () => `${shadow()}${ellipse(16, 15, 12, 9, '#d8d3b7', INK, 2)}${circle(16, 15, 6, '#5aa1b6', INK, 2)}${circle(16, 15, 3, INK, 'none', 0)}${path('M6 20 Q4 26 8 29 M12 23 Q11 27 13 30 M20 23 Q21 27 19 30 M26 20 Q28 26 24 29', 'none', '#a45d70', 2)}${sparkle(14, 12)}`},
    {name: 'tunnel-worm', draw: () => `${shadow()}${path('M5 25 C7 13 20 26 25 14 C28 8 22 4 17 8', 'none', '#9a6a55', 8)}${ellipse(17, 8, 7, 5, '#aa765c', INK, 2)}${circle(17, 8, 3, '#332927', INK)}${line(12, 16, 19, 18, '#d5a588', 1)}${line(8, 21, 15, 23, '#d5a588', 1)}`},
    {name: 'scorpion', draw: () => `${shadow()}${ellipse(15, 20, 7, 6, '#7c5035', INK, 2)}${circle(15, 13, 5, '#8d5b38', INK, 2)}${path('M20 15 Q29 11 25 4 Q22 1 20 5', 'none', '#7c5035', 4)}${polygon('18,5 22,1 24,6', '#b37a45', INK)}${path('M9 17 L4 13 L1 16 M21 18 L27 14 L31 17', 'none', '#7c5035', 3)}${line(10, 23, 5, 28, '#7c5035', 2)}${line(20, 23, 25, 28, '#7c5035', 2)}`},
    {name: 'centipede', draw: () => `${shadow()}${circle(7, 18, 5, '#a64b3e', INK)}${circle(14, 17, 5, '#b75b3e', INK)}${circle(21, 18, 5, '#c16e40', INK)}${circle(27, 16, 4, '#d18a4b', INK)}${line(7, 22, 4, 27)}${line(12, 21, 10, 27)}${line(18, 22, 18, 28)}${line(23, 21, 25, 27)}${line(28, 19, 30, 23)}${rect(27, 14, 2, 2, '#f0e55e', 'none', 0)}`},
    {name: 'jelly-cube', draw: () => `${shadow()}${rect(5, 5, 22, 22, '#59b6b188', INK, 2)}${rect(8, 8, 16, 5, '#9de4da88', 'none', 0)}${eye(9, 14, '#eafff7')}${eye(19, 14, '#eafff7')}${path('M11 22 Q16 18 21 22', 'none', '#2c6668', 2)}${circle(16, 11, 3, '#6c4b39', INK)}`},
    {name: 'cave-blob', draw: () => slime('#786197', '#ad73b0')},
    {name: 'fire-elemental', draw: () => `${shadow()}${path('M16 2 C19 8 27 10 24 18 C29 23 23 29 16 28 C8 29 4 22 8 17 C5 11 12 8 16 2 Z', '#e64a25', INK, 2)}${path('M16 9 C17 14 22 15 20 21 C18 25 11 23 12 19 C10 16 14 13 16 9 Z', '#ffc43d', 'none', 0)}${eye(10, 17, '#fff1a1')}${eye(18, 17, '#fff1a1')}`},
    {name: 'lava-serpent', draw: () => serpent('#c93c22', '#f5a832', polygon('18,6 20,1 23,6 26,2 27,9', '#ff7130', INK))},
    {name: 'ice-golem', draw: () => golem('#89cbd8', '#efffff', polygon('9,5 12,0 16,5 21,0 23,7', '#c7f3f6', INK))},
    {name: 'bone-knight', draw: () => humanoid('#77766c', '#ddd8bd', `${path('M9 9 V5 L16 2 L23 5 V11', '#9a9990', INK, 2)}${rect(12, 7, 3, 2, INK, 'none', 0)}${rect(18, 7, 3, 2, INK, 'none', 0)}`, shield('#c7c1a5', ''))},
    {name: 'dark-knight', draw: () => humanoid('#272b35', '#4c515b', `${path('M9 10 V5 L16 2 L23 5 V12', '#353a45', INK, 2)}${rect(11, 8, 10, 2, '#c9474d', 'none', 0)}`, line(8, 22, 25, 10, '#9ea7a8', 3))},
    {name: 'masked-acolyte', draw: () => humanoid('#5c315d', '#d3c8a6', `${path('M10 5 Q16 0 22 5 L21 13 H11 Z', '#e3dcc0', INK, 2)}${rect(12, 8, 3, 2, '#552455', 'none', 0)}${rect(18, 8, 3, 2, '#552455', 'none', 0)}`, circle(16, 21, 3, '#a957b2', INK))},
    {name: 'witch', draw: () => humanoid('#513456', '#b38b67', polygon('4,8 13,6 17,1 21,7 28,10', '#343046', INK, 2), `${line(5, 27, 27, 27, '#7d512e', 2)}${line(23, 9, 27, 28, '#7d512e', 2)}`)},
    {name: 'warlock', draw: () => humanoid('#3e3b73', '#9f775e', path('M8 10 Q10 1 16 2 Q23 1 24 10', '#25243f', INK, 2), `${circle(16, 20, 4, '#5dc3ca', INK)}${sparkle(16, 20)}`)},
    {name: 'necromancer', draw: () => humanoid('#30494c', '#c4c1a6', path('M8 11 Q9 2 16 2 Q23 2 24 11 L21 8 H11 Z', '#263536', INK, 2), `${circle(16, 20, 4, '#70c768', INK)}${path('M14 20 L16 17 L18 20 L16 23 Z', '#dce8c4', 'none', 0)}`)},
    {name: 'vampire', draw: () => humanoid('#651f2c', '#ddd0bd', polygon('8,8 11,2 16,6 21,2 24,9', '#2c2532', INK), `${path('M9 16 L4 27 L14 23 L16 28 L18 23 L28 27 L23 16', '#311f2a', INK, 2)}${rect(13, 12, 2, 4, '#f2eee1', 'none', 0)}${rect(19, 12, 2, 4, '#f2eee1', 'none', 0)}`)},
    {name: 'werewolf', draw: () => `${shadow()}${path('M7 26 L9 14 L13 11 L11 5 L16 8 L21 4 L21 11 L25 15 L27 26 L21 24 L18 28 L14 24 L9 28 Z', '#62554d', INK, 2)}${polygon('10,12 16,8 23,12 21,18 16,21 10,17', '#77665a', INK)}${eye(11, 13, '#e2c945')}${eye(18, 13, '#e2c945')}${polygon('14,18 16,21 18,18', '#302724', 'none', 0)}`},
    {name: 'zombie', draw: () => humanoid('#66594c', '#79906a', `${rect(9, 5, 14, 6, '#75856d', INK)}${line(12, 6, 9, 3, '#b24d43', 2)}`, `${line(8, 18, 3, 15, '#79906a', 3)}${line(24, 18, 29, 14, '#79906a', 3)}${rect(13, 20, 3, 4, '#a6413e', 'none', 0)}`)},
    {name: 'mummy', draw: () => humanoid('#b1a17a', '#c3b68d', `${path('M9 5 H23 V13 H9 Z', '#c9bd94', INK, 2)}${line(9, 8, 23, 11, '#7f765e', 1)}${rect(12, 8, 3, 2, '#d94a3e', 'none', 0)}${rect(18, 9, 3, 2, '#d94a3e', 'none', 0)}`, `${line(8, 18, 24, 21, '#ded2a9', 2)}${line(10, 23, 22, 17, '#ded2a9', 2)}`)},
    {name: 'ember-imp', draw: () => humanoid('#b63a2f', '#d95035', `${polygon('11,6 7,1 14,5', '#ef7d2e', INK)}${polygon('20,5 25,1 23,8', '#ef7d2e', INK)}`, `${path('M8 22 Q2 21 5 15', 'none', '#d95035', 2)}${polygon('4,14 2,19 7,18', '#ef7d2e', INK)}`)},
    {name: 'dragon-hatchling', draw: () => `${shadow()}${ellipse(16, 20, 9, 7, '#4f8b55', INK, 2)}${circle(22, 11, 6, '#5d9d5c', INK, 2)}${polygon('18,7 20,2 23,7', '#d7c565', INK)}${polygon('24,7 29,4 27,11', '#d7c565', INK)}${eye(22, 9, '#f5dd55')}${path('M9 18 L3 11 L5 23 Z', '#7eb36a', INK, 2)}${path('M8 22 Q2 25 5 28', 'none', '#4f8b55', 3)}`},
    {name: 'hydra-head', draw: () => `${shadow()}${path('M9 28 Q8 18 12 14 L9 7 L14 10 L17 4 L20 10 L25 7 L22 15 Q27 19 23 28 Z', '#397d52', INK, 2)}${ellipse(16, 14, 8, 6, '#4d9662', INK, 2)}${eye(10, 12, '#f1dc50')}${eye(18, 12, '#f1dc50')}${line(13, 18, 11, 22, '#ece4c5', 2)}${line(19, 18, 21, 22, '#ece4c5', 2)}${path('M12 22 Q16 25 20 22', 'none', '#293429', 2)}`},
    {name: 'maze-guardian', draw: () => `${shadow()}${path('M5 25 L7 10 L12 5 H20 L25 10 L27 25 L22 28 H10 Z', '#6c6657', INK, 2)}${polygon('8,10 16,3 24,10 21,17 11,17', '#87806c', INK, 2)}${rect(11, 11, 4, 3, '#efc74d', 'none', 0)}${rect(18, 11, 4, 3, '#efc74d', 'none', 0)}${path('M10 20 H22 V25 H18 V22 H14 V25 H10 Z', '#2f302d', INK)}${line(5, 18, 1, 14, '#b09b52', 3)}${line(27, 18, 31, 14, '#b09b52', 3)}`}
];

function buildSpriteSheet(entries) {
    if (entries.length !== CAPACITY || new Set(entries.map(entry => entry.name)).size !== CAPACITY) {
        throw new Error('Each sprite sheet must contain exactly 50 uniquely named entries.');
    }

    const groups = entries.map((entry, index) => {
        const x = (index % COLUMNS) * TILE_SIZE;
        const y = Math.floor(index / COLUMNS) * TILE_SIZE;
        return `<g id="${entry.name}" transform="translate(${x} ${y})">${entry.draw()}</g>`;
    }).join('');

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<svg xmlns="http://www.w3.org/2000/svg" width="${COLUMNS * TILE_SIZE}" height="${ROWS * TILE_SIZE}" viewBox="0 0 ${COLUMNS * TILE_SIZE} ${ROWS * TILE_SIZE}" shape-rendering="crispEdges">`,
        groups,
        '</svg>'
    ].join('');
}

function renderSheet(fileName, entries) {
    const svgPath = join(assetsDirectory, `.${fileName}.svg`);
    const pngPath = join(assetsDirectory, `${fileName}.png`);
    writeFileSync(svgPath, buildSpriteSheet(entries));

    const result = spawnSync('magick', [
        '-background', 'none',
        svgPath,
        '-alpha', 'on',
        '-strip',
        '-define', 'png:color-type=6',
        `PNG32:${pngPath}`
    ], {encoding: 'utf8'});

    rmSync(svgPath, {force: true});
    if (result.status !== 0) {
        throw new Error(result.stderr || `ImageMagick failed to render ${fileName}.`);
    }
}

mkdirSync(assetsDirectory, {recursive: true});
renderSheet('item-sprites', itemSprites);
renderSheet('monster-sprites', monsterSprites);
console.log(`Generated two ${COLUMNS * TILE_SIZE}x${ROWS * TILE_SIZE} sprite sheets.`);