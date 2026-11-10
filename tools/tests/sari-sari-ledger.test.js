'use strict';

// sari-sari-ledger is a stock single-page app with an inline `var I18N`
// dictionary (en / zh / id / fil) and a `?lang=` override on top of the
// persisted setting. It does not use the new `#i18n` contract, so this test
// extracts the real dictionary from index.html and asserts the static
// routing contract instead of relying on a copy of the text.

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'sari-sari-ledger';
var ROOT = path.join('/Users/fa/games/tools', SLUG);
var PAGE = path.join(ROOT, 'index.html');
var MAX_BYTES = 90 * 1024;
var LANGS = ['zh', 'en', 'id', 'fil'];

var html = '';
var readError = null;
try { html = fs.readFileSync(PAGE, 'utf8'); } catch (e) { readError = e; }

var dict = null;
var dictError = null;
var dictMatch = html.match(/var I18N = (\{[\s\S]*?\n  \});/);
if (dictMatch) {
  try { dict = lib.evalCode(dictMatch[0], 'I18N'); } catch (e) { dictError = e; }
}
var baseKeys = dict && dict.en ? Object.keys(dict.en).sort() : [];

var t = lib.suite(SLUG);

// ---------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------

t.group('files', function () {
  t.ok('index.html exists', !readError, readError && readError.message);
  t.ok('index.html non-empty', html.length > 1000, html.length + ' chars');
  t.ok('index.html <= 90 KB', Buffer.byteLength(html, 'utf8') <= MAX_BYTES,
    (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1) + ' KB');
  ['sw.js', 'manifest.webmanifest', 'icon.svg'].forEach(function (name) {
    var file = path.join(ROOT, name);
    t.ok(name + ' exists', fs.existsSync(file), file);
  });
  t.ok('doctype html', /^<!doctype html>/i.test(html));
  return (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1) + ' KB';
});

// ---------------------------------------------------------------------------
// inline var I18N: four languages, identical key sets, key presence
// ---------------------------------------------------------------------------

t.group('var I18N 四语字典', function () {
  t.ok('inline `var I18N` block found', !!dictMatch);
  t.ok('I18N evaluates', !!dict, dictError && dictError.message);
  if (!dict) return '';

  LANGS.forEach(function (lang) {
    t.ok('I18N.' + lang + ' exists', !!(dict[lang] && typeof dict[lang] === 'object'));
    t.ok('I18N.' + lang + ' non-empty', !!(dict[lang] && Object.keys(dict[lang]).length));
    t.eq('I18N.' + lang + ' key set matches en',
      dict[lang] ? Object.keys(dict[lang]).sort() : [], baseKeys);
  });
  t.ok('dictionary has at least 40 keys', baseKeys.length >= 40, baseKeys.length + ' keys');

  var REQUIRED = [
    'appTitle', 'tagline', 'privacy', 'totalOwed', 'addCustomer', 'nameLabel',
    'add', 'customers', 'noCustomers', 'paidUp', 'addEntry', 'amount', 'note',
    'saveCredit', 'savePayment', 'history', 'deleteCustomer', 'deleteEntry',
    'reminderHint', 'copied', 'storageFail', 'importBad'
  ];
  LANGS.forEach(function (lang) {
    REQUIRED.forEach(function (key) {
      t.ok('I18N.' + lang + '.' + key + ' exists',
        !!(dict[lang] && typeof dict[lang][key] === 'string'));
    });
  });

  LANGS.forEach(function (lang) {
    baseKeys.forEach(function (key) {
      var value = dict[lang] && dict[lang][key];
      t.ok('I18N.' + lang + '.' + key + ' non-empty',
        typeof value === 'string' && value.trim().length > 0,
        JSON.stringify(value));
    });
  });

  t.ok('zh appTitle is Chinese', /[一-鿿]/.test(dict.zh.appTitle), dict.zh.appTitle);
  t.ok('en appTitle is English', /sari-sari/i.test(dict.en.appTitle), dict.en.appTitle);
  t.ok('id appTitle is Indonesian', /utang|sari-sari/i.test(dict.id.appTitle), dict.id.appTitle);
  t.ok('fil appTitle is Filipino', /utang|talaan/i.test(dict.fil.appTitle), dict.fil.appTitle);
  t.ok('zh and en appTitle differ', dict.zh.appTitle !== dict.en.appTitle);
  t.ok('zh tagline contains Chinese text', /[一-鿿]/.test(dict.zh.tagline), dict.zh.tagline);
  t.ok('zh privacy says data stays on the device', /手机|本机|设备|不上传|不会上传/.test(dict.zh.privacy), dict.zh.privacy);
  t.ok('no TODO/FIXME/lorem placeholder in dictionary text', LANGS.every(function (lang) {
    return baseKeys.every(function (key) {
      return !/\b(TODO|FIXME|lorem ipsum)\b/i.test(String(dict[lang][key]));
    });
  }));

  return LANGS.join('/') + ', ' + baseKeys.length + ' keys each';
});

