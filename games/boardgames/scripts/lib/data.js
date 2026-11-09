'use strict';

/*
 * Shared catalog helpers for fetch-games.js, build.js and test.js.
 * No npm dependencies, no network access.
 */

var fs = require('fs');
var path = require('path');
var schemaLite = require('./schema-lite.js');

var ROOT = path.resolve(__dirname, '..', '..');
var DATA_DIR = path.join(ROOT, 'data');
var PATHS = {
  root: ROOT,
  categories: path.join(DATA_DIR, 'categories.json'),
  games: path.join(DATA_DIR, 'games.json'),
  schema: path.join(ROOT, 'schema', 'game.schema.json'),
  fixture: path.join(ROOT, 'fixtures', 'games-snapshot.json'),
  gstoneAttempt: path.join(ROOT, 'fixtures', 'gstone-attempt.json')
};

var EXPECTED_CATEGORIES = ['euro', 'party', 'ameritrash', 'card', 'two-player', 'family'];
var CATEGORY_FIELDS = ['id', 'zh', 'en', 'desc', 'order'];

function readJSON(file) {
  var raw = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error('invalid JSON in ' + file + ': ' + err.message);
  }
}

function loadCategories() {
  return readJSON(PATHS.categories);
}

function loadGames() {
  return readJSON(PATHS.games);
}

function loadSchema() {
  return readJSON(PATHS.schema);
}

function loadFixture() {
  return readJSON(PATHS.fixture);
}

function validateCategories(categories) {
  var errors = [];
  if (!Array.isArray(categories)) {
    return [{ path: 'categories', message: 'must be an array' }];
  }
  if (categories.length !== EXPECTED_CATEGORIES.length) {
    errors.push({
      path: 'categories',
      message: 'expected ' + EXPECTED_CATEGORIES.length + ' categories, got ' + categories.length
    });
  }
  var ids = [];
  var orders = [];
  categories.forEach(function (cat, i) {
    var at = 'categories[' + i + ']';
    if (!cat || typeof cat !== 'object' || Array.isArray(cat)) {
      errors.push({ path: at, message: 'must be an object' });
      return;
    }
    Object.keys(cat).forEach(function (key) {
      if (CATEGORY_FIELDS.indexOf(key) === -1) {
        errors.push({ path: at, message: 'unexpected property "' + key + '"' });
      }
    });
    CATEGORY_FIELDS.forEach(function (key) {
      if (key === 'order') {
        if (!Number.isInteger(cat.order)) errors.push({ path: at + '.order', message: 'must be an integer' });
      } else if (typeof cat[key] !== 'string' || cat[key].trim() === '') {
        errors.push({ path: at + '.' + key, message: 'must be a non-empty string' });
      }
    });
    if (typeof cat.id === 'string') ids.push(cat.id);
    if (Number.isInteger(cat.order)) orders.push(cat.order);
  });
  ids.forEach(function (id, i) {
    if (ids.indexOf(id) !== i) errors.push({ path: 'categories[' + i + '].id', message: 'duplicate id ' + id });
  });
  orders.forEach(function (order, i) {
    if (orders.indexOf(order) !== i) errors.push({ path: 'categories[' + i + '].order', message: 'duplicate order ' + order });
  });
  EXPECTED_CATEGORIES.forEach(function (id) {
    if (ids.indexOf(id) === -1) errors.push({ path: 'categories', message: 'missing category id ' + id });
  });
  orders.slice().sort(function (a, b) { return a - b; }).forEach(function (order, i) {
    if (order !== i + 1) {
      errors.push({ path: 'categories', message: 'order values must be 1..' + EXPECTED_CATEGORIES.length + ', got ' + JSON.stringify(orders) });
    }
  });
  return errors;
}

function parseBestPlayers(bestPlayers) {
  if (typeof bestPlayers === 'string') {
    var parts = bestPlayers.split('-').map(Number);
    return [parts[0], parts.length > 1 ? parts[1] : parts[0]];
  }
  if (Array.isArray(bestPlayers)) {
    var nums = bestPlayers.map(Number);
    return [nums[0], nums.length > 1 ? nums[1] : nums[0]];
  }
  return [NaN, NaN];
}

