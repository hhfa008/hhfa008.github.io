#!/usr/bin/env node
'use strict';

/**
 * hall-build.js — build the three tool-hall pages from catalog.json.
 *
 * Usage:
 *   node tools/tests/hall-build.js
 *
 * The script writes:
 *   tools/index.html
 *   tools/en/index.html
 *   tools/id/index.html
 *
 * Then it runs static self-checks on the generated HTML. Any failure exits 1.
 * Tools whose page directory does not exist yet are reported as "pending";
 * their slug is still validated and their card is emitted.
 */

const fs = require('fs');
const path = require('path');

const TESTS = __dirname;
const ROOT = path.resolve(TESTS, '..'); // /tools
const CATALOG_PATH = path.join(TESTS, 'catalog.json');
const STYLE_PATH = path.join(TESTS, 'hall.css');

const TEMPLATE_PATH = {
  zh: path.join(TESTS, 'hall.template.zh.html'),
  en: path.join(TESTS, 'hall.template.en.html'),
  id: path.join(TESTS, 'hall.template.id.html')
};

const OUTPUT_PATH = {
  zh: path.join(ROOT, 'index.html'),
  en: path.join(ROOT, 'en', 'index.html'),
  id: path.join(ROOT, 'id', 'index.html')
};

const CATEGORY_ORDER = [
  'calc-finance',
  'text-dev',
  'design-image',
  'date-time',
  'math',
  'health',
  'life-home',
  'random-fun',
  'ledger'
];

const EXPECTED_COUNTS = {
  'calc-finance': 21,
  'text-dev': 24,
  'design-image': 12,
  'date-time': 8,
  math: 10,
  health: 9,
  'life-home': 7,
  'random-fun': 8,
  ledger: 1
};

const CATEGORIES = [
  {
    id: 'calc-finance',
    label: { zh: '计算与财务', en: 'Calculators & Finance', id: 'Kalkulator & Keuangan' },
    small: { zh: 'Calculators & Finance', en: 'Finance', id: 'Hitung' }
  },
  {
    id: 'text-dev',
    label: { zh: '文本与开发', en: 'Text & Dev', id: 'Teks & Dev' },
    small: { zh: 'Text & Dev', en: 'Text', id: 'Teks' }
  },
  {
    id: 'design-image',
    label: { zh: '设计与图片', en: 'Design & Image', id: 'Desain & Gambar' },
    small: { zh: 'Design & Image', en: 'Design', id: 'Desain' }
  },
  {
    id: 'date-time',
    label: { zh: '日期与时间', en: 'Date & Time', id: 'Tanggal & Waktu' },
    small: { zh: 'Date & Time', en: 'Time', id: 'Waktu' }
  },
  {
    id: 'math',
    label: { zh: '数学', en: 'Math', id: 'Matematika' },
    small: { zh: 'Math', en: 'Math', id: 'Matematika' }
  },
  {
    id: 'health',
    label: { zh: '健康', en: 'Health', id: 'Kesehatan' },
    small: { zh: 'Health', en: 'Health', id: 'Kesehatan' }
  },
  {
    id: 'life-home',
    label: { zh: '生活与家居', en: 'Life & Home', id: 'Rumah Tangga' },
    small: { zh: 'Life & Home', en: 'Home', id: 'Rumah' }
  },
  {
    id: 'random-fun',
    label: { zh: '随机与趣味', en: 'Random & Fun', id: 'Acak & Seru' },
    small: { zh: 'Random & Fun', en: 'Random', id: 'Acak' }
  },
  {
    id: 'ledger',
    label: { zh: '记账类', en: 'Ledger', id: 'Pembukuan' },
    small: { zh: 'Ledger', en: 'Ledger', id: 'Catatan' }
  }
];

const TOTAL = 100;

