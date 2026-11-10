'use strict';
/* Mini dice engine (UMD) - pure, seedable, no DOM and no network. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DiceMiniEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var CFG = {"name":"押面小铺","mode":"bet","aiName":"铺娘","faces":6,"maxRounds":4,"betDice":2,"payout":2,"stake":2,"maxBets":3,"start":12};

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function d6(g) { return 1 + Math.floor(g.rng() * CFG.faces); }
  function sideName(g) { return g.turn === 'you' ? '你' : CFG.aiName; }
  function scoreOf(g, side) { return g.mode === 'bet' ? g[side].bankroll : g[side].score; }

  function addLog(g, msg) {
    g.last = msg;
    g.log.push(msg);
    if (g.log.length > 40) g.log.shift();
  }

  function finish(g, forced) {
    g.phase = 'over';
    if (forced) g.winner = forced;
    else {
      var a = scoreOf(g, 'you'), b = scoreOf(g, 'ai');
      g.winner = a > b ? 'you' : (a < b ? 'ai' : 'draw');
    }
    var tail = g.winner === 'draw' ? '平局' : (g.winner === 'you' ? '你获胜' : '对手获胜');
    addLog(g, '对局结束：' + tail + '。你的成绩 ' + scoreOf(g, 'you') + '，对手成绩 ' + scoreOf(g, 'ai') + '。');
  }

  function endTurn(g) {
    g[g.turn].bets = 0;
    g.pot = 0; g.rolls = 0; g.multiplier = 1;
    g.dice = []; g.current = 0; g.streak = 0;
    if (g.turn === 'you') {
      g.turn = 'ai';
    } else {
      g.turn = 'you';
      g.round++;
      if (g.round > g.maxRounds) return finish(g);
    }
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 1 : (opts.seed >>> 0);
    return {
      cfg: CFG, seed: seed, rng: mulberry32(seed), mode: CFG.mode,
      round: 1, maxRounds: CFG.maxRounds, turn: 'you',
      you: { score: 0, bankroll: CFG.start || 0, bets: 0 },
      ai: { score: 0, bankroll: CFG.start || 0, bets: 0 },
      pot: 0, multiplier: 1, rolls: 0, dice: [], current: 0, streak: 0,
      phase: 'play', winner: null, last: '准备开始',
      log: ['新对局开始，你先行动。']
    };
  }

  function actions(g) {
    if (g.phase === 'over') return [];
    if (g.mode === 'push' || g.mode === 'chain') {
      if (g.rolls >= CFG.maxRolls) return [{ id: 'bank', label: '落袋 +' + g.pot }];
      var out = [{ id: 'roll', label: g.rolls ? '再掷一次' : '掷骰' }];
      if (g.pot > 0) out.push({ id: 'bank', label: '落袋 +' + g.pot });
      return out;
    }
    if (g.mode === 'highlow') {
      if (g.current === 0) return [{ id: 'roll', label: '掷起始骰' }];
      if (g.rolls >= CFG.maxRolls) return [{ id: 'bank', label: '落袋 +' + g.pot }];
      var h = [{ id: 'high', label: '猜更大' }, { id: 'low', label: '猜更小' }];
      if (g.pot > 0) h.push({ id: 'bank', label: '落袋 +' + g.pot });
      return h;
    }
    var p = g[g.turn];
    if (p.bankroll <= 0) return [{ id: 'end', label: '结束回合' }];
    var faces = [];
    for (var f = 1; f <= CFG.faces; f++) faces.push({ id: 'face:' + f, label: '押 ' + f + ' 点' });
    return faces;
  }

  function hasAction(g, id) {
    var as = actions(g);
    for (var i = 0; i < as.length; i++) if (as[i].id === id) return true;
    return false;
  }

  function act(g, id) {
    if (!g || g.phase === 'over') return { ok: false, error: '对局已结束' };
    if (!hasAction(g, id)) return { ok: false, error: '动作不可用' };
    var p = g[g.turn];
    var i, d, dice, sum, gain, lost, face, stake, hits, profit;

    if (g.mode === 'push') {
      if (id === 'roll') {
        dice = [];
        for (i = 0; i < CFG.dice; i++) dice.push(d6(g));
        g.dice = dice; g.rolls++;
        if (dice.indexOf(CFG.bust) >= 0) {
          lost = g.pot; g.pot = 0;
          if (CFG.penalty > 0) p.score = Math.max(0, p.score - CFG.penalty);
          addLog(g, sideName(g) + '掷出 ' + dice.join('、') + '，爆点，奖池清零' + (CFG.penalty > 0 ? '并倒扣 ' + CFG.penalty + ' 分' : '') + '。');
          endTurn(g);
          return { ok: true, bust: true };
        }
        sum = 0; for (i = 0; i < dice.length; i++) sum += dice[i];
        var crit = CFG.critDouble && dice.length > 1 && dice.every(function (x) { return x === dice[0]; });
        gain = crit ? sum * 2 : sum;
        g.pot += gain;
        addLog(g, sideName(g) + '掷出 ' + dice.join('、') + '，奖池 +' + gain + (crit ? '（同点翻倍）' : '') + '。');
        return { ok: true };
      }
      if (id === 'bank') {
        p.score += g.pot;
        addLog(g, sideName(g) + '落袋，总分 +' + g.pot + '。');
        endTurn(g);
        return { ok: true };
      }
    }

    if (g.mode === 'chain') {
      if (id === 'roll') {
        d = d6(g); g.dice = [d]; g.rolls++;
        if (d === CFG.bust) {
          lost = g.pot; g.pot = 0;
          addLog(g, sideName(g) + '掷出 ' + d + '，爆点，损失奖池 ' + lost + '。');
          endTurn(g);
          return { ok: true, bust: true };
        }
        gain = d * g.multiplier;
        g.pot += gain;
        addLog(g, sideName(g) + '掷出 ' + d + '，' + g.multiplier + ' 倍，奖池 +' + gain + '。');
        g.multiplier++;
        return { ok: true };
      }
      if (id === 'bank') {
        p.score += g.pot;
        addLog(g, sideName(g) + '落袋，总分 +' + g.pot + '。');
        if (p.score >= CFG.target) { finish(g, g.turn); return { ok: true, won: true }; }
        endTurn(g);
        return { ok: true };
      }
    }

    if (g.mode === 'highlow') {
      if (id === 'roll') {
        d = d6(g); g.dice = [d]; g.current = d;
        addLog(g, sideName(g) + '掷出起始骰 ' + d + '。');
        return { ok: true };
      }
      if (id === 'high' || id === 'low') {
        var from = g.current;
        var next = d6(g); g.rolls++;
        var correct = id === 'high' ? next > from : next < from;
        g.current = next; g.dice = [from, next];
        if (!correct) {
          lost = g.pot; g.pot = 0;
          addLog(g, sideName(g) + '猜 ' + (id === 'high' ? '更大' : '更小') + '，开 ' + from + ' 后出 ' + next + '，猜错，奖池清零。');
          endTurn(g);
          return { ok: true, wrong: true };
        }
        g.pot += next; g.streak++;
        addLog(g, sideName(g) + '猜 ' + (id === 'high' ? '更大' : '更小') + '，' + from + ' 后出 ' + next + '，猜对，奖池 +' + next + '。');
        if (g.rolls >= CFG.maxRolls) addLog(g, '本轮猜数次已达上限，只能落袋。');
        return { ok: true };
      }
      if (id === 'bank') {
        p.score += g.pot;
        addLog(g, sideName(g) + '落袋，总分 +' + g.pot + '。');
        endTurn(g);
        return { ok: true };
      }
    }

    if (g.mode === 'bet') {
      if (id === 'end') {
        addLog(g, sideName(g) + '筹码不足，结束本轮。');
        endTurn(g);
        return { ok: true };
      }
      face = parseInt(id.slice(5), 10);
      if (!(face >= 1 && face <= CFG.faces)) return { ok: false, error: '押注点数非法' };
      stake = Math.min(CFG.stake, p.bankroll);
      if (stake <= 0) { endTurn(g); return { ok: true }; }
      p.bankroll -= stake;
      dice = [];
      for (i = 0; i < CFG.betDice; i++) dice.push(d6(g));
      g.dice = dice;
      hits = 0;
      for (i = 0; i < dice.length; i++) if (dice[i] === face) hits++;
      if (hits > 0) {
        profit = stake * CFG.payout * hits;
        p.bankroll += stake + profit;
        addLog(g, sideName(g) + '押 ' + face + ' 点，开 ' + dice.join('、') + '，命中 ' + hits + ' 颗，净赚 ' + profit + '。');
      } else {
        addLog(g, sideName(g) + '押 ' + face + ' 点，开 ' + dice.join('、') + '，未命中，损失 ' + stake + '。');
      }
      p.bets++;
      if (p.bankroll <= 0 || p.bets >= CFG.maxBets) endTurn(g);
      return { ok: true };
    }

    return { ok: false, error: '未知模式' };
  }

  function autoMove(g) {
    if (!g || g.phase === 'over') return { ok: false, error: '对局已结束' };
    var as = actions(g);
    if (!as.length) { finish(g); return { ok: false, error: '无可用动作' }; }
    var id = null;
    var p = g[g.turn];
    var i;
    if (g.mode === 'push' || g.mode === 'chain') {
      id = (g.pot >= CFG.aiBank || g.rolls >= CFG.maxRolls) ? 'bank' : 'roll';
    } else if (g.mode === 'highlow') {
      if (g.current === 0) id = 'roll';
      else if (g.pot >= CFG.aiBank || g.rolls >= CFG.maxRolls) id = 'bank';
      else id = g.current <= Math.ceil(CFG.faces / 2) ? 'high' : 'low';
    } else {
      if (p.bankroll <= 0) id = 'end';
      else id = 'face:' + (1 + Math.floor(g.rng() * CFG.faces));
    }
    var found = false;
    for (i = 0; i < as.length; i++) if (as[i].id === id) found = true;
    if (!found) id = as[0].id;
    return act(g, id);
  }

  function view(g) {
    var as = actions(g);
    var out = [];
    for (var i = 0; i < as.length; i++) out.push({ id: as[i].id, label: as[i].label });
    return {
      meta: { name: CFG.name, mode: g.mode, aiName: CFG.aiName },
      mode: g.mode,
      round: g.round, maxRounds: g.maxRounds, turn: g.turn,
      phase: g.phase, winner: g.winner,
      you: { score: g.you.score, bankroll: g.you.bankroll },
      ai: { score: g.ai.score, bankroll: g.ai.bankroll },
      pot: g.pot, multiplier: g.multiplier, rolls: g.rolls, maxRolls: CFG.maxRolls,
      dice: g.dice.slice(), current: g.current, streak: g.streak,
      target: CFG.target, stake: CFG.stake, payout: CFG.payout,
      maxBets: CFG.maxBets, faces: CFG.faces, betDice: CFG.betDice, bust: CFG.bust,
      actions: out, last: g.last, log: g.log.slice(-8)
    };
  }

  var META = { name: CFG.name, mode: CFG.mode };
  return { createGame: createGame, actions: actions, act: act, autoMove: autoMove, aiTurn: autoMove, view: view, META: META, CFG: CFG };
});
