import { readFile, mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// XML Tokenizer
function tokenizeXml(xml) {
  const tokens = [];
  let i = 0;
  while (i < xml.length) {
    if (xml.startsWith('<?xml', i)) {
      const end = xml.indexOf('?>', i);
      if (end === -1) throw new Error('Unterminated XML declaration');
      tokens.push({ type: 'xmldecl', value: xml.slice(i, end + 2) });
      i = end + 2;
    } else if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i);
      if (end === -1) throw new Error('Unterminated comment');
      tokens.push({ type: 'comment', value: xml.slice(i, end + 3) });
      i = end + 3;
    } else if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i);
      if (end === -1) throw new Error('Unterminated CDATA');
      tokens.push({ type: 'cdata', value: xml.slice(i + 9, end) });
      i = end + 3;
    } else if (xml[i] === '<') {
      if (xml[i + 1] === '/') {
        const end = xml.indexOf('>', i);
        if (end === -1) throw new Error('Unterminated closing tag');
        tokens.push({ type: 'closetag', value: xml.slice(i + 2, end) });
        i = end + 1;
      } else {
        const end = xml.indexOf('>', i);
        if (end === -1) throw new Error('Unterminated opening tag');
        const tag = xml.slice(i + 1, end);
        const isSelfClosing = tag.endsWith('/');
        if (isSelfClosing) {
          tokens.push({ type: 'selfclosingtag', value: tag.slice(0, -1) });
        } else {
          tokens.push({ type: 'opentag', value: tag });
        }
        i = end + 1;
      }
    } else {
      const end = xml.indexOf('<', i);
      if (end === -1) {
        tokens.push({ type: 'text', value: xml.slice(i) });
        break;
      } else {
        tokens.push({ type: 'text', value: xml.slice(i, end) });
        i = end;
      }
    }
  }
  return tokens;
}

// XML Parser
function parseXml(xml) {
  const tokens = tokenizeXml(xml);
  const stack = [];
  let root = null;
  let current = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'opentag') {
      const node = { type: 'element', name: '', attributes: {}, children: [] };
      const match = token.value.match(/^(\w+)(?:\s+(.*?))?(\/?)$/);
      if (!match) throw new Error('Invalid tag format');
      node.name = match[1];
      if (match[2]) {
        const attrRegex = /(\w+)\s*=\s*["']([^"']*)["']/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(match[2])) !== null) {
          node.attributes[attrMatch[1]] = unescapeXml(attrMatch[2]);
        }
      }
      if (!root) {
        root = node;
        current = node;
      } else {
        stack.push(current);
        current.children.push(node);
        current = node;
      }
    } else if (token.type === 'selfclosingtag') {
      const node = { type: 'element', name: '', attributes: {}, children: [] };
      const match = token.value.match(/^(\w+)(?:\s+(.*?))?(\/?)$/);
      if (!match) throw new Error('Invalid tag format');
      node.name = match[1];
      if (match[2]) {
        const attrRegex = /(\w+)\s*=\s*["']([^"']*)["']/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(match[2])) !== null) {
          node.attributes[attrMatch[1]] = unescapeXml(attrMatch[2]);
        }
      }
      if (current) {
        current.children.push(node);
      } else {
        root = node;
      }
    } else if (token.type === 'closetag') {
      if (stack.length === 0) {
        // Closing the document root is legal; anything else at depth 0 is not.
        if (current !== root) throw new Error('Unexpected closing tag');
        current = null;
      } else {
        current = stack.pop();
      }
    } else if (token.type === 'text' || token.type === 'cdata') {
      if (current) {
        const raw = token.value.trim();
        const text = token.type === 'text' ? unescapeXml(raw) : raw;
        if (text) {
          current.children.push({ type: 'text', value: text });
        }
      }
    }
  }

  return root;
}

function unescapeXml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (match, code) => String.fromCharCode(parseInt(code, 10)));
}

// BGG XML Parser
function parseBggXml(xml) {
  const root = parseXml(xml);
  if (!root || root.name !== 'items') {
    throw new Error('Invalid BGG XML structure');
  }
  return root.children
    .filter(child => child.name === 'item' && child.attributes.type === 'boardgame')
    .map(item => normalizeItem(item));
}