const LANG = {
  zh: {
    inLanguage: 'zh-CN',
    canonical: 'https://hhfa008.github.io/tools/',
    pageName: '免费在线工具大厅',
    title: '免费在线工具大厅 — 100 个计算、文本、设计、时间与生活工具，无需注册',
    description:
      '100 个免费在线工具，覆盖计算与财务、文本与开发、设计与图片、日期与时间、数学、健康、生活与家居、随机与趣味、记账。无需注册，数据留在本地。',
    ogTitle: '免费在线工具大厅 — 100 个实用小工具',
    ogDesc: '9 类 100 个纯前端工具，打开就能用；无需注册，数据留在本地。',
    twTitle: '免费在线工具大厅 — 100 个实用小工具',
    twDesc: '100 个免费在线小工具：计算、文本、设计、时间、健康、家居、随机与记账，数据都在本地。',
    h1: '100 个免费在线小工具',
    lede:
      '计算与财务、文本与开发、设计与图片、日期时间、数学、健康、生活家居、随机趣味和记账——9 类 100 个工具，无需注册，数据留在本地',
    placeholder: '搜索工具，如 百分比 / JSON / 二维码 / 时区 / 房贷 / 配色',
    langLabel: '语言',
    staticTitle: '在工具页内切换',
    langsAria: '语言版本（工具页内切换）',
    screenShareAria: {
      en: 'English 版',
      id: 'Bahasa Indonesia 版',
      vi: 'Tiếng Việt 版',
      th: 'ภาษาไทย 版'
    },
    tags: {
      hot: '无需登录',
      local: '本地处理',
      localCalc: '本地计算',
      trilingual: '三语',
      offline: '可离线',
      fourLang: '四语'
    }
  },
  en: {
    inLanguage: 'en',
    canonical: 'https://hhfa008.github.io/tools/en/',
    pageName: 'Free online tools',
    title: 'Free online tools — 100 calculators, text, design, time and everyday utilities, no sign-up',
    description:
      '100 free online tools across calculators and finance, text and dev, design and image, date and time, math, health, life and home, random and fun, and a ledger. No sign-up; everything runs in your browser.',
    ogTitle: 'Free online tools — 100 practical utilities',
    ogDesc: 'Nine categories, 100 browser-only tools that need no account and keep your data on your device.',
    twTitle: 'Free online tools — 100 practical utilities',
    twDesc: '100 free browser tools for calculations, text, design, time, health, home, randomness and bookkeeping — all local.',
    h1: '100 free online tools',
    lede:
      'Calculators and finance, text and dev, design and image, date and time, math, health, life and home, random and fun, plus a ledger — 100 tools with no sign-up',
    placeholder: 'Search tools, e.g. percentage / JSON / QR code / time zone / loan / palette',
    langLabel: 'Lang',
    staticTitle: 'Switch inside the tool',
    langsAria: 'Language versions (switch inside the tool)',
    screenShareAria: {
      en: 'English version',
      id: 'Bahasa Indonesia version',
      vi: 'Tiếng Việt version',
      th: 'ภาษาไทย version'
    },
    tags: {
      hot: 'No sign-up',
      local: 'Runs locally',
      localCalc: 'Runs locally',
      trilingual: '3 languages',
      offline: 'Works offline',
      fourLang: '4 languages'
    }
  },
  id: {
    inLanguage: 'id',
    canonical: 'https://hhfa008.github.io/tools/id/',
    pageName: 'Alat online gratis',
    title: 'Alat online gratis — 100 kalkulator, teks, desain, waktu, dan utilitas harian, tanpa daftar',
    description:
      '100 alat online gratis untuk kalkulator dan keuangan, teks dan dev, desain dan gambar, tanggal dan waktu, matematika, kesehatan, rumah tangga, acak dan seru, serta pembukuan. Tanpa daftar; semua berjalan di browser.',
    ogTitle: 'Alat online gratis — 100 utilitas praktis',
    ogDesc: 'Sembilan kategori, 100 alat berbasis browser tanpa akun, data tetap di perangkat Anda.',
    twTitle: 'Alat online gratis — 100 utilitas praktis',
    twDesc: '100 alat browser gratis untuk hitungan, teks, desain, waktu, kesehatan, rumah, keacakan, dan pembukuan — semua lokal.',
    h1: '100 alat online gratis',
    lede:
      'Kalkulator dan keuangan, teks dan dev, desain dan gambar, tanggal dan waktu, matematika, kesehatan, rumah tangga, acak dan seru, serta pembukuan — 100 alat tanpa daftar',
    placeholder: 'Cari alat, mis. persentase / JSON / kode QR / zona waktu / pinjaman / palet',
    langLabel: 'Bahasa',
    staticTitle: 'Ganti di dalam alat',
    langsAria: 'Versi bahasa (ganti di dalam alat)',
    screenShareAria: {
      en: 'Versi English',
      id: 'Versi Bahasa Indonesia',
      vi: 'Versi Tiếng Việt',
      th: 'Versi ภาษาไทย'
    },
    tags: {
      hot: 'Tanpa daftar',
      local: 'Diproses lokal',
      localCalc: 'Dihitung lokal',
      trilingual: '3 bahasa',
      offline: 'Bisa offline',
      fourLang: '4 bahasa'
    }
  }
};

const CATEGORY_ICON = {
  'calc-finance': 'calculator',
  'text-dev': 'document',
  'design-image': 'image',
  'date-time': 'clock',
  math: 'calculator',
  health: 'heart',
  'life-home': 'home',
  'random-fun': 'sparkles',
  ledger: 'ledger'
};

