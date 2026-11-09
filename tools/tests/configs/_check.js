#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const CATALOG = path.join(DIR, "..", "CATALOG.md");
const EXISTING = new Set([
  "screen-share-calc", "sari-sari-ledger", "percentage-calculator", "unit-converter",
  "loan-calculator", "date-calculator", "bmi-calculator", "text-tools",
  "json-formatter", "password-generator", "tip-splitter", "pomodoro-timer"
]);
const EXTRA = ["cooking-converter"]; // listed in batch allocation, not in numbered detail
const CATEGORIES = new Set([
  "calc-finance", "text-dev", "design-image", "date-time",
  "math", "health", "life-home", "random-fun"
]);

function expectedSlugs() {
  const md = fs.readFileSync(CATALOG, "utf8");
  const slugs = new Set();
  for (const line of md.split("\n")) {
    const m = line.match(/^\d+\.\s+([a-z0-9]+(?:-[a-z0-9]+)*)\s+—/);
    if (m && !EXISTING.has(m[1])) slugs.add(m[1]);
  }
  for (const s of EXTRA) slugs.add(s);
  return slugs;
}

const CATALOG_JSON = JSON.parse(fs.readFileSync(path.join(DIR, "..", "catalog.json"), "utf8"));
const catalogBySlug = new Map(CATALOG_JSON.map((e) => [e.slug, e]));

const expected = expectedSlugs();
const actual = new Set(
  fs.readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
);

const errors = [];
const warnings = [];
const categoryCounts = {};
let files = 0;
let parsed = 0;
let faqTotal = 0;

function fail(msg) { errors.push(msg); }

if (actual.size !== expected.size) {
  fail(`file count: expected ${expected.size}, got ${actual.size}`);
}
for (const s of expected) if (!actual.has(s)) fail(`missing config: ${s}`);
for (const s of actual) if (!expected.has(s)) fail(`unexpected config: ${s}`);

for (const slug of [...actual].sort()) {
  const file = path.join(DIR, slug + ".json");
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    parsed++;
  } catch (e) {
    fail(`${slug}: JSON parse error: ${e.message}`);
    continue;
  }
  files++;

  if (cfg.slug !== slug) fail(`${slug}: slug field is ${JSON.stringify(cfg.slug)}`);
  if (!CATEGORIES.has(cfg.category)) fail(`${slug}: bad category ${JSON.stringify(cfg.category)}`);
  const catalogEntry = catalogBySlug.get(slug);
  if (!catalogEntry) fail(`${slug}: not found in catalog.json`);
  else if (catalogEntry.category !== cfg.category) {
    fail(`${slug}: category ${cfg.category} != catalog ${catalogEntry.category}`);
  }
  categoryCounts[cfg.category] = (categoryCounts[cfg.category] || 0) + 1;

  for (const lang of ["zh", "en", "id"]) {
    const block = cfg[lang];
    if (!block || typeof block !== "object") { fail(`${slug}: missing ${lang}`); continue; }
    for (const key of ["title", "desc", "appTitle", "tagline"]) {
      if (typeof block[key] !== "string" || !block[key].trim()) fail(`${slug}.${lang}.${key}: empty or not string`);
    }
  }

  if (cfg.zh && typeof cfg.zh.title === "string" && cfg.zh.title.length > 34) {
    fail(`${slug}.zh.title: ${cfg.zh.title.length} > 34`);
  }
  for (const lang of ["en", "id"]) {
    if (cfg[lang] && typeof cfg[lang].title === "string" && cfg[lang].title.length > 70) {
      fail(`${slug}.${lang}.title: ${cfg[lang].title.length} > 70`);
    }
  }

  if (cfg.zh && typeof cfg.zh.desc === "string" && (cfg.zh.desc.length < 60 || cfg.zh.desc.length > 90)) {
    fail(`${slug}.zh.desc: ${cfg.zh.desc.length} not in 60-90`);
  }
  for (const lang of ["en", "id"]) {
    const d = cfg[lang] && cfg[lang].desc;
    if (typeof d === "string" && (d.length < 120 || d.length > 180)) {
      fail(`${slug}.${lang}.desc: ${d.length} not in 120-180`);
    }
  }

  if (!Array.isArray(cfg.faqs) || cfg.faqs.length !== 3) {
    fail(`${slug}.faqs: length ${Array.isArray(cfg.faqs) ? cfg.faqs.length : "not array"}, expected 3`);
  } else {
    cfg.faqs.forEach((f, i) => {
      faqTotal++;
      if (!f || typeof f.q !== "string" || !f.q.trim()) fail(`${slug}.faqs[${i}].q: empty`);
      if (!f || typeof f.a !== "string" || !f.a.trim()) fail(`${slug}.faqs[${i}].a: empty`);
      else if (f.a.length < 40 || f.a.length > 120) fail(`${slug}.faqs[${i}].a: ${f.a.length} not in 40-120`);
    });
  }

  if (cfg.category === "health" && cfg.zh && !cfg.zh.desc.includes("仅供参考，不构成医疗建议")) {
    fail(`${slug}: health desc missing medical disclaimer`);
  }
  if (cfg.category === "calc-finance" && cfg.zh && !cfg.zh.desc.includes("仅为估算，不构成财务建议")) {
    fail(`${slug}: finance desc missing financial disclaimer`);
  }
  if (cfg.category === "design-image" && cfg.zh && !cfg.zh.desc.includes("不上传")) {
    fail(`${slug}: image desc missing local/no-upload statement`);
  }
  if (Array.isArray(cfg.faqs)) {
    const allAnswers = cfg.faqs.map((f) => f && f.a).join("\n");
    if (cfg.category === "health" && !allAnswers.includes("仅供参考，不构成医疗建议")) {
      fail(`${slug}: health FAQ missing medical disclaimer`);
    }
    if (cfg.category === "calc-finance" && !allAnswers.includes("仅为估算，不构成财务建议")) {
      fail(`${slug}: finance FAQ missing financial disclaimer`);
    }
    if (cfg.category === "design-image" && !(allAnswers.includes("本地") && allAnswers.includes("不上传"))) {
      fail(`${slug}: image FAQ missing local/no-upload statement`);
    }
  }
  if (cfg.zh && cfg.zh.desc && (!cfg.zh.desc.includes("本地") || !cfg.zh.desc.includes("无需注册"))) {
    fail(`${slug}: zh.desc missing local/no-sign-up statement`);
  }
  if (cfg.en && cfg.en.desc) {
    const d = cfg.en.desc.toLowerCase();
    if (!d.includes("local") || !d.includes("no sign-up")) fail(`${slug}: en.desc missing local/no-sign-up statement`);
  }
  if (cfg.id && cfg.id.desc) {
    const d = cfg.id.desc.toLowerCase();
    if (!d.includes("lokal") || !d.includes("tanpa daftar")) fail(`${slug}: id.desc missing local/no-sign-up statement`);
  }
}

console.log(`files parsed: ${files}/${parsed} (json files found: ${actual.size})`);
console.log(`expected slugs: ${expected.size}`);
console.log(`faq entries: ${faqTotal}`);
console.log("category counts:", categoryCounts);
if (warnings.length) {
  console.log(`WARNINGS (${warnings.length}):`);
  warnings.forEach((w) => console.log("  -", w));
}
if (errors.length) {
  console.log(`FAILURES (${errors.length}):`);
  errors.forEach((e) => console.log("  -", e));
  process.exitCode = 1;
} else {
  console.log("ALL CHECKS PASSED");
}
