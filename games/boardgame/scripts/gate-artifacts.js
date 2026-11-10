#!/usr/bin/env node
'use strict';

/*
 * Art evidence collector for the shipped gate.
 *
 * The old collector only walked the game directory, so a page that points at
 * shared art via `../../assets/art/premium/<slug>/...` (CSS url() or
 * og:image) was judged "no art". This module also resolves local references
 * from the game page, including:
 *   - <meta property="og:image" content="...">
 *   - <meta name="twitter:image" content="...">
 *   - <img src="...">
 *   - CSS url("...") in inline <style> / style attributes
 *   - linked local stylesheets (<link rel="stylesheet" href="...">)
 *
 * Remote/data refs are ignored. Missing files are ignored (they are not
 * evidence). Paths may be game-relative, site-absolute (`/games/assets/...`),
 * or walk out of the game directory (`../../assets/...`).
 */

const fs = require('fs');
const path = require('path');

const BOARD_ROOT = path.resolve(__dirname, '..');
const GAMES_ROOT = path.resolve(BOARD_ROOT, '..');
const REPO_ROOT = path.resolve(GAMES_ROOT, '..');
const IMG_EXT = /\.(png|jpe?g|webp|avif|gif)$/i;

function isRemote(ref) {
  return /^(?:data:|https?:|\/\/|#|mailto:|javascript:)/i.test(String(ref).trim());
}

function cleanRef(ref) {
  return String(ref || '').trim().replace(/^['"]|['"]$/g, '').split(/[?#]/)[0];
}

function resolveRef(ref, gameDir) {
  const raw = cleanRef(ref);
  if (!raw || isRemote(raw)) return null;
  if (raw.charAt(0) === '/') return path.resolve(REPO_ROOT, '.' + raw);
  return path.resolve(gameDir, raw);
}

function extractRefs(html) {
  const refs = [];
  const push = (ref) => { if (ref) refs.push(ref); };

  String(html).replace(/<meta\b[^>]*>/gi, (tag) => {
    if (/\b(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["']/i.test(tag)) {
      const m = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i);
      if (m) push(m[1]);
    }
    return tag;
  });
  String(html).replace(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi, (m, src) => {
    push(src);
    return m;
  });
  String(html).replace(/<link\b[^>]*?\brel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*>/gi, (tag) => {
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (href) push(href[1]);
    return tag;
  });
  String(html).replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (m, quote, ref) => {
    push(ref);
    return m;
  });
  return refs;
}

function linkedCssRefs(html, gameDir, seen) {
  const out = [];
  String(html).replace(/<link\b[^>]*?\brel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*>/gi, (tag) => {
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (!href) return tag;
    const abs = resolveRef(href[1], gameDir);
    if (!abs || !fs.existsSync(abs) || seen[abs]) return tag;
    seen[abs] = true;
    try {
      const css = fs.readFileSync(abs, 'utf8');
      String(css).replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (m, q, ref) => {
        out.push({ ref: ref, base: path.dirname(abs) });
        return m;
      });
    } catch (e) { /* unreadable css is not evidence */ }
    return tag;
  });
  return out;
}

function walkImages(dir, base, out) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkImages(full, base, out);
    else if (IMG_EXT.test(ent.name)) {
      out.push({
        rel: path.relative(base, full).split(path.sep).join('/'),
        bytes: fs.statSync(full).size,
        abs: full,
        source: 'local'
      });
    }
  }
  return out;
}

function imageArtifacts(gameDir) {
  const dir = path.resolve(gameDir);
  const images = [];
  const seen = Object.create(null);
  const add = (entry) => {
    if (!entry.abs || seen[entry.abs]) return;
    seen[entry.abs] = true;
    images.push(entry);
  };

  walkImages(dir, dir, []).forEach(add);

  const indexFile = path.join(dir, 'index.html');
  if (fs.existsSync(indexFile)) {
    const html = fs.readFileSync(indexFile, 'utf8');
    const refs = extractRefs(html).map((ref) => ({ ref: ref, base: dir }))
      .concat(linkedCssRefs(html, dir, Object.create(null)));
    refs.forEach((item) => {
      const abs = resolveRef(item.ref, item.base);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return;
      if (!IMG_EXT.test(abs)) return;
      add({
        rel: path.relative(dir, abs).split(path.sep).join('/'),
        bytes: fs.statSync(abs).size,
        abs: abs,
        source: 'ref'
      });
    });
  }
  return images;
}

function pngSize(buf) {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    }
    i += 2 + len;
  }
  return null;
}

function imageSize(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return null; }
  if (/\.png$/i.test(file)) return pngSize(buf);
  if (/\.jpe?g$/i.test(file)) return jpegSize(buf);
  return null;
}

