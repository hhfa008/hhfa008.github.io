#!/usr/bin/env node
'use strict';

/*
 * make-tool.js — generate a tool page from scaffold.html.
 *
 *   node make-tool.js --config configs/demo.json --out examples/demo.html
 *   node make-tool.js --check --out examples/demo.html
 *   node make-tool.js --check                 # defaults to examples/demo.html
 *
 * Real tool:
 *   node make-tool.js --config configs/<slug>.json \
 *     --out /Users/fa/games/tools/<slug>/index.html
 *
 * Without "demo": true (or --demo), the body / explain / engine / UI regions
 * are left as clean placeholders for the builder.
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SCAFFOLD_PATH = path.join(__dirname, 'scaffold.html');
var DEFAULT_DEMO_OUT = path.join(__dirname, 'examples', 'demo.html');
var MAX_BYTES = 90 * 1024;
var SITE = 'https://hhfa008.github.io';
var LANGS = ['zh', 'en', 'id'];

var CATEGORY_SCHEMA = {
  'calc-finance': 'FinanceApplication',
  'text-dev': 'UtilitiesApplication',
  'design-image': 'DesignApplication',
  'date-time': 'UtilitiesApplication',
  'math': 'EducationalApplication',
  'health': 'HealthApplication',
  'life-home': 'UtilitiesApplication',
  'random-fun': 'GameApplication',
  ledger: 'FinanceApplication'
};

var GENERIC_KEYS = [
  'docTitle', 'docDesc', 'appTitle', 'tagline', 'eyebrow', 'privacy', 'skip',
  'navAria', 'navHall', 'navGames', 'langLabel', 'langZh', 'langEn', 'langId',
  'brandName', 'brandHome', 'navHome', 'footerAria', 'footerNote', 'copyright',
  'copy', 'copied', 'copyFail', 'copyHint', 'reset', 'result',
  'explainTitle', 'faqTitle', 'formulaTitle', 'assumptionsTitle',
  'backTools', 'moreTools', 'notMedical', 'notFinancial', 'unitNote',
  'download', 'downloadFail', 'clear', 'swap', 'add', 'remove', 'close',
  'yes', 'no', 'errorInvalid', 'errorRequired', 'errorGeneric',
  'storageFail', 'noscript'
];

var DEMO_BODY = `
<div class="tool-layout">
  <section class="card" aria-labelledby="tool-title">
    <p class="card-kicker" data-i="demoKicker">快速试用</p>
    <h2 id="tool-title" data-i="demoTitle">输入一个数值</h2>
    <p class="panel-desc" data-i="demoDesc">这是脚手架自带的演示：把数值乘以 2，展示输入、结果、复制与三语切换。</p>
    <div class="field">
      <label for="demo-value" data-i="demoLabel">数值</label>
      <input id="demo-value" type="text" inputmode="decimal" autocomplete="off" value="21"
        placeholder="例如 21" data-i-ph="demoPh" aria-describedby="demo-error">
    </div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn primary" type="button" id="demo-calc" data-i="demoCalc">计算</button>
      <button class="btn ghost" type="button" id="demo-reset" data-i="reset">重置</button>
    </div>
    <p class="hint" data-i="demoHint">输入即算；按“计算”也会重新计算。</p>
  </section>
  <div class="result-col">
    <section class="card result" aria-labelledby="demo-result-title">
      <p class="card-kicker" data-i="result">结果</p>
      <h2 id="demo-result-title" data-i="demoResultTitle">计算结果</h2>
      <div class="result-live" aria-live="polite">
        <p class="result-big" id="demo-result">—</p>
        <p class="result-note" id="demo-context"></p>
      </div>
      <p class="error" id="demo-error" role="alert" hidden></p>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn primary" type="button" id="demo-copy" data-i="copy" disabled>复制结果</button>
      </div>
      <p class="hint" data-i="demoCopyHint">复制的是原始数值，不带千分位。</p>
    </section>
  </div>
</div>`.trim();

var DEMO_EXPLAIN = `
<p class="panel-desc" data-i="demoExplainIntro">这个示例只做一次乘法，用来验证脚手架的完整链路。</p>
<div class="formula-grid">
  <div class="formula">
    <h3 data-i="demoFormulaLabel">演示公式</h3>
    <code data-i="demoFormula">结果 = 数值 × 2</code>
  </div>
</div>
<h3 class="formula-title" data-i="assumptionsTitle">假设与规则</h3>
<ul class="assumptions">
  <li data-i="demoAssumption1">输入必须是有限数字，允许负数与小数。</li>
  <li data-i="demoAssumption2">结果超过 1e12 时返回溢出错误。</li>
  <li data-i="privacy">所有计算都在浏览器本地完成，输入不会上传。</li>
</ul>`.trim();

var CLEAN_ENGINE = [
  'var ToolEngine = (function () {',
  "  'use strict';",
  '',
  '  // TOOL_ENGINE_START',
  '  // TODO: builder writes pure functions here, then exports them below.',
  '  // TOOL_ENGINE_END',
  '',
  '  return {};',
  '})();'
].join('\n');

var CLEAN_UI = [
  '// TOOL_UI_START',
  '  // TODO: builder wires inputs, renders results with textContent, and calls',
  '  // ToolUI.onLangChange(render) so dynamic copy refreshes after a language switch.',
  '  // TOOL_UI_END'
].join('\n');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.log([
    '用法:',
    '  node make-tool.js --config <config.json> --out <index.html> [--demo] [--check]',
    '  node make-tool.js --check [--out <index.html>]',
    '',
    '选项:',
    '  --config <file>    工具配置 JSON',
    '  --out <file>       输出 HTML（--check 时可省略，默认 examples/demo.html）',
    '  --scaffold <file>  覆盖 scaffold.html 路径',
    '  --demo             注入内置演示 body/explain（config 里 "demo": true 等效）',
    '  --check            生成后（或对已有文件）运行静态检查，失败 exit 1',
    '  --max-bytes <kb>   --check 的体积上限，默认 90（KB）',
    '  --quiet            只输出错误',
    '  --help             显示帮助'
  ].join('\n'));
}

function parseArgs(argv) {
  var opts = {
    config: null,
    out: null,
    scaffold: SCAFFOLD_PATH,
    demo: false,
    check: false,
    maxBytes: MAX_BYTES,
    quiet: false,
    help: false
  };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--config') {
      opts.config = argv[++i];
    } else if (a === '--out' || a === '--output') {
      opts.out = argv[++i];
    } else if (a === '--scaffold') {
      opts.scaffold = argv[++i];
    } else if (a === '--demo') {
      opts.demo = true;
    } else if (a === '--check') {
      opts.check = true;
    } else if (a === '--max-bytes') {
      var kb = parseInt(argv[++i], 10);
      if (!isFinite(kb) || kb <= 0) throw new Error('--max-bytes 需要正整数 KB');
      opts.maxBytes = kb * 1024;
    } else if (a === '--quiet') {
      opts.quiet = true;
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    } else if (a.charAt(0) === '-') {
      throw new Error('未知参数: ' + a);
    } else if (!opts.out) {
      opts.out = a;
    } else {
      throw new Error('多余的位置参数: ' + a);
    }
  }
  if (!opts.out && opts.check) opts.out = DEFAULT_DEMO_OUT;
  return opts;
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Text placed inside a JSON string literal in the page. Keeps the surrounding
// quotes; escapes "</script>" and line separators so the block cannot break out.
function jsonFragment(value) {
  return JSON.stringify(String(value)).slice(1, -1)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// Text placed inside a single-quoted JS string literal in the page.
function jsFragment(value) {
  return JSON.stringify(String(value)).slice(1, -1)
    .replace(/'/g, "\\'")
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function jsonForScript(value) {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function replaceAll(html, token, value) {
  return html.split(token).join(value);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function readConfig(file) {
  var raw = fs.readFileSync(file, 'utf8');
  var config;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    throw new Error('config 不是合法 JSON: ' + e.message);
  }
  return config;
}

function requireText(obj, key, where) {
  if (!obj || typeof obj[key] !== 'string' || !obj[key].trim()) {
    throw new Error(where + '.' + key + ' 必须是非空字符串');
  }
  return obj[key].trim();
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('config 必须是对象');
  var slug = requireText(config, 'slug', 'config');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 60) {
    throw new Error('config.slug 只能是小写字母、数字和连字符，长度 <= 60');
  }
  var category = requireText(config, 'category', 'config');
  if (!CATEGORY_SCHEMA[category]) {
    throw new Error('config.category 必须是: ' + Object.keys(CATEGORY_SCHEMA).join(', '));
  }

  var langData = {};
  LANGS.forEach(function (lang) {
    var item = config[lang];
    if (!item || typeof item !== 'object') {
      throw new Error('缺少 config.' + lang + '（title/desc/appTitle/tagline）');
    }
    langData[lang] = {
      title: requireText(item, 'title', 'config.' + lang),
      desc: requireText(item, 'desc', 'config.' + lang),
      appTitle: requireText(item, 'appTitle', 'config.' + lang),
      tagline: requireText(item, 'tagline', 'config.' + lang)
    };
  });

  if (!Array.isArray(config.faqs) || config.faqs.length < 3 || config.faqs.length > 4) {
    throw new Error('config.faqs 必须是 3–4 条问答');
  }
  var faqs = config.faqs.map(function (item, index) {
    if (!item || typeof item !== 'object') {
      throw new Error('config.faqs[' + index + '] 必须是对象');
    }
    return {
      q: requireText(item, 'q', 'config.faqs[' + index + ']'),
      a: requireText(item, 'a', 'config.faqs[' + index + ']')
    };
  });

  return {
    slug: slug,
    category: category,
    demo: config.demo === true,
    lang: langData,
    faqs: faqs
  };
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

function faqHtml(faqs) {
  return faqs.map(function (item, index) {
    var n = index + 1;
    return [
      '<details>',
      '      <summary data-i="faqQ' + n + '">' + escapeHtml(item.q) + '</summary>',
      '      <p data-i="faqA' + n + '">' + escapeHtml(item.a) + '</p>',
      '    </details>'
    ].join('\n    ');
  }).join('\n    ');
}

function faqJsonLd(faqs) {
  var list = faqs.map(function (item) {
    return {
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a }
    };
  });
  return jsonForScript(list);
}

function generate(configFile, outFile, scaffoldFile, forceDemo, quiet) {
  var config = validateConfig(readConfig(configFile));
  var html = fs.readFileSync(scaffoldFile, 'utf8');
  var url = SITE + '/tools/' + config.slug + '/';
  var demo = forceDemo || config.demo === true;

  var requiredMarkers = [
    '<!--TOOL_BODY-->',
    '<!--TOOL_EXPLAIN-->',
    '<!--TOOL_FAQ-->',
    '<!--TOOL_FAQ_JSONLD-->',
    '// TOOL_ENGINE_START',
    '// TOOL_ENGINE_END',
    "var ToolEngine = (function ()",
    '// TOOL_UI_START',
    '// TOOL_UI_END'
  ];
  requiredMarkers.forEach(function (marker) {
    if (html.indexOf(marker) === -1) {
      throw new Error('scaffold.html 缺少标记: ' + marker);
    }
  });

  // Head + structured data + body slots.
  var replacements = [
    ['__SLUG__', config.slug],
    ['__CATEGORY__', config.category],
    ['__URL__', url],
    ['__TITLE_HTML__', escapeHtml(config.lang.zh.title)],
    ['__DESC_HTML__', escapeHtml(config.lang.zh.desc)],
    ['__APP_TITLE_HTML__', escapeHtml(config.lang.zh.appTitle)],
    ['__TAGLINE_HTML__', escapeHtml(config.lang.zh.tagline)],
    ['__LD_NAME__', jsonFragment(config.lang.zh.appTitle)],
    ['__LD_DESC__', jsonFragment(config.lang.zh.desc)],
    ['__LD_CATEGORY__', CATEGORY_SCHEMA[config.category]],
    ['__ZH_TITLE__', jsFragment(config.lang.zh.title)],
    ['__ZH_DESC__', jsFragment(config.lang.zh.desc)],
    ['__ZH_APP_TITLE__', jsFragment(config.lang.zh.appTitle)],
    ['__ZH_TAGLINE__', jsFragment(config.lang.zh.tagline)],
    ['__EN_TITLE__', jsFragment(config.lang.en.title)],
    ['__EN_DESC__', jsFragment(config.lang.en.desc)],
    ['__EN_APP_TITLE__', jsFragment(config.lang.en.appTitle)],
    ['__EN_TAGLINE__', jsFragment(config.lang.en.tagline)],
    ['__ID_TITLE__', jsFragment(config.lang.id.title)],
    ['__ID_DESC__', jsFragment(config.lang.id.desc)],
    ['__ID_APP_TITLE__', jsFragment(config.lang.id.appTitle)],
    ['__ID_TAGLINE__', jsFragment(config.lang.id.tagline)]
  ];
  replacements.forEach(function (pair) {
    html = replaceAll(html, pair[0], pair[1]);
  });

  // FAQ: visible Chinese defaults + FAQPage JSON-LD, both from config.faqs.
  html = replaceAll(html, '<!--TOOL_FAQ-->', faqHtml(config.faqs));
  html = replaceAll(html, '<!--TOOL_FAQ_JSONLD-->', faqJsonLd(config.faqs));

  if (demo) {
    html = replaceAll(html, '<!--TOOL_BODY-->', DEMO_BODY);
    html = replaceAll(html, '<!--TOOL_EXPLAIN-->', DEMO_EXPLAIN);
  } else {
    // Keep the content placeholders, but remove demo-only engine/UI code so
    // the intermediate page opens without errors and the regions are obvious.
    html = html.replace(/(<script id="engine">)([\s\S]*?)(<\/script>)/, function (m, open, body, close) {
      return open + '\n' + CLEAN_ENGINE + '\n' + close;
    });
    html = html.replace(/(\/\/ TOOL_UI_START)[\s\S]*?(\/\/ TOOL_UI_END)/, function (m, start, end) {
      return CLEAN_UI;
    });
  }

  var leftovers = html.match(/__[A-Z][A-Z0-9_]*__/g);
  if (leftovers) {
    throw new Error('生成后仍有未替换 token: ' + Array.from(new Set(leftovers)).join(', '));
  }

  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(path.resolve(outFile), html, 'utf8');

  if (!quiet) {
    var bytes = Buffer.byteLength(html, 'utf8');
    console.log('generated: ' + path.resolve(outFile));
    console.log('  slug: ' + config.slug + ' · category: ' + config.category +
      ' · mode: ' + (demo ? 'demo' : 'placeholder') + ' · ' + (bytes / 1024).toFixed(1) + ' KB');
    if (!demo) {
      console.log('  next: replace <!--TOOL_BODY-->, <!--TOOL_EXPLAIN-->, TOOL_ENGINE_*, TOOL_UI_*, TOOL_DICT_*');
    }
  }
  return { out: path.resolve(outFile), demo: demo, config: config };
}

// ---------------------------------------------------------------------------
// Static check
// ---------------------------------------------------------------------------

function extractI18n(html) {
  var match = html.match(/<script[^>]*id\s*=\s*["']i18n["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('找不到 <script id="i18n">');
  return vm.runInNewContext(match[1] + '\n;TOOL_I18N;', Object.create(null), { timeout: 3000 });
}

function extractJsonLd(html) {
  var re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  var out = [];
  var match;
  while ((match = re.exec(html))) out.push(JSON.parse(match[1]));
  return out;
}

function dataKeys(html) {
  // Ignore HTML comments so documentation examples cannot masquerade as keys.
  var clean = html.replace(/<!--[\s\S]*?-->/g, '');
  var re = /data-i(?:-ph|-aria)?\s*=\s*["']([^"']+)["']/g;
  var seen = Object.create(null);
  var match;
  while ((match = re.exec(clean))) seen[match[1]] = true;
  return Object.keys(seen).sort();
}

function checkOutput(file, quiet, maxBytes) {
  var limit = isFinite(maxBytes) && maxBytes > 0 ? maxBytes : MAX_BYTES;
  var errors = [];
  var warnings = [];
  var html;
  try {
    html = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.error('CHECK FAIL: 读不到文件 ' + file);
    return false;
  }

  var bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > limit) {
    errors.push('文件 ' + (bytes / 1024).toFixed(1) + ' KB 超过 ' + (limit / 1024).toFixed(0) + ' KB 上限');
  }

  var forbidden = [
    { re: /<script[^>]*\bsrc\s*=/i, why: '<script src>' },
    { re: /<link[^>]*\brel\s*=\s*["']?stylesheet/i, why: 'stylesheet link' },
    { re: /@import/i, why: '@import' },
    { re: /url\(\s*["']?https?:/i, why: 'remote url()' },
    { re: /\bfetch\s*\(/i, why: 'fetch()' },
    { re: /XMLHttpRequest/, why: 'XMLHttpRequest' },
    { re: /sendBeacon/, why: 'sendBeacon' }
  ];
  forbidden.forEach(function (item) {
    var hit = html.match(item.re);
    if (hit) errors.push('禁止的外链/请求: ' + item.why + ' ×' + hit.length);
  });

  var tokens = html.match(/__[A-Z][A-Z0-9_]*__/g);
  if (tokens) {
    errors.push('未替换 token: ' + Array.from(new Set(tokens)).join(', '));
  }
  var placeholders = html.match(/<!--TOOL_[A-Z_]+-->/g) || [];
  Array.from(new Set(placeholders)).forEach(function (marker) {
    if (marker === '<!--TOOL_BODY-->' || marker === '<!--TOOL_EXPLAIN-->') {
      warnings.push('内容占位仍存在（交付前必须替换）: ' + marker);
    } else {
      errors.push('未替换占位: ' + marker);
    }
  });
  if (html.indexOf('innerHTML') !== -1) {
    warnings.push('页面出现 innerHTML；确认只用于静态模板，绝不拼接用户输入');
  }

  // JSON-LD: exactly three parseable blocks with the required types.
  var jsonLd = [];
  try {
    jsonLd = extractJsonLd(html);
    if (jsonLd.length !== 3) errors.push('JSON-LD 应为 3 条，实际 ' + jsonLd.length + ' 条');
    var types = jsonLd.map(function (item) { return item && item['@type']; });
    ['SoftwareApplication', 'FAQPage', 'BreadcrumbList'].forEach(function (type) {
      if (types.indexOf(type) === -1) errors.push('缺少 JSON-LD 类型: ' + type);
    });
    var faqPage = jsonLd.filter(function (item) { return item && item['@type'] === 'FAQPage'; })[0];
    if (faqPage) {
      if (!Array.isArray(faqPage.mainEntity) || faqPage.mainEntity.length < 3) {
        errors.push('FAQPage.mainEntity 少于 3 条');
      } else {
        faqPage.mainEntity.forEach(function (item, index) {
          if (!item || !item.name || !item.acceptedAnswer || !item.acceptedAnswer.text) {
            errors.push('FAQPage.mainEntity[' + index + '] 缺少 name/acceptedAnswer.text');
          }
        });
        var visibleFaq = (html.match(/data-i\s*=\s*["']faqQ\d+["']/g) || []).length;
        if (visibleFaq !== faqPage.mainEntity.length) {
          errors.push('可见 FAQ ' + visibleFaq + ' 条与 JSON-LD ' + faqPage.mainEntity.length + ' 条不一致');
        }
      }
    }
  } catch (e) {
    errors.push('JSON-LD 不是合法 JSON: ' + e.message);
  }

  // Dictionaries: same keys in zh/en/id, non-empty values, required keys.
  var dict = null;
  try {
    dict = extractI18n(html);
  } catch (e) {
    errors.push('三语字典无法求值: ' + e.message);
  }
  var dictKeys = [];
  if (dict) {
    LANGS.forEach(function (lang) {
      if (!dict[lang] || typeof dict[lang] !== 'object') {
        errors.push('字典缺少语言: ' + lang);
      }
    });
    if (dict.zh && dict.en && dict.id) {
      dictKeys = Object.keys(dict.zh).sort();
      ['en', 'id'].forEach(function (lang) {
        var keys = Object.keys(dict[lang]).sort();
        if (JSON.stringify(keys) !== JSON.stringify(dictKeys)) {
          errors.push('字典 ' + lang + ' 的键与 zh 不一致');
        }
      });
      dictKeys.forEach(function (key) {
        LANGS.forEach(function (lang) {
          var value = dict[lang] && dict[lang][key];
          if (typeof value !== 'string' || !value.trim()) {
            errors.push('字典 ' + lang + '.' + key + ' 为空或不是字符串');
          } else if (value.trim() === key) {
            errors.push('字典 ' + lang + '.' + key + ' 的值等于键名');
          }
        });
      });
      GENERIC_KEYS.forEach(function (key) {
        if (dictKeys.indexOf(key) === -1) errors.push('缺少通用字典键: ' + key);
      });
    }
  }

  var referenced = dataKeys(html);
  if (dict) {
    referenced.forEach(function (key) {
      LANGS.forEach(function (lang) {
        if (!dict[lang] || !Object.prototype.hasOwnProperty.call(dict[lang], key)) {
          errors.push('data-i 键 ' + key + ' 在字典 ' + lang + ' 中不存在');
        }
      });
    });
  }

  // Head / SEO basics.
  var titleMatch = html.match(/<title>\s*([^<]*?)\s*<\/title>/i);
  if (!titleMatch || !titleMatch[1].trim()) errors.push('缺少非空 <title>');
  if (!/<meta[^>]+name\s*=\s*["']viewport["'][^>]*content\s*=\s*["'][^"']*width=device-width/i.test(html)) {
    errors.push('缺少 viewport width=device-width');
  }
  var descMatch = html.match(/<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']/i);
  if (!descMatch || !descMatch[1].trim()) errors.push('缺少非空 meta description');
  if (!/<meta[^>]+name\s*=\s*["']author["'][^>]*content\s*=\s*["']Devin["']/i.test(html)) {
    errors.push('缺少 author=Devin');
  }
  if (!/<meta[^>]+name\s*=\s*["']robots["']/i.test(html)) errors.push('缺少 meta robots');
  var themeColors = (html.match(/<meta[^>]+name\s*=\s*["']theme-color["']/gi) || []).length;
  if (themeColors < 2) errors.push('theme-color 明暗两套缺失');
  if (!/<link[^>]+rel\s*=\s*["']canonical["']/i.test(html)) errors.push('缺少 canonical');
  if (!/<link[^>]+rel\s*=\s*["']icon["'][^>]*href\s*=\s*["']data:image\/svg\+xml/i.test(html)) {
    errors.push('缺少内联 data URI favicon');
  }
  if (!/<meta[^>]+property\s*=\s*["']og:title["']/i.test(html)) errors.push('缺少 og:title');
  if (!/<meta[^>]+property\s*=\s*["']og:description["']/i.test(html)) errors.push('缺少 og:description');
  if (!/<meta[^>]+property\s*=\s*["']og:url["']/i.test(html)) errors.push('缺少 og:url');
  if (!/<meta[^>]+name\s*=\s*["']twitter:card["']/i.test(html)) errors.push('缺少 twitter:card');

  var slugMatch = html.match(/data-slug\s*=\s*["']([^"']+)["']/);
  var slug = slugMatch ? slugMatch[1] : null;
  var canonicalMatch = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i);
  var canonical = canonicalMatch ? canonicalMatch[1] : '';
  if (slug && canonical !== SITE + '/tools/' + slug + '/') {
    errors.push('canonical 应为 ' + SITE + '/tools/' + slug + '/，实际 ' + canonical);
  }
  if (!/<html[^>]*lang\s*=\s*["']zh-CN["']/i.test(html)) {
    errors.push('html lang 默认应为 zh-CN');
  }
  LANGS.forEach(function (lang) {
    var count = (html.match(new RegExp('data-lang\\s*=\\s*["\']' + lang + '["\']', 'g')) || []).length;
    if (count !== 1) errors.push('data-lang="' + lang + '" 应恰好出现 1 次，实际 ' + count);
  });
  if (!/<script[^>]*id\s*=\s*["']engine["']/i.test(html)) {
    errors.push('缺少 <script id="engine">');
  }

  if (!quiet) {
    console.log('');
    if (errors.length) {
      console.log('CHECK FAIL: ' + path.resolve(file) + ' · ' + errors.length + ' 个错误');
      errors.forEach(function (item) { console.log('  ERROR: ' + item); });
    } else {
      console.log('CHECK OK: ' + path.resolve(file));
      console.log('  ' + (bytes / 1024).toFixed(1) + ' KB (<= ' + (limit / 1024).toFixed(0) + ' KB) · JSON-LD ' + jsonLd.length +
        ' · data-i 键 ' + referenced.length + ' · i18n 键 ' + dictKeys.length);
    }
    warnings.forEach(function (item) { console.log('  WARN: ' + item); });
  } else if (errors.length) {
    errors.forEach(function (item) { console.error('ERROR: ' + item); });
  }
  return errors.length === 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  var opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error('参数错误: ' + e.message);
    process.exitCode = 2;
    return;
  }
  if (opts.help) { usage(); return; }

  var out = opts.out;
  try {
    if (opts.config) {
      if (!out) throw new Error('生成时必须提供 --out');
      var result = generate(opts.config, out, opts.scaffold, opts.demo, opts.quiet);
      out = result.out;
    } else if (!out) {
      usage();
      process.exitCode = 2;
      return;
    }

    if (opts.check) {
      var ok = checkOutput(out, opts.quiet, opts.maxBytes);
      if (!ok) process.exitCode = 1;
    }
  } catch (e) {
    console.error('失败: ' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  generate: generate,
  checkOutput: checkOutput,
  validateConfig: validateConfig,
  CATEGORY_SCHEMA: CATEGORY_SCHEMA,
  GENERIC_KEYS: GENERIC_KEYS,
  MAX_BYTES: MAX_BYTES
};
