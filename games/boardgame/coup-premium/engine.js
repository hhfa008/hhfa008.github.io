/* Coup (政变) premium — 2–6 player engine.
 *
 * Strict rules: 15 influence cards (Duke / Assassin / Captain / Ambassador /
 * Contessa, 3 each), 2 cards and 2 coins per player, seven actions, open
 * challenge, blocks, block challenges, discard, exchange, reshuffle.
 *
 * UMD: Node `require()` and browser `window.CoupEngine` share one file.
 * The engine mutates a plain state object and returns { ok, error } results,
 * which keeps an authoritative server and a thin browser client in sync.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    var sharedShuffle = null;
    try { sharedShuffle = require('../../shared/shuffle.js'); } catch (err) { sharedShuffle = null; }
    module.exports = factory(root, sharedShuffle);
  } else {
    root.CoupEngine = factory(root, root.Shuffle || null);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root, SharedShuffle) {
  'use strict';

  var VERSION = '1.0.0';
  var ROLES = ['duke', 'assassin', 'captain', 'ambassador', 'contessa'];
  var ROLE_NAMES = {
    duke: '公爵',
    assassin: '刺客',
    captain: '队长',
    ambassador: '大使',
    contessa: '女伯爵'
  };
  var ROLE_GLYPHS = {
    duke: 'crown',
    assassin: 'dagger',
    captain: 'anchor',
    ambassador: 'scroll',
    contessa: 'mask'
  };
  var ACTION_NAMES = {
    income: '收入',
    foreign_aid: '外援',
    coup: '政变',
    tax: '征税',
    assassinate: '暗杀',
    steal: '偷取',
    exchange: '交换'
  };
  var ACTION_COSTS = {
    income: 0, foreign_aid: 0, coup: 7, tax: 0,
    assassinate: 3, steal: 0, exchange: 0
  };
  var CLAIM_BY_ACTION = {
    tax: 'duke',
    assassinate: 'assassin',
    steal: 'captain',
    exchange: 'ambassador'
  };
  var BLOCK_BY_ACTION = {
    foreign_aid: ['duke'],
    assassinate: ['contessa'],
    steal: ['captain', 'ambassador']
  };
  var AI_LEVELS = ['easy', 'normal', 'hard'];
  var AI_NAMES = ['你', 'AI · 铁幕', 'AI · 密探', 'AI · 黑账房', 'AI · 喉舌', 'AI · 夜莺'];
  var DEFAULT_AI_LEVELS = ['normal', 'normal', 'hard', 'easy', 'normal'];

  /* ---------- deterministic, serialisable RNG ---------- */

  function hashSeed(seed) {
    var text = String(seed == null ? 1 : seed);
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16;
    return h >>> 0;
  }

  function random(state) {
    var a = state.rngState | 0;
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    state.rngState = a;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function shuffle(state, list) {
    // Shared shuffle engine (games/shared/shuffle.js): seeded Fisher-Yates.
    // A per-state counter makes every shuffle reproducible from the game seed
    // while keeping the state JSON-serialisable (no closure-held RNG).
    state.shuffleCounter = (state.shuffleCounter || 0) + 1;
    if (SharedShuffle && typeof SharedShuffle.shuffleInPlace === 'function') {
      SharedShuffle.shuffleInPlace(list, { seed: String(state.seed) + ':' + state.shuffleCounter });
      return list;
    }
    // Fallback for a checkout that lacks the shared file.
    for (var i = list.length - 1; i > 0; i -= 1) {
      var j = Math.floor(random(state) * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function clampInt(value, lo, hi, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, Math.floor(n)));
  }

  /* ---------- state helpers ---------- */

  function alive(player) { return !!(player && !player.eliminated); }
  function aliveIds(state) {
    return state.players.filter(alive).map(function (p) { return p.id; });
  }
  function nameOf(state, id) {
    var p = state.players[id];
    return p && p.name ? p.name : '玩家' + id;
  }
  function hiddenRoles(player) {
    return player.influence.map(function (card) { return card.role; });
  }
  function hasRole(player, role) {
    return player.influence.some(function (card) { return card.role === role; });
  }
  function countRolePublic(state, role) {
    var n = 0;
    state.players.forEach(function (p) {
      p.lost.forEach(function (lostRole) { if (lostRole === role) n += 1; });
    });
    return n;
  }
  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 160) state.log.shift();
  }
  function event(state, type, data) {
    state.lastEvent = Object.assign({ type: type, at: state.actionCount }, data || {});
    state.events.push(state.lastEvent);
    if (state.events.length > 40) state.events.shift();
  }
  function nextAlive(state, from) {
    var n = state.players.length;
    for (var k = 1; k <= n; k += 1) {
      var id = (from + k) % n;
      if (alive(state.players[id])) return id;
    }
    return from;
  }
  function othersFrom(state, actor) {
    var out = [];
    var n = state.players.length;
    for (var k = 1; k < n; k += 1) {
      var id = (actor + k) % n;
      if (alive(state.players[id])) out.push(id);
    }
    return out;
  }

  function recycleDiscard(state) {
    if (!state.discard.length) return false;
    var recycled = state.discard.splice(0, state.discard.length);
    state.deck = state.deck.concat(recycled);
    shuffle(state, state.deck);
    log(state, '牌堆耗尽，弃牌洗回牌堆（' + recycled.length + ' 张）。');
    event(state, 'reshuffle', { count: recycled.length });
    return true;
  }

  function drawCard(state) {
    if (!state.deck.length) recycleDiscard(state);
    if (!state.deck.length) return null;
    return state.deck.pop();
  }

  function allCardIds(state) {
    var ids = state.deck.map(function (c) { return c.id; });
    state.players.forEach(function (p) {
      p.influence.forEach(function (c) { ids.push(c.id); });
    });
    state.discard.forEach(function (c) { ids.push(c.id); });
    if (state.pending && state.pending.exchange) {
      state.pending.exchange.cards.forEach(function (c) {
        if (ids.indexOf(c.id) < 0) ids.push(c.id);
      });
    }
    return ids;
  }

  function roleCountsInPlay(state) {
    var counts = {};
    ROLES.forEach(function (r) { counts[r] = 0; });
    state.deck.forEach(function (c) { counts[c.role] += 1; });
    state.players.forEach(function (p) {
      p.influence.forEach(function (c) { counts[c.role] += 1; });
    });
    state.discard.forEach(function (c) { counts[c.role] += 1; });
    if (state.pending && state.pending.exchange) {
      state.pending.exchange.cards.forEach(function (c) {
        var already = state.players.some(function (p) {
          return p.influence.some(function (h) { return h.id === c.id; });
        });
        if (!already && !state.deck.some(function (d) { return d.id === c.id; })) counts[c.role] += 1;
      });
    }
    return counts;
  }

  /* ---------- game creation ---------- */

  function createGame(options) {
    var opts = options || {};
    var playerCount = clampInt(opts.playerCount, 2, 6, 3);
    var seed = opts.seed == null ? Date.now() : opts.seed;
    var rngState = hashSeed(seed);
    if (opts.rngState != null) rngState = opts.rngState >>> 0;

    var deck = [];
    var cardId = 0;
    ROLES.forEach(function (role) {
      for (var i = 0; i < 3; i += 1) {
        deck.push({ id: 'c' + (cardId += 1), role: role });
      }
    });
    var state = {
      version: VERSION,
      seed: seed,
      rngState: rngState,
      shuffleCounter: 0,
      playerCount: playerCount,
      players: [],
      deck: deck,
      discard: [],
      current: 0,
      phase: 'action',
      pending: null,
      winner: null,
      over: false,
      log: [],
      events: [],
      lastEvent: null,
      lastReveal: null,
      turns: 0,
      actionCount: 0,
      stats: { income: 0, foreign_aid: 0, coup: 0, tax: 0, assassinate: 0, steal: 0, exchange: 0, challenges: 0, blocks: 0, discards: 0, reshuffles: 0 },
      startedAt: opts.startedAt || null
    };
    shuffle(state, deck);

    var names = opts.names || [];
    var levels = opts.aiLevels || [];
    var aiAll = !!opts.aiAll;
    var humanSeat = clampInt(opts.humanSeat, 0, playerCount - 1, 0);
    for (var i = 0; i < playerCount; i += 1) {
      var isAI = aiAll ? true : i !== humanSeat;
      var level = levels[i] || DEFAULT_AI_LEVELS[(i + playerCount) % DEFAULT_AI_LEVELS.length];
      if (AI_LEVELS.indexOf(level) < 0) level = 'normal';
      state.players.push({
        id: i,
        name: names[i] || (isAI ? AI_NAMES[i % AI_NAMES.length] : '你'),
        coins: 2,
        influence: [drawCard(state), drawCard(state)],
        lost: [],
        eliminated: false,
        isAI: isAI,
        aiLevel: isAI ? level : null
      });
    }
    state.current = clampInt(opts.firstPlayer, 0, playerCount - 1, 0);
    if (opts.current != null) state.current = clampInt(opts.current, 0, playerCount - 1, 0);
    log(state, '政变开局：' + playerCount + ' 人，每人 2 张面朝下身份与 2 枚金币。最后存活者获胜。');
    event(state, 'newGame', { playerCount: playerCount });
    return state;
  }

  /* ---------- turn flow ---------- */

  function isOver(state) { return state.phase === 'over' || state.winner !== null; }

  function checkGameOver(state) {
    var ids = aliveIds(state);
    if (ids.length <= 1) {
      state.winner = ids.length ? ids[0] : -1;
      state.phase = 'over';
      state.over = true;
      state.pending = null;
      if (state.winner >= 0) {
        log(state, nameOf(state, state.winner) + '存活到最后，赢得本局。');
        event(state, 'win', { winner: state.winner });
      } else {
        log(state, '无人存活，本局结束。');
        event(state, 'win', { winner: -1 });
      }
      return true;
    }
    return false;
  }

  function actorId(state) {
    if (!state || isOver(state)) return null;
    if (state.phase === 'action' || state.phase === 'exchange') return state.current;
    if (state.phase === 'challenge') {
      return state.pending && state.pending.challengeQueue.length ? state.pending.challengeQueue[0] : null;
    }
    if (state.phase === 'block') {
      return state.pending && state.pending.blockQueue.length ? state.pending.blockQueue[0] : null;
    }
    if (state.phase === 'blockChallenge') return state.pending ? state.pending.actor : null;
    if (state.phase === 'discard') {
      return state.pending && state.pending.discardQueue.length ? state.pending.discardQueue[0] : null;
    }
    return null;
  }

  function endTurn(state) {
    if (checkGameOver(state)) return;
    state.pending = null;
    state.current = nextAlive(state, state.current);
    state.phase = 'action';
    state.turns += 1;
    log(state, '轮到' + nameOf(state, state.current) + '行动。');
    event(state, 'turn', { current: state.current });
  }

  function startDiscard(state, ids, reason, cont) {
    var queue = ids.filter(function (id) {
      return alive(state.players[id]) && state.players[id].influence.length > 0;
    });
    if (!queue.length) {
      continueBy(state, cont);
      return;
    }
    state.pending.discardQueue = queue;
    state.pending.discardReason = reason;
    state.pending.cont = cont;
    state.phase = 'discard';
    log(state, nameOf(state, queue[0]) + '需要选择一张身份牌翻开（' + reason + '）。');
    event(state, 'discardPrompt', { player: queue[0], reason: reason });
  }

  function continueBy(state, cont) {
    if (isOver(state)) return;
    if (cont === 'afterChallenge') afterChallenges(state);
    else if (cont === 'cancel') {
      log(state, '行动被取消。');
      endTurn(state);
    } else if (cont === 'resolve') resolveAction(state);
    else if (cont === 'blockStands') {
      log(state, '阻挡成立，行动取消。');
      endTurn(state);
    } else endTurn(state);
  }

  function beginChallenge(state, pending) {
    state.pending = pending;
    pending.claim = pending.claim || CLAIM_BY_ACTION[pending.action] || null;
    pending.challengeQueue = othersFrom(state, pending.actor);
    if (!pending.challengeQueue.length) {
      afterChallenges(state);
      return;
    }
    state.phase = 'challenge';
    log(state, nameOf(state, pending.actor) + '宣称' + ROLE_NAMES[pending.claim] +
      (pending.target != null ? '，目标为' + nameOf(state, pending.target) : '') + '，等待挑战。');
    event(state, 'claim', { actor: pending.actor, claim: pending.claim, action: pending.action, target: pending.target });
  }

  function afterChallenges(state) {
    var pending = state.pending;
    if (!pending || isOver(state)) return;
    var blockRoles = BLOCK_BY_ACTION[pending.action];
    if (blockRoles && blockRoles.length) {
      var queue;
      if (pending.action === 'foreign_aid') queue = othersFrom(state, pending.actor);
      else queue = (pending.target != null && alive(state.players[pending.target])) ? [pending.target] : [];
      pending.blockRoles = blockRoles;
      pending.blockQueue = queue;
      if (queue.length) {
        state.phase = 'block';
        log(state, '等待阻挡：' + nameOf(state, queue[0]) + '（' + blockRoles.map(function (r) { return ROLE_NAMES[r]; }).join(' / ') + '）。');
        event(state, 'blockPrompt', { player: queue[0], action: pending.action });
        return;
      }
    }
    resolveAction(state);
  }

  function revealAndReplace(state, player, role, kind) {
    var index = -1;
    for (var i = 0; i < player.influence.length; i += 1) {
      if (player.influence[i].role === role) { index = i; break; }
    }
    if (index < 0) return false;
    var card = player.influence.splice(index, 1)[0];
    state.deck.push(card);
    shuffle(state, state.deck);
    var replacement = drawCard(state);
    if (replacement) player.influence.push(replacement);
    state.lastReveal = { player: player.id, role: role, kind: kind || 'claim', at: state.actionCount };
    log(state, nameOf(state, player.id) + '亮出' + ROLE_NAMES[role] + '，随后洗回牌堆并补抽一张。');
    event(state, 'reveal', { player: player.id, role: role, kind: kind || 'claim' });
    return true;
  }

  function doChallenge(state, challenger) {
    var pending = state.pending;
    var actor = state.players[pending.actor];
    var claim = pending.claim;
    state.stats.challenges += 1;
    pending.challenger = challenger;
    pending.challengeQueue = [];
    if (hasRole(actor, claim)) {
      revealAndReplace(state, actor, claim, 'claim');
      log(state, nameOf(state, challenger) + '挑战失败，向' + ROLE_NAMES[claim] + '宣称低头。');
      event(state, 'challenge', { challenger: challenger, actor: pending.actor, claim: claim, success: false });
      startDiscard(state, [challenger], '挑战失败', 'afterChallenge');
    } else {
      log(state, nameOf(state, actor.id) + '并没有' + ROLE_NAMES[claim] + '，挑战成功，行动取消。');
      event(state, 'challenge', { challenger: challenger, actor: pending.actor, claim: claim, success: true });
      startDiscard(state, [pending.actor], '诈称被拆穿', 'cancel');
    }
  }

  function doBlock(state, role) {
    var pending = state.pending;
    var blocker = pending.blockQueue[0];
    pending.blocker = blocker;
    pending.blockClaim = role;
    state.stats.blocks += 1;
    state.phase = 'blockChallenge';
    log(state, nameOf(state, blocker) + '宣称' + ROLE_NAMES[role] + '阻挡，等待' +
      nameOf(state, pending.actor) + '决定是否挑战。');
    event(state, 'block', { blocker: blocker, role: role, action: pending.action });
  }

  function doBlockChallenge(state) {
    var pending = state.pending;
    var blocker = state.players[pending.blocker];
    if (hasRole(blocker, pending.blockClaim)) {
      revealAndReplace(state, blocker, pending.blockClaim, 'block');
      log(state, nameOf(state, blocker.id) + '的阻挡成立，' + nameOf(state, pending.actor) + '失去一张身份。');
      event(state, 'blockChallenge', { blocker: pending.blocker, role: pending.blockClaim, success: false });
      startDiscard(state, [pending.actor], '挑战阻挡失败', 'blockStands');
    } else {
      log(state, nameOf(state, blocker.id) + '的' + ROLE_NAMES[pending.blockClaim] + '阻挡是诈称，行动继续。');
      event(state, 'blockChallenge', { blocker: pending.blocker, role: pending.blockClaim, success: true });
      startDiscard(state, [pending.blocker], '阻挡造假', 'resolve');
    }
  }

  function doDiscard(state, index) {
    var pending = state.pending;
    if (!pending || !pending.discardQueue.length) return false;
    var id = pending.discardQueue[0];
    var player = state.players[id];
    var card = player.influence[index];
    if (!card) return false;
    player.influence.splice(index, 1);
    player.lost.push(card.role);
    state.discard.push(card);
    state.stats.discards += 1;
    log(state, nameOf(state, id) + '翻开并失去' + ROLE_NAMES[card.role] + '（' + pending.discardReason + '）。');
    event(state, 'discard', { player: id, role: card.role, reason: pending.discardReason });
    if (!player.influence.length) {
      player.eliminated = true;
      log(state, nameOf(state, id) + '的两张身份均已翻开，被淘汰。');
      event(state, 'eliminate', { player: id });
    }
    pending.discardQueue.shift();
    if (checkGameOver(state)) return true;
    if (!pending.discardQueue.length) {
      var cont = pending.cont;
      continueBy(state, cont);
    }
    return true;
  }

  function doKeep(state, indices) {
    var pending = state.pending;
    if (!pending || pending.action !== 'exchange' || !pending.exchange) return false;
    var actor = state.players[pending.actor];
    var cards = pending.exchange.cards;
    var chosen = indices.slice().sort(function (a, b) { return a - b; });
    var kept = [];
    var returned = [];
    cards.forEach(function (card, i) {
      if (chosen.indexOf(i) >= 0) kept.push(card);
      else returned.push(card);
    });
    actor.influence = kept;
    state.deck = state.deck.concat(returned);
    shuffle(state, state.deck);
    log(state, nameOf(state, actor.id) + '完成交换，保留 2 张身份牌，其余洗回牌堆。');
    event(state, 'exchangeDone', { actor: actor.id, kept: kept.map(function (c) { return c.role; }) });
    state.pending = null;
    endTurn(state);
    return true;
  }

  function resolveAction(state) {
    var pending = state.pending;
    if (!pending || isOver(state)) return;
    var actor = state.players[pending.actor];
    var target = pending.target == null ? null : state.players[pending.target];
    var action = pending.action;
    state.actionCount += 1;
    state.stats[action] = (state.stats[action] || 0) + 1;
    state.pending = null;

    if (action === 'income') {
      actor.coins += 1;
      log(state, nameOf(state, actor.id) + '领取收入，获得 1 枚金币。');
      event(state, 'actionResolved', { action: 'income', actor: actor.id, coins: actor.coins });
      endTurn(state);
    } else if (action === 'foreign_aid') {
      actor.coins += 2;
      log(state, nameOf(state, actor.id) + '获得 2 枚外援金币。');
      event(state, 'actionResolved', { action: 'foreign_aid', actor: actor.id, coins: actor.coins });
      endTurn(state);
    } else if (action === 'tax') {
      actor.coins += 3;
      log(state, nameOf(state, actor.id) + '征税成功，获得 3 枚金币。');
      event(state, 'actionResolved', { action: 'tax', actor: actor.id, coins: actor.coins });
      endTurn(state);
    } else if (action === 'steal') {
      var amount = Math.min(2, target.coins);
      target.coins -= amount;
      actor.coins += amount;
      log(state, nameOf(state, actor.id) + '从' + nameOf(state, target.id) + '偷走 ' + amount + ' 枚金币。');
      event(state, 'actionResolved', { action: 'steal', actor: actor.id, target: target.id, amount: amount });
      endTurn(state);
    } else if (action === 'exchange') {
      var drawn = [];
      for (var i = 0; i < 2; i += 1) {
        var card = drawCard(state);
        if (card) drawn.push(card);
      }
      pending.exchange = { actor: actor.id, cards: actor.influence.concat(drawn), drawn: drawn.length };
      state.pending = pending;
      state.phase = 'exchange';
      log(state, nameOf(state, actor.id) + '抽取 ' + drawn.length + ' 张身份牌，选择保留 2 张。');
      event(state, 'exchangePrompt', { actor: actor.id, count: pending.exchange.cards.length });
    } else if (action === 'coup') {
      log(state, nameOf(state, actor.id) + '发动政变，' + nameOf(state, target.id) + '必须失去一张身份。');
      state.pending = { action: 'coup', actor: actor.id, target: target.id };
      startDiscard(state, [target.id], '政变', 'end');
    } else if (action === 'assassinate') {
      log(state, nameOf(state, actor.id) + '的暗杀得手，' + nameOf(state, target.id) + '失去一张身份。');
      state.pending = { action: 'assassinate', actor: actor.id, target: target.id };
      startDiscard(state, [target.id], '暗杀', 'end');
    }
  }

  function beginAction(state, action) {
    var actor = state.players[state.current];
    var pending = {
      action: action.type,
      actor: actor.id,
      target: action.target == null ? null : action.target,
      claim: null,
      challenger: null,
      blockClaim: null,
      blocker: null,
      challengeQueue: [],
      blockQueue: [],
      discardQueue: [],
      discardReason: '',
      cont: 'end',
      exchange: null
    };
    if (action.type === 'income') {
      state.pending = pending;
      resolveAction(state);
    } else if (action.type === 'foreign_aid') {
      state.pending = pending;
      log(state, nameOf(state, actor.id) + '申请外援，任何人都可以宣称公爵阻挡。');
      event(state, 'actionDeclared', { action: 'foreign_aid', actor: actor.id });
      afterChallenges(state);
    } else if (action.type === 'coup') {
      actor.coins -= 7;
      state.pending = pending;
      log(state, nameOf(state, actor.id) + '支付 7 枚金币发动政变（不可挑战、不可阻挡）。');
      event(state, 'actionDeclared', { action: 'coup', actor: actor.id, target: pending.target });
      var target = state.players[action.target];
      startDiscard(state, [target.id], '政变', 'end');
    } else if (action.type === 'tax') {
      pending.claim = 'duke';
      event(state, 'actionDeclared', { action: 'tax', actor: actor.id, claim: 'duke' });
      beginChallenge(state, pending);
    } else if (action.type === 'assassinate') {
      actor.coins -= 3;
      pending.claim = 'assassin';
      event(state, 'actionDeclared', { action: 'assassinate', actor: actor.id, target: pending.target, claim: 'assassin' });
      beginChallenge(state, pending);
    } else if (action.type === 'steal') {
      pending.claim = 'captain';
      event(state, 'actionDeclared', { action: 'steal', actor: actor.id, target: pending.target, claim: 'captain' });
      beginChallenge(state, pending);
    } else if (action.type === 'exchange') {
      pending.claim = 'ambassador';
      event(state, 'actionDeclared', { action: 'exchange', actor: actor.id, claim: 'ambassador' });
      beginChallenge(state, pending);
    }
  }

  /* ---------- legality ---------- */

  function actionError(state, action) {
    if (!state || isOver(state)) return '对局已结束';
    if (!action || typeof action !== 'object' || !action.type) return '缺少行动';
    var actor = actorId(state);
    if (actor == null) return '当前没有行动者';
    var player = state.players[actor];
    if (!player || !alive(player)) return '行动者已被淘汰';

    if (state.phase === 'action') {
      var type = action.type;
      if (action.actor != null && action.actor !== actor) return '不是你的回合';
      if (type === 'income' || type === 'foreign_aid' || type === 'tax' || type === 'exchange') return null;
      if (type !== 'coup' && type !== 'assassinate' && type !== 'steal') return '未知行动';
      var targetId = action.target;
      if (!Number.isInteger(targetId) || targetId === actor ||
          !state.players[targetId] || !alive(state.players[targetId])) return '需要选择一个存活的对手';
      if (type === 'coup' && player.coins < 7) return '政变需要 7 枚金币';
      if (type === 'assassinate' && player.coins < 3) return '暗杀需要 3 枚金币';
      return null;
    }
    if (state.phase === 'challenge') {
      return (action.type === 'challenge' || action.type === 'pass') ? null : '当前只能挑战或放弃';
    }
    if (state.phase === 'block') {
      if (action.type === 'pass') return null;
      if (action.type !== 'block') return '当前只能阻挡或放弃';
      var roles = BLOCK_BY_ACTION[state.pending.action] || [];
      return roles.indexOf(action.role) >= 0 ? null : '该角色不能阻挡此行动';
    }
    if (state.phase === 'blockChallenge') {
      return (action.type === 'challenge' || action.type === 'pass') ? null : '当前只能挑战阻挡或接受';
    }
    if (state.phase === 'discard') {
      if (action.type !== 'discard') return '请选择一张身份牌翻开';
      if (!Number.isInteger(action.index) || !player.influence[action.index]) return '无效的身份牌';
      return null;
    }
    if (state.phase === 'exchange') {
      if (action.type !== 'keep') return '请选择保留两张身份牌';
      var idx = action.indices;
      if (!Array.isArray(idx) || idx.length !== 2) return '必须保留两张身份牌';
      if (!state.pending.exchange) return '交换状态缺失';
      var total = state.pending.exchange.cards.length;
      if (idx[0] === idx[1] || idx.some(function (i) { return !Number.isInteger(i) || i < 0 || i >= total; })) return '无效的保留选择';
      return null;
    }
    return '当前不能行动';
  }

  function getLegalActions(state) {
    if (!state || isOver(state)) return [];
    var actor = actorId(state);
    if (actor == null) return [];
    var player = state.players[actor];
    var actions = [];
    if (state.phase === 'action') {
      actions.push({ type: 'income' });
      actions.push({ type: 'foreign_aid' });
      actions.push({ type: 'tax' });
      actions.push({ type: 'exchange' });
      aliveIds(state).forEach(function (target) {
        if (target === actor) return;
        actions.push({ type: 'steal', target: target });
        if (player.coins >= 3) actions.push({ type: 'assassinate', target: target });
        if (player.coins >= 7) actions.push({ type: 'coup', target: target });
      });
    } else if (state.phase === 'challenge') {
      actions.push({ type: 'challenge' }, { type: 'pass' });
    } else if (state.phase === 'block') {
      (state.pending.blockRoles || BLOCK_BY_ACTION[state.pending.action] || []).forEach(function (role) {
        actions.push({ type: 'block', role: role });
      });
      actions.push({ type: 'pass' });
    } else if (state.phase === 'blockChallenge') {
      actions.push({ type: 'challenge' }, { type: 'pass' });
    } else if (state.phase === 'discard') {
      player.influence.forEach(function (card, i) {
        actions.push({ type: 'discard', index: i });
      });
    } else if (state.phase === 'exchange') {
      var total = state.pending.exchange ? state.pending.exchange.cards.length : 0;
      for (var i = 0; i < total; i += 1) {
        for (var j = i + 1; j < total; j += 1) actions.push({ type: 'keep', indices: [i, j] });
      }
    }
    return actions;
  }

  function applyAction(state, action) {
    var error = actionError(state, action);
    if (error) return { ok: false, error: error };
    var actor = actorId(state);
    if (state.phase === 'action') {
      beginAction(state, action);
      return { ok: true, actor: actor };
    }
    if (state.phase === 'challenge') {
      if (action.type === 'challenge') doChallenge(state, actor);
      else {
        log(state, nameOf(state, actor) + '不挑战。');
        state.pending.challengeQueue.shift();
        if (!state.pending.challengeQueue.length) afterChallenges(state);
      }
      return { ok: true, actor: actor };
    }
    if (state.phase === 'block') {
      if (action.type === 'block') doBlock(state, action.role);
      else {
        log(state, nameOf(state, actor) + '不阻挡。');
        state.pending.blockQueue.shift();
        if (!state.pending.blockQueue.length) resolveAction(state);
      }
      return { ok: true, actor: actor };
    }
    if (state.phase === 'blockChallenge') {
      if (action.type === 'challenge') doBlockChallenge(state);
      else {
        log(state, nameOf(state, state.pending.actor) + '接受阻挡，行动取消。');
        state.pending.blockQueue = [];
        endTurn(state);
      }
      return { ok: true, actor: actor };
    }
    if (state.phase === 'discard') {
      var discarded = doDiscard(state, action.index);
      return discarded ? { ok: true, actor: actor } : { ok: false, error: '无效的身份牌' };
    }
    if (state.phase === 'exchange') {
      var kept = doKeep(state, action.indices);
      return kept ? { ok: true, actor: actor } : { ok: false, error: '无效的保留选择' };
    }
    return { ok: false, error: '当前不能行动' };
  }

  /* ---------- AI ---------- */

  function levelIndex(level) {
    var i = AI_LEVELS.indexOf(level);
    return i < 0 ? 1 : i;
  }
  function roleScore(role, state, player) {
    if (role === 'duke') return player.coins >= 5 ? 3.6 : 3.0;
    if (role === 'contessa') return 3.1;
    if (role === 'assassin') return player.coins >= 3 ? 3.2 : 2.2;
    if (role === 'captain') return player.coins <= 5 ? 2.8 : 2.1;
    return 1.7;
  }
  function pickWeighted(state, entries) {
    var total = entries.reduce(function (n, entry) { return n + Math.max(0, entry.w); }, 0);
    if (total <= 0) return entries.length ? entries[0].value : null;
    var roll = random(state) * total;
    for (var i = 0; i < entries.length; i += 1) {
      roll -= Math.max(0, entries[i].w);
      if (roll < 0) return entries[i].value;
    }
    return entries[entries.length - 1].value;
  }
  function targetForAI(state, actor, level) {
    var targets = aliveIds(state).filter(function (id) { return id !== actor; });
    if (!targets.length) return null;
    if (level === 0) return targets[Math.floor(random(state) * targets.length)];
    var scored = targets.map(function (id) {
      var p = state.players[id];
      var score = p.coins * 0.6 + (p.influence.length === 1 ? 2.5 : 0) + random(state) * (level === 2 ? 0.5 : 2);
      return { id: id, score: score };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored[0].id;
  }
  function chooseActionPhaseAI(state, actor, level) {
    var p = state.players[actor];
    var targets = aliveIds(state).filter(function (id) { return id !== actor; });
    var target = targetForAI(state, actor, level);
    var options = [];
    if (p.coins >= 7) {
      options.push({ w: level === 0 ? 5 : 30, value: { type: 'coup', target: target } });
    } else {
      if (level === 0) {
        options.push({ w: 5, value: { type: 'income' } });
        options.push({ w: 4, value: { type: 'foreign_aid' } });
        if (hasRole(p, 'duke')) options.push({ w: 4, value: { type: 'tax' } });
        if (hasRole(p, 'captain')) options.push({ w: 3, value: { type: 'steal', target: target } });
        if (hasRole(p, 'ambassador')) options.push({ w: 2, value: { type: 'exchange' } });
        if (hasRole(p, 'assassin') && p.coins >= 3) options.push({ w: 3, value: { type: 'assassinate', target: target } });
        if (random(state) < 0.10) options.push({ w: 1, value: { type: 'income' } });
      } else {
        var aggressive = level === 2;
        options.push({ w: aggressive ? 1.2 : 2, value: { type: 'income' } });
        options.push({ w: aggressive ? 2.2 : 3.2, value: { type: 'foreign_aid' } });
        if (hasRole(p, 'duke')) options.push({ w: aggressive ? 9 : 6, value: { type: 'tax' } });
        if (hasRole(p, 'captain') && targets.some(function (id) { return state.players[id].coins > 0; })) {
          options.push({ w: aggressive ? 6 : 4, value: { type: 'steal', target: target } });
        }
        if (hasRole(p, 'ambassador')) options.push({ w: aggressive ? 4 : 3, value: { type: 'exchange' } });
        if (hasRole(p, 'assassin') && p.coins >= 3) {
          options.push({ w: aggressive ? 8 : 4.5, value: { type: 'assassinate', target: target } });
        }
        var bluff = aggressive ? 0.22 : 0.11;
        if (!hasRole(p, 'duke') && random(state) < bluff) {
          options.push({ w: 1.4, value: { type: 'tax' } });
        }
        if (!hasRole(p, 'captain') && random(state) < bluff) {
          options.push({ w: 1.1, value: { type: 'steal', target: target } });
        }
        if (!hasRole(p, 'assassin') && p.coins >= 3 && random(state) < bluff * 0.55) {
          options.push({ w: 0.9, value: { type: 'assassinate', target: target } });
        }
        if (!hasRole(p, 'ambassador') && random(state) < bluff * 0.45) {
          options.push({ w: 0.8, value: { type: 'exchange' } });
        }
      }
    }
    var chosen = pickWeighted(state, options);
    if (!chosen) chosen = { type: 'income' };
    // Never return an illegal target action.
    if (chosen.target != null && targets.indexOf(chosen.target) < 0) chosen.target = target;
    if ((chosen.type === 'steal') && chosen.target != null && state.players[chosen.target].coins < 1) {
      return { type: 'foreign_aid' };
    }
    return chosen;
  }
  function chooseChallengeAI(state, actor, level) {
    var pending = state.pending;
    if (!pending || !pending.claim) return { type: 'pass' };
    var p = state.players[actor];
    var own = p.influence.filter(function (c) { return c.role === pending.claim; }).length;
    var publicLost = countRolePublic(state, pending.claim);
    var remaining = Math.max(0, 3 - own - publicLost);
    var rate;
    if (remaining === 0) rate = level === 0 ? 0.55 : 0.94;
    else if (remaining === 1) rate = level === 0 ? 0.08 : level === 1 ? 0.24 : 0.38;
    else rate = level === 0 ? 0.03 : level === 1 ? 0.10 : 0.17;
    if (pending.action === 'assassinate' || pending.action === 'coup') rate += level * 0.01;
    return random(state) < rate ? { type: 'challenge' } : { type: 'pass' };
  }
  function chooseBlockAI(state, actor, level) {
    var pending = state.pending;
    var roles = pending.blockRoles || BLOCK_BY_ACTION[pending.action] || [];
    var own = roles.filter(function (role) { return hasRole(state.players[actor], role); });
    if (own.length) {
      var honestRate = level === 0 ? 0.62 : level === 1 ? 0.86 : 0.96;
      if (random(state) < honestRate) {
        var role = own[0];
        if (level === 2 && own.length > 1 && pending.action === 'steal') {
          role = state.players[actor].coins <= 4 ? 'captain' : 'ambassador';
        }
        return { type: 'block', role: role };
      }
      return { type: 'pass' };
    }
    var bluffRate = level === 0 ? 0.03 : level === 1 ? 0.08 : 0.15;
    if (pending.action === 'foreign_aid' && state.players[actor].coins < 2) bluffRate += 0.04;
    if (random(state) < bluffRate) return { type: 'block', role: roles[0] };
    return { type: 'pass' };
  }
  function chooseBlockChallengeAI(state, actor, level) {
    var pending = state.pending;
    var publicLost = countRolePublic(state, pending.blockClaim);
    var remaining = Math.max(0, 3 - publicLost);
    var rate = remaining === 0 ? 0.9 : level === 0 ? 0.10 : level === 1 ? 0.24 : 0.36;
    if (pending.action === 'assassinate' && state.players[actor].influence.length === 1) rate += 0.08;
    return random(state) < rate ? { type: 'challenge' } : { type: 'pass' };
  }
  function chooseDiscardAI(state, actor, level) {
    var p = state.players[actor];
    if (!p.influence.length) return { type: 'discard', index: 0 };
    if (level === 0) return { type: 'discard', index: Math.floor(random(state) * p.influence.length) };
    var ranked = p.influence.map(function (card, i) {
      return { i: i, score: roleScore(card.role, state, p) + random(state) * (level === 1 ? 1.2 : 0.3) };
    });
    ranked.sort(function (a, b) { return a.score - b.score; });
    return { type: 'discard', index: ranked[0].i };
  }
  function chooseExchangeAI(state, actor, level) {
    var pending = state.pending;
    var cards = pending && pending.exchange ? pending.exchange.cards : [];
    if (cards.length < 2) return { type: 'keep', indices: [0, 1] };
    if (level === 0) {
      var a = Math.floor(random(state) * cards.length);
      var b = Math.floor(random(state) * (cards.length - 1));
      if (b >= a) b += 1;
      return { type: 'keep', indices: [a, b].sort(function (x, y) { return x - y; }) };
    }
    var p = state.players[actor];
    var ranked = cards.map(function (card, i) {
      return { i: i, score: roleScore(card.role, state, p) + random(state) * (level === 1 ? 1.1 : 0.2) };
    });
    ranked.sort(function (x, y) { return y.score - x.score; });
    return { type: 'keep', indices: [ranked[0].i, ranked[1].i].sort(function (x, y) { return x - y; }) };
  }

  function chooseAIAction(state, level) {
    if (!state || isOver(state)) return null;
    var actor = actorId(state);
    if (actor == null) return null;
    var lv = level == null ? (state.players[actor] && state.players[actor].aiLevel) || 'normal' : level;
    var li = levelIndex(lv);
    if (state.phase === 'action') return chooseActionPhaseAI(state, actor, li);
    if (state.phase === 'challenge') return chooseChallengeAI(state, actor, li);
    if (state.phase === 'block') return chooseBlockAI(state, actor, li);
    if (state.phase === 'blockChallenge') return chooseBlockChallengeAI(state, actor, li);
    if (state.phase === 'discard') return chooseDiscardAI(state, actor, li);
    if (state.phase === 'exchange') return chooseExchangeAI(state, actor, li);
    return null;
  }

  function autoRun(state, options) {
    var opts = options || {};
    var limit = opts.limit == null ? 1000 : opts.limit;
    var steps = 0;
    while (!isOver(state) && steps < limit) {
      var actor = actorId(state);
      if (actor == null) break;
      var level = opts.levelFor ? opts.levelFor(actor, state) : null;
      var action = chooseAIAction(state, level);
      if (!action) throw new Error('AI returned no action in phase ' + state.phase);
      var result = applyAction(state, action);
      if (!result.ok) throw new Error('AI illegal action in ' + state.phase + ': ' + result.error + ' ' + JSON.stringify(action));
      steps += 1;
    }
    return { steps: steps, over: isOver(state), winner: state.winner, state: state };
  }

  function selfPlay(options) {
    var opts = options || {};
    var games = opts.games == null ? 1 : opts.games;
    var results = [];
    for (var g = 0; g < games; g += 1) {
      var playerCount = opts.playerCount || (2 + (g % 5));
      var state = createGame({
        playerCount: playerCount,
        seed: (opts.seed == null ? 1 : opts.seed) + g * 7919,
        aiAll: true,
        aiLevels: opts.aiLevels || [AI_LEVELS[g % 3], AI_LEVELS[(g + 1) % 3], AI_LEVELS[(g + 2) % 3], AI_LEVELS[(g + 3) % 3], AI_LEVELS[(g + 4) % 3], AI_LEVELS[(g + 5) % 3]]
      });
      var run = autoRun(state, { limit: opts.limit || 800 });
      results.push({
        game: g,
        playerCount: playerCount,
        steps: run.steps,
        over: run.over,
        winner: run.winner,
        winnerInfluence: run.winner >= 0 ? state.players[run.winner].influence.length : 0,
        cards: allCardIds(state).length,
        stats: Object.assign({}, state.stats)
      });
    }
    return results;
  }

  /* ---------- views ---------- */

  function sanitizePending(pending, seat) {
    if (!pending) return null;
    var copy = {
      action: pending.action,
      actor: pending.actor,
      target: pending.target,
      claim: pending.claim || null,
      challenger: pending.challenger == null ? null : pending.challenger,
      blocker: pending.blocker == null ? null : pending.blocker,
      blockClaim: pending.blockClaim || null,
      challengeQueue: (pending.challengeQueue || []).slice(),
      blockQueue: (pending.blockQueue || []).slice(),
      blockRoles: (pending.blockRoles || []).slice(),
      discardQueue: (pending.discardQueue || []).slice(),
      discardReason: pending.discardReason || '',
      cont: pending.cont || null,
      exchange: null
    };
    if (pending.exchange) {
      copy.exchange = {
        actor: pending.exchange.actor,
        count: pending.exchange.cards.length,
        cards: pending.exchange.actor === seat
          ? pending.exchange.cards.map(function (c) { return c.role; })
          : null
      };
    }
    return copy;
  }

  function viewFor(state, seat) {
    var seatId = Number.isInteger(seat) ? seat : null;
    var view = {
      version: state.version,
      playerCount: state.playerCount,
      current: state.current,
      phase: state.phase,
      winner: state.winner,
      over: isOver(state),
      actorId: actorId(state),
      players: state.players.map(function (p, i) {
        return {
          id: p.id,
          name: p.name,
          isAI: p.isAI,
          aiLevel: p.aiLevel || null,
          coins: p.coins,
          eliminated: p.eliminated,
          influenceCount: p.influence.length,
          influence: p.influence.map(function (card) {
            return i === seatId ? { role: card.role, hidden: false } : { role: null, hidden: true };
          }),
          lost: p.lost.slice(),
          hand: i === seatId ? p.influence.map(function (c) { return c.role; }) : null
        };
      }),
      hand: seatId != null && state.players[seatId]
        ? state.players[seatId].influence.map(function (c) { return c.role; })
        : [],
      pending: sanitizePending(state.pending, seatId),
      deckCount: state.deck.length,
      discardCount: state.discard.length,
      log: state.log.slice(-50),
      lastEvent: state.lastEvent,
      lastReveal: state.lastReveal,
      turns: state.turns,
      actionCount: state.actionCount
    };
    return view;
  }

  function winner(state) { return state ? state.winner : null; }

  /* ---------- exports ---------- */

  return Object.freeze({
    VERSION: VERSION,
    ROLES: ROLES,
    ROLE_NAMES: ROLE_NAMES,
    ROLE_GLYPHS: ROLE_GLYPHS,
    ACTION_NAMES: ACTION_NAMES,
    ACTION_COSTS: ACTION_COSTS,
    CLAIM_BY_ACTION: CLAIM_BY_ACTION,
    BLOCK_BY_ACTION: BLOCK_BY_ACTION,
    AI_LEVELS: AI_LEVELS,
    AI_NAMES: AI_NAMES,
    createGame: createGame,
    applyAction: applyAction,
    getLegalActions: getLegalActions,
    legalActions: getLegalActions,
    actionError: actionError,
    actorId: actorId,
    isOver: isOver,
    winner: winner,
    chooseAIAction: chooseAIAction,
    autoRun: autoRun,
    selfPlay: selfPlay,
    viewFor: viewFor,
    allCardIds: allCardIds,
    roleCountsInPlay: roleCountsInPlay,
    aliveIds: aliveIds,
    nextAlive: nextAlive,
    recycleDiscard: recycleDiscard,
    random: random
  });
}));