// ---------------------------------------------------------------------------
// markup bindings: every data-i key resolves in all four languages
// ---------------------------------------------------------------------------

t.group('markup 与四语文案绑定', function () {
  var markupKeys = lib.dataIKeys(html);
  t.ok('markup references data-i keys', markupKeys.length >= 20, markupKeys.length + ' keys');
  LANGS.forEach(function (lang) {
    markupKeys.forEach(function (key) {
      t.ok('[' + lang + '] data-i key ' + key + ' resolves',
        !!(dict && dict[lang] && typeof dict[lang][key] === 'string'),
        'missing in I18N.' + lang);
    });
  });

  LANGS.forEach(function (lang) {
    t.ok('language button data-lang="' + lang + '" present',
      new RegExp('data-lang="' + lang + '"').test(html));
  });
  t.ok('four language buttons total',
    (html.match(/data-lang="(zh|en|id|fil)"/g) || []).length === 4);
  t.ok('language switch labels 中文/EN/ID/FIL',
    /data-lang="zh">中文<\/button>/.test(html) &&
    /data-lang="en">EN<\/button>/.test(html) &&
    /data-lang="id">ID<\/button>/.test(html) &&
    /data-lang="fil">FIL<\/button>/.test(html));
  t.ok('initial ui language is en',
    /var ui = \{ lang: 'en', currency: 'PHP', openId: null \};/.test(html));
  t.ok('runtime html lang uses LANG_TAG',
    /document\.documentElement\.lang = LANG_TAG\[ui\.lang\] \|\| 'en';/.test(html));
  return markupKeys.length + ' markup keys × ' + LANGS.length + ' languages';
});

// ---------------------------------------------------------------------------
// ?lang routing: query > localStorage > navigator.language
// ---------------------------------------------------------------------------

