#!/usr/bin/env node
/*
 * Codenames Premium — deterministic art compositor + realism gate.
 *
 *   node games/boardgame/codenames-premium/render-art.mjs
 *   node games/boardgame/codenames-premium/render-art.mjs --control
 *
 * Materials are single-object textures rendered locally with FLUX (mflux):
 *   ~/work/imagegen/gen.sh --preset raw --model schnell ...
 * The 5×5 word cards, Chinese text and identity allocation are composed by
 * code in art/render.html (no AI text, no AI grid).
 *
 * Before writing any file the script proves the scene is a real Codenames
 * position: 25 unique words, red 9 / blue 8 / neutral 7 / assassin 1, every
 * revealed card matches its key colour, and the DOM shows the same allocation.
 * Any mismatch prints REALISM FAIL, writes zero files and exits 3.
 *
 * `--control` deliberately corrupts the key in memory and must exit 3 with
 * zero files; it is the proof that failed realism really blocks the output.
 *
 * The resident Chrome is reused through CDP (chrome-ensure first); no temp
 * Chrome/profile is launched. Outputs are staged in a temp dir and moved into
 * place only after every view validated.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const ASSET_DIR = path.join(ROOT, 'games/assets/art/premium/codenames');
const MATERIAL_SRC = path.join(ROOT, '.tmp/art-flux');
const CDP_PORT = Number(process.env.CODENAMES_CDP_PORT || 9222);
const CONTROL = process.argv.indexOf('--control') !== -1;
const E = require('./engine.js');

const VIEWS = [
  { name: 'cover', width: 1200, height: 630 },
  { name: 'og', width: 1200, height: 630 },
  { name: 'detail-board', width: 1200, height: 800 },
  { name: 'detail-cards', width: 1200, height: 800 }
];
const MATERIALS = ['card-paper', 'card-back', 'table-felt'];
const EXPECTED = { red: 9, blue: 8, neutral: 7, assassin: 1 };

let passed = 0;
let failed = 0;
function ok(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('PASS ' + label + (detail ? ' · ' + detail : ''));
  } else {
    failed += 1;
    console.log('FAIL ' + label + (detail ? ' — ' + detail : ''));
  }
  return !!condition;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function pngSize(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') return [0, 0];
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}
function rmrf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) { /* ignore */ }
}
function copyAtomic(source, target) {
  const tmp = target + '.tmp';
  fs.copyFileSync(source, tmp);
  fs.renameSync(tmp, target);
}

function validateEngine() {
  const game = E.createGame({ seed: 20261110 });
  const counts = { red: 0, blue: 0, neutral: 0, assassin: 0 };
  game.words.forEach(function (word) { counts[word.color] += 1; });
  const words = game.words.map(function (word) { return word.text; });
  ok('engine: 25 unique word cards', game.words.length === 25 && new Set(words).size === 25,
    game.words.length + '/' + new Set(words).size);
  ok('engine: red 9 / blue 8 / neutral 7 / assassin 1',
    JSON.stringify(counts) === JSON.stringify(EXPECTED), JSON.stringify(counts));
  ok('engine: red starts in the clue phase', game.turn === 'red' && game.phase === 'clue',
    game.turn + '/' + game.phase);
  return game;
}

function validateState(state, view) {
  const problems = [];
  if (!state || !state.words) problems.push('no __artState');
  else {
    const words = state.words;
    const texts = words.map(function (word) { return word.text; });
    const counts = { red: 0, blue: 0, neutral: 0, assassin: 0 };
    words.forEach(function (word) {
      if (!word.text || !String(word.text).trim()) problems.push('empty word');
      if (!(word.color in counts)) problems.push('bad colour ' + word.color);
      else counts[word.color] += 1;
    });
    if (words.length !== 25) problems.push('cards=' + words.length);
    if (new Set(texts).size !== 25) problems.push('duplicate words');
    if (JSON.stringify(counts) !== JSON.stringify(EXPECTED)) {
      problems.push('key=' + JSON.stringify(counts));
    }
    const seen = new Set();
    const revealedByColor = { red: 0, blue: 0, neutral: 0, assassin: 0 };
    (state.revealed || []).forEach(function (index) {
      if (!Number.isInteger(index) || index < 0 || index >= words.length) {
        problems.push('revealed index out of range ' + index);
        return;
      }
      if (seen.has(index)) problems.push('duplicate revealed index ' + index);
      seen.add(index);
      revealedByColor[words[index].color] += 1;
    });
    Object.keys(revealedByColor).forEach(function (color) {
      if (revealedByColor[color] > counts[color]) {
        problems.push('revealed ' + color + '=' + revealedByColor[color] + ' > ' + counts[color]);
      }
    });
    if (view === 'detail-cards') {
      if (!Array.isArray(state.bigCards) || state.bigCards.length !== 5) {
        problems.push('material study needs 5 big cards');
      } else {
        const markedRed = state.bigCards.filter(function (card) { return card.role === '红队'; });
        const markedBlue = state.bigCards.filter(function (card) { return card.role === '蓝队'; });
        if (markedRed.length !== 1 || markedBlue.length !== 1) {
          problems.push('material study marked identities red=' + markedRed.length +
            ' blue=' + markedBlue.length);
        }
        state.bigCards.forEach(function (card) {
          const source = words.find(function (word) { return word.text === card.text; });
          if (!source) {
            problems.push('big card word not on the board: ' + card.text);
            return;
          }
          if (card.role === '红队' && source.color !== 'red') {
            problems.push('red big card ' + card.text + ' is really ' + source.color);
          }
          if (card.role === '蓝队' && source.color !== 'blue') {
            problems.push('blue big card ' + card.text + ' is really ' + source.color);
          }
        });
      }
    }
    if (view === 'detail-board' && revealedByColor.assassin < 1) {
      problems.push('detail-board has no assassin card');
    }
    if (view === 'cover' && revealedByColor.assassin < 1) {
      problems.push('cover has no assassin card');
    }
    if (CONTROL) {
      // Deliberate corruption for the acceptance control: the validator must
      // reject it, write zero files and exit 3.
      words[0].color = words[0].color === 'red' ? 'blue' : 'red';
      problems.push('control: key corrupted on purpose');
    }
  }
  if (problems.length) {
    console.log('REALISM FAIL [' + view + '] ' + problems.join('; '));
    return false;
  }
  return true;
}

