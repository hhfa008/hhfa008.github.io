'use strict';

/*
 * Page parity harness.
 *
 * For every implemented tool we re-extract <script id="engine"> from
 * tools/<id>/index.html, run it inside this Node process with vm, and compare
 * its output with tools/shared/compute.js for the same input. Numbers are
 * compared with a small tolerance so deliberate display rounding in the
 * adapters (2–4 decimals) does not fail the check.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const compute = require(path.join(__dirname, '..', 'shared', 'compute.js'));
const manifest = require(path.join(__dirname, '..', 'manifest.json'));

const ROOT = path.join(__dirname, '..', '..');
const engineCache = Object.create(null);

function loadEngine(id) {
  if (engineCache[id]) return engineCache[id];
  const html = fs.readFileSync(path.join(ROOT, 'tools', id, 'index.html'), 'utf8');
  const match = html.match(/<script[^>]*id="engine"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('engine not found: ' + id);
  const code = '(function () {\n' + match[1] + '\nreturn ToolEngine;\n})()';
  engineCache[id] = vm.runInThisContext(code, { filename: 'tools/' + id + '/engine.js' });
  return engineCache[id];
}

function roundTo(value, places) {
  if (typeof value !== 'number' || !isFinite(value)) return value;
  const f = Math.pow(10, places);
  const abs = Math.abs(value);
  const r = Math.floor(abs * f + 0.5 + 1e-9) / f;
  return value < 0 ? -r : r;
}
const fromCents = c => c / 100;
const pad2 = n => (String(n).length < 2 ? '0' + String(n) : String(n));
const formatDate = p => String(p.y) + '-' + pad2(p.m) + '-' + pad2(p.d);

function seededRandom(seed) {
  let a = Number(seed) >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const refs = {
  'base64-encoder': (E, input) => {
    const action = input.action == null ? 'encode' : input.action;
    if (action === 'encode') {
      const r = E.encodeUtf8(input.text, { urlSafe: input.urlSafe === true });
      return { text: r.value, bytes: r.bytes, urlSafe: input.urlSafe === true };
    }
    const d = E.decodeUtf8(input.text);
    return { text: d.value, bytes: d.bytes, urlSafe: false };
  },

  'case-converter': (E, input) => {
    const mode = input.mode == null ? 'camel' : input.mode;
    return { text: E.convert(mode, input.text).value, mode: mode };
  },

  'slug-generator': (E, input) => {
    const r = E.slugify(input.text, {
      separator: input.separator == null ? '-' : input.separator,
      keepUnicode: input.keepUnicode !== false,
      stopWords: input.stopWords === true,
      maxLength: input.maxLength == null ? 0 : input.maxLength
    });
    return { slug: r.value, tokens: r.tokens };
  },

  'url-encoder': (E, input) => {
    const action = input.action == null ? 'encodeComponent' : input.action;
    if (action === 'parseQuery') return { params: E.parseQuery(input.value).params };
    if (action === 'buildQuery') {
      const r = E.buildQuery(input.pairs);
      return { value: r.value, params: r.params };
    }
    if (action === 'parse') {
      const u = E.parseUrl(input.value);
      return {
        protocol: u.protocol, host: u.host, path: u.path, query: u.query,
        hash: u.hash, params: u.params, hasQuery: u.hasQuery
      };
    }
    const fn = { encodeComponent: E.encodeComponent, encodeUri: E.encodeUri,
      decodeComponent: E.decodeComponent, decodeUri: E.decodeUri }[action];
    return { value: fn(input.value).value, action: action };
  },

  'html-entity-encoder': (E, input) => {
    const action = input.action == null ? 'escape' : input.action;
    if (action === 'escape' || action === 'encode') {
      return { text: E.escapeHtml(input.text, input.mode == null ? 'named' : input.mode, input.nonAscii === true).value, action: 'escape' };
    }
    if (action === 'unescape' || action === 'decode') return { text: E.unescapeHtml(input.text).value, action: 'unescape' };
    return { text: E.toNumericEntities(input.text).value, action: 'numeric' };
  },

  'csv-to-json': (E, input) => {
    const rows = E.parseCsv(input.csv, { delimiter: input.delimiter == null ? ',' : input.delimiter }).rows;
    const j = E.toJson(rows, {
      hasHeader: input.hasHeader !== false,
      inferTypes: input.inferTypes === true,
      nested: input.nested === true
    });
    return { data: j.data, columns: j.columns, warnings: j.warnings, rowCount: j.data.length };
  },

  'json-to-csv': (E, input) => {
    const value = typeof input.json === 'string' ? E.parseJson(input.json).value : input.data;
    const c = E.toCsv(value, {
      delimiter: input.delimiter == null ? ',' : input.delimiter,
      header: input.header !== false,
      flatten: input.flatten !== false,
      bom: input.bom === true
    });
    return { csv: c.csv, columns: c.columns, rowCount: c.rowCount, warnings: c.warnings };
  },

  'json-formatter': (E, input) => {
    const opts = { indent: input.indent == null ? 2 : input.indent, sortKeys: input.sortKeys === true };
    const r = input.minify === true ? E.minify(input.text) : E.formatJson(input.text, opts);
    return { text: r.text, summary: E.summarize(r.value), minified: input.minify === true };
  },

  'json-to-typescript': (E, input) => {
    const parsed = E.parseJsonText(input.text);
    const ts = E.toTypeScript(parsed.value, {
      rootName: input.rootName == null ? 'Root' : input.rootName,
      mode: input.mode == null ? 'interface' : input.mode,
      indent: input.indent == null ? 2 : input.indent,
      export: input.export !== false
    });
    return { typescript: ts.code, rootName: ts.rootName, interfaces: ts.interfaces, fields: ts.fields, rootKind: ts.rootKind };
  },

  'jwt-decoder': (E, input) => {
    const j = E.decodeJwt(input.token);
    const out = {
      header: j.header, payload: j.payload, signature: j.signature,
      signed: j.signed, headerText: j.headerText, payloadText: j.payloadText
    };
    if (input.nowSeconds != null) out.status = E.claimsStatus(j.payload, input.nowSeconds);
    return out;
  },

  'text-diff': (E, input) => {
    const d = E.diffLines(input.a, input.b, {
      ignoreCase: input.ignoreCase === true,
      ignoreWhitespace: input.ignoreWhitespace === true
    });
    return { rows: d.rows, stats: d.stats, unified: E.unifiedText(d.rows).value };
  },

  'color-converter': (E, input) => {
    const rgb = E.parseColor(input.value);
    const hsl = E.rgbToHsl(rgb.r, rgb.g, rgb.b);
    const hsv = E.rgbToHsv(rgb.r, rgb.g, rgb.b);
    const cmyk = E.rgbToCmyk(rgb.r, rgb.g, rgb.b);
    const name = E.colorName(rgb.r, rgb.g, rgb.b);
    return {
      hex: E.rgbToHex(rgb.r, rgb.g, rgb.b).value,
      rgb: { r: rgb.r, g: rgb.g, b: rgb.b },
      hsl: { h: roundTo(hsl.h, 4), s: roundTo(hsl.s, 4), l: roundTo(hsl.l, 4) },
      hsv: { h: roundTo(hsv.h, 4), s: roundTo(hsv.s, 4), v: roundTo(hsv.v, 4) },
      cmyk: { c: roundTo(cmyk.c, 4), m: roundTo(cmyk.m, 4), y: roundTo(cmyk.y, 4), k: roundTo(cmyk.k, 4) },
      name: name.exact ? name.name : null,
      nearestName: name.name,
      contrastBlack: E.contrastRatio(rgb, { r: 0, g: 0, b: 0 }).ratio,
      contrastWhite: E.contrastRatio(rgb, { r: 255, g: 255, b: 255 }).ratio
    };
  },

  'number-base-converter': (E, input) => {
    const r = E.convertBase(input.value, input.fromBase, input.toBase, input.precision == null ? 8 : input.precision);
    return { value: r.value, intText: r.intText, fracText: r.fracText, base: r.base, negative: r.negative, truncated: r.truncated };
  },

  'roman-numeral-converter': (E, input) => {
    const r = E.validate(input.value);
    return { value: r.value, roman: r.roman, lower: r.lower, source: r.source };
  },

  'fraction-calculator': (E, input) => {
    const r = E.compute(input.a, input.op == null ? '+' : input.op, input.b);
    return {
      num: r.num.toString(), den: r.den.toString(),
      fraction: E.formatFraction(r.num, r.den),
      mixed: { whole: r.mixed.whole.toString(), num: r.mixed.num.toString(), den: r.mixed.den.toString() },
      decimal: E.toDecimal(r.num, r.den, input.places == null ? 10 : input.places)
    };
  },

  'percentage-calculator': (E, input) => {
    const mode = input.mode == null ? 'of' : input.mode;
    if (mode === 'of') return { mode: mode, value: E.percentOf(input.a, input.b).value };
    if (mode === 'whatPercent') return { mode: mode, value: E.whatPercent(input.a, input.b).value };
    if (mode === 'change') {
      const r = E.percentChange(input.a, input.b);
      return { mode: mode, value: r.value, direction: r.direction };
    }
    return { mode: mode, value: E.applyPercent(input.a, input.b, input.direction == null ? 'increase' : input.direction).value };
  },

  'statistics-calculator': (E, input) => {
    const values = Array.isArray(input.values) ? input.values : E.parseNumbers(input.text).values;
    const r = E.summarize(values).value;
    const sample = input.sample === true;
    return {
      count: r.count, sum: r.sum, mean: r.mean, median: r.median,
      modes: r.modes, min: r.min, max: r.max, range: r.range,
      variance: sample ? r.varianceSample : r.variancePopulation,
      stdev: sample ? r.stdevSample : r.stdevPopulation,
      q1: r.q1, q2: r.q2, q3: r.q3, iqr: r.iqr, sorted: r.sorted
    };
  },

  'unit-converter': (E, input) => {
    if (input.to == null || input.to === '') {
      return { category: input.category, from: input.from, units: E.convertAll(input.category, input.value, input.from).value };
    }
    return { category: input.category, from: input.from, to: input.to, value: E.convert(input.category, input.value, input.from, input.to).value };
  },

  'cooking-converter': (E, input) => {
    const r = E.convertIngredient(input.amount, input.from, input.to, input.ingredient == null ? 'water' : input.ingredient);
    return { value: r.value, ml: r.ml, grams: r.grams, density: r.density, fromKind: r.fromKind, toKind: r.toKind };
  },

  'paper-size-converter': (E, input) => {
    const mode = input.mode == null ? 'size' : input.mode;
    if (mode === 'size') {
      const s = E.paperSize(input.name);
      return { name: s.name, widthMm: s.widthMm, heightMm: s.heightMm, group: s.group };
    }
    if (mode === 'pixels') {
      const p = E.paperPixels(input.name, input.dpi == null ? 96 : input.dpi);
      return { name: p.name, widthMm: p.widthMm, heightMm: p.heightMm, widthPx: p.widthPx, heightPx: p.heightPx, dpi: p.dpi };
    }
    const r = E.scaleRatio(input.source, input.target);
    return { source: r.source, target: r.target, widthRatio: r.widthRatio, heightRatio: r.heightRatio, fitScale: r.fitScale, areaRatio: r.areaRatio, fitsWithoutScaling: r.fitsWithoutScaling };
  },

  'aspect-ratio-calculator': (E, input) => {
    if (input.mode === 'scale') {
      const s = E.scale(input.width, input.height, input.target, input.which == null ? 'width' : input.which);
      return { mode: 'scale', width: s.width, height: s.height, scale: s.scale, which: s.which };
    }
    const mode = input.mode == null ? 'ratio' : input.mode;
    const req = { mode: mode };
    if (mode === 'ratio') { req.width = input.width; req.height = input.height; }
    else if (mode === 'height') { req.width = input.width; req.ratioW = input.ratioW; req.ratioH = input.ratioH; }
    else { req.height = input.height; req.ratioW = input.ratioW; req.ratioH = input.ratioH; }
    const r = E.solve(req);
    return { mode: r.mode, width: r.width, height: r.height, ratioW: r.ratioW, ratioH: r.ratioH, decimal: r.decimal };
  },

  'loan-calculator': (E, input) => {
    const opts = {
      principal: input.principal, annualRate: input.annualRate, months: input.months,
      extra: input.extra == null ? 0 : input.extra,
      method: input.method == null ? 'annuity' : input.method
    };
    const s = E.summarize(opts);
    const monthly = opts.method === 'annuity'
      ? E.monthlyPayment(opts.principal, opts.annualRate, opts.months)
      : E.equalPrincipalFirstPayment(opts.principal, opts.annualRate, opts.months);
    return {
      monthlyPayment: roundTo(monthly, 2), firstPayment: fromCents(s.firstPayment),
      totalInterest: fromCents(s.totalInterest), totalPayment: fromCents(s.totalPayment),
      totalPrincipal: fromCents(s.totalPrincipal), totalExtra: fromCents(s.totalExtra),
      actualMonths: s.actualMonths, interestRatio: roundTo(s.interestRatio, 6),
      extraInterestSaved: fromCents(s.extraInterestSaved), extraMonthsSaved: s.extraMonthsSaved,
      method: s.method
    };
  },

  'compound-interest-calculator': (E, input) => {
    const r = E.compound(input.principal, input.annualRatePct, input.years,
      input.freq == null ? 12 : input.freq, input.monthlyAdd == null ? 0 : input.monthlyAdd);
    return { final: r.final, interest: r.interest, principalTotal: r.principalTotal, deposits: r.deposits, schedule: r.schedule };
  },

  'savings-goal-calculator': (E, input) => {
    const mode = input.mode == null ? 'plan' : input.mode;
    const target = input.target, current = input.current == null ? 0 : input.current;
    const rate = input.annualRatePct == null ? 0 : input.annualRatePct;
    if (mode === 'plan') {
      const p = E.monthlyNeeded(target, current, rate, input.months);
      return { mode: mode, achieved: p.achieved, monthly: p.monthly, exactMonthly: p.exactMonthly, projected: p.projected, totalDeposits: p.totalDeposits, interest: p.interest };
    }
    const d = E.monthsToGoal(target, current, rate, input.monthly);
    return { mode: mode, achieved: d.achieved, months: d.months, exactMonths: d.exactMonths, projected: d.projected, totalDeposits: d.totalDeposits, interest: d.interest };
  },

  'roi-calculator': (E, input) => {
    const r = E.compute({ costCents: Math.round(input.cost * 100), returnCents: Math.round(input.return * 100), years: input.years });
    return { netGain: fromCents(r.netGainCents), roiPct: r.roiPct, annualizedPct: r.annualizedPct, multiple: r.multiple, verdict: r.verdict };
  },

  'vat-calculator': (E, input) => {
    const mode = input.mode == null ? 'add' : input.mode;
    const r = mode === 'add' ? E.addVat(input.amount, input.ratePct) : E.extractVat(input.amount, input.ratePct);
    return { mode: r.mode, net: r.net, tax: r.tax, gross: r.gross };
  },

  'profit-margin-calculator': (E, input) => {
    const mode = input.mode == null ? 'calc' : input.mode;
    const r = mode === 'calc'
      ? E.compute({ mode: 'calc', costCents: Math.round(input.cost * 100), priceCents: Math.round(input.price * 100) })
      : E.compute({ mode: 'target', costCents: Math.round(input.cost * 100), targetMarginPct: input.targetMarginPct });
    return { grossProfit: fromCents(r.grossProfitCents), marginPct: r.marginPct, markupPct: r.markupPct, price: fromCents(r.priceCents), priceCents: r.priceCents };
  },

  'bmi-calculator': (E, input) => {
    const bmi = E.bmi(input.weightKg, input.heightCm);
    const range = E.healthyWeightRange(input.heightCm);
    const cat = E.bmiCategory(bmi);
    const out = {
      bmi: roundTo(bmi, 4),
      category: cat === 'under' ? 'underweight' : cat === 'over' ? 'overweight' : cat,
      healthyMinKg: roundTo(range.min, 4), healthyMaxKg: roundTo(range.max, 4)
    };
    if (input.sex != null && input.age != null) {
      const bmr = E.bmrMifflin(input.sex, input.weightKg, input.heightCm, input.age);
      const tdee = E.tdee(bmr, input.activity == null ? 'sedentary' : input.activity);
      const targets = E.calorieTargets(tdee);
      out.bmr = roundTo(bmr, 2);
      out.tdee = roundTo(tdee, 2);
      out.calorieTargets = {
        maintain: roundTo(targets.maintain, 0), mildLoss: roundTo(targets.mildLoss, 0),
        loss: roundTo(targets.loss, 0), gain: roundTo(targets.gain, 0)
      };
    }
    return out;
  },

  'quadratic-solver': (E, input) => {
    const r = E.solveQuadratic(input.a, input.b, input.c);
    return {
      mode: r.mode, discriminant: r.discriminant, roots: r.roots, vertex: r.vertex,
      factor: r.factor, radical: r.radical, sumRoots: r.sumRoots, productRoots: r.productRoots
    };
  },

  'gcd-lcm-calculator': (E, input) => {
    const mode = input.mode == null ? 'gcd' : input.mode;
    const values = typeof input.values === 'string' ? E.parseList(input.values).values : input.values;
    if (mode === 'factorize') {
      const f = E.factorize(values[0]);
      return {
        mode: 'factorize', value: String(values[0]),
        factors: f.factors.map(x => ({ p: x.p.toString(), e: x.e })),
        formatted: E.formatFactors(f.factors), negative: f.negative, one: f.one
      };
    }
    const r = mode === 'gcd' ? E.gcdAll(values) : E.lcmAll(values);
    return { mode: mode, value: r.value.toString(), steps: r.steps };
  },

  'date-calculator': (E, input) => {
    const mode = input.mode == null ? 'diff' : input.mode;
    if (mode === 'diff') return { mode: mode, days: E.diffDays(input.from, input.to) };
    if (mode === 'calendar') return { mode: mode, diff: E.calendarDiff(input.from, input.to) };
    if (mode === 'business') return { mode: mode, days: E.businessDays(input.from, input.to, input.inclusive === true) };
    if (mode === 'add') {
      let d;
      if (input.days != null) d = E.addDays(input.from, input.days);
      else if (input.months != null) d = E.addMonths(input.from, input.months);
      else d = E.addYears(input.from, input.years);
      return { mode: mode, date: formatDate(d), weekday: E.weekdayIndex(d) };
    }
    const a = E.ageOn(input.from, input.to);
    return {
      mode: mode, years: a.years, months: a.months, days: a.days,
      nextBirthday: formatDate(a.nextBirthday), daysToNextBirthday: a.daysToNextBirthday,
      isBirthdayToday: a.isBirthdayToday, isBirthdayTomorrow: a.isBirthdayTomorrow
    };
  },

  'unix-timestamp-converter': (E, input) => {
    let ms, unit;
    if (typeof input.value === 'string') {
      ms = E.parseIso(input.value).value;
      unit = 'iso';
    } else {
      const c = E.toMs(input.value, input.unit == null ? 'auto' : input.unit);
      ms = c.value.ms;
      unit = c.value.unit;
    }
    const out = {
      unixSeconds: Math.floor(ms / 1000), unixMillis: ms,
      isoUtc: E.isoUTC(ms).value, unit: unit
    };
    if (input.offsetMinutes != null) out.isoWithOffset = E.isoWithOffset(ms, input.offsetMinutes).value;
    return out;
  },

  'timezone-converter': (E, input) => {
    const v = E.convertZone(input.local, input.from, input.to).value;
    return {
      epoch: v.epoch, from: E.formatWall(v.from).value, to: E.formatWall(v.to).value,
      offsetFrom: E.formatOffset(v.offsetFrom).value, offsetTo: E.formatOffset(v.offsetTo).value,
      dayDelta: v.dayDelta
    };
  },

  'hash-generator': (E, input) => {
    const algorithm = input.algorithm == null ? 'SHA-256' : input.algorithm;
    return E.hashText(input.text, algorithm, globalThis.crypto).then(r => ({
      algorithm: r.algorithm, bytes: r.bytes, hex: r.hex, base64: r.base64
    }));
  },

  'uuid-generator': (E, input) => {
    const count = input.count == null ? 1 : input.count;
    const rng = input.seed == null ? Math.random : seededRandom(input.seed);
    const r = E.batch(count, { uppercase: input.uppercase === true, hyphens: input.hyphens !== false }, rng);
    return { uuids: r.values, count: r.count };
  }
};

function compare(expected, actual, at, diffs) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const tol = 5e-4 + 1e-9 * Math.abs(expected);
    if (Math.abs(expected - actual) > tol) diffs.push(at + ': ' + actual + ' != ' + expected);
    return;
  }
  if (expected === null || actual === null || expected === undefined || actual === undefined) {
    if (expected !== actual) diffs.push(at + ': ' + actual + ' != ' + expected);
    return;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) {
      diffs.push(at + ': array shape differs');
      return;
    }
    for (let i = 0; i < expected.length; i++) compare(expected[i], actual[i], at + '[' + i + ']', diffs);
    return;
  }
  if (typeof expected === 'object' && typeof actual === 'object') {
    const keys = new Set(Object.keys(expected).concat(Object.keys(actual)));
    keys.forEach(k => compare(expected[k], actual[k], at + '.' + k, diffs));
    return;
  }
  if (expected !== actual) diffs.push(at + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
}

// Compare only the fields a reference returns; extra adapter fields are fine.
function compareSubset(expected, actual, at, diffs) {
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    Object.keys(expected).forEach(k => {
      if (!actual || !(k in actual)) {
        diffs.push(at + '.' + k + ': missing in compute output');
      } else {
        compareSubset(expected[k], actual[k], at + '.' + k, diffs);
      }
    });
    return;
  }
  compare(expected, actual, at, diffs);
}

async function check(id, input) {
  const tool = manifest.tools.find(t => t.id === id);
  if (!tool || !tool.implemented) throw new Error('not implemented: ' + id);
  const E = loadEngine(id);
  const expected = await Promise.resolve(refs[id](E, input));
  const actualRun = await Promise.resolve(compute.run(id, input));
  if (!actualRun.ok) return { id: id, ok: false, diffs: ['compute failed: ' + actualRun.error] };
  const diffs = [];
  compareSubset(expected, actualRun.result, '$', diffs);
  return { id: id, ok: diffs.length === 0, diffs: diffs };
}

module.exports = { check, loadEngine, refs, compare, compareSubset };