function findArt(images, pattern, minBytes, minW, minH) {
  for (const img of images) {
    if (!pattern.test(img.rel)) continue;
    if (img.bytes < minBytes) continue;
    const file = img.abs || path.join(BOARD_ROOT, img.slug, img.rel);
    const size = imageSize(file);
    if (size && (size.width < minW || size.height < minH)) continue;
    return { rel: img.rel, bytes: img.bytes, size: size, abs: file, source: img.source };
  }
  return null;
}

function largest(images, exclude) {
  const left = images.filter((img) => img.bytes >= 8 * 1024 && (!exclude || !exclude.has(img.abs)));
  left.sort((a, b) => b.bytes - a.bytes);
  return left.length ? { rel: left[0].rel, bytes: left[0].bytes, abs: left[0].abs,
    size: imageSize(left[0].abs), source: left[0].source } : null;
}

function classifyArt(images) {
  let cover = findArt(images, /(^|\/)(cover|封面)[-_.]|cover\.(png|jpe?g|webp)$/i, 8 * 1024, 600, 400);
  let og = findArt(images, /(^|\/)(og|social|share)[-_.]|og[-_]?image\.(png|jpe?g|webp)$/i, 15 * 1024, 1000, 500);
  let detail = findArt(images, /(^|\/)(detail|hero|screenshot|screen|配图|card|scene|table|tile|factory|board|art)[-_.]/i, 8 * 1024, 600, 400);

  const used = new Set();
  if (cover) used.add(cover.abs);
  if (og) used.add(og.abs);
  if (detail) used.add(detail.abs);

  // Fallbacks keep the gate useful for pages that name assets by role rather
  // than by literal "cover"/"detail" filenames, while still requiring a real
  // local raster with enough bytes.
  if (!cover) cover = largest(images, used);
  if (cover) used.add(cover.abs);
  if (!detail) detail = largest(images, used);
  if (!og) {
    og = images.filter((img) => /(^|\/)og/i.test(img.rel) && img.bytes >= 15 * 1024)
      .map((img) => ({ rel: img.rel, bytes: img.bytes, abs: img.abs, size: imageSize(img.abs), source: img.source }))[0] || null;
  }
  return { cover: cover || null, og: og || null, detail: detail || null };
}

// Deliberate controls for the art gate.
function control() {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-art-control-'));
  const game = path.join(tmp, 'games', 'boardgame', 'fixture');
  const artDir = path.join(tmp, 'games', 'assets', 'art', 'premium', 'fixture');
  fs.mkdirSync(path.join(game, 'assets'), { recursive: true });
  fs.mkdirSync(artDir, { recursive: true });
  const fakePng = (w, h, bytes) => {
    const buf = Buffer.alloc(Math.max(bytes, 33));
    buf.write('\x89PNG\r\n\x1a\n', 0, 'binary');
    buf.writeUInt32BE(13, 8);
    buf.write('IHDR', 12, 'ascii');
    buf.writeUInt32BE(w, 16);
    buf.writeUInt32BE(h, 20);
    buf[24] = 8; buf[25] = 6;
    return buf;
  };
  fs.writeFileSync(path.join(game, 'assets', 'cover.png'), fakePng(800, 600, 9000));
  fs.writeFileSync(path.join(game, 'assets', 'og.png'), fakePng(1200, 630, 16000));
  fs.writeFileSync(path.join(game, 'assets', 'detail.png'), fakePng(800, 600, 9000));
  fs.writeFileSync(path.join(artDir, 'tile-blue.webp'), Buffer.alloc(9000));
  fs.writeFileSync(path.join(game, 'index.html'), [
    '<meta property="og:image" content="assets/og.png">',
    '<img src="assets/cover.png">',
    '<style>.tile{background:url("../../assets/art/premium/fixture/tile-blue.webp")}</style>',
    '<img src="assets/detail.png">'
  ].join('\n'));

  const images = imageArtifacts(game);
  const external = images.some((img) => img.rel.indexOf('../../assets/art/premium/fixture/tile-blue.webp') !== -1);
  const classified = classifyArt(images);
  const positive = external && classified.cover && classified.og && classified.detail;

  // Negative control: a missing external reference must not become evidence.
  fs.unlinkSync(path.join(artDir, 'tile-blue.webp'));
  const after = imageArtifacts(game);
  const gone = after.every((img) => img.rel.indexOf('tile-blue.webp') === -1);
  // Remote refs must never count.
  fs.writeFileSync(path.join(game, 'index.html'), '<img src="https://example.com/fake.png">');
  const remote = imageArtifacts(game).every((img) => img.source !== 'ref');

  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = !!(positive && gone && remote);
  return {
    ok,
    detail: {
      positive_external_ref_and_three_roles: !!positive,
      negative_missing_external_not_evidence: gone,
      negative_remote_ref_ignored: remote
    }
  };
}

module.exports = {
  BOARD_ROOT,
  REPO_ROOT,
  extractRefs,
  resolveRef,
  imageArtifacts,
  imageSize,
  findArt,
  classifyArt,
  control
};