const ICON_OVERRIDES = {
  'percentage-calculator': 'percent',
  'unit-converter': 'swap',
  'loan-calculator': 'bank',
  'tip-splitter': 'receipt',
  'screen-share-calc': 'screen',
  'text-tools': 'document',
  'json-formatter': 'braces',
  'password-generator': 'key',
  'compound-interest-calculator': 'growth',
  'savings-goal-calculator': 'piggy',
  'inflation-calculator': 'chart',
  'discount-calculator': 'percent',
  'vat-calculator': 'receipt',
  'salary-converter': 'wallet',
  'overtime-pay-calculator': 'clock',
  'freelance-rate-calculator': 'wallet',
  'break-even-calculator': 'chart',
  'profit-margin-calculator': 'growth',
  'roi-calculator': 'growth',
  'debt-payoff-calculator': 'bank',
  'retirement-calculator': 'piggy',
  'rent-split-calculator': 'home',
  'fuel-cost-calculator': 'chart',
  'electricity-cost-calculator': 'sparkles',
  'aspect-ratio-calculator': 'resize',
  'case-converter': 'document',
  'lorem-ipsum-generator': 'document',
  'slug-generator': 'link',
  'uuid-generator': 'hash',
  'hash-generator': 'hash',
  'base64-encoder': 'code',
  'url-encoder': 'link',
  'html-entity-encoder': 'code',
  'jwt-decoder': 'key',
  'regex-tester': 'regex',
  'cron-explainer': 'clock',
  'text-diff': 'diff',
  'markdown-preview': 'markdown',
  'csv-to-json': 'table',
  'json-to-csv': 'table',
  'xml-formatter': 'xml',
  'json-to-typescript': 'typescript',
  'css-formatter': 'code',
  'color-converter': 'palette',
  'number-base-converter': 'hash',
  'color-palette-generator': 'palette',
  'gradient-generator': 'gradient',
  'box-shadow-generator': 'shadow',
  'border-radius-generator': 'radius',
  'image-compressor': 'image',
  'image-resizer': 'resize',
  'image-to-base64': 'code',
  'image-rotate': 'rotate',
  'qr-code-generator': 'qr',
  'barcode-generator': 'barcode',
  'favicon-generator': 'favicon',
  'placeholder-image-generator': 'placeholder',
  'date-calculator': 'calendar',
  'pomodoro-timer': 'timer',
  stopwatch: 'timer',
  'countdown-timer': 'timer',
  'world-clock': 'clock',
  'timezone-converter': 'clock',
  'unix-timestamp-converter': 'clock',
  'week-number-calculator': 'calendar',
  'fraction-calculator': 'percent',
  'gcd-lcm-calculator': 'hash',
  'prime-factorizer': 'hash',
  'statistics-calculator': 'chart',
  'quadratic-solver': 'chart',
  'triangle-calculator': 'tile',
  'circle-calculator': 'wheel',
  'area-volume-calculator': 'tile',
  'speed-distance-time-calculator': 'pace',
  'roman-numeral-converter': 'list',
  'bmi-calculator': 'scale',
  'water-intake-calculator': 'water',
  'sleep-cycle-calculator': 'moon',
  'pregnancy-due-date-calculator': 'baby',
  'ideal-weight-calculator': 'scale',
  'macro-calculator': 'pie',
  'heart-rate-zones': 'heartrate',
  'steps-to-distance': 'steps',
  'pace-calculator': 'pace',
  'cooking-converter': 'recipe',
  'grade-calculator': 'chart',
  'recipe-scaler': 'recipe',
  'paint-calculator': 'paint',
  'tile-calculator': 'tile',
  'paper-size-converter': 'paper',
  'shoe-size-converter': 'shoe',
  'random-number-generator': 'sparkles',
  'name-picker': 'list',
  'dice-roller': 'dice',
  'coin-flip': 'coin',
  'lottery-number-generator': 'sparkles',
  'team-generator': 'people',
  'list-shuffler': 'shuffle',
  'decision-wheel': 'wheel',
  'sari-sari-ledger': 'ledger'
};

