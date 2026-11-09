#!/usr/bin/env node
'use strict';

/*
 * Re-runnable catalog importer.
 *
 *   node scripts/fetch-games.js
 *       Offline (default): import fixtures/games-snapshot.json into
 *       data/games.json. No network access.
 *
 *   node scripts/fetch-games.js --online
 *       Check robots.txt, then try the public GStone list/detail pages.
 *       Requests use a normal browser UA, are spaced at least 1.5s apart,
 *       time out after 15s, and retry at most 3 times. If robots.txt
 *       disallows crawling, if a page is a login/anti-bot wall, or if any
 *       record cannot be parsed, the run aborts and data/games.json is
 *       left untouched.
 *
 *   --fixture <path>   override the offline fixture
 *   --out <path>       override the output file
 *   --limit <n>        cap detail pages in online mode (default 20)
 *
 * The importer never writes a partial file: it validates everything first
 * and then replaces the destination with a single atomic rename.
 */

var fs = require('fs');
var path = require('path');
var https = require('https');
var data = require('./lib/data.js');

var USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 ' +
  'BoardgamesCatalogBot/1.0';
var GSTONE_ORIGIN = 'https://www.gstonegames.com';
var REQUEST_GAP_MS = 1500;
var REQUEST_TIMEOUT_MS = 15000;
var MAX_RETRIES = 3;
var MAX_REDIRECTS = 5;

function parseArgs(argv) {
  var opts = {
    online: false,
    fixture: data.PATHS.fixture,
    out: data.PATHS.games,
    limit: 20
  };
  for (var i = 0; i < argv.length; i++) {
    var arg = argv[i];
    if (arg === '--online') opts.online = true;
    else if (arg === '--offline') opts.online = false;
    else if (arg === '--fixture') opts.fixture = path.resolve(argv[++i]);
    else if (arg.indexOf('--fixture=') === 0) opts.fixture = path.resolve(arg.slice(10));
    else if (arg === '--out') opts.out = path.resolve(argv[++i]);
    else if (arg.indexOf('--out=') === 0) opts.out = path.resolve(arg.slice(6));
    else if (arg === '--limit') opts.limit = Math.max(1, parseInt(argv[++i], 10) || 20);
    else if (arg.indexOf('--limit=') === 0) opts.limit = Math.max(1, parseInt(arg.slice(8), 10) || 20);
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/fetch-games.js [--online] [--fixture file] [--out file] [--limit n]');
      process.exit(0);
    } else {
      console.error('unknown argument: ' + arg);
      process.exit(1);
    }
  }
  return opts;
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

var lastRequestAt = 0;

function throttle() {
  var wait = REQUEST_GAP_MS - (Date.now() - lastRequestAt);
  return wait > 0 ? sleep(wait) : Promise.resolve();
}

function requestOnce(url, redirects) {
  redirects = redirects || 0;
  return new Promise(function (resolve, reject) {
    var req = https.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        'Cache-Control': 'no-cache',
        'Connection': 'close'
      },
      timeout: REQUEST_TIMEOUT_MS
    }, function (res) {
      var status = res.statusCode || 0;
      var location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) {
          reject(new Error('too many redirects'));
          return;
        }
        var next = new URL(location, url).toString();
        resolve(requestOnce(next, redirects + 1));
        return;
      }
      var chunks = [];
      var size = 0;
      res.on('data', function (chunk) {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) {
          req.destroy(new Error('response larger than 5MB'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', function () {
        resolve({ status: status, url: url, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('request timed out after ' + REQUEST_TIMEOUT_MS + 'ms')); });
    req.on('error', reject);
  });
}

async function fetchWithRetry(url) {
  var lastError;
  for (var attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await throttle();
      lastRequestAt = Date.now();
      var res = await requestOnce(url);
      if (res.status >= 500 || res.status === 429) {
        lastError = new Error('HTTP ' + res.status + ' for ' + url);
      } else {
        return res;
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt < MAX_RETRIES) {
      console.error('[online] attempt ' + attempt + ' failed: ' + lastError.message + '; retrying');
      await sleep(REQUEST_GAP_MS * attempt);
    }
  }
  throw lastError || new Error('request failed: ' + url);
}

