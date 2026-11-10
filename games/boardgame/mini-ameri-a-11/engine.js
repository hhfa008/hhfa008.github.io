/* Mini ameri-style duel engine — generated; pure UMD, seedable. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniEngine = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CONFIG = {
    "family": "monster",
    "name": "古墓守卫",
    "en": "Tomb Warden",
    "hero0": "探险家·凯",
    "hero1": "守墓巨像",
    "hp0": 22,
    "hp1": 32,
    "diceCount": 2,
    "diceFaces": 6,
    "critAt": 6,
    "critBonus": 2,
    "guardValue": 3,
    "startRes": 0,
    "specialCost": 3,
    "specialDamage": 6,
    "healAmount": 0,
    "focusHeal": 0,
    "monsterBonus": 2,
    "bannerAt": 0,
    "bannersToWin": 0,
    "specialName": "破墓锤",
    "maxRounds": 18,
    "events": [
      {
        "name": "血月",
        "text": "本回合双方攻击 +2",
        "atkBonus": 2
      },
      {
        "name": "治疗泉",
        "text": "双方回复 2 点生命",
        "healBoth": 2
      },
      {
        "name": "补给车",
        "text": "双方获得 1 点能量",
        "resBoth": 1
      },
      {
        "name": "铁壁",
        "text": "双方获得 2 点护盾",
        "guardBoth": 2
      },
      {
        "name": "混乱",
        "text": "本回合双方攻击 -1",
        "atkBonus": -1
      }
    ]
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 60) state.log.shift();
  }
  function other(id) { return id === 0 ? 1 : 0; }

  function applyEvent(state) {
    var ev = CONFIG.events[Math.floor(state.rng() * CONFIG.events.length)];
    state.event = ev;
    log(state, '【事件】' + ev.name + '：' + ev.text);
    state.players.forEach(function (p) {
      if (ev.healBoth) p.hp = Math.min(p.maxHp, p.hp + ev.healBoth);
      if (ev.resBoth) p.res += ev.resBoth;
      if (ev.guardBoth) p.guard += ev.guardBoth;
    });
  }
  function startRound(state) {
    state.event = null;
    if (CONFIG.family === 'event') applyEvent(state);
  }

  function createGame(opts) {
    opts = opts || {};
    var rng = opts.rng || mulberry32(opts.seed == null ? 1 : opts.seed);
    var state = {
      round: 1,
      turn: 0,
      phase: 'play',
      winner: null,
      lastRoll: [],
      lastDamage: 0,
      event: null,
      log: [],
      players: [
        { id: 0, name: CONFIG.hero0, hp: CONFIG.hp0, maxHp: CONFIG.hp0, guard: 0, res: CONFIG.startRes || 0, banners: 0 },
        { id: 1, name: CONFIG.hero1, hp: CONFIG.hp1, maxHp: CONFIG.hp1, guard: 0, res: CONFIG.startRes || 0, banners: 0 }
      ],
      rng: rng
    };
    log(state, '对局开始：' + CONFIG.hero0 + ' vs ' + CONFIG.hero1);
    startRound(state);
    return state;
  }

  function legalActions(state) {
    if (state.phase === 'over') return [];
    var p = state.players[state.turn];
    var acts = ['attack', 'guard', 'focus'];
    if (p.res >= CONFIG.specialCost) acts.push('special');
    return acts;
  }

  function strike(state, attacker, extraDice, flat, ignoreGuard) {
    var rolls = [];
    var n = CONFIG.diceCount + extraDice;
    for (var i = 0; i < n; i++) rolls.push(1 + Math.floor(state.rng() * CONFIG.diceFaces));
    var crits = 0, sum = 0;
    rolls.forEach(function (r) { sum += r; if (r >= CONFIG.critAt) crits++; });
    var bonus = crits * CONFIG.critBonus + flat;
    if (state.event && state.event.atkBonus) bonus += state.event.atkBonus;
    if (CONFIG.family === 'monster' && attacker.id === 1) bonus += (CONFIG.monsterBonus || 0);
    var target = state.players[other(attacker.id)];
    var raw = Math.max(1, sum + bonus);
    var dmg;
    if (ignoreGuard) {
      dmg = raw;
    } else {
      dmg = Math.max(0, raw - target.guard);
      target.guard = 0;
    }
    target.hp = Math.max(0, target.hp - dmg);
    state.lastRoll = rolls;
    state.lastDamage = dmg;
    log(state, attacker.name + ' 出手 ' + rolls.join('+') +
      (crits ? '（暴击×' + crits + '）' : '') + ' → ' + dmg + ' 伤害');
    if (CONFIG.family === 'faction' && dmg >= CONFIG.bannerAt) {
      attacker.banners += 1;
      log(state, attacker.name + ' 夺旗！旗帜 ' + attacker.banners + '/' + CONFIG.bannersToWin);
    }
    return dmg;
  }

  function special(state, p, foe) {
    if (CONFIG.family === 'dice') {
      log(state, p.name + ' 发动【' + CONFIG.specialName + '】');
      strike(state, p, 2, 1, false);
    } else if (CONFIG.family === 'skill') {
      foe.hp = Math.max(0, foe.hp - CONFIG.specialDamage);
      p.hp = Math.min(p.maxHp, p.hp + CONFIG.healAmount);
      log(state, p.name + ' 发动【' + CONFIG.specialName + '】：' + CONFIG.specialDamage +
        ' 穿甲伤害，回复 ' + CONFIG.healAmount);
    } else if (CONFIG.family === 'monster') {
      var bonus = p.id === 1 ? (CONFIG.monsterBonus || 0) : 0;
      foe.guard = 0;
      foe.hp = Math.max(0, foe.hp - CONFIG.specialDamage - bonus);
      if (p.id === 0) p.hp = Math.min(p.maxHp, p.hp + 2);
      log(state, p.name + ' 发动【' + CONFIG.specialName + '】：' + (CONFIG.specialDamage + bonus) +
        ' 穿甲伤害并击碎护盾' + (p.id === 0 ? '，回复 2' : ''));
    } else if (CONFIG.family === 'event') {
      foe.hp = Math.max(0, foe.hp - CONFIG.specialDamage);
      p.hp = Math.min(p.maxHp, p.hp + 1);
      log(state, p.name + ' 发动【' + CONFIG.specialName + '】：' + CONFIG.specialDamage + ' 穿甲伤害，回复 1');
    } else {
      p.banners += 1;
      foe.hp = Math.max(0, foe.hp - CONFIG.specialDamage);
      log(state, p.name + ' 发动【' + CONFIG.specialName + '】：获得 1 面旗帜，' +
        CONFIG.specialDamage + ' 点穿甲伤害');
    }
  }

  function finalize(state) {
    state.phase = 'over';
    var p0 = state.players[0], p1 = state.players[1];
    if (p0.hp !== p1.hp) state.winner = p0.hp > p1.hp ? 0 : 1;
    else if (p0.banners !== p1.banners) state.winner = p0.banners > p1.banners ? 0 : 1;
    else if (p0.res !== p1.res) state.winner = p0.res > p1.res ? 0 : 1;
    else state.winner = 'draw';
    log(state, state.winner === 'draw' ? '回合用尽，平局！' : state.players[state.winner].name + ' 获胜！');
  }

  function checkOver(state) {
    if (state.phase === 'over') return;
    var p0 = state.players[0], p1 = state.players[1];
    if (p0.hp <= 0 || p1.hp <= 0) {
      state.phase = 'over';
      state.winner = p0.hp <= 0 && p1.hp <= 0 ? 'draw' : (p0.hp <= 0 ? 1 : 0);
      log(state, state.winner === 'draw' ? '同归于尽，平局！' : state.players[state.winner].name + ' 获胜！');
      return;
    }
    if (CONFIG.family === 'faction' &&
        (p0.banners >= CONFIG.bannersToWin || p1.banners >= CONFIG.bannersToWin)) {
      state.phase = 'over';
      if (p0.banners >= CONFIG.bannersToWin && p1.banners >= CONFIG.bannersToWin) {
        state.winner = p0.banners === p1.banners ? 'draw' : (p0.banners > p1.banners ? 0 : 1);
      } else {
        state.winner = p0.banners >= CONFIG.bannersToWin ? 0 : 1;
      }
      log(state, state.winner === 'draw' ? '旗帜相同，平局！' : state.players[state.winner].name + ' 凭旗帜获胜！');
    }
  }

  function applyAction(state, action) {
    if (!action || state.phase === 'over') return { ok: false, error: '对局已结束' };
    if (legalActions(state).indexOf(action.type) < 0) return { ok: false, error: '非法行动' };
    var p = state.players[state.turn];
    var foe = state.players[other(state.turn)];
    if (action.type === 'attack') {
      strike(state, p, 0, 0, false);
    } else if (action.type === 'guard') {
      p.guard += CONFIG.guardValue;
      p.res += 1;
      log(state, p.name + ' 举盾：护盾 +' + CONFIG.guardValue + '，能量 +1');
    } else if (action.type === 'focus') {
      p.res += 2;
      if (CONFIG.focusHeal) p.hp = Math.min(p.maxHp, p.hp + CONFIG.focusHeal);
      log(state, p.name + ' 蓄力：能量 +2' + (CONFIG.focusHeal ? '，回复 ' + CONFIG.focusHeal : ''));
    } else if (action.type === 'special') {
      p.res -= CONFIG.specialCost;
      special(state, p, foe);
    }
    checkOver(state);
    if (state.phase !== 'over') {
      if (state.turn === 1) {
        state.turn = 0;
        state.round += 1;
        if (state.round > CONFIG.maxRounds) finalize(state);
        else startRound(state);
      } else {
        state.turn = 1;
      }
    }
    return { ok: true };
  }

  function aiAction(state) {
    if (state.phase === 'over') return null;
    var acts = legalActions(state);
    if (!acts.length) return null;
    var me = state.players[state.turn];
    var you = state.players[other(state.turn)];
    if (you.hp <= 6) return { type: 'attack' };
    if (acts.indexOf('special') >= 0 &&
        (you.hp <= CONFIG.specialDamage + 4 || me.hp < me.maxHp * 0.4 || state.rng() < 0.35)) {
      return { type: 'special' };
    }
    if (me.hp < me.maxHp * 0.35 && me.guard < CONFIG.guardValue) return { type: 'guard' };
    if (me.res < CONFIG.specialCost && state.rng() < 0.65) return { type: 'focus' };
    return { type: 'attack' };
  }

  return {
    CONFIG: CONFIG,
    createGame: createGame,
    legalActions: legalActions,
    applyAction: applyAction,
    aiAction: aiAction,
    isOver: function (state) { return state.phase === 'over'; }
  };
}));