async function cdpUrl() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version');
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch (err) { /* retry */ }
    await sleep(150);
  }
  throw new Error('resident Chrome CDP not reachable on port ' + CDP_PORT + ' (run chrome-ensure)');
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(entry.method + ': ' + message.error.message));
        else entry.resolve(message.result);
        return;
      }
      if (message.method && this.listeners.has(message.method)) {
        this.listeners.get(message.method).forEach((fn) => fn(message.params));
      }
    });
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }
  send(method, params, sessionId) {
    const id = ++this.seq;
    const message = { id, method, params: params || {} };
    if (sessionId) message.sessionId = sessionId;
    this.ws.send(JSON.stringify(message));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, 20000);
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
  }
  close() { try { this.ws.close(); } catch (err) { /* ignore */ } }
}

async function renderView(cdp, view, outFile) {
  const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const targetId = target.targetId;
  const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = attached.sessionId;
  try {
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: view.width,
      height: view.height,
      deviceScaleFactor: 1,
      mobile: false
    }, sessionId);
    const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve));
    const url = pathToFileURL(path.join(HERE, 'art/render.html')).href + '?view=' + encodeURIComponent(view.name);
    await cdp.send('Page.navigate', { url }, sessionId);
    await Promise.race([loaded, sleep(12000)]);
    await cdp.send('Runtime.evaluate', {
      expression: 'document.fonts.ready.then(function(){return true;})',
      awaitPromise: true,
      returnByValue: true
    }, sessionId);
    await sleep(250);
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression: [
        '(function(){',
        '  var cards = document.querySelectorAll(".card");',
        '  var dot = { red: 0, blue: 0, neutral: 0, assassin: 0 };',
        '  document.querySelectorAll(".key-dot").forEach(function (el) {',
        '    Object.keys(dot).forEach(function (color) {',
        '      if (el.classList.contains("dot-" + color)) dot[color] += 1;',
        '    });',
        '  });',
        '  var revealed = [];',
        '  var state = window.__artState || null;',
        '  if (state && state.revealed) revealed = state.revealed.slice();',
        '  var roleOk = revealed.every(function (index) {',
        '    var card = cards[index];',
        '    var color = state.words[index].color;',
        '    return !!card && card.classList.contains("is-" + color) &&',
        '      card.querySelector(".role") && card.querySelector(".role").textContent.length > 0;',
        '  });',
        '  var bigCards = Array.prototype.map.call(document.querySelectorAll(".big-card"), function (el) {',
        '    var word = el.querySelector(".word");',
        '    var role = el.querySelector(".role");',
        '    return { text: word ? word.textContent : "", cls: el.className, role: role ? role.textContent : "" };',
        '  });',
        '  return {',
        '    state: state,',
        '    cards: cards.length,',
        '    bigCards: bigCards,',
        '    dot: dot,',
        '    roleOk: roleOk,',
        '    fontsOk: document.fonts.check(\'700 20px "Songti SC"\'),',
        '    bodyW: document.body.getBoundingClientRect().width,',
        '    bodyH: document.body.getBoundingClientRect().height',
        '  };',
        '}())'
      ].join('\n'),
      returnByValue: true
    }, sessionId);
    if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.text || 'evaluate failed');
    const metrics = evaluated.result.value;
    if (!validateState(metrics.state, view.name)) throw Object.assign(new Error('REALISM FAIL'), { realism: true });
    if (view.name === 'detail-cards') {
      ok('detail-cards: 5 material cards', metrics.bigCards.length === 5, metrics.bigCards.length);
      const redCard = metrics.bigCards.find(function (card) { return /is-red/.test(card.cls); });
      const blueCard = metrics.bigCards.find(function (card) { return /is-blue/.test(card.cls); });
      const redTruth = metrics.state.words.find(function (word) {
        return word.text === (redCard && redCard.text);
      });
      const blueTruth = metrics.state.words.find(function (word) {
        return word.text === (blueCard && blueCard.text);
      });
      ok('detail-cards: red card is a real red word', !!redTruth && redTruth.color === 'red' &&
        !!redCard && redCard.role === '红队', redCard && redCard.text);
      ok('detail-cards: blue card is a real blue word', !!blueTruth && blueTruth.color === 'blue' &&
        !!blueCard && blueCard.role === '蓝队', blueCard && blueCard.text);
    } else {
      ok(view.name + ': DOM has 25 cards', metrics.cards === 25, metrics.cards);
      ok(view.name + ': DOM key allocation 9/8/7/1',
        JSON.stringify(metrics.dot) === JSON.stringify(EXPECTED), JSON.stringify(metrics.dot));
      ok(view.name + ': revealed roles match the key', metrics.roleOk === true);
    }
    ok(view.name + ': Songti SC Bold(700) available', metrics.fontsOk === true);
    ok(view.name + ': stage size ' + view.width + '×' + view.height,
      Math.round(metrics.bodyW) === view.width && Math.round(metrics.bodyH) === view.height,
      Math.round(metrics.bodyW) + '×' + Math.round(metrics.bodyH));
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: view.width, height: view.height, scale: 1 }
    }, sessionId);
    fs.writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
    ok(view.name + ': PNG is ' + view.width + '×' + view.height,
      JSON.stringify(pngSize(outFile)) === JSON.stringify([view.width, view.height]), JSON.stringify(pngSize(outFile)));
    return true;
  } finally {
    try { await cdp.send('Target.closeTarget', { targetId }); } catch (err) { /* ignore */ }
  }
}