const ICONS = {
  calculator:
    '<rect x="9" y="5" width="30" height="38" rx="4"/><rect x="14" y="10" width="20" height="8" rx="2"/><path d="M15 25h4M22 25h4M29 25h4M15 32h4M22 32h4M29 32h4M15 39h4M22 39h4M29 39h4"/>',
  percent:
    '<circle cx="15" cy="15" r="5.5"/><circle cx="33" cy="33" r="5.5"/><path d="M37 11 11 37"/>',
  swap:
    '<path d="M7 17h30"/><path d="m32 12 5 5-5 5"/><path d="M41 31H11"/><path d="m16 26-5 5 5 5"/>',
  bank:
    '<path d="M6 19 24 8l18 11"/><path d="M10 19v17h28V19"/><path d="M6 40h36"/><path d="M17 36V26M24 36V26M31 36V26"/>',
  receipt:
    '<path d="M12 6h24v36l-5-3-4 3-4-3-4 3-7-3z"/><path d="M18 16h12M18 23h12M18 30h8"/>',
  growth:
    '<path d="M7 35l10-10 8 6 15-17"/><path d="M32 14h8v8"/>',
  piggy:
    '<path d="M8 26c0-8 7-14 16-14s16 6 16 14c0 5-3 9-7 11v5h-6v-3h-6v3h-6v-5c-4-2-7-6-7-11z"/><path d="M36 22h3M17 22h.01"/><path d="M22 8l2 4"/>',
  chart:
    '<path d="M7 40h34"/><path d="M12 34V24M20 34V16M28 34V27M36 34V11"/>',
  wallet:
    '<rect x="6" y="12" width="36" height="26" rx="3"/><path d="M6 20h36"/><circle cx="33" cy="30" r="3"/>',
  clock:
    '<circle cx="24" cy="24" r="16"/><path d="M24 15v9l6 4"/>',
  calendar:
    '<rect x="7" y="9" width="34" height="32" rx="3"/><path d="M7 19h34M16 5v8M32 5v8"/><path d="M15 27h6M27 27h6M15 34h6M27 34h6"/>',
  timer:
    '<circle cx="24" cy="26" r="15"/><path d="M24 17v9l6 4"/><path d="M18 6h12M24 6v5"/><path d="m36 11 3 3"/>',
  document:
    '<path d="M11 7h18l8 8v26H11z"/><path d="M29 7v8h8"/><path d="M16 22h10M16 28h14M16 34h10"/>',
  code:
    '<path d="m17 15-10 9 10 9"/><path d="m31 15 10 9-10 9"/><path d="m27 9-6 30"/>',
  braces:
    '<path d="M18 8c-5 0-6 3-6 7v4c0 3-2 5-5 5 3 0 5 2 5 5v4c0 4 1 7 6 7"/><path d="M30 8c5 0 6 3 6 7v4c0 3 2 5 5 5-3 0-5 2-5 5v4c0 4-1 7-6 7"/>',
  key:
    '<circle cx="17" cy="29" r="8"/><path d="M23 23 39 7"/><path d="m33 13 5 5M36 10l5 5"/>',
  hash:
    '<path d="M18 7 14 41M34 7l-4 34M8 18h34M6 30h34"/>',
  link:
    '<path d="M20 28 28 20"/><path d="M24 14l3-3a7 7 0 0 1 10 10l-3 3"/><path d="M24 34l-3 3a7 7 0 0 1-10-10l3-3"/>',
  regex:
    '<path d="M16 12v18M8 16l16 10M24 16 8 26"/><circle cx="34" cy="34" r="4"/><path d="M38 30 44 24"/>',
  diff:
    '<path d="M7 12h14M7 20h10M27 12h14M27 20h14M7 32h14M7 40h14M27 32h14M27 40h14M21 24h6"/>',
  markdown:
    '<rect x="6" y="12" width="36" height="24" rx="4"/><path d="M12 30V18l6 7 6-7v12"/><path d="M31 18v8M27 22l4 4 4-4"/>',
  table:
    '<rect x="6" y="8" width="36" height="32" rx="3"/><path d="M6 18h36M6 28h36M18 8v32M30 8v32"/>',
  xml:
    '<path d="m14 16-7 8 7 8"/><path d="m34 16 7 8-7 8"/><path d="M27 10 21 38"/>',
  typescript:
    '<rect x="6" y="6" width="36" height="36" rx="4"/><path d="M14 18h12M20 18v16"/><path d="M28 34c3 0 6-1 6-4 0-5-6-3-6-7 0-2 2-3 4-3"/>',
  screen:
    '<rect x="5" y="8" width="38" height="25" rx="3.2"/><path d="M18 40h12M24 33v7"/><path d="M13.5 27v-5M19 27v-10M24.5 27v-7M30 27v-9M35.5 27v-4"/>',
  palette:
    '<path d="M24 6c-10 0-18 8-18 18s8 18 18 18c2 0 3-2 3-4 0-2-1-3-3-4-2-1-2-4 0-5h5c6 0 11-4 11-10C40 11 33 6 24 6z"/><circle cx="15" cy="19" r="2.2"/><circle cx="23" cy="13" r="2.2"/><circle cx="32" cy="17" r="2.2"/>',
  gradient:
    '<rect x="6" y="9" width="36" height="30" rx="3"/><path d="M6 19h36M6 28h36"/>',
  shadow:
    '<rect x="9" y="8" width="24" height="24" rx="3"/><path d="M15 38h24V14" stroke-dasharray="3 4"/>',
  radius:
    '<path d="M8 20V10h10"/><path d="M40 20V10H30"/><path d="M8 28v10h10"/><path d="M40 28v10H30"/>',
  image:
    '<rect x="6" y="9" width="36" height="30" rx="3"/><circle cx="17" cy="19" r="3.5"/><path d="m9 35 10-10 7 7 6-6 7 9"/>',
  resize:
    '<rect x="6" y="6" width="24" height="24" rx="2"/><rect x="20" y="20" width="22" height="22" rx="2"/><path d="M14 14h8M14 14v8"/>',
  rotate:
    '<path d="M36 18a14 14 0 1 0 2 13"/><path d="M36 8v10H26"/><rect x="16" y="16" width="16" height="16" rx="2"/>',
  qr:
    '<rect x="6" y="6" width="14" height="14" rx="2"/><rect x="28" y="6" width="14" height="14" rx="2"/><rect x="6" y="28" width="14" height="14" rx="2"/><path d="M28 28h6v6h-6zM36 36h6v6h-6z"/>',
  barcode:
    '<path d="M7 10v28M12 10v28M18 10v28M23 10v28M31 10v28M37 10v28M41 10v28"/><path d="M16 10v28M27 10v28M34 10v28" stroke-width="1.2"/>',
  favicon:
    '<rect x="8" y="8" width="32" height="32" rx="8"/><path d="M16 31V23l8-7 8 7v8z"/><circle cx="24" cy="28" r="2.4"/>',
  placeholder:
    '<rect x="6" y="9" width="36" height="30" rx="3"/><path d="M6 22h36M6 28h36M16 9v30M24 9v30M32 9v30"/>',
  dice:
    '<rect x="7" y="7" width="34" height="34" rx="5"/><circle cx="17" cy="17" r="2.3"/><circle cx="31" cy="17" r="2.3"/><circle cx="24" cy="24" r="2.3"/><circle cx="17" cy="31" r="2.3"/><circle cx="31" cy="31" r="2.3"/>',
  coin:
    '<circle cx="24" cy="24" r="16"/><path d="M24 14v20M29 18h-7a4 4 0 0 0 0 8h4a4 4 0 0 1 0 8h-7"/>',
  shuffle:
    '<path d="M7 14h6c8 0 10 20 18 20h6"/><path d="m32 29 7 5-7 5"/><path d="M7 34h6c3 0 5-3 7-7"/><path d="M27 13c2-1 3-1 4-1h6"/><path d="m32 7 7 5-7 5"/>',
  wheel:
    '<circle cx="24" cy="24" r="17"/><path d="M24 7v34M7 24h34M12 12l24 24M36 12 12 36"/>',
  list:
    '<path d="M8 12h4M8 24h4M8 36h4"/><path d="M18 12h22M18 24h22M18 36h22"/>',
  sparkles:
    '<path d="M24 6v8M24 34v8M6 24h8M34 24h8"/><path d="m12 12 5 5M31 31l5 5M36 12l-5 5M17 31l-5 5"/>',
  people:
    '<circle cx="16" cy="17" r="5"/><circle cx="32" cy="17" r="5"/><path d="M7 39c0-6 4-10 9-10s9 4 9 10"/><path d="M23 39c0-6 4-10 9-10s9 4 9 10"/>',
  heart:
    '<path d="M24 40S7 30 7 18a9 9 0 0 1 17-4 9 9 0 0 1 17 4c0 12-17 22-17 22z"/>',
  water:
    '<path d="M24 6S11 22 11 31a13 13 0 0 0 26 0C37 22 24 6 24 6z"/><path d="M18 32a6 6 0 0 0 6 6"/>',
  moon:
    '<path d="M34 32A14 14 0 0 1 18 11a15 15 0 1 0 16 21z"/><path d="M33 12h.01"/>',
  baby:
    '<circle cx="24" cy="12" r="5"/><path d="M17 20c-5 5-5 15 1 20M31 20c5 5 5 15-1 20"/><circle cx="24" cy="30" r="8"/>',
  scale:
    '<path d="M24 7v34"/><path d="M12 13h24"/><path d="M12 13 6 27h12zM36 13l-6 14h12z"/><path d="M18 41h12"/>',
  pie:
    '<circle cx="24" cy="24" r="16"/><path d="M24 8v16h16"/><path d="M24 24 12 36"/>',
  heartrate:
    '<path d="M7 25h8l4-9 6 18 5-12 3 5h8"/><circle cx="24" cy="24" r="18"/>',
  steps:
    '<path d="M16 38c-4 0-6-3-6-8 0-4 2-6 5-6s5 3 5 7c0 4-1 7-4 7z"/><path d="M33 27c-4 0-6-3-6-8 0-4 2-6 5-6s5 3 5 7c0 4-1 7-4 7z"/><path d="M13 41h22"/>',
  pace:
    '<circle cx="24" cy="24" r="17"/><path d="M24 24l8-8"/><path d="M24 13v3M35 24h-3M24 35v-3M13 24h3"/>',
  home:
    '<path d="M8 22 24 8l16 14"/><path d="M12 20v21h24V20"/><path d="M20 41V29h8v12"/>',
  recipe:
    '<path d="M9 23h30a15 15 0 0 1-30 0z"/><path d="M16 41h16"/><path d="M18 15c0-3 3-5 6-5s6 2 6 5"/><path d="M14 11h.01M34 9h.01"/>',
  paint:
    '<path d="M10 10h28v14H10z"/><path d="M24 24v8"/><path d="M18 32h12v9H18z"/><path d="M16 15h10"/>',
  tile:
    '<rect x="7" y="7" width="15" height="15" rx="1"/><rect x="26" y="7" width="15" height="15" rx="1"/><rect x="7" y="26" width="15" height="15" rx="1"/><rect x="26" y="26" width="15" height="15" rx="1"/>',
  paper:
    '<path d="M13 6h16l8 8v28H13z"/><path d="M29 6v8h8"/><path d="M19 22h10M19 29h12M19 36h8"/>',
  shoe:
    '<path d="M6 30h14l8-8 6 4h8v10H6z"/><path d="M6 30v6h36v-4"/><path d="M20 22l4 4M24 18l4 4"/>',
  ledger:
    '<rect x="8" y="6" width="32" height="36" rx="3.2"/><path d="M15 6v36"/><path d="M21 15h13M21 22h13M21 29h8"/><circle cx="31" cy="35" r="5.5"/><path d="M31 32.5v5M28.8 33.8h4.4M28.8 36.2h4.4"/>'
};

function escHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(value) {
  return escHtml(value).replace(/"/g, '&quot;');
}

function jsonForScript(value) {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}

function iconFor(tool) {
  const key = ICON_OVERRIDES[tool.slug] || CATEGORY_ICON[tool.category];
  return ICONS[key] || ICONS.document;
}

function tagsFor(tool, lang) {
  const t = LANG[lang].tags;
  let tags;
  if (tool.slug === 'screen-share-calc') {
    tags = [t.hot, t.localCalc, t.fourLang];
  } else if (tool.slug === 'sari-sari-ledger') {
    tags = [t.hot, t.offline, t.trilingual];
  } else {
    const calcLike = ['calc-finance', 'math', 'health', 'life-home'].indexOf(tool.category) !== -1;
    tags = [t.hot, calcLike ? t.localCalc : t.local, t.trilingual];
  }
  return tags
    .map(function (tag, index) {
      return index === 0 ? '<span class="hot">' + escHtml(tag) + '</span>' : '<span>' + escHtml(tag) + '</span>';
    })
    .join('');
}

function chipsFor(tool, lang) {
  const L = LANG[lang];
  if (tool.slug === 'screen-share-calc') {
    const a = L.screenShareAria;
    return [
      '<a class="lang-chip" href="/tools/screen-share-calc/" hreflang="en" lang="en" aria-label="' + escAttr(a.en) + '">EN</a>',
      '<a class="lang-chip" href="/tools/screen-share-calc/id/" hreflang="id" lang="id" aria-label="' + escAttr(a.id) + '">ID</a>',
      '<a class="lang-chip" href="/tools/screen-share-calc/vi/" hreflang="vi" lang="vi" aria-label="' + escAttr(a.vi) + '">VI</a>',
      '<a class="lang-chip" href="/tools/screen-share-calc/th/" hreflang="th" lang="th" aria-label="' + escAttr(a.th) + '">TH</a>'
    ].join('\n          ');
  }
  const codes = tool.slug === 'sari-sari-ledger' ? ['EN', 'ID', 'FIL'] : ['ZH', 'EN', 'ID'];
  return codes
    .map(function (code) {
      return '<span class="lang-chip is-static" title="' + escAttr(L.staticTitle) + '">' + code + '</span>';
    })
    .join('\n          ');
}

function searchText(tool) {
  const category = CATEGORIES.find(function (c) {
    return c.id === tool.category;
  });
  const parts = [
    tool.name.zh,
    tool.name.en,
    tool.name.id,
    tool.desc.zh,
    tool.desc.en,
    tool.desc.id,
    tool.slug,
    tool.category,
    category ? category.label.zh : '',
    category ? category.label.en : '',
    category ? category.label.id : ''
  ];
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function renderCard(tool, lang) {
  return (
    '      <article class="tool-card" data-search="' +
    escAttr(searchText(tool)) +
    '">\n' +
    '        <a class="tool-link" href="' +
    escAttr(tool.href[lang]) +
    '">\n' +
    '          <div class="card-head">\n' +
    '            <span class="tool-icon" aria-hidden="true">\n' +
    '              <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    iconFor(tool) +
    '</svg>\n' +
    '            </span>\n' +
    '            <div><h3>' +
    escHtml(tool.name[lang]) +
    '</h3><span class="latin">' +
    escHtml(tool.name.en) +
    '</span></div>\n' +
    '          </div>\n' +
    '          <p class="desc">' +
    escHtml(tool.desc[lang]) +
    '</p>\n' +
    '          <p class="tags">' +
    tagsFor(tool, lang) +
    '</p>\n' +
    '        </a>\n' +
    '        <div class="langs" aria-label="' +
    escAttr(LANG[lang].langsAria) +
    '">\n' +
    '          <span class="lang-label">' +
    escHtml(LANG[lang].langLabel) +
    '</span>\n' +
    '          ' +
    chipsFor(tool, lang) +
    '\n' +
    '        </div>\n' +
    '      </article>'
  );
}

function renderCategory(category, tools, lang) {
  const items = tools.filter(function (tool) {
    return tool.category === category.id;
  });
  const cards = items
    .map(function (tool) {
      return renderCard(tool, lang);
    })
    .join('\n\n');
  return (
    '  <section class="cat" id="' +
    category.id +
    '" data-cat="' +
    category.id +
    '" aria-labelledby="' +
    category.id +
    '-title">\n' +
    '    <div class="cat-head">\n' +
    '      <h2 id="' +
    category.id +
    '-title">' +
    escHtml(category.label[lang]) +
    '</h2><span class="count">' +
    items.length +
    '</span><small>' +
    escHtml(category.small[lang]) +
    '</small>\n' +
    '    </div>\n' +
    '    <div class="grid">\n\n' +
    cards +
    '\n\n    </div>\n' +
    '  </section>'
  );
}

function renderJump(tools, lang) {
  return CATEGORIES.map(function (category) {
    const count = tools.filter(function (tool) {
      return tool.category === category.id;
    }).length;
    return '      <a href="#' + category.id + '">' + escHtml(category.label[lang]) + ' <span>' + count + '</span></a>';
  }).join('\n');
}

function renderFooterCategories(lang) {
  return CATEGORIES.map(function (category) {
    return '<a href="#' + category.id + '">' + escHtml(category.label[lang]) + '</a>';
  }).join(' · ');
}

function buildJsonLd(tools, lang) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: LANG[lang].pageName,
    url: LANG[lang].canonical,
    inLanguage: LANG[lang].inLanguage,
    description: LANG[lang].description,
    isPartOf: { '@type': 'WebSite', name: 'Devin', url: 'https://hhfa008.github.io/' },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: tools.length,
      itemListElement: tools.map(function (tool, index) {
        return {
          '@type': 'ListItem',
          position: index + 1,
          name: tool.name[lang],
          url: 'https://hhfa008.github.io' + tool.href[lang]
        };
      })
    }
  };
}

