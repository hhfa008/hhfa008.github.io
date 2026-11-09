/* Coup (政变) — pure 3-player engine (you + 2 AI).
 * Supports Income, Foreign Aid, Coup, Tax, Assassinate, Steal and Exchange,
 * with challenge / block / discard / exchange state machine.
 * UMD: require() in node tests, window.CoupEngine in the browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CoupEngine = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ROLES = ['duke', 'assassin', 'captain', 'ambassador', 'contessa'];
  var ROLE_NAMES = {
    duke: '公爵', assassin: '刺客', captain: '队长',
    ambassador: '大使', contessa: '女伯爵'
  };
  var ACTION_NAMES = {
    income: '收入', foreign_aid: '外援', coup: '政变', tax: '征税',
    assassinate: '暗杀', steal: '偷取', exchange: '交换'
  };
  var CLAIM_BY_ACTION = { tax: 'duke', assassinate: 'assassin', steal: 'captain', exchange: 'ambassador' };
  var BLOCK_BY_ACTION = {
    foreign_aid: ['duke'],
    assassinate: ['contessa'],
    steal: ['captain', 'ambassador']
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 80) state.log.shift();
  }
  function name(state, id) {
    var p = state.players[id];
    return p && p.name ? p.name : ('玩家' + id);
  }
  function alive(p) { return p && !p.eliminated; }
  function aliveIds(state) {
    return state.players.filter(alive).map(function (p) { return p.id; });
  }
  function hiddenCards(p) {
    return p.influence.map(function (c, i) { return c.revealed ? null : i; })
      .filter(function (i) { return i !== null; });
  }
  function hiddenRoles(p) {
    return p.influence.filter(function (c) { return !c.revealed; })
      .map(function (c) { return c.role; });
  }
  function hasRole(p, role) { return hiddenRoles(p).indexOf(role) >= 0; }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 1 : opts.seed;
    var rng = opts.rng || mulberry32(seed);
    var deck = [];
    ROLES.forEach(function (role) {
      for (var i = 0; i < 3; i++) deck.push({ role: role, revealed: false });
    });
    shuffle(deck, rng);
    var names = opts.names || ['你', '阿尔法', '贝塔'];
    var players = [];
    for (var p = 0; p < 3; p++) {
      players.push({
        id: p,
        name: names[p] || ('玩家' + p),
        coins: 2,
        influence: [deck.pop(), deck.pop()],
        eliminated: false
      });
    }
    var state = {
      players: players,
      deck: deck,
      current: 0,
      phase: 'action',
      pending: null,
      winner: null,
      log: [],
      rng: rng,
      seat: opts.seat == null ? 0 : opts.seat,
      aiAll: !!opts.aiAll
    };
    log(state, '新对局：每人 2 张身份牌、2 枚金币，存活到最后的人获胜。');
    return state;
  }

  function isOver(state) { return state.phase === 'over' || state.winner !== null; }

  function actorId(state) {
    if (state.phase === 'action' || state.phase === 'exchange') return state.current;
    if (state.phase === 'challenge') return state.pending.challengeQueue[0];
    if (state.phase === 'block') return state.pending.blockQueue[0];
    if (state.phase === 'blockChallenge') return state.pending.actor;
    if (state.phase === 'discard') return state.pending.discardQueue[0];
    return null;
  }

  function needsHuman(state) {
    if (state.aiAll || isOver(state)) return false;
    return actorId(state) === state.seat;
  }

  function legalActions(state) {
    if (isOver(state)) return [];
    var a = [];
    var p = state.players[state.current];
    var others = aliveIds(state).filter(function (id) { return id !== state.current; });
    if (state.phase === 'action') {
      a.push({ type: 'income' });
      a.push({ type: 'foreign_aid' });
      a.push({ type: 'tax' });
      a.push({ type: 'exchange' });
      others.forEach(function (t) {
        a.push({ type: 'steal', target: t });
        if (p.coins >= 3) a.push({ type: 'assassinate', target: t });
        if (p.coins >= 7) a.push({ type: 'coup', target: t });
      });
    } else if (state.phase === 'challenge') {
      a.push({ type: 'challenge' });
      a.push({ type: 'pass' });
    } else if (state.phase === 'block') {
      var roles = BLOCK_BY_ACTION[state.pending.action] || [];
      roles.forEach(function (r) { a.push({ type: 'block', role: r }); });
      a.push({ type: 'pass' });
    } else if (state.phase === 'blockChallenge') {
      a.push({ type: 'challenge' });
      a.push({ type: 'pass' });
    } else if (state.phase === 'discard') {
      hiddenCards(state.players[actorId(state)]).forEach(function (i) {
        a.push({ type: 'discard', index: i });
      });
    } else if (state.phase === 'exchange') {
      var ids = state.players[state.current].influence.map(function (c, i) { return i; });
      for (var i = 0; i < ids.length; i++) {
        for (var j = i + 1; j < ids.length; j++) {
          a.push({ type: 'keep', indices: [ids[i], ids[j]] });
        }
      }
    }
    return a;
  }

  function checkGameOver(state) {
    var ids = aliveIds(state);
    if (ids.length <= 1) {
      state.winner = ids.length ? ids[0] : -1;
      state.phase = 'over';
      state.pending = null;
      if (state.winner >= 0) log(state, name(state, state.winner) + '存活到最后，获胜！');
      return true;
    }
    return false;
  }

  function nextAlive(state, from) {
    for (var k = 1; k <= state.players.length; k++) {
      var id = (from + k) % state.players.length;
      if (alive(state.players[id])) return id;
    }
    return from;
  }

  function endTurn(state) {
    if (checkGameOver(state)) return;
    state.pending = null;
    state.current = nextAlive(state, state.current);
    state.phase = 'action';
    log(state, '轮到' + name(state, state.current) + '行动。');
  }

  function startDiscard(state, ids, reason, cont) {
    var queue = ids.filter(function (id) { return alive(state.players[id]) && hiddenCards(state.players[id]).length; });
    if (!queue.length) { continueBy(state, cont); return; }
    state.pending.discardQueue = queue;
    state.pending.discardReason = reason;
    state.pending.cont = cont;
    state.phase = 'discard';
  }

  function continueBy(state, cont) {
    if (isOver(state)) return;
    if (cont === 'afterChallenge') afterChallenge(state);
    else if (cont === 'cancel') { log(state, '行动被取消。'); endTurn(state); }
    else if (cont === 'resolve') resolveAction(state);
    else if (cont === 'blockStands') { log(state, '阻挡生效，行动取消。'); endTurn(state); }
    else if (cont === 'end') endTurn(state);
  }

  function beginChallenge(state, pending) {
    var queue = aliveIds(state).filter(function (id) { return id !== pending.actor; });
    state.pending = pending;
    pending.claim = pending.claim || CLAIM_BY_ACTION[pending.action] || null;
    pending.challengeQueue = queue;
    if (!queue.length) { afterChallenge(state); return; }
    state.phase = 'challenge';
    log(state, name(state, pending.actor) + '宣称' + ACTION_NAMES[pending.action] +
      (pending.target != null ? '（目标：' + name(state, pending.target) + '）' : '') + '，等待挑战。');
  }

  function afterChallenge(state) {
    var pending = state.pending;
    if (!pending) return;
    var blockRoles = BLOCK_BY_ACTION[pending.action];
    if (blockRoles && blockRoles.length) {
      var queue;
      if (pending.action === 'foreign_aid') {
        queue = aliveIds(state).filter(function (id) { return id !== pending.actor; });
      } else {
        queue = (pending.target != null && alive(state.players[pending.target])) ? [pending.target] : [];
      }
      pending.blockQueue = queue;
      if (queue.length) {
        state.phase = 'block';
        log(state, '等待阻挡：' + name(state, queue[0]) + '。');
        return;
      }
    }
    resolveAction(state);
  }

  function resolveAction(state) {
    var pending = state.pending;
    if (!pending) return;
    var p = state.players[pending.actor];
    var target = pending.target == null ? null : state.players[pending.target];
    var action = pending.action;
    state.pending = null;
    if (action === 'income') {
      p.coins += 1;
      log(state, name(state, p.id) + '获得 1 枚金币。');
      endTurn(state);
    } else if (action === 'foreign_aid') {
      p.coins += 2;
      log(state, name(state, p.id) + '获得 2 枚外援金币。');
      endTurn(state);
    } else if (action === 'tax') {
      p.coins += 3;
      log(state, name(state, p.id) + '征税，获得 3 枚金币。');
      endTurn(state);
    } else if (action === 'steal') {
      var amount = Math.min(2, target.coins);
      target.coins -= amount;
      p.coins += amount;
      log(state, name(state, p.id) + '从' + name(state, target.id) + '偷走 ' + amount + ' 枚金币。');
      endTurn(state);
    } else if (action === 'exchange') {
      p.influence.push(state.deck.pop(), state.deck.pop());
      state.phase = 'exchange';
      state.pending = { action: 'exchange', actor: p.id, cont: 'end' };
      log(state, name(state, p.id) + '抽 2 张牌，选择保留 2 张。');
    } else if (action === 'coup') {
      log(state, name(state, p.id) + '发动政变，' + name(state, target.id) + '失去一张身份牌。');
      state.pending = { action: 'coup', actor: p.id, target: target.id };
      startDiscard(state, [target.id], '政变', 'end');
    } else if (action === 'assassinate') {
      log(state, name(state, p.id) + '暗杀' + name(state, target.id) + '。');
      state.pending = { action: 'assassinate', actor: p.id, target: target.id };
      startDiscard(state, [target.id], '暗杀', 'end');
    }
  }

  function doChallenge(state, challenger) {
    var pending = state.pending;
    var actor = state.players[pending.actor];
    if (hasRole(actor, pending.claim)) {
      log(state, name(state, actor.id) + '亮出' + ROLE_NAMES[pending.claim] + '，挑战失败。');
      pending.challenger = challenger;
      startDiscard(state, [challenger], '挑战失败', 'afterChallenge');
    } else {
      log(state, name(state, actor.id) + '没有' + ROLE_NAMES[pending.claim] + '，挑战成功！');
      startDiscard(state, [actor.id], '诈称被拆穿', 'cancel');
    }
  }

  function doBlock(state, role) {
    var pending = state.pending;
    pending.blockClaim = role;
    pending.blocker = pending.blockQueue[0];
    state.phase = 'blockChallenge';
    log(state, name(state, pending.blocker) + '以' + ROLE_NAMES[role] + '阻挡，等待' +
      name(state, pending.actor) + '决定是否挑战。');
  }

  function doBlockChallenge(state) {
    var pending = state.pending;
    var blocker = state.players[pending.blocker];
    if (hasRole(blocker, pending.blockClaim)) {
      log(state, name(state, blocker.id) + '亮出' + ROLE_NAMES[pending.blockClaim] + '，阻挡成立。');
      startDiscard(state, [pending.actor], '挑战阻挡失败', 'blockStands');
    } else {
      log(state, name(state, blocker.id) + '阻挡造假，被拆穿。');
      startDiscard(state, [blocker.id], '阻挡造假', 'resolve');
    }
  }

  function doDiscard(state, index) {
    var pending = state.pending;
    var id = pending.discardQueue[0];
    var p = state.players[id];
    var card = p.influence[index];
    if (!card || card.revealed) return false;
    card.revealed = true;
    log(state, name(state, id) + '失去' + ROLE_NAMES[card.role] + '（' + pending.discardReason + '）。');
    if (hiddenCards(p).length === 0) {
      p.eliminated = true;
      log(state, name(state, id) + '被淘汰。');
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
    var p = state.players[state.current];
    if (!Array.isArray(indices) || indices.length !== 2) return false;
    var uniq = {};
    for (var i = 0; i < indices.length; i++) {
      if (!Number.isInteger(indices[i]) || !p.influence[indices[i]] || uniq[indices[i]]) return false;
      uniq[indices[i]] = 1;
    }
    var kept = indices.map(function (x) { return p.influence[x]; });
    var returned = p.influence.filter(function (c, idx) { return indices.indexOf(idx) < 0; });
    p.influence = kept;
    state.deck = shuffle(state.deck.concat(returned), state.rng);
    log(state, name(state, p.id) + '完成交换，保留 2 张身份牌。');
    endTurn(state);
    return true;
  }

  function applyAction(state, action) {
    if (!action || isOver(state)) return { ok: false, error: '对局已结束' };
    var p = state.players[state.current];
    if (state.phase === 'action') {
      var others = aliveIds(state).filter(function (id) { return id !== p.id; });
      var validTarget = action.target != null && others.indexOf(action.target) >= 0;
      if (action.type === 'income') {
        state.phase = 'action';
        state.pending = { action: 'income', actor: p.id };
        resolveAction(state);
        return { ok: true };
      }
      if (action.type === 'foreign_aid') {
        state.pending = { action: 'foreign_aid', actor: p.id, target: null, claim: null };
        log(state, name(state, p.id) + '申请外援（可被公爵阻挡）。');
        afterChallenge(state);
        return { ok: true };
      }
      if (action.type === 'tax') {
        beginChallenge(state, { action: 'tax', actor: p.id, target: null, claim: 'duke' });
        return { ok: true };
      }
      if (action.type === 'exchange') {
        beginChallenge(state, { action: 'exchange', actor: p.id, target: null, claim: 'ambassador' });
        return { ok: true };
      }
      if (action.type === 'steal') {
        if (!validTarget) return { ok: false, error: '偷取需要存活的对手' };
        beginChallenge(state, { action: 'steal', actor: p.id, target: action.target, claim: 'captain' });
        return { ok: true };
      }
      if (action.type === 'assassinate') {
        if (!validTarget) return { ok: false, error: '暗杀需要存活的对手' };
        if (p.coins < 3) return { ok: false, error: '金币不足（暗杀需 3 枚）' };
        p.coins -= 3;
        beginChallenge(state, { action: 'assassinate', actor: p.id, target: action.target, claim: 'assassin' });
        return { ok: true };
      }
      if (action.type === 'coup') {
        if (!validTarget) return { ok: false, error: '政变需要存活的对手' };
        if (p.coins < 7) return { ok: false, error: '金币不足（政变需 7 枚）' };
        p.coins -= 7;
        state.pending = { action: 'coup', actor: p.id, target: action.target };
        log(state, name(state, p.id) + '支付 7 枚金币发动政变。');
        startDiscard(state, [action.target], '政变', 'end');
        return { ok: true };
      }
      return { ok: false, error: '未知行动' };
    }
    if (state.phase === 'challenge') {
      var actor = state.pending.challengeQueue[0];
      if (action.type === 'challenge') { doChallenge(state, actor); return { ok: true }; }
      if (action.type === 'pass') {
        log(state, name(state, actor) + '不挑战。');
        state.pending.challengeQueue.shift();
        if (!state.pending.challengeQueue.length) afterChallenge(state);
        return { ok: true };
      }
      return { ok: false, error: '当前只能挑战或放弃' };
    }
    if (state.phase === 'block') {
      var blocker = state.pending.blockQueue[0];
      var allowed = BLOCK_BY_ACTION[state.pending.action] || [];
      if (action.type === 'block') {
        if (allowed.indexOf(action.role) < 0) return { ok: false, error: '该角色不能阻挡此行动' };
        doBlock(state, action.role);
        return { ok: true };
      }
      if (action.type === 'pass') {
        log(state, name(state, blocker) + '不阻挡。');
        state.pending.blockQueue.shift();
        if (!state.pending.blockQueue.length) resolveAction(state);
        return { ok: true };
      }
      return { ok: false, error: '当前只能阻挡或放弃' };
    }
    if (state.phase === 'blockChallenge') {
      if (action.type === 'challenge') { doBlockChallenge(state); return { ok: true }; }
      if (action.type === 'pass') {
        log(state, name(state, state.pending.actor) + '接受阻挡，行动取消。');
        endTurn(state);
        return { ok: true };
      }
      return { ok: false, error: '当前只能挑战阻挡或接受' };
    }
    if (state.phase === 'discard') {
      if (action.type !== 'discard') return { ok: false, error: '请选择一张身份牌弃掉' };
      var done = doDiscard(state, action.index);
      return done ? { ok: true } : { ok: false, error: '无效的身份牌' };
    }
    if (state.phase === 'exchange') {
      if (action.type !== 'keep') return { ok: false, error: '请选择保留两张牌' };
      var kept = doKeep(state, action.indices);
      return kept ? { ok: true } : { ok: false, error: '无效的保留选择' };
    }
    return { ok: false, error: '当前不能行动' };
  }

  function aiAction(state) {
    if (isOver(state)) return null;
    var id = actorId(state);
    var p = state.players[id];
    if (state.phase === 'action') {
      var others = aliveIds(state).filter(function (x) { return x !== id; });
      var target = others[Math.floor(state.rng() * others.length)];
      if (p.coins >= 7) return { type: 'coup', target: target };
      var candidates = [{ type: 'income', w: 1 }, { type: 'foreign_aid', w: 1.2 }];
      if (hasRole(p, 'duke')) candidates.push({ type: 'tax', w: 1.6 });
      if (hasRole(p, 'captain')) candidates.push({ type: 'steal', target: target, w: 1.3 });
      if (hasRole(p, 'ambassador')) candidates.push({ type: 'exchange', w: 0.9 });
      if (hasRole(p, 'assassin') && p.coins >= 3) {
        candidates.push({ type: 'assassinate', target: target, w: 1.5 });
      }
      if (state.rng() < 0.1) {
        var bluff = [{ type: 'tax' }, { type: 'steal', target: target }, { type: 'exchange' }];
        candidates.push(Object.assign({ w: 0.5 }, bluff[Math.floor(state.rng() * bluff.length)]));
      }
      var total = candidates.reduce(function (n, c) { return n + c.w; }, 0);
      var roll = state.rng() * total;
      for (var i = 0; i < candidates.length; i++) {
        roll -= candidates[i].w;
        if (roll <= 0) {
          var c = candidates[i];
          return { type: c.type, target: c.target };
        }
      }
      return { type: 'income' };
    }
    if (state.phase === 'challenge') {
      var claim = state.pending.claim;
      var chance = hasRole(p, claim) ? 0.04 : 0.22;
      return state.rng() < chance ? { type: 'challenge' } : { type: 'pass' };
    }
    if (state.phase === 'block') {
      var roles = BLOCK_BY_ACTION[state.pending.action] || [];
      var own = roles.filter(function (r) { return hasRole(p, r); });
      if (own.length && state.rng() < 0.85) return { type: 'block', role: own[0] };
      if (!own.length && state.rng() < 0.08) return { type: 'block', role: roles[0] };
      return { type: 'pass' };
    }
    if (state.phase === 'blockChallenge') {
      return state.rng() < 0.18 ? { type: 'challenge' } : { type: 'pass' };
    }
    if (state.phase === 'discard') {
      var hs = hiddenCards(p);
      return { type: 'discard', index: hs[Math.floor(state.rng() * hs.length)] };
    }
    if (state.phase === 'exchange') {
      var n = p.influence.length;
      var a = Math.floor(state.rng() * n);
      var b = Math.floor(state.rng() * (n - 1));
      if (b >= a) b++;
      return { type: 'keep', indices: [a, b] };
    }
    return null;
  }

  function autoRun(state, limit) {
    var n = 0;
    limit = limit || 500;
    while (!isOver(state) && !needsHuman(state) && n++ < limit) {
      var a = aiAction(state);
      if (!a) break;
      var r = applyAction(state, a);
      if (!r.ok) break;
    }
    return n;
  }

  function viewFor(state, seat) {
    return {
      seat: seat,
      aiAll: state.aiAll,
      current: state.current,
      phase: state.phase,
      winner: state.winner,
      log: state.log.slice(),
      pending: state.pending ? JSON.parse(JSON.stringify(state.pending)) : null,
      players: state.players.map(function (p) {
        return {
          id: p.id,
          name: p.name,
          coins: p.coins,
          eliminated: p.eliminated,
          influence: p.influence.map(function (c) {
            var visible = c.revealed || p.id === seat;
            return { role: visible ? c.role : 'hidden', revealed: c.revealed };
          })
        };
      })
    };
  }

  return {
    ROLES: ROLES,
    ROLE_NAMES: ROLE_NAMES,
    ACTION_NAMES: ACTION_NAMES,
    CLAIM_BY_ACTION: CLAIM_BY_ACTION,
    BLOCK_BY_ACTION: BLOCK_BY_ACTION,
    createGame: createGame,
    viewFor: viewFor,
    needsHuman: needsHuman,
    actorId: actorId,
    legalActions: legalActions,
    aiAction: aiAction,
    applyAction: applyAction,
    autoRun: autoRun,
    isOver: isOver,
    hasRole: hasRole
  };
}));
