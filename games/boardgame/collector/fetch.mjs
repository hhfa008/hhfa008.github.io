import { readFile, mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { importBggXml } from './import.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = 'https://boardgamegeek.com/xmlapi2/thing';
const USER_AGENT = 'hhfa008.github.io boardgames importer (+https://hhfa008.github.io)';
const DEFAULT_IDS = [13, 822, 30549, 36218, 266192];

function parseArgs(args) {
  const flags = {
    offline: false,
    fixture: 'fixtures/bgg-sample.xml',
    ids: DEFAULT_IDS,
    out: 'out/games.imported.json',
    'raw-dir': 'raw',
    delay: 1000,
    retry: 2,
    timeout: 15000
  };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--offline') {
      flags.offline = true;
      continue;
    }
    const value = args[i + 1];
    switch (flag) {
      case '--fixture':
        flags.fixture = value;
        i++;
        break;
      case '--ids':
        flags.ids = String(value || '').split(',').map(Number).filter(Number.isFinite);
        i++;
        break;
      case '--out':
        flags.out = value;
        i++;
        break;
      case '--raw-dir':
        flags['raw-dir'] = value;
        i++;
        break;
      case '--delay': {
        const n = parseInt(value, 10);
        flags.delay = Number.isFinite(n) ? Math.max(1000, n) : 1000;
        i++;
        break;
      }
      case '--retry': {
        const n = parseInt(value, 10);
        flags.retry = Number.isFinite(n) ? Math.min(3, Math.max(0, n)) : 2;
        i++;
        break;
      }
      case '--timeout': {
        const n = parseInt(value, 10);
        flags.timeout = Number.isFinite(n) && n > 0 ? n : 15000;
        i++;
        break;
      }
    }
  }

  if (!flags.ids.length) flags.ids = DEFAULT_IDS;
  return flags;
}

async function fetchThing(id, rawDir, timeout, retryCount = 0) {
  const url = `${BASE_URL}?id=${id}`;
  const retries = Math.min(3, Math.max(0, retryCount));
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/xml,text/xml'
        },
        signal: controller.signal,
        redirect: 'follow'
      });

      if (response.status === 401 || response.status === 403) {
        const body = await response.text();
        console.error(`BGG authentication error (HTTP ${response.status}): ${(body || 'no body').trim()} — a registered BGG application (Bearer token) is required; see https://boardgamegeek.com/using_the_xml_api`);
        const authError = new Error(`Authentication failed: HTTP ${response.status}`);
        authError.auth = true;
        authError.status = response.status;
        process.exitCode = 3;
        throw authError;
      }

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      const body = await response.text();

      if (!contentType.includes('xml') && !body.trim().startsWith('<?xml') && !body.trim().startsWith('<items')) {
        lastError = new Error('Invalid content type or XML structure');
        if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `bgg-${id}-${timestamp}.xml`;
      const rawPath = resolve(rawDir, filename);
      await mkdir(dirname(rawPath), { recursive: true });
      await writeFile(rawPath, body);

      return { body, rawPath };
    } catch (error) {
      if (error.auth) throw error;
      lastError = error;
      if (attempt >= retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error(`Failed to fetch ID ${id}`);
}

async function importAll(ids, rawDir, outPath, delay, retry, timeout) {
  const rawFiles = [];
  const games = [];
  const startTime = new Date();

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (i > 0) await new Promise(resolve => setTimeout(resolve, delay));

    try {
      const { body, rawPath } = await fetchThing(id, rawDir, timeout, retry);
      rawFiles.push(rawPath);
      const { games: importedGames } = await importBggXml(body);
      games.push(...importedGames);
      console.log(`ID ${id}: ${body.length} bytes, ${importedGames.length} games`);
    } catch (error) {
      console.error(`Failed to fetch ID ${id}: ${error.message}`);
      if (process.exitCode !== 3) process.exitCode = 1;
      throw error;
    }
  }

  const endTime = new Date();
  const data = {
    count: games.length,
    source: 'bgg',
    generatedAt: new Date().toISOString(),
    ids,
    rawFiles,
    games
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(data, null, 2));
  console.log(`Imported ${games.length} games to ${outPath} (${endTime - startTime}ms)`);
}

async function main() {
  const args = process.argv.slice(2);
  const flags = parseArgs(args);

  const fixturePath = resolve(__dirname, flags.fixture);
  const rawDir = resolve(__dirname, flags['raw-dir']);
  const outPath = resolve(__dirname, flags.out);

  if (flags.offline) {
    try {
      const body = await readFile(fixturePath, 'utf8');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `fixture-${timestamp}.xml`;
      const rawPath = resolve(rawDir, filename);
      await mkdir(dirname(rawPath), { recursive: true });
      await writeFile(rawPath, body);
      const { games } = await importBggXml(body);
      const data = {
        count: games.length,
        source: 'bgg',
        generatedAt: new Date().toISOString(),
        ids: flags.ids,
        rawFiles: [rawPath],
        games
      };
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, JSON.stringify(data, null, 2));
      console.log(`Imported ${games.length} games from fixture to ${outPath}`);
    } catch (error) {
      console.error(`Offline mode error: ${error.message}`);
      process.exitCode = 1;
    }
  } else {
    try {
      await importAll(flags.ids, rawDir, outPath, flags.delay, flags.retry, flags.timeout);
    } catch (error) {
      if (!process.exitCode) process.exitCode = 1;
    }
  }
}

export { fetchThing, importAll, main };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Top-level error:', error.message);
    if (!process.exitCode) process.exitCode = 1;
  });
}
