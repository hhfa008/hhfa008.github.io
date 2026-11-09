'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const TESTS_DIR = path.dirname(LIB_DIR);
export const ROOT = path.dirname(TESTS_DIR);
export const FIXTURES_DIR = path.join(TESTS_DIR, 'fixtures');

export function rel(abs) {
  return path.relative(ROOT, abs);
}

export function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

export function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

export function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

export function listFiles(relativeDir, predicate) {
  const dir = path.join(ROOT, relativeDir);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  (function walk(current, base) {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const relPath = base ? base + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full, relPath);
      } else if (!predicate || predicate(relPath)) {
        out.push(path.posix.join(relativeDir, relPath));
      }
    }
  })(dir, '');
  return out;
}

/*
 * Probe the first existing module from `candidates` (paths relative to the
 * boardgame root). Returns:
 *   { found, path, abs, mod, api, error }
 * `api` merges named exports with a default object export, so both
 * `export function play()` and `export default { play }` work.
 */
export async function probeModule(candidates, label) {
  const tried = [];
  for (const candidate of candidates) {
    const abs = path.join(ROOT, candidate);
    if (!fs.existsSync(abs)) {
      tried.push(candidate);
      continue;
    }
    try {
      const mod = await import(pathToFileURL(abs).href);
      const api = mod.default && typeof mod.default === 'object'
        ? Object.assign({}, mod.default, mod)
        : mod;
      return { found: true, label: label || candidate, path: candidate, abs: abs, mod: mod, api: api, error: null, tried: tried };
    } catch (err) {
      return { found: true, label: label || candidate, path: candidate, abs: abs, mod: null, api: null, error: err, tried: tried };
    }
  }
  return { found: false, label: label || 'module', path: null, abs: null, mod: null, api: null, error: null, tried: tried };
}

export function pick(api, names) {
  if (!api) return undefined;
  for (const name of names) {
    if (api[name] !== undefined) return api[name];
  }
  return undefined;
}

export function fnOf(api, names) {
  const value = pick(api, names);
  return typeof value === 'function' ? value : undefined;
}

export function nameOf(api, names) {
  if (!api) return undefined;
  for (const name of names) {
    if (api[name] !== undefined) return name;
  }
  return undefined;
}

export function pickFromNames(api, names) {
  const name = nameOf(api, names);
  return name ? { name: name, value: api[name] } : null;
}

export function instantiate(exported, options) {
  if (exported == null) throw new Error('nothing to instantiate');
  if (typeof exported !== 'function') return exported;
  if (/^class[\s{]/.test(Function.prototype.toString.call(exported))) {
    return new exported(options);
  }
  let instance;
  try {
    instance = new exported(options);
  } catch (err) {
    instance = undefined;
  }
  if (instance && typeof instance === 'object') return instance;
  return exported(options);
}

export function hasMethods(value, methods) {
  if (!value || typeof value !== 'object') return false;
  return methods.every(function (method) { return typeof value[method] === 'function'; });
}

export function describeMissing(probe, candidates) {
  const list = candidates && candidates.length ? candidates.join(', ') : 'no candidates';
  return probe && probe.path ? 'found ' + probe.path + ' but API mismatch' : 'none of ' + list + ' exist yet';
}