t.group('?lang 路由优先级', function () {
  t.ok('reads ?lang with URLSearchParams',
    /new URLSearchParams\(location\.search\)\.get\('lang'\)/.test(html));
  t.ok('accepts exactly zh/en/id/fil from the query',
    /var qLang = \(q === 'en' \|\| q === 'id' \|\| q === 'fil' \|\| q === 'zh'\) \? q : '';/.test(html));
  t.ok('rejects unknown ?lang values', /\) \? q : '';/.test(html));
  t.ok('persisted language is validated before use',
    /if \(s\.lang === 'en' \|\| s\.lang === 'id' \|\| s\.lang === 'fil' \|\| s\.lang === 'zh'\) ui\.lang = s\.lang;/.test(html));
  t.ok('query language overrides the stored setting',
    /if \(qLang\) ui\.lang = qLang;/.test(html));
  t.ok('detectLang only runs when no query and no stored setting',
    /else if \(!found\) ui\.lang = detectLang\(\);/.test(html));

  var loadSettings = (html.match(/function loadSettings\(\) \{[\s\S]*?\n  \}/) || [''])[0];
  t.ok('loadSettings function extracted', loadSettings.length > 200);
  var storedAt = loadSettings.indexOf('localStorage.getItem(SET_KEY)');
  var queryAt = loadSettings.indexOf('if (qLang) ui.lang = qLang;');
  var detectAt = loadSettings.indexOf('detectLang()');
  t.ok('localStorage is read in loadSettings', storedAt !== -1);
  t.ok('query assignment is in loadSettings', queryAt !== -1);
  t.ok('query assignment comes after localStorage read', storedAt !== -1 && queryAt > storedAt,
    'stored@' + storedAt + ' query@' + queryAt);
  t.ok('detectLang fallback comes after query assignment', detectAt > queryAt,
    'query@' + queryAt + ' detect@' + detectAt);

  t.ok('autodetect maps id/in to Indonesian',
    /l\.indexOf\('id'\) === 0 \|\| l\.indexOf\('in'\) === 0/.test(html));
  t.ok('autodetect maps fil/tl to Filipino',
    /l\.indexOf\('fil'\) === 0 \|\| l\.indexOf\('tl'\) === 0/.test(html));
  t.ok('autodetect falls back to English', /return 'en';/.test(html));
  t.ok('LANG_TAG declares zh-CN', /var LANG_TAG = \{ en: 'en', id: 'id', fil: 'fil', zh: 'zh-CN' \};/.test(html));
  t.ok('clicking a button saves then applies the language',
    /ui\.lang = this\.getAttribute\('data-lang'\);\s*\n\s*saveSettings\(\);\s*\n\s*applyLang\(\);/.test(html));
  return 'query > settings > navigator';
});

// ---------------------------------------------------------------------------
// localStorage keys and persistence
// ---------------------------------------------------------------------------