// Normalize Item
function normalizeItem(itemNode, context = {}) {
  const item = itemNode;
  const id = item.attributes.id;
  if (!id) return null;

  const nameNodes = item.children.filter(c => c.name === 'name');
  const primaryName = nameNodes.find(n => n.attributes.type === 'primary')?.attributes.value || '';
  const altNames = nameNodes.filter(n => n.attributes.type === 'alternate').map(n => n.attributes.value);
  const cjkName = altNames.find(n => /[\u3400-\u9FBF\u3040-\u309F\u30A0-\u30FF]/.test(n)) || primaryName;

  const year = parseInt(item.children.find(c => c.name === 'yearpublished')?.attributes.value || '0', 10);
  const minPlayers = parseInt(item.children.find(c => c.name === 'minplayers')?.attributes.value || '1', 10);
  const maxPlayers = parseInt(item.children.find(c => c.name === 'maxplayers')?.attributes.value || '1', 10);

  const playingTime = parseInt(item.children.find(c => c.name === 'playingtime')?.attributes.value || '0', 10);
  const minPlayTime = parseInt(item.children.find(c => c.name === 'minplaytime')?.attributes.value || '0', 10);
  const maxPlayTime = parseInt(item.children.find(c => c.name === 'maxplaytime')?.attributes.value || '0', 10);

  const minAge = parseInt(item.children.find(c => c.name === 'minage')?.attributes.value || '0', 10);

  const categories = item.children
    .filter(c => c.name === 'link' && c.attributes.type === 'boardgamecategory')
    .map(c => c.attributes.value);
  const mechanics = item.children
    .filter(c => c.name === 'link' && c.attributes.type === 'boardgamemechanic')
    .map(c => c.attributes.value);

  const designers = item.children
    .filter(c => c.name === 'link' && c.attributes.type === 'boardgamedesigner')
    .map(c => c.attributes.value);
  const publishers = item.children
    .filter(c => c.name === 'link' && c.attributes.type === 'boardgamepublisher')
    .map(c => c.attributes.value);

  const stats = item.children.find(c => c.name === 'statistics');
  const ratings = stats?.children.find(c => c.name === 'ratings');
  const avgWeight = parseFloat(ratings?.children.find(c => c.name === 'averageweight')?.attributes.value || '0');
  const avgRating = parseFloat(ratings?.children.find(c => c.name === 'average')?.attributes.value || '0');

  const poll = item.children.find(c => c.name === 'poll' && c.attributes.name === 'suggested_numplayers');
  const bestPlayers = [];
  if (poll) {
    const results = poll.children.filter(c => c.name === 'results');
    const bestVotes = results.reduce((max, r) => {
      const best = r.children.find(c => c.name === 'result' && c.attributes.value === 'Best');
      return Math.max(max, parseInt(best?.attributes.numvotes || '0', 10));
    }, 0);
    results.forEach(r => {
      const best = r.children.find(c => c.name === 'result' && c.attributes.value === 'Best');
      if (parseInt(best?.attributes.numvotes || '0', 10) === bestVotes && bestVotes > 0) {
        const numPlayers = parseInt(r.attributes.numplayers || '0', 10);
        if (/^\d+$/.test(r.attributes.numplayers || '') && !isNaN(numPlayers) && numPlayers > 0) {
          bestPlayers.push(numPlayers);
        }
      }
    });
  }
  bestPlayers.sort((a, b) => a - b);

  const slug = slugify(primaryName);
  const placeholder = `${primaryName.substring(0, 4).toUpperCase()} · ${year}`;

  const category = determineCategory(categories, mechanics, minAge, maxPlayers, avgWeight);

  return {
    id: `bgg-${id}`,
    slug,
    name: {
      zh: cjkName,
      en: primaryName
    },
    originalName: primaryName,
    category,
    players: {
      min: minPlayers,
      max: maxPlayers
    },
    bestPlayers,
    playTime: {
      min: minPlayTime || playingTime,
      max: maxPlayTime || playingTime
    },
    weight: avgWeight,
    rating: avgRating,
    designers,
    publishers,
    year,
    cover: {
      url: null,
      placeholder
    },
    bgg: {
      categories,
      mechanics
    },
    source: {
      site: 'bgg',
      url: `https://boardgamegeek.com/boardgame/${id}`,
      fetchedAt: new Date().toISOString()
    }
  };
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function determineCategory(categories, mechanics, minAge, maxPlayers, weight) {
  if (categories.includes('Card Game') && mechanics.includes('Deck, Bag, and Pool Building')) {
    return 'card';
  }
  if (mechanics.includes('Cooperative Game')) {
    return 'ameritrash';
  }
  if (categories.includes('Party Game') || categories.includes('Word Game')) {
    return 'party';
  }
  if (maxPlayers <= 2) {
    return 'two-player';
  }
  if (minAge <= 8 || (maxPlayers >= 5 && minAge <= 10)) {
    return 'family';
  }
  if (weight >= 2.3) {
    return 'euro';
  }
  return 'family';
}

// Import BGG XML
async function importBggXml(xml, options = {}) {
  const games = parseBggXml(xml).filter(Boolean);
  const warnings = [];
  const seenSlugs = new Map();

  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    const originalSlug = game.slug;
    let counter = 1;
    while (seenSlugs.has(game.slug)) {
      counter++;
      game.slug = `${originalSlug}-${counter}`;
    }
    seenSlugs.set(game.slug, true);
  }

  return { games, warnings };
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  let inputFile = 'fixtures/bgg-sample.xml';
  let outputFile = 'out/games.imported.json';

  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--input') {
      inputFile = args[i + 1];
    } else if (args[i] === '--out') {
      outputFile = args[i + 1];
    }
  }

  try {
    const xml = await readFile(resolve(__dirname, inputFile), 'utf8');
    const { games, warnings } = await importBggXml(xml);
    const outputDir = dirname(resolve(__dirname, outputFile));
    await mkdir(outputDir, { recursive: true });
    const data = {
      count: games.length,
      source: 'bgg',
      generatedAt: new Date().toISOString(),
      games
    };
    await writeFile(resolve(__dirname, outputFile), JSON.stringify(data, null, 2));
    console.log(`Imported ${games.length} games to ${outputFile}`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { parseXml, parseBggXml, normalizeItem, importBggXml };