function robotsDisallowsAll(text) {
  var groups = [];
  var current = null;
  text.split(/\r?\n/).forEach(function (line) {
    line = line.replace(/#.*$/, '').trim();
    if (!line) return;
    var m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (!m) return;
    var key = m[1].toLowerCase();
    var value = m[2].trim();
    if (key === 'user-agent') {
      current = { agents: [value.toLowerCase()], rules: [] };
      groups.push(current);
    } else if (current && (key === 'disallow' || key === 'allow')) {
      current.rules.push({ allow: key === 'allow', path: value });
    }
  });
  var relevant = groups.filter(function (g) {
    return g.agents.indexOf('*') !== -1 || g.agents.some(function (a) { return USER_AGENT.toLowerCase().indexOf(a) !== -1; });
  });
  if (!relevant.length) return false;
  var blocked = false;
  relevant.forEach(function (g) {
    var disallowRoot = g.rules.some(function (r) { return !r.allow && r.path === '/'; });
    var allowRoot = g.rules.some(function (r) { return r.allow && (r.path === '/' || r.path === ''); });
    if (disallowRoot && !allowRoot) blocked = true;
  });
  return blocked;
}

function extractDetailLinks(html, origin) {
  var links = [];
  var re = /href="(\/game\/info-[0-9]+\.html)"/g;
  var m;
  var seen = Object.create(null);
  while ((m = re.exec(html))) {
    if (!seen[m[1]]) {
      seen[m[1]] = true;
      links.push(origin + m[1]);
    }
  }
  return links;
}

function textOf(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(text, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    var m = text.match(patterns[i]);
    if (m) return m;
  }
  return null;
}

function mapCategories(text) {
  var cats = [];
  if (/德式|策略|经营|建设|工人放置|资源|轮抽/.test(text)) cats.push('euro');
  if (/派对|聚会|毛线|推理|身份|社交|反应/.test(text)) cats.push('party');
  if (/美式|主题|对抗|骰子|冒险|战役/.test(text)) cats.push('ameritrash');
  if (/卡牌|牌组|手牌|构筑|tcg|living card/i.test(text)) cats.push('card');
  if (/双人|两人|2\s*人/.test(text)) cats.push('two-player');
  if (/家庭|亲子|儿童|轻松|易上手/.test(text)) cats.push('family');
  if (!cats.length) cats.push('euro');
  return cats.filter(function (id, i) { return cats.indexOf(id) === i; });
}

function slugFromUrl(url) {
  var m = url.match(/info-([0-9]+)\.html/);
  return m ? 'gstone-' + m[1] : null;
}

function parseGstoneDetail(html, url, fetchedAt) {
  var titleMatch = firstMatch(html, [/<h1[^>]*>([\s\S]*?)<\/h1>/i, /<title>([\s\S]*?)<\/title>/i]);
  var name = titleMatch ? textOf(titleMatch[1]).replace(/\s*[-|_].*$/, '').trim() : '';
  var pageText = textOf(html);
  var playerRange = firstMatch(pageText, [/(\d+)\s*[-–—~至到]\s*(\d+)\s*人/, /(\d+)\s*人/]);
  var timeRange = firstMatch(pageText, [/(\d+)\s*[-–—~至到]\s*(\d+)\s*分钟/, /(\d+)\s*分钟/]);
  var yearMatch = firstMatch(pageText, [/((?:19|20)\d{2})\s*年?/, /出版年份[：:]\s*((?:19|20)\d{2})/]);
  var weightMatch = firstMatch(pageText, [/(?:重度|weight)[：:\s]*([0-9](?:\.[0-9])?)/i, /([0-9](?:\.[0-9])?)\s*\/\s*5/]);
  var ratingMatch = firstMatch(pageText, [/(?:评分|rating)[：:\s]*([0-9]{1,2}(?:\.[0-9])?)/i, /([0-9]{1,2}(?:\.[0-9])?)\s*\/\s*10/]);
  var designerMatch = firstMatch(pageText, [/(?:设计师|设计)[：:]\s*([^|｜。]{1,80})/, /Designer[：:]\s*([^|｜。]{1,80})/i]);
  var publisherMatch = firstMatch(pageText, [/(?:出版社|发行)[：:]\s*([^|｜。]{1,80})/, /Publisher[：:]\s*([^|｜。]{1,80})/i]);
  var descMatch = firstMatch(html, [/<meta[^>]+name="description"[^>]+content="([^"]*)"/i, /<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i]);

  if (!name || !playerRange || !timeRange) {
    throw new Error('could not parse name/players/time from ' + url + ' (page may require JS or login)');
  }

  var slug = slugFromUrl(url);
  var playersMin = parseInt(playerRange[1], 10);
  var playersMax = playerRange.length > 2 ? parseInt(playerRange[2], 10) : playersMin;
  var playTimeMin = parseInt(timeRange[1], 10);
  var playTimeMax = timeRange.length > 2 ? parseInt(timeRange[2], 10) : playTimeMin;
  var weight = weightMatch ? parseFloat(weightMatch[1]) : 2.5;
  var rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
  var label = (slug || name).replace(/^gstone-/, '').slice(0, 6).toUpperCase();
  var designers = designerMatch
    ? designerMatch[1].split(/[、,，/／]/).map(function (s) { return s.trim(); }).filter(Boolean)
    : [];
  var publishers = publisherMatch
    ? publisherMatch[1].split(/[、,，/／]/).map(function (s) { return s.trim(); }).filter(Boolean)
    : [];

  return {
    id: slug,
    slug: slug,
    name: name,
    nameOriginal: name,
    description: descMatch ? descMatch[1].trim() : 'GStone 公开页面的离线导入记录。',
    categories: mapCategories(pageText),
    playersMin: playersMin,
    playersMax: Math.max(playersMin, playersMax),
    bestPlayers: [playersMin, playersMax],
    playTimeMin: playTimeMin,
    playTimeMax: Math.max(playTimeMin, playTimeMax),
    weight: Math.min(5, Math.max(1, weight || 2.5)),
    rating: rating == null ? null : Math.min(10, Math.max(0, rating)),
    designers: designers,
    publishers: publishers,
    year: yearMatch ? parseInt(yearMatch[1], 10) : null,
    cover: {
      gradient: 'linear-gradient(135deg,#1f2a30,#5a7a8a)',
      label: label || 'GAME'
    },
    source: { type: 'gstone', name: 'GStone public page', url: url, fetchedAt: fetchedAt }
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function validateAndWrite(records, out, label) {
  var categories = data.loadCategories();
  var schema = data.loadSchema();
  var errors = data.validateCatalog(categories, records, schema);
  if (errors.length) {
    console.error('[' + label + '] validation failed; existing data was not changed:');
    errors.slice(0, 40).forEach(function (err) {
      console.error('  ' + err.path + ': ' + err.message);
    });
    process.exitCode = 1;
    return false;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  var tmp = out + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2) + '\n');
    fs.renameSync(tmp, out);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (ignored) {}
    console.error('[' + label + '] write failed; existing data was not changed: ' + err.message);
    process.exitCode = 1;
    return false;
  }
  console.log('[' + label + '] wrote ' + records.length + ' games to ' + path.relative(process.cwd(), out));
  return true;
}

function importOffline(opts) {
  if (!fs.existsSync(opts.fixture)) {
    console.error('[offline] fixture not found: ' + opts.fixture);
    process.exitCode = 1;
    return;
  }
  var records;
  try {
    records = data.readJSON(opts.fixture);
  } catch (err) {
    console.error('[offline] ' + err.message);
    process.exitCode = 1;
    return;
  }
  console.log('[offline] fixture: ' + path.relative(process.cwd(), opts.fixture));
  validateAndWrite(records, opts.out, 'offline');
}

async function importOnline(opts) {
  var robotsUrl = GSTONE_ORIGIN + '/robots.txt';
  var robots;
  try {
    robots = await fetchWithRetry(robotsUrl);
  } catch (err) {
    console.error('[online] cannot read robots.txt (' + err.message + '); refusing to crawl. Existing data was not changed.');
    process.exitCode = 2;
    return;
  }
  if (robots.status !== 200) {
    console.error('[online] robots.txt returned HTTP ' + robots.status + '; refusing to crawl. Existing data was not changed.');
    process.exitCode = 2;
    return;
  }
  if (robotsDisallowsAll(robots.body)) {
    console.error('[online] robots.txt disallows crawling (User-agent: * / Disallow: /).');
    console.error('[online] online collection stopped; no login or anti-bot bypass attempted. Existing data was not changed.');
    process.exitCode = 2;
    return;
  }

  var listUrl = GSTONE_ORIGIN + '/game/';
  var list;
  try {
    list = await fetchWithRetry(listUrl);
  } catch (err) {
    console.error('[online] list request failed: ' + err.message + '. Existing data was not changed.');
    process.exitCode = 2;
    return;
  }
  if (list.status !== 200) {
    console.error('[online] list page returned HTTP ' + list.status + ' (possible anti-bot/login wall). Existing data was not changed.');
    process.exitCode = 2;
    return;
  }
  var links = extractDetailLinks(list.body, GSTONE_ORIGIN).slice(0, opts.limit);
  if (!links.length) {
    console.error('[online] no /game/info-*.html links found; page may be rendered by JavaScript. Existing data was not changed.');
    process.exitCode = 2;
    return;
  }

  var records = [];
  var fetchedAt = today();
  try {
    for (var i = 0; i < links.length; i++) {
      var url = links[i];
      var res = await fetchWithRetry(url);
      if (res.status !== 200) {
        throw new Error('detail page HTTP ' + res.status + ' for ' + url + ' (anti-bot/login wall)');
      }
      records.push(parseGstoneDetail(res.body, url, fetchedAt));
      console.log('[online] parsed ' + (i + 1) + '/' + links.length + ': ' + url);
    }
  } catch (err) {
    console.error('[online] aborting: ' + err.message + '. Existing data was not changed.');
    process.exitCode = 2;
    return;
  }

  validateAndWrite(records, opts.out, 'online');
}

async function main() {
  var opts = parseArgs(process.argv.slice(2));
  if (opts.online) await importOnline(opts);
  else importOffline(opts);
}

if (require.main === module) {
  main().catch(function (err) {
    console.error('fatal: ' + (err && err.stack || err));
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs: parseArgs,
  robotsDisallowsAll: robotsDisallowsAll,
  extractDetailLinks: extractDetailLinks,
  parseGstoneDetail: parseGstoneDetail
};
