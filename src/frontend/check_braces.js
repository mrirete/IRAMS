import { readFileSync } from 'fs';
const src = readFileSync('src/eam/pages/WorkOrders.tsx', 'utf8');
const lines = src.split(/\r?\n/);
let depth = 0;
for (let i = 0; i < 400; i++) {
    const l = lines[i];
    const opens = (l.match(/\{/g) || []).length;
    const closes = (l.match(/\}/g) || []).length;
    depth += opens - closes;
    if (i >= 56 && i <= 395) {
        console.log((i + 1) + ': depth=' + depth + ' | ' + l.substring(0, 100));
    }
}