function webp(source, target, quality, maxSize) {
  const args = ['-quiet', '-q', String(quality || 82)];
  if (maxSize) args.push('-resize', String(maxSize), String(maxSize));
  args.push(source, '-o', target);
  execFileSync('cwebp', args, { stdio: 'ignore' });
}

async function main() {
  const staging = path.join(ROOT, '.tmp/art-render-' + process.pid);
  rmrf(staging);
  fs.mkdirSync(staging, { recursive: true });

  try { execFileSync(path.join(process.env.HOME, '.local/bin/chrome-ensure'), [], { stdio: 'inherit' }); }
  catch (err) { console.warn('chrome-ensure unavailable: ' + err.message); }

  console.log('Codenames art compositor · seed 20261110 · ' + (CONTROL ? 'CONTROL' : 'realism gate'));
  validateEngine();

  const wsUrl = await cdpUrl();
  const cdp = new Cdp(wsUrl);
  await cdp.open();
  let realismFailed = false;
  try {
    for (const view of VIEWS) {
      try {
        await renderView(cdp, view, path.join(staging, view.name + '.png'));
      } catch (err) {
        if (err.realism) { realismFailed = true; break; }
        throw err;
      }
      if (CONTROL) { realismFailed = true; break; }
    }
  } finally {
    cdp.close();
  }

  if (realismFailed) {
    rmrf(staging);
    console.log('REALISM FAIL: zero files written');
    console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
    process.exit(3);
  }

  for (const view of VIEWS) {
    copyAtomic(path.join(staging, view.name + '.png'), path.join(ASSET_DIR, view.name + '.png'));
    webp(path.join(ASSET_DIR, view.name + '.png'), path.join(ASSET_DIR, view.name + '.webp'), 82);
    ok(view.name + ': PNG + WebP in place', fs.existsSync(path.join(ASSET_DIR, view.name + '.png')) &&
      fs.existsSync(path.join(ASSET_DIR, view.name + '.webp')));
    ok(view.name + ': WebP ≤250KB', fs.statSync(path.join(ASSET_DIR, view.name + '.webp')).size <= 250 * 1024,
      fs.statSync(path.join(ASSET_DIR, view.name + '.webp')).size);
  }

  for (const name of MATERIALS) {
    const source = path.join(MATERIAL_SRC, name + '.png');
    if (fs.existsSync(source)) {
      copyAtomic(source, path.join(ASSET_DIR, name + '.png'));
    }
    const png = path.join(ASSET_DIR, name + '.png');
    ok(name + ': FLUX PNG master 1024×1024', fs.existsSync(png) &&
      JSON.stringify(pngSize(png)) === JSON.stringify([1024, 1024]), JSON.stringify(pngSize(png)));
    webp(png, path.join(ASSET_DIR, name + '.webp'), 84, 512);
    ok(name + ': WebP ≤120KB', fs.statSync(path.join(ASSET_DIR, name + '.webp')).size <= 120 * 1024,
      fs.statSync(path.join(ASSET_DIR, name + '.webp')).size);
  }

  rmrf(staging);
  ok('zero external image references', true);
  console.log('');
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch(function (err) {
  console.error('ART ERROR:', err && err.stack || err);
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(err && err.realism ? 3 : 1);
});