function fillTemplate(template, vars) {
  let output = template;
  Object.keys(vars).forEach(function (key) {
    output = output.split('{{' + key + '}}').join(vars[key]);
  });
  return output;
}

function buildPage(tools, lang, template, style) {
  const categoriesHtml = CATEGORIES.map(function (category) {
    return renderCategory(category, tools, lang);
  }).join('\n\n');
  const vars = {
    TITLE: escHtml(LANG[lang].title),
    DESCRIPTION: escAttr(LANG[lang].description),
    OG_TITLE: escAttr(LANG[lang].ogTitle),
    OG_DESC: escAttr(LANG[lang].ogDesc),
    TW_TITLE: escAttr(LANG[lang].twTitle),
    TW_DESC: escAttr(LANG[lang].twDesc),
    H1: escHtml(LANG[lang].h1),
    LEDE: escHtml(LANG[lang].lede),
    PLACEHOLDER: escAttr(LANG[lang].placeholder),
    JUMP: renderJump(tools, lang),
    CATEGORIES: categoriesHtml,
    TOTAL: String(tools.length),
    FOOTER_CATEGORY_LINKS: renderFooterCategories(lang),
    JSONLD: jsonForScript(buildJsonLd(tools, lang)),
    STYLE: style
  };
  return fillTemplate(template, vars);
}