function validDateString(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  var d = new Date(value + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function validateGames(categories, games, schema) {
  var errors = [];
  if (!Array.isArray(games)) {
    return [{ path: 'games', message: 'must be an array' }];
  }
  if (games.length < 30) {
    errors.push({ path: 'games', message: 'expected at least 30 games, got ' + games.length });
  }

  var validCategoryIds = categories.map(function (c) { return c.id; });
  var ids = Object.create(null);
  var slugs = Object.create(null);
  var usedCats = Object.create(null);

  games.forEach(function (game, i) {
    var at = 'games[' + i + ']';
    errors = errors.concat(schemaLite.validate(game, schema, at));
    if (!game || typeof game !== 'object' || Array.isArray(game)) return;

    if (typeof game.id === 'string') {
      if (ids[game.id]) errors.push({ path: at + '.id', message: 'duplicate id ' + game.id });
      ids[game.id] = (ids[game.id] || 0) + 1;
    }
    if (typeof game.slug === 'string') {
      if (slugs[game.slug]) errors.push({ path: at + '.slug', message: 'duplicate slug ' + game.slug });
      slugs[game.slug] = (slugs[game.slug] || 0) + 1;
    }

    if (Array.isArray(game.categories)) {
      game.categories.forEach(function (cat) {
        if (validCategoryIds.indexOf(cat) === -1) {
          errors.push({ path: at + '.categories', message: 'unknown category ' + cat });
        }
        usedCats[cat] = true;
      });
    }

    if (Number.isInteger(game.playersMin) && Number.isInteger(game.playersMax) && game.playersMin > game.playersMax) {
      errors.push({ path: at, message: 'playersMin must not exceed playersMax' });
    }
    if (Number.isInteger(game.playTimeMin) && Number.isInteger(game.playTimeMax) && game.playTimeMin > game.playTimeMax) {
      errors.push({ path: at, message: 'playTimeMin must not exceed playTimeMax' });
    }

    var range = parseBestPlayers(game.bestPlayers);
    if (!isNaN(range[0]) && !isNaN(range[1])) {
      if (range[0] > range[1]) {
        errors.push({ path: at + '.bestPlayers', message: 'bestPlayers range is reversed' });
      }
      if (Number.isInteger(game.playersMin) && range[0] < game.playersMin) {
        errors.push({ path: at + '.bestPlayers', message: 'bestPlayers below playersMin' });
      }
      if (Number.isInteger(game.playersMax) && range[1] > game.playersMax) {
        errors.push({ path: at + '.bestPlayers', message: 'bestPlayers above playersMax' });
      }
    }

    if (game.cover && typeof game.cover.gradient === 'string') {
      if (/https?:/i.test(game.cover.gradient) || /url\s*\(/i.test(game.cover.gradient)) {
        errors.push({ path: at + '.cover.gradient', message: 'cover must be a local gradient, not a remote URL' });
      }
    }

    if (game.source && !validDateString(game.source.fetchedAt)) {
      errors.push({ path: at + '.source.fetchedAt', message: 'must be a valid YYYY-MM-DD date' });
    }
    if (game.source && game.source.url != null && !/^https:\/\//.test(game.source.url)) {
      errors.push({ path: at + '.source.url', message: 'source url must be https or null' });
    }
  });

  EXPECTED_CATEGORIES.forEach(function (id) {
    if (!usedCats[id]) errors.push({ path: 'games', message: 'no game uses category ' + id });
  });

  return errors;
}

function validateCatalog(categories, games, schema) {
  return validateCategories(categories).concat(validateGames(categories, games, schema));
}

function categoryMap(categories) {
  var map = Object.create(null);
  categories.forEach(function (cat) { map[cat.id] = cat; });
  return map;
}

function formatPlayers(game) {
  if (game.playersMin === game.playersMax) return game.playersMin + ' 人';
  return game.playersMin + '–' + game.playersMax + ' 人';
}

function formatBestPlayers(game) {
  var range = parseBestPlayers(game.bestPlayers);
  if (isNaN(range[0])) return '暂无';
  if (range[0] === range[1]) return range[0] + ' 人';
  return range[0] + '–' + range[1] + ' 人';
}

function formatTime(game) {
  if (game.playTimeMin === game.playTimeMax) return game.playTimeMin + ' 分钟';
  return game.playTimeMin + '–' + game.playTimeMax + ' 分钟';
}

function formatWeight(game) {
  return typeof game.weight === 'number' ? game.weight.toFixed(1) : '暂无';
}

function formatRating(game) {
  return typeof game.rating === 'number' ? game.rating.toFixed(1) : '暂无';
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function searchText(game, catMap) {
  var labels = game.categories.map(function (id) { return catMap[id] ? catMap[id].zh + ' ' + catMap[id].en : id; });
  return [
    game.slug,
    game.name,
    game.nameOriginal,
    game.description || '',
    labels.join(' '),
    (game.designers || []).join(' '),
    (game.publishers || []).join(' '),
    game.year == null ? '' : String(game.year)
  ].join(' ').toLowerCase();
}

function countByCategory(games) {
  var counts = Object.create(null);
  EXPECTED_CATEGORIES.forEach(function (id) { counts[id] = 0; });
  games.forEach(function (game) {
    (game.categories || []).forEach(function (id) {
      if (counts[id] !== undefined) counts[id]++;
    });
  });
  return counts;
}

module.exports = {
  ROOT: ROOT,
  PATHS: PATHS,
  EXPECTED_CATEGORIES: EXPECTED_CATEGORIES,
  readJSON: readJSON,
  loadCategories: loadCategories,
  loadGames: loadGames,
  loadSchema: loadSchema,
  loadFixture: loadFixture,
  validateCategories: validateCategories,
  validateGames: validateGames,
  validateCatalog: validateCatalog,
  parseBestPlayers: parseBestPlayers,
  categoryMap: categoryMap,
  formatPlayers: formatPlayers,
  formatBestPlayers: formatBestPlayers,
  formatTime: formatTime,
  formatWeight: formatWeight,
  formatRating: formatRating,
  escapeHtml: escapeHtml,
  searchText: searchText,
  countByCategory: countByCategory
};
