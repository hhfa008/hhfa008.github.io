/*
 * Carcassonne（卡卡颂）纯规则引擎 — UMD
 *
 * 无 DOM、无网络。浏览器里挂到 globalThis.CarcassonneEngine，Node 里
 * require('./engine.js') 直接测试。页面和测试共用同一份规则。
 *
 * 简化点（详见 rules.html）：
 *   - 60 分左右的基础版规则，不做盾牌、双倍城市、商品等扩展；
 *   - 路口按“每条岔路在路口终止”处理，即路口瓦片的各条道路彼此独立；
 *   - 农夫终局计分：农田区域每座相邻的已完成城市 3 分，按农夫多数；
 *   - 未完成城市/道路终局每块瓦片 1 分；未完成修道院 1 + 已占邻格数。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.CarcassonneEngine = factory(root.CarcassonneData);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DATA) {
  'use strict';

  var DIR_NAMES = ['N', 'E', 'S', 'W'];
  var DX = [0, 1, 0, -1];
  var DY = [-1, 0, 1, 0];

  var BY_ID = Object.create(null);
  DATA.TILES.forEach(function (t) { BY_ID[t.id] = t; });

  function opposite(dir) { return (dir + 2) % 4; }
  function normalizeRot(rot) { return ((rot % 4) + 4) % 4; }
  function boardKey(x, y) { return x + ',' + y; }
  function parseKey(key) {
    var parts = String(key).split(',');
    return { x: Number(parts[0]), y: Number(parts[1]) };
  }
  function inBounds(x, y) {
    return x >= DATA.BOARD_MIN && x <= DATA.BOARD_MAX && y >= DATA.BOARD_MIN && y <= DATA.BOARD_MAX;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rng) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  /* ------------------------------------------------------------------ */
  /* 瓦片实例                                                            */
  /* ------------------------------------------------------------------ */

  function makeTile(def, rot) {
    if (!def) throw new Error('未知瓦片');
    rot = normalizeRot(rot || 0);
    var tile = {
      tileId: def.id,
      name: def.name,
      rot: rot,
      edges: [0, 1, 2, 3].map(function (dir) {
        return def.edges[(dir - rot + 4) % 4];
      }),
      cities: def.cities.map(function (g) {
        return g.map(function (d) { return (d + rot) % 4; });
      }),
      roads: def.roads.map(function (g) {
        return g.map(function (d) { return (d + rot) % 4; });
      }),
      fields: def.fields.map(function (g) {
        return g.map(function (d) { return (d + rot) % 4; });
      }),
      fieldAdj: def.fieldAdj.map(function (list) { return list.slice(); }),
      monastery: !!def.monastery,
      cityAt: [-1, -1, -1, -1],
      roadAt: [-1, -1, -1, -1],
      fieldAt: [-1, -1, -1, -1],
      meeples: []
    };
    ['cities', 'roads', 'fields'].forEach(function (name) {
      var at = name === 'cities' ? 'cityAt' : (name === 'roads' ? 'roadAt' : 'fieldAt');
      tile[name].forEach(function (group, gi) {
        group.forEach(function (dir) { tile[at][dir] = gi; });
      });
    });
    return tile;
  }

  function putTile(state, tileId, x, y, rot) {
    var def = BY_ID[tileId];
    if (!def) throw new Error('未知瓦片：' + tileId);
    if (!inBounds(x, y)) throw new Error('坐标超出棋盘范围');
    var key = boardKey(x, y);
    if (state.board[key]) throw new Error('该位置已有瓦片');
    var tile = makeTile(def, rot);
    tile.x = x;
    tile.y = y;
    tile.key = key;
    state.board[key] = tile;
    return tile;
  }

  function __putTile(state, tileId, x, y, rot) {
    return putTile(state, tileId, x, y, rot);
  }

  /* ------------------------------------------------------------------ */
  /* 放置合法性                                                          */
  /* ------------------------------------------------------------------ */

  function canPlaceInstance(state, tile, x, y) {
    if (!inBounds(x, y)) return { ok: false, reason: '坐标超出棋盘范围' };
    var key = boardKey(x, y);
    if (state.board[key]) return { ok: false, reason: '该位置已有瓦片' };
    var neighbours = 0;
    for (var dir = 0; dir < 4; dir++) {
      var nk = boardKey(x + DX[dir], y + DY[dir]);
      var nb = state.board[nk];
      if (!nb) continue;
      neighbours++;
      if (tile.edges[dir] !== nb.edges[opposite(dir)]) {
        return { ok: false, reason: '边不匹配：' + DIR_NAMES[dir] + ' 边是 ' + tile.edges[dir] };
      }
    }
    if (!neighbours) return { ok: false, reason: '必须与已有瓦片相邻' };
    return { ok: true, reason: '' };
  }

  function canPlaceTile(state, tileId, rot, x, y) {
    var def = BY_ID[tileId];
    if (!def) return { ok: false, reason: '未知瓦片' };
    return canPlaceInstance(state, makeTile(def, rot), x, y);
  }

  function frontier(state) {
    var out = [];
    var seen = Object.create(null);
    Object.keys(state.board).forEach(function (key) {
      var p = parseKey(key);
      for (var dir = 0; dir < 4; dir++) {
        var nx = p.x + DX[dir], ny = p.y + DY[dir];
        if (!inBounds(nx, ny)) continue;
        var nk = boardKey(nx, ny);
        if (state.board[nk] || seen[nk]) continue;
        seen[nk] = true;
        out.push({ x: nx, y: ny });
      }
    });
    out.sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });
    return out;
  }

  function getLegalPlacements(state, tileId, rot) {
    var def = BY_ID[tileId];
    if (!def) return [];
    var rots = rot == null ? [0, 1, 2, 3] : [normalizeRot(rot)];
    var cells = frontier(state);
    var out = [];
    rots.forEach(function (r) {
      var tile = makeTile(def, r);
      cells.forEach(function (cell) {
        if (canPlaceInstance(state, tile, cell.x, cell.y).ok) {
          out.push({ x: cell.x, y: cell.y, rot: r });
        }
      });
    });
    return out;
  }

  function hasAnyLegalPlacement(state, tileId) {
    for (var rot = 0; rot < 4; rot++) {
      if (getLegalPlacements(state, tileId, rot).length) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* 区域连通与计分                                                      */
  /* ------------------------------------------------------------------ */

  var META = {
    city: { groups: 'cities', at: 'cityAt' },
    road: { groups: 'roads', at: 'roadAt' },
    field: { groups: 'fields', at: 'fieldAt' }
  };

  function traverseComponent(state, startKey, kind, startGroup) {
    var meta = META[kind];
    if (!meta) throw new Error('未知区域类型：' + kind);
    var queue = [{ key: startKey, group: startGroup }];
    var seen = Object.create(null);
    var nodes = [];
    var tiles = Object.create(null);
    var openEdges = [];
    var meeples = [];

    while (queue.length) {
      var item = queue.shift();
      var id = item.key + '#' + item.group;
      if (seen[id]) continue;
      seen[id] = true;
      var tile = state.board[item.key];
      if (!tile) continue;
      var groups = tile[meta.groups];
      var edges = groups && groups[item.group];
      if (!edges) continue;
      nodes.push({ key: item.key, group: item.group, edges: edges });
      tiles[item.key] = true;
      tile.meeples.forEach(function (m) {
        if (m.kind === kind && m.group === item.group) {
          meeples.push({ key: item.key, meeple: m });
        }
      });
      for (var i = 0; i < edges.length; i++) {
        var dir = edges[i];
        var nx = tile.x + DX[dir];
        var ny = tile.y + DY[dir];
        var nk = boardKey(nx, ny);
        var nb = state.board[nk];
        var nkGroup = nb ? nb[meta.at][opposite(dir)] : -1;
        if (nkGroup == null || nkGroup < 0) {
          openEdges.push(item.key + ':' + dir);
        } else {
          queue.push({ key: nk, group: nkGroup });
        }
      }
    }

    nodes.sort(function (a, b) {
      var ak = a.key + '#' + a.group;
      var bk = b.key + '#' + b.group;
      return ak < bk ? -1 : (ak > bk ? 1 : 0);
    });
    var keys = nodes.map(function (n) { return n.key + '#' + n.group; });
    return {
      kind: kind,
      nodes: nodes,
      tiles: Object.keys(tiles),
      tileCount: Object.keys(tiles).length,
      openEdges: openEdges,
      meeples: meeples,
      complete: openEdges.length === 0,
      key: kind + ':' + keys.join('|')
    };
  }

  function cityComponent(state, key, group) { return traverseComponent(state, key, 'city', group); }
  function roadComponent(state, key, group) { return traverseComponent(state, key, 'road', group); }
  function fieldComponent(state, key, group) { return traverseComponent(state, key, 'field', group); }

  function monasteryNeighborCount(state, key) {
    var p = parseKey(key);
    var n = 0;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (state.board[boardKey(p.x + dx, p.y + dy)]) n++;
      }
    }
    return n;
  }

  function monasteryComplete(state, key) {
    var tile = state.board[key];
    if (!tile || !tile.monastery) return false;
    return monasteryNeighborCount(state, key) === 8;
  }

  function monasteryComponent(state, key) {
    var tile = state.board[key];
    if (!tile || !tile.monastery) throw new Error('该位置不是修道院');
    var meeples = tile.meeples.filter(function (m) { return m.kind === 'monastery'; })
      .map(function (m) { return { key: key, meeple: m }; });
    return {
      kind: 'monastery',
      nodes: [{ key: key, group: 0, edges: [] }],
      tiles: [key],
      tileCount: 1,
      openEdges: [],
      meeples: meeples,
      complete: monasteryComplete(state, key),
      key: 'monastery:' + key
    };
  }

  function majorityPlayers(meeples) {
    var counts = Object.create(null);
    var max = 0;
    meeples.forEach(function (ref) {
      var pi = ref.meeple.player;
      counts[pi] = (counts[pi] || 0) + 1;
      if (counts[pi] > max) max = counts[pi];
    });
    return Object.keys(counts)
      .filter(function (pi) { return counts[pi] === max; })
      .map(Number)
      .sort(function (a, b) { return a - b; });
  }

  function removeMeeple(state, ref) {
    var tile = state.board[ref.key];
    if (!tile) return;
    var idx = tile.meeples.indexOf(ref.meeple);
    if (idx >= 0) tile.meeples.splice(idx, 1);
    var player = state.players[ref.meeple.player];
    if (player) player.meeples = Math.min(DATA.MEEPLES_PER_PLAYER, player.meeples + 1);
  }

  function pushLog(state, type, text, playerIndex) {
    state.log.push({
      turn: state.turn,
      player: playerIndex == null ? null : playerIndex,
      type: type,
      text: text
    });
    if (state.log.length > 140) state.log.splice(0, state.log.length - 140);
  }

  function playerName(state, pi) {
    var p = state.players[pi];
    return p ? p.name : ('玩家' + pi);
  }

  function scoreComponent(state, comp, points, label) {
    var winners = majorityPlayers(comp.meeples);
    winners.forEach(function (pi) { state.players[pi].score += points; });
    comp.meeples.slice().forEach(function (ref) { removeMeeple(state, ref); });
    var event = {
      kind: comp.kind,
      label: label,
      points: points,
      players: winners,
      tiles: comp.tileCount,
      complete: !!comp.complete,
      openEdges: comp.openEdges.length
    };
    state.events.push(event);
    if (state.events.length > 120) state.events.splice(0, state.events.length - 120);
    if (winners.length) {
      pushLog(state, 'score',
        winners.map(function (pi) { return playerName(state, pi); }).join('、') +
        ' 结算' + label + '，得 ' + points + ' 分（' + comp.tileCount + ' 块瓦片）',
        winners[0]);
    } else {
      pushLog(state, 'score',
        label + ' 已完成（' + comp.tileCount + ' 块瓦片），无人占领', null);
    }
    return event;
  }

  function adjacentCompletedCities(state, fieldComp) {
    var ids = Object.create(null);
    fieldComp.nodes.forEach(function (node) {
      var tile = state.board[node.key];
      if (!tile) return;
      var list = tile.fieldAdj[node.group] || [];
      list.forEach(function (ci) {
        if (!tile.cities[ci]) return;
        var comp = cityComponent(state, node.key, ci);
        if (comp.complete) ids[comp.key] = true;
      });
    });
    return Object.keys(ids);
  }

  function resolveAfterPlacement(state) {
    var key = state.lastPlaced;
    var tile = key ? state.board[key] : null;
    var events = [];
    if (!tile) {
      advanceAfterTurn(state);
      return events;
    }
    var seen = Object.create(null);

    ['city', 'road'].forEach(function (kind) {
      var groups = kind === 'city' ? tile.cities : tile.roads;
      groups.forEach(function (group, gi) {
        var comp = traverseComponent(state, key, kind, gi);
        if (!comp.complete || seen[comp.key]) return;
        seen[comp.key] = true;
        var pts = kind === 'city' ? comp.tileCount * 2 : comp.tileCount;
        events.push(scoreComponent(state, comp, pts, kind === 'city' ? '城市' : '道路'));
      });
    });

    var p = parseKey(key);
    var candidates = [key];
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var nk = boardKey(p.x + dx, p.y + dy);
        var nb = state.board[nk];
        if (nb && nb.monastery) candidates.push(nk);
      }
    }
    candidates.forEach(function (mk) {
      if (!state.board[mk] || !state.board[mk].monastery) return;
      if (!monasteryComplete(state, mk)) return;
      var comp = monasteryComponent(state, mk);
      if (seen[comp.key]) return;
      seen[comp.key] = true;
      events.push(scoreComponent(state, comp, 9, '修道院'));
    });

    advanceAfterTurn(state);
    return events;
  }

  /* ------------------------------------------------------------------ */
  /* 回合推进                                                            */
  /* ------------------------------------------------------------------ */

  function advanceAfterTurn(state) {
    if (state.phase === 'over') return;
    state.lastPlaced = null;
    state.currentTile = null;
    state.phase = 'placing';
    state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
    state.turn++;
    if (!state.deck.length) {
      finishGame(state);
      return;
    }
    drawTile(state);
  }

  function drawTile(state) {
    if (state.phase === 'over') return;
    if (!state.deck.length) { finishGame(state); return; }
    var guard = 0;
    while (state.deck.length && guard++ < 200) {
      var id = state.deck.shift();
      var def = BY_ID[id];
      if (!def) throw new Error('牌堆中有未知瓦片：' + id);
      state.currentTile = { tileId: id, rot: 0 };
      state.phase = 'placing';
      state.selected = null;
      if (hasAnyLegalPlacement(state, id)) return;
      state.discard.push(id);
      pushLog(state, 'discard', '瓦片「' + def.name + '」没有合法位置，弃置', state.currentPlayer);
      state.currentTile = null;
    }
    finishGame(state);
  }

  function discardCurrentTile(state) {
    if (state.phase !== 'placing' || !state.currentTile) throw new Error('当前没有可弃置的瓦片');
    var def = BY_ID[state.currentTile.tileId];
    state.discard.push(state.currentTile.tileId);
    pushLog(state, 'discard',
      playerName(state, state.currentPlayer) + ' 的「' + (def ? def.name : '瓦片') + '」没有合法位置，弃置',
      state.currentPlayer);
    state.currentTile = null;
    drawTile(state);
  }

  function placeCurrentTile(state, move) {
    if (state.phase !== 'placing' || !state.currentTile) throw new Error('当前不能放置瓦片');
    var rot = move.rot == null ? state.currentTile.rot : normalizeRot(move.rot);
    var check = canPlaceTile(state, state.currentTile.tileId, rot, move.x, move.y);
    if (!check.ok) throw new Error(check.reason || '非法放置');
    var tile = putTile(state, state.currentTile.tileId, move.x, move.y, rot);
    state.currentTile.rot = rot;
    state.lastPlaced = tile.key;
    state.phase = 'meeple';
    pushLog(state, 'place',
      playerName(state, state.currentPlayer) + ' 放置「' + tile.name + '」到 (' + tile.x + ', ' + tile.y + ')',
      state.currentPlayer);
    return tile;
  }

  function rotateCurrent(state, delta) {
    if (state.phase !== 'placing' || !state.currentTile) return 0;
    state.currentTile.rot = normalizeRot(state.currentTile.rot + (delta == null ? 1 : delta));
    state.selected = null;
    return state.currentTile.rot;
  }

  function setRotation(state, rot) {
    if (state.phase === 'placing' && state.currentTile) state.currentTile.rot = normalizeRot(rot);
    state.selected = null;
    return state.currentTile ? state.currentTile.rot : 0;
  }

  /* ------------------------------------------------------------------ */
  /* 米宝                                                                */
  /* ------------------------------------------------------------------ */

  function featureLabel(kind) {
    if (kind === 'city') return '城市';
    if (kind === 'road') return '道路';
    if (kind === 'field') return '农田';
    if (kind === 'monastery') return '修道院';
    return kind;
  }

  function getMeepleOptions(state, playerIndex) {
    if (state.phase !== 'meeple' || !state.lastPlaced) return [];
    var pi = playerIndex == null ? state.currentPlayer : playerIndex;
    var player = state.players[pi];
    var tile = state.board[state.lastPlaced];
    if (!player || !tile || player.meeples <= 0) return [];
    var options = [];

    ['city', 'road', 'field'].forEach(function (kind) {
      var groups = tile[kind === 'city' ? 'cities' : (kind === 'road' ? 'roads' : 'fields')];
      groups.forEach(function (group, gi) {
        var comp = traverseComponent(state, tile.key, kind, gi);
        options.push({
          kind: kind,
          group: gi,
          label: featureLabel(kind),
          occupied: comp.meeples.length > 0,
          complete: comp.complete,
          tiles: comp.tileCount,
          openEdges: comp.openEdges.length
        });
      });
    });

    if (tile.monastery) {
      var occupied = tile.meeples.some(function (m) { return m.kind === 'monastery'; });
      options.push({
        kind: 'monastery',
        group: 0,
        label: '修道院',
        occupied: occupied,
        complete: monasteryComplete(state, tile.key),
        tiles: 1,
        openEdges: 0
      });
    }
    return options;
  }

  function __putMeeple(state, playerIndex, x, y, kind, group) {
    var tile = state.board[boardKey(x, y)];
    if (!tile) throw new Error('该位置没有瓦片');
    group = group || 0;
    if (kind === 'monastery') {
      if (!tile.monastery) throw new Error('该瓦片没有修道院');
    } else {
      var groups = kind === 'city' ? tile.cities : (kind === 'road' ? tile.roads : tile.fields);
      if (!groups || !groups[group]) throw new Error('区域不存在');
    }
    var player = state.players[playerIndex];
    if (!player) throw new Error('玩家不存在');
    if (player.meeples <= 0) throw new Error('没有可用米宝');
    var meeple = { player: playerIndex, kind: kind, group: group };
    tile.meeples.push(meeple);
    player.meeples--;
    return { key: tile.key, meeple: meeple };
  }

  function placeMeeple(state, kind, group, playerIndex) {
    if (state.phase !== 'meeple' || !state.lastPlaced) throw new Error('当前不能放置米宝');
    var pi = playerIndex == null ? state.currentPlayer : playerIndex;
    var player = state.players[pi];
    if (!player) throw new Error('玩家不存在');
    if (player.meeples <= 0) throw new Error('没有可用米宝');
    var tile = state.board[state.lastPlaced];
    group = group || 0;
    if (kind === 'monastery') {
      if (!tile.monastery) throw new Error('该瓦片没有修道院');
      if (tile.meeples.some(function (m) { return m.kind === 'monastery'; })) {
        throw new Error('该修道院已有米宝');
      }
    } else {
      var groups = kind === 'city' ? tile.cities : (kind === 'road' ? tile.roads : tile.fields);
      if (!groups || !groups[group]) throw new Error('区域不存在');
      if (traverseComponent(state, tile.key, kind, group).meeples.length) {
        throw new Error('该区域已有米宝');
      }
    }
    tile.meeples.push({ player: pi, kind: kind, group: group });
    player.meeples--;
    pushLog(state, 'meeple',
      playerName(state, pi) + ' 在「' + tile.name + '」放置米宝（' + featureLabel(kind) + '）', pi);
    return resolveAfterPlacement(state);
  }

  function skipMeeple(state) {
    if (state.phase !== 'meeple') throw new Error('当前不能跳过米宝');
    return resolveAfterPlacement(state);
  }

  /* ------------------------------------------------------------------ */
  /* 终局结算                                                            */
  /* ------------------------------------------------------------------ */

  function finishGame(state) {
    if (state.phase === 'over') return state.result;
    state.phase = 'over';
    state.over = true;
    state.currentTile = null;
    state.lastPlaced = null;
    state.selected = null;

    var breakdown = [];
    var seen = Object.create(null);
    var keys = Object.keys(state.board).sort();

    keys.forEach(function (key) {
      var tile = state.board[key];

      tile.cities.forEach(function (group, gi) {
        var comp = cityComponent(state, key, gi);
        if (comp.complete || seen[comp.key] || !comp.meeples.length) return;
        seen[comp.key] = true;
        breakdown.push(scoreComponent(state, comp, comp.tileCount, '未完成城市'));
      });

      tile.roads.forEach(function (group, gi) {
        var comp = roadComponent(state, key, gi);
        if (comp.complete || seen[comp.key] || !comp.meeples.length) return;
        seen[comp.key] = true;
        breakdown.push(scoreComponent(state, comp, comp.tileCount, '未完成道路'));
      });

      if (tile.monastery && !monasteryComplete(state, key) &&
          tile.meeples.some(function (m) { return m.kind === 'monastery'; })) {
        var mc = monasteryComponent(state, key);
        breakdown.push(scoreComponent(state, mc, 1 + monasteryNeighborCount(state, key), '未完成修道院'));
      }
    });

    keys.forEach(function (key) {
      var tile = state.board[key];
      tile.fields.forEach(function (group, gi) {
        var comp = fieldComponent(state, key, gi);
        var fieldKey = 'field:' + comp.key;
        if (seen[fieldKey] || !comp.meeples.length) return;
        seen[fieldKey] = true;
        var cities = adjacentCompletedCities(state, comp);
        if (!cities.length) return;
        breakdown.push(scoreComponent(state, comp, cities.length * 3, '农田'));
      });
    });

    state.finalBreakdown = breakdown;
    state.finalScores = state.players.map(function (p) { return p.score; });
    var best = Math.max.apply(null, state.finalScores);
    var winners = state.finalScores
      .map(function (score, index) { return { score: score, index: index }; })
      .filter(function (item) { return item.score === best; })
      .map(function (item) { return item.index; });
    state.result = {
      scores: state.finalScores.slice(),
      winners: winners,
      winner: winners.length === 1 ? winners[0] : null,
      tie: winners.length > 1,
      tied: winners.length > 1,
      breakdown: breakdown.slice()
    };
    pushLog(state, 'over',
      '终局：' + state.players.map(function (p, i) {
        return p.name + ' ' + state.finalScores[i] + ' 分';
      }).join(' · ') + (winners.length > 1 ? '，平局' : '，' + state.players[winners[0]].name + ' 获胜'),
      null);
    return state.result;
  }

  /* ------------------------------------------------------------------ */
  /* AI                                                                  */
  /* ------------------------------------------------------------------ */

  function fieldPotential(state, comp) {
    return adjacentCompletedCities(state, comp).length * 1.5 + 0.15;
  }

  function featurePotential(state, kind, comp, key) {
    if (kind === 'city') return comp.openEdges.length * 0.8 + comp.tileCount * 0.35;
    if (kind === 'road') return comp.openEdges.length * 0.45 + comp.tileCount * 0.2;
    if (kind === 'monastery') return monasteryNeighborCount(state, key) * 0.35 + 0.2;
    if (kind === 'field') return fieldPotential(state, comp);
    return 0;
  }

  function featurePoints(kind, comp) {
    if (kind === 'city') return comp.tileCount * 2;
    if (kind === 'road') return comp.tileCount;
    if (kind === 'monastery') return 9;
    return 0;
  }

  function evaluateMove(state, tileId, rot, x, y, playerIndex) {
    var key = boardKey(x, y);
    var tile = makeTile(BY_ID[tileId], rot);
    tile.x = x;
    tile.y = y;
    tile.key = key;
    state.board[key] = tile;
    try {
      var player = state.players[playerIndex];
      var hasMeeples = player.meeples > 0;
      var score = 0;
      var bestMeeple = null;
      var bestValue = -Infinity;

      var features = [];
      tile.cities.forEach(function (g, gi) { features.push({ kind: 'city', group: gi }); });
      tile.roads.forEach(function (g, gi) { features.push({ kind: 'road', group: gi }); });
      tile.fields.forEach(function (g, gi) { features.push({ kind: 'field', group: gi }); });
      if (tile.monastery) features.push({ kind: 'monastery', group: 0 });

      features.forEach(function (item) {
        var comp = item.kind === 'monastery'
          ? monasteryComponent(state, key)
          : traverseComponent(state, key, item.kind, item.group);
        var occupied = comp.meeples.length > 0;
        var existingAI = comp.meeples.some(function (ref) { return ref.meeple.player === playerIndex; });
        var canClaim = hasMeeples && !occupied;
        var pts = featurePoints(item.kind, comp);
        var pot = featurePotential(state, item.kind, comp, key);

        if (comp.complete && pts > 0) {
          if (existingAI || canClaim) score += pts;
        } else if (!comp.complete) {
          if (existingAI) score += pot * 0.8;
          else if (canClaim) score += pot * 0.55;
        }

        if (canClaim) {
          var value = comp.complete && pts > 0 ? pts + 1 : pot;
          if (value > bestValue) {
            bestValue = value;
            bestMeeple = { kind: item.kind, group: item.group };
          }
        }
      });

      var neighbours = 0;
      for (var dir = 0; dir < 4; dir++) {
        if (state.board[boardKey(x + DX[dir], y + DY[dir])]) neighbours++;
      }
      score += neighbours * 0.15;

      if (bestValue < 0.9) bestMeeple = null;
      return { score: score, meeple: bestMeeple };
    } finally {
      delete state.board[key];
    }
  }

  function chooseAIMove(state, playerIndex) {
    if (state.phase !== 'placing' || !state.currentTile) return null;
    var pi = playerIndex == null ? state.currentPlayer : playerIndex;
    var tileId = state.currentTile.tileId;
    var best = null;
    for (var rot = 0; rot < 4; rot++) {
      var placements = getLegalPlacements(state, tileId, rot);
      for (var i = 0; i < placements.length; i++) {
        var pos = placements[i];
        var evaluation = evaluateMove(state, tileId, rot, pos.x, pos.y, pi);
        if (!best || evaluation.score > best.score + 1e-9) {
          best = {
            type: 'place',
            x: pos.x,
            y: pos.y,
            rot: rot,
            meeple: evaluation.meeple,
            score: evaluation.score,
            player: pi
          };
        }
      }
    }
    return best || { type: 'discard', player: pi };
  }

  function runAITurn(state, playerIndex) {
    if (state.phase === 'over') return [];
    if (state.phase === 'meeple') return skipMeeple(state);
    if (state.phase !== 'placing' || !state.currentTile) return [];
    var pi = playerIndex == null ? state.currentPlayer : playerIndex;
    var move = chooseAIMove(state, pi);
    if (!move || move.type !== 'place') {
      discardCurrentTile(state);
      return [];
    }
    placeCurrentTile(state, move);
    if (move.meeple && state.phase === 'meeple') {
      return placeMeeple(state, move.meeple.kind, move.meeple.group, state.currentPlayer);
    }
    return skipMeeple(state);
  }

  /* ------------------------------------------------------------------ */
  /* 杂项与调试                                                          */
  /* ------------------------------------------------------------------ */

  function currentTileDef(state) {
    return state.currentTile ? BY_ID[state.currentTile.tileId] || null : null;
  }

  function findEdgeMismatches(state) {
    var bad = [];
    Object.keys(state.board).forEach(function (key) {
      var tile = state.board[key];
      for (var dir = 0; dir < 4; dir++) {
        var nb = state.board[boardKey(tile.x + DX[dir], tile.y + DY[dir])];
        if (!nb) continue;
        if (tile.edges[dir] !== nb.edges[opposite(dir)]) {
          bad.push({ key: key, dir: DIR_NAMES[dir], a: tile.edges[dir], b: nb.edges[opposite(dir)] });
        }
      }
    });
    return bad;
  }

  function summary(state) {
    return {
      phase: state.phase,
      turn: state.turn,
      currentPlayer: state.currentPlayer,
      deckLeft: state.deck.length,
      boardTiles: Object.keys(state.board).length,
      discard: state.discard.length,
      scores: state.players.map(function (p) { return p.score; }),
      meeples: state.players.map(function (p) { return p.meeples; }),
      winners: state.result ? state.result.winners : null
    };
  }

  function createGame(options) {
    options = options || {};
    var seed = options.seed == null ? (Date.now() >>> 0) : (options.seed >>> 0);
    var rng = mulberry32(seed);
    var deck;
    if (options.deck) {
      deck = options.deck.slice();
    } else {
      var pool = [];
      DATA.TILES.forEach(function (t) {
        if (t.id === DATA.START_TILE_ID) return;
        for (var i = 0; i < t.count; i++) pool.push(t.id);
      });
      deck = shuffle(pool, rng);
    }
    var defs = options.players || DATA.PLAYER_NAMES.map(function (name, i) {
      return { name: name, isAI: i === 1 };
    });
    var state = {
      seed: seed,
      rng: rng,
      deck: deck,
      discard: [],
      board: Object.create(null),
      players: defs.map(function (p, i) {
        return {
          index: i,
          name: p.name || ('玩家' + (i + 1)),
          isAI: !!p.isAI,
          color: DATA.PLAYER_COLORS[i % DATA.PLAYER_COLORS.length],
          score: 0,
          meeples: DATA.MEEPLES_PER_PLAYER
        };
      }),
      currentPlayer: 0,
      currentTile: null,
      lastPlaced: null,
      phase: 'placing',
      over: false,
      turn: 1,
      selected: null,
      log: [],
      events: [],
      result: null,
      finalScores: null,
      finalBreakdown: null
    };

    putTile(state, DATA.START_TILE_ID, 0, 0, 0);
    pushLog(state, 'system', '起始瓦片已放置于 (0, 0)', null);
    drawTile(state);
    return state;
  }

  /* ------------------------------------------------------------------ */
  /* 联机服务器适配层                                                    */
  /* ------------------------------------------------------------------ */
  /*
   * The shared room server (games/shared/online-room-server.mjs) drives every game through
   * getLegalMoves(state) / applyMove(state, move). Carcassonne's turn has two
   * phases, so the adapter exposes typed moves matching the page and the
   * online suite: place -> meeple | skip, plus discard when the drawn tile has
   * no legal cell.
   */
  function getLegalMoves(state) {
    if (!state || state.phase === 'over') return [];
    if (state.phase === 'meeple') {
      var moves = [];
      getMeepleOptions(state, state.currentPlayer).forEach(function (option) {
        if (!option.occupied) {
          moves.push({ type: 'meeple', kind: option.kind, group: option.group });
        }
      });
      moves.push({ type: 'skip' });
      return moves;
    }
    if (state.phase !== 'placing' || !state.currentTile) return [];
    var placements = getLegalPlacements(state, state.currentTile.tileId);
    if (!placements.length) return [{ type: 'discard' }];
    return placements.map(function (placement) {
      return { type: 'place', x: placement.x, y: placement.y, rot: placement.rot };
    });
  }

  function applyMove(state, move) {
    if (!state || !move) throw new Error('缺少动作');
    var type = move.type || (move.kind ? 'meeple' : (move.x != null ? 'place' : (move.skip ? 'skip' : '')));
    if (type === 'place') {
      placeCurrentTile(state, move);
      return state;
    }
    if (type === 'meeple') {
      placeMeeple(state, move.kind, move.group, state.currentPlayer);
      return state;
    }
    if (type === 'skip') {
      skipMeeple(state);
      return state;
    }
    if (type === 'discard') {
      discardCurrentTile(state);
      return state;
    }
    throw new Error('未知动作：' + JSON.stringify(move));
  }

  return {
    DIR_NAMES: DIR_NAMES,
    START_TILE_ID: DATA.START_TILE_ID,
    DX: DX,
    DY: DY,
    opposite: opposite,
    boardKey: boardKey,
    parseKey: parseKey,
    inBounds: inBounds,

    makeTile: makeTile,
    createGame: createGame,
    newGame: createGame,
    currentTileDef: currentTileDef,
    rotateCurrent: rotateCurrent,
    setRotation: setRotation,

    frontier: frontier,
    canPlaceTile: canPlaceTile,
    getLegalPlacements: getLegalPlacements,
    hasAnyLegalPlacement: hasAnyLegalPlacement,
    placeCurrentTile: placeCurrentTile,
    discardCurrentTile: discardCurrentTile,

    getMeepleOptions: getMeepleOptions,
    placeMeeple: placeMeeple,
    skipMeeple: skipMeeple,
    resolveAfterPlacement: resolveAfterPlacement,

    traverseComponent: traverseComponent,
    cityComponent: cityComponent,
    roadComponent: roadComponent,
    fieldComponent: fieldComponent,
    monasteryComplete: monasteryComplete,
    monasteryNeighborCount: monasteryNeighborCount,
    adjacentCompletedCities: adjacentCompletedCities,
    majorityPlayers: majorityPlayers,
    finishGame: finishGame,
    advanceAfterTurn: advanceAfterTurn,

    getLegalMoves: getLegalMoves,
    applyMove: applyMove,

    chooseAIMove: chooseAIMove,
    evaluateMove: evaluateMove,
    runAITurn: runAITurn,
    findEdgeMismatches: findEdgeMismatches,
    summary: summary,

    __putTile: __putTile,
    __putMeeple: __putMeeple
  };
});