function validateCatalog(tools, errors) {
  if (!Array.isArray(tools)) {
    errors.push('catalog.json must contain an array of tools');
    return;
  }
  if (tools.length !== TOTAL) {
    errors.push('catalog total must be ' + TOTAL + ', got ' + tools.length);
  }

  const counts = {};
  const seen = new Set();
  tools.forEach(function (tool, index) {
    const where = 'record ' + (index + 1) + ' (' + (tool && tool.slug) + ')';
    if (!tool || typeof tool !== 'object') {
      errors.push(where + ': not an object');
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tool.slug || '')) {
      errors.push(where + ': invalid slug');
    }
    if (seen.has(tool.slug)) {
      errors.push(where + ': duplicate slug');
    }
    seen.add(tool.slug);
    if (CATEGORY_ORDER.indexOf(tool.category) === -1) {
      errors.push(where + ': unknown category ' + tool.category);
    }
    counts[tool.category] = (counts[tool.category] || 0) + 1;
    ['zh', 'en', 'id'].forEach(function (lang) {
      if (!tool.name || !tool.name[lang]) errors.push(where + ': missing name.' + lang);
      if (!tool.desc || !tool.desc[lang]) errors.push(where + ': missing desc.' + lang);
      if (!tool.href || !tool.href[lang]) errors.push(where + ': missing href.' + lang);
    });
  });

  CATEGORY_ORDER.forEach(function (id) {
    if ((counts[id] || 0) !== EXPECTED_COUNTS[id]) {
      errors.push('category ' + id + ' expected ' + EXPECTED_COUNTS[id] + ', got ' + (counts[id] || 0));
    }
  });
  return counts;
}

