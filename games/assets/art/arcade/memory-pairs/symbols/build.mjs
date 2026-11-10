#!/usr/bin/env node
/* 生成 memory-pairs 卡面图案：8 个形状 × 3 个配色 = 24 个独立 PNG（透明底）。
 *
 *   node games/assets/art/arcade/memory-pairs/symbols/build.mjs
 *
 * 形状路径来自 arcade 美术引擎的共享符号集
 * （games/assets/art/arcade/engine/art-render.html#svgIcon），配色与尺寸由
 * symbols.json 锁定；PNG 用 rsvg-convert 从同一次生成的 SVG 栅格化，保证
 * 「配置 + 产物」同一次提交可复现（ART-GUIDE §8）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'symbols.json'), 'utf8'));
const size = manifest.size;
const margin = manifest.margin;
const scale = 1 - margin * 2;
const shift = 24 * margin;

const shapes = Object.entries(manifest.shapes);
const palettes = manifest.palettes;

function svgFor(shapeMarkup, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
  <g fill="${color}" transform="translate(${shift} ${shift}) scale(${scale})">${shapeMarkup}</g>
</svg>
`;
}

const written = [];
for (const pal of palettes) {
  for (const [shape, markup] of shapes) {
    const key = `${shape}-${pal.key}`;
    const svgPath = path.join(HERE, key + '.svg');
    const pngPath = path.join(HERE, key + '.png');
    fs.writeFileSync(svgPath, svgFor(markup, pal.color));
    const r = spawnSync('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', pngPath, svgPath], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(`rsvg-convert failed for ${key}: ${r.stderr || r.error}`);
      process.exit(1);
    }
    written.push(key);
  }
}
console.log(`wrote ${written.length} symbols @ ${size}px: ${written.join(', ')}`);