t.group('localStorage 键与持久化', function () {
  t.ok('DATA_KEY is sari-ledger-v1', /var DATA_KEY = 'sari-ledger-v1';/.test(html));
  t.ok('SET_KEY is sari-ledger-settings-v1',
    /var SET_KEY = 'sari-ledger-settings-v1';/.test(html));
  t.ok('data is loaded from DATA_KEY', /localStorage\.getItem\(DATA_KEY\)/.test(html));
  t.ok('data is saved to DATA_KEY',
    /localStorage\.setItem\(DATA_KEY, JSON\.stringify\(data\)\)/.test(html));
  t.ok('settings are loaded from SET_KEY', /localStorage\.getItem\(SET_KEY\)/.test(html));
  t.ok('settings persist lang and currency',
    /localStorage\.setItem\(SET_KEY, JSON\.stringify\(\{ lang: ui\.lang, currency: ui\.currency \}\)\);/.test(html));
  t.ok('no sessionStorage usage', !/sessionStorage/.test(html));
  t.ok('storage failures are caught (offline/private mode)',
    /function loadData\(\) \{\s*try \{[\s\S]*?localStorage\.getItem\(DATA_KEY\)/.test(html) &&
    /catch \(e\) \{ \/\* start empty \*\/ \}/.test(html));
  t.ok('no cookies written', !/document\.cookie/.test(html));
  return 'sari-ledger-v1 / sari-ledger-settings-v1';
});

// ---------------------------------------------------------------------------
// static document contract
// ---------------------------------------------------------------------------

t.group('静态文档契约', function () {
  t.ok('viewport is width=device-width with safe-area',
    /<meta[^>]*name="viewport"[^>]*content="width=device-width, initial-scale=1, viewport-fit=cover"/.test(html));
  t.ok('title is non-empty', /<title>[^<]*\S[^<]*<\/title>/i.test(html));
  t.ok('meta description is non-empty',
    /<meta[^>]*name="description"[^>]*content="[^"]+\S[^"]*"/i.test(html));
  t.ok('meta description names all supported languages',
    /English, Bahasa Indonesia, Filipino/.test(html));
  t.ok('canonical URL is correct',
    /<link rel="canonical" href="https:\/\/hhfa008\.github\.io\/tools\/sari-sari-ledger\/">/.test(html));
  t.ok('manifest is linked', /<link rel="manifest" href="\.\/manifest\.webmanifest">/.test(html));
  t.ok('theme-color present', /<meta name="theme-color" content="#[0-9a-f]{6}">/i.test(html));
  t.ok('robots meta present', /<meta name="robots" content="index,follow/.test(html));
  t.ok('no screenshot / OCR placeholder artifacts',
    !/\b(TODO|FIXME|lorem ipsum|placeholder text)\b/i.test(html));
  t.eq('zero external requests', lib.externalRefs(html), []);
  return 'viewport/canonical/manifest/offline';
});

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

t.group('JSON-LD', function () {
  var blocks;
  try {
    blocks = lib.jsonLd(html);
    t.ok('JSON-LD parses', true);
  } catch (e) {
    t.ok('JSON-LD parses', false, e.message);
    return '';
  }
  t.eq('exactly one JSON-LD block', blocks.length, 1);
  var app = blocks[0] || {};
  t.eq('@type is WebApplication', app['@type'], 'WebApplication');
  t.ok('name non-empty', typeof app.name === 'string' && app.name.trim().length > 0);
  t.ok('url is the canonical tool URL',
    app.url === 'https://hhfa008.github.io/tools/sari-sari-ledger/');
  t.ok('inLanguage includes en, id and fil',
    Array.isArray(app.inLanguage) &&
    ['en', 'id', 'fil'].every(function (lang) { return app.inLanguage.indexOf(lang) !== -1; }),
    JSON.stringify(app.inLanguage));
  t.ok('offers a free price', !!(app.offers && String(app.offers.price) === '0'));
  t.ok('featureList has at least 5 entries',
    Array.isArray(app.featureList) && app.featureList.length >= 5,
    app.featureList && app.featureList.length);
  t.ok('description mentions offline',
    /offline/i.test(app.description || ''));
  return 'WebApplication / ' + (app.inLanguage || []).join(',');
});

// ---------------------------------------------------------------------------
// offline: service worker + manifest
// ---------------------------------------------------------------------------

t.group('离线与 manifest', function () {
  t.ok('service worker registration is relative',
    /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/.test(html));
  t.ok('SW registration is guarded',
    /'serviceWorker' in navigator[\s\S]{0,80}location\.protocol\.indexOf\('http'\) === 0/.test(html));

  var sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  t.ok('sw.js caches index.html', /\.\/index\.html/.test(sw));
  t.ok('sw.js caches manifest', /\.\/manifest\.webmanifest/.test(sw));
  t.ok('sw.js ignores cross-origin requests',
    /url\.origin !== self\.location\.origin[\s\S]{0,40}return;/.test(sw));
  t.ok('sw.js never fetches cross-origin assets',
    !/https?:\/\//.test(sw));
  t.ok('sw.js network-first for navigation',
    /req\.mode === 'navigate'/.test(sw) &&
    /fetch\(req\)\.then/.test(sw) &&
    /catch\(function \(\) \{[\s\S]*?caches\.match\(req\)/.test(sw));

  var manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8')); }
  catch (e) { manifest = null; }
  t.ok('manifest parses', !!manifest, manifest === null ? 'invalid JSON' : '');
  if (!manifest) return '';
  t.ok('manifest display is standalone', manifest.display === 'standalone');
  t.ok('manifest start_url is scoped', manifest.start_url === './' && manifest.scope === './');
  t.ok('manifest has icons', Array.isArray(manifest.icons) && manifest.icons.length >= 1);
  t.ok('manifest icon src is local', manifest.icons.every(function (icon) {
    return !/^https?:/i.test(icon.src);
  }));
  return 'sw.js + manifest.webmanifest';
});

t.done();