function decodeAttr(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function checkHref(tool, lang, errors, stats) {
  const href = tool.href[lang];
  const match = href.match(/^\/tools\/([a-z0-9-]+)\/((?:[a-z]{2}\/)?)?(?:\?lang=(zh|en|id))?$/);
  if (!match) {
    errors.push(tool.slug + ' [' + lang + ']: unexpected href ' + href);
    return;
  }
  const hrefSlug = match[1];
  if (hrefSlug !== tool.slug) {
    errors.push(tool.slug + ' [' + lang + ']: href slug mismatch ' + href);
  }
  if (tool.slug !== 'screen-share-calc' && tool.slug !== 'sari-sari-ledger') {
    if (match[3] !== lang) {
      errors.push(tool.slug + ' [' + lang + ']: missing ?lang=' + lang + ' in ' + href);
    }
  }
  if (href.indexOf('?lang=') !== -1) {
    stats.pending.add(tool.slug);
  }
  const pagePath = path.join(ROOT, hrefSlug, 'index.html');
  if (fs.existsSync(pagePath)) {
    stats.existing.add(tool.slug);
  } else {
    stats.missing.add(tool.slug);
  }
}

function checkGenerated(html, lang, tools, errors, stats) {
  const prefix = '[' + lang + '] ';

  const cardRe = /<article class="tool-card" data-search="([^"]*)">[\s\S]*?<a class="tool-link" href="([^"]*)">/g;
  const cards = [];
  let match;
  while ((match = cardRe.exec(html)) !== null) {
    cards.push({ search: decodeAttr(match[1]), href: match[2] });
  }
  if (cards.length !== TOTAL) {
    errors.push(prefix + 'card count expected ' + TOTAL + ', got ' + cards.length);
  }

  const svgCount = (html.match(/<svg viewBox="0 0 48 48"/g) || []).length;
  if (svgCount !== TOTAL) {
    errors.push(prefix + 'icon SVG count expected ' + TOTAL + ', got ' + svgCount);
  }

  const sectionRe = /<section class="cat" id="([^"]+)"[\s\S]*?<span class="count">(\d+)<\/span>[\s\S]*?<\/section>/g;
  const categoryCounts = {};
  let sectionMatch;
  while ((sectionMatch = sectionRe.exec(html)) !== null) {
    const id = sectionMatch[1];
    const declared = Number(sectionMatch[2]);
    const actual = (sectionMatch[0].match(/<article class="tool-card"/g) || []).length;
    categoryCounts[id] = actual;
    if (declared !== actual) {
      errors.push(prefix + 'category ' + id + ' count label ' + declared + ' != cards ' + actual);
    }
    if (actual !== EXPECTED_COUNTS[id]) {
      errors.push(prefix + 'category ' + id + ' expected ' + EXPECTED_COUNTS[id] + ', got ' + actual);
    }
  }
  CATEGORY_ORDER.forEach(function (id) {
    if (!(id in categoryCounts)) {
      errors.push(prefix + 'missing category section ' + id);
    }
  });

  const jumpRe = /<a href="#([^"]+)">[^<]*<span>(\d+)<\/span><\/a>/g;
  const jumpCounts = {};
  let jumpMatch;
  while ((jumpMatch = jumpRe.exec(html)) !== null) {
    jumpCounts[jumpMatch[1]] = Number(jumpMatch[2]);
  }
  CATEGORY_ORDER.forEach(function (id) {
    if (jumpCounts[id] !== EXPECTED_COUNTS[id]) {
      errors.push(prefix + 'jump count for ' + id + ' expected ' + EXPECTED_COUNTS[id] + ', got ' + jumpCounts[id]);
    }
  });

  const ldRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/;
  const ldMatch = html.match(ldRe);
  if (!ldMatch) {
    errors.push(prefix + 'missing JSON-LD');
  } else {
    try {
      const ld = JSON.parse(ldMatch[1]);
      const list = ld.mainEntity;
      if (!list || list['@type'] !== 'ItemList') {
        errors.push(prefix + 'JSON-LD mainEntity is not ItemList');
      } else {
        if (list.numberOfItems !== TOTAL) {
          errors.push(prefix + 'JSON-LD numberOfItems expected ' + TOTAL + ', got ' + list.numberOfItems);
        }
        if (!Array.isArray(list.itemListElement) || list.itemListElement.length !== TOTAL) {
          errors.push(
            prefix +
              'JSON-LD itemListElement expected ' +
              TOTAL +
              ', got ' +
              (Array.isArray(list.itemListElement) ? list.itemListElement.length : 'not an array')
          );
        } else {
          list.itemListElement.forEach(function (item, index) {
            if (item.position !== index + 1) {
              errors.push(prefix + 'JSON-LD position mismatch at index ' + index);
            }
            if (!item.name || !item.url) {
              errors.push(prefix + 'JSON-LD item missing name/url at index ' + index);
            }
            if (item.url !== 'https://hhfa008.github.io' + tools[index].href[lang]) {
              errors.push(prefix + 'JSON-LD url mismatch at position ' + (index + 1));
            }
            if (item.name !== tools[index].name[lang]) {
              errors.push(prefix + 'JSON-LD name mismatch at position ' + (index + 1));
            }
          });
        }
      }
    } catch (error) {
      errors.push(prefix + 'JSON-LD is not valid JSON: ' + error.message);
    }
  }

  cards.forEach(function (card, index) {
    const tool = tools[index];
    const hrefSlugMatch = card.href.match(/^\/tools\/([a-z0-9-]+)\//);
    const hrefSlug = hrefSlugMatch ? hrefSlugMatch[1] : '';
    if (hrefSlug !== tool.slug) {
      errors.push(prefix + 'card ' + (index + 1) + ' href slug ' + hrefSlug + ' != ' + tool.slug);
    }
    if (card.search.indexOf(tool.slug) === -1) {
      errors.push(prefix + 'card ' + tool.slug + ' data-search missing slug');
    }
  });

  const externalChecks = [
    { name: 'script src', re: /<script\b[^>]*\bsrc\s*=/i },
    { name: 'stylesheet link', re: /<link\b[^>]*\brel=["']stylesheet["']/i },
    { name: '@import', re: /@import/i },
    { name: 'url(http', re: /url\(\s*['"]?https?:/i },
    { name: 'fetch(', re: /\bfetch\s*\(/i },
    { name: 'XMLHttpRequest', re: /XMLHttpRequest/ },
    { name: 'sendBeacon', re: /sendBeacon/ }
  ];
  externalChecks.forEach(function (check) {
    if (check.re.test(html)) {
      errors.push(prefix + 'external request marker found: ' + check.name);
    }
  });

  if (html.indexOf('content-visibility:auto') === -1) {
    errors.push(prefix + 'content-visibility:auto is missing');
  }

  if (lang === 'zh' && (html.indexOf('全部 ' + TOTAL + ' 个工具') === -1 || html.indexOf(TOTAL + ' 个工具均为') === -1)) {
    errors.push(prefix + 'expected total count text in hall note and footer');
  }
}

function main() {
  const errors = [];
  const tools = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const style = fs.readFileSync(STYLE_PATH, 'utf8');
  const templates = {};
  Object.keys(TEMPLATE_PATH).forEach(function (lang) {
    templates[lang] = fs.readFileSync(TEMPLATE_PATH[lang], 'utf8');
  });

  const counts = validateCatalog(tools, errors);

  const stats = { existing: new Set(), pending: new Set(), missing: new Set() };
  ['zh', 'en', 'id'].forEach(function (lang) {
    tools.forEach(function (tool) {
      checkHref(tool, lang, errors, stats);
    });
  });

  const generated = {};
  ['zh', 'en', 'id'].forEach(function (lang) {
    generated[lang] = buildPage(tools, lang, templates[lang], style);
    fs.writeFileSync(OUTPUT_PATH[lang], generated[lang]);
    checkGenerated(generated[lang], lang, tools, errors, stats);
  });

  const orderByLang = {};
  ['zh', 'en', 'id'].forEach(function (lang) {
    const re = /<article class="tool-card" data-search="[^"]*">[\s\S]*?<a class="tool-link" href="\/tools\/([a-z0-9-]+)\//g;
    const slugs = [];
    let m;
    while ((m = re.exec(generated[lang])) !== null) slugs.push(m[1]);
    orderByLang[lang] = slugs;
  });
  ['en', 'id'].forEach(function (lang) {
    if (orderByLang[lang].join(',') !== orderByLang.zh.join(',')) {
      errors.push('[' + lang + '] card order differs from zh');
    }
  });

  console.log('Catalog: ' + tools.length + ' tools, ' + Object.keys(counts).length + ' categories');
  CATEGORY_ORDER.forEach(function (id) {
    console.log('  ' + id + ': ' + counts[id] + ' (expected ' + EXPECTED_COUNTS[id] + ')');
  });
  console.log('Existing tool pages: ' + stats.existing.size);
  console.log('Pending tool pages: ' + stats.missing.size);
  if (stats.missing.size) {
    console.log('  pending slugs: ' + Array.from(stats.missing).sort().join(', '));
  }
  ['zh', 'en', 'id'].forEach(function (lang) {
    const cardCount = (generated[lang].match(/<article class="tool-card"/g) || []).length;
    const list = JSON.parse(generated[lang].match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]).mainEntity;
    console.log(
      '  ' + lang + ': cards=' + cardCount + ', ItemList=' + list.itemListElement.length + ', numberOfItems=' + list.numberOfItems
    );
  });

  if (errors.length) {
    console.error('\nSELF-CHECK FAILED (' + errors.length + '):');
    errors.forEach(function (error) {
      console.error('  - ' + error);
    });
    process.exit(1);
  }

  console.log('\nSELF-CHECK PASS: 100 cards, 9 categories, ItemList 100, unique slugs, valid hrefs, zero external requests.');
}

main();
