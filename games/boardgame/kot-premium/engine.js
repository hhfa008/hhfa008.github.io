/*
 * 东京妖都（Kot Premium）纯规则引擎 — UMD
 *
 * 浏览器：<script src="../../shared/shuffle.js"></script>
 *          <script src="data.js"></script><script src="engine.js"></script>
 * Node：  const E = require('./engine.js')
 *
 * 共享模块：牌库洗牌委托给 games/shared/shuffle.js（禁止复制 Fisher-Yates）。
 * 骰子随机数使用 state.rng 的 mulberry32，保证注入 seed 后完全可复现。
 *
 * 设计约束：
 *   - 不依赖 DOM；每个动作返回全新 state，不修改传入对象。
 *   - 所有随机性来自 createGame 的 seed（mulberry32），不使用 Math.random。
 *   - AI 只从 getLegalMoves(state) 的结果中选择动作。
 *   - 非法动作一律抛出 Error。
 *
 * 规则说明：2–4 人；6 颗骰子、最多 3 次掷骰；数字三连得分、爪击、
 * 治疗、能量；东京城/东京湾（4 人局启用湾）；20 分或最后存活获胜。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('../../shared/shuffle.js'));
  } else {
    root.KotEngine = factory(root.KOT_DATA, root.Shuffle);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DATA, Shuffle) {
  'use strict';

  if (!DATA || !DATA.MONSTERS || !DATA.CARDS) {
    throw new Error('KotEngine 需要先加载 data.js');
  }
  if (!Shuffle || typeof Shuffle.shuffle !== 'function') {
    throw new Error('KotEngine 需要先加载 games/shared/shuffle.js');
  }

  var FACES = ['1', '2', '3', 'claw', 'heart', 'energy'];
  var FACE_LABELS = {
    '1': '数字 1', '2': '数字 2', '3': '数字 3',
    claw: '爪击', heart: '治疗', energy: '能量'
  };
  var WIN_VP = 20;
  var START_HP = 10;
  var START_DICE = 6;
  var MAX_ROLLS = 3;
  var SWEEP_COST = 2;
  var TOKYO_SLOTS = ['city', 'bay'];
  var SLOT_LABELS = { city: '东京城', bay: '东京湾' };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /* mulberry32：状态保存在 state.rng，保证注入 seed 后完全可复现。 */
  function nextRandom(state) {
    var a = (state.rng >>> 0) + 0x6D2B79F5;
    state.rng = a >>> 0;
    var t = state.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function randomFace(state) {
    return FACES[Math.floor(nextRandom(state) * FACES.length)];
  }

  function bayEnabled(state) {
    return state.playerCount >= 4;
  }

  function getOccupant(state, slot) {
    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      if (p.alive && p.location === slot) return p;
    }
    return null;
  }

  function playerById(state, id) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return state.players[i];
    }
    return null;
  }

  function hasCard(player, cardId) {
    return !!player && (player.cards || []).indexOf(cardId) !== -1;
  }

  function diceCounts(state) {
    var counts = { '1': 0, '2': 0, '3': 0, claw: 0, heart: 0, energy: 0 };
    state.dice.forEach(function (die) { counts[die.face] += 1; });
    return counts;
  }

  function log(state, type, text, extra) {
    state.logSeq = (state.logSeq || 0) + 1;
    var entry = { type: type, text: text, seq: state.logSeq };
    if (extra) {
      Object.keys(extra).forEach(function (key) { entry[key] = extra[key]; });
    }
    state.log.push(entry);
    if (state.log.length > 200) state.log.shift();
    return entry;
  }

  function alivePlayers(state) {
    return state.players.filter(function (p) { return p.alive; });
  }

  function gainVP(state, player, amount, reason) {
    if (!player || !player.alive || amount <= 0) return;
    player.vp += amount;
    log(state, 'vp', player.name + ' +' + amount + ' 分' + (reason ? '（' + reason + '）' : ''), {
      playerId: player.id, amount: amount, reason: reason || ''
    });
  }

  function gainEnergy(state, player, amount, reason) {
    if (!player || !player.alive || amount <= 0) return;
    player.energy += amount;
    log(state, 'energy', player.name + ' +' + amount + ' 能量' + (reason ? '（' + reason + '）' : ''), {
      playerId: player.id, amount: amount, reason: reason || ''
    });
  }

  function healPlayer(state, player, amount, reason) {
    if (!player || !player.alive || amount <= 0) return 0;
    var actual = Math.min(amount, player.maxHp - player.hp);
    if (actual <= 0) return 0;
    player.hp += actual;
    log(state, 'heal', player.name + ' 回复 ' + actual + ' 生命' + (reason ? '（' + reason + '）' : ''), {
      playerId: player.id, amount: actual, reason: reason || ''
    });
    return actual;
  }

  function setWinner(state, player, reason) {
    if (state.gameOver) return;
    state.gameOver = true;
    state.winner = player ? player.id : null;
    state.winnerName = player ? player.name : null;
    state.winReason = reason;
    state.phase = 'gameover';
    state.pending = null;
    log(state, 'win',
      (player ? player.name + ' 成为东京之王！' : '游戏结束') +
      (reason === 'points' ? '（达到 20 分）' : '（最后存活）'),
      { playerId: player ? player.id : null, reason: reason });
  }

  function checkVictory(state) {
    if (state.gameOver) return;
    var alive = alivePlayers(state);
    if (alive.length === 1) {
      setWinner(state, alive[0], 'last');
      return;
    }
    if (alive.length === 0) return;
    var champion = null;
    alive.forEach(function (p) {
      if (p.vp >= WIN_VP && (!champion || p.vp > champion.vp)) champion = p;
    });
    if (champion) setWinner(state, champion, 'points');
  }

  function eliminate(state, player, attacker) {
    if (!player.alive) return;
    player.alive = false;
    player.hp = 0;
    var lostCards = (player.cards || []).slice();
    lostCards.forEach(function (cardId) { state.discard.push(cardId); });
    player.cards = [];
    player.energy = 0;
    player.location = null;
    log(state, 'eliminate', player.name + ' 被淘汰' + (attacker ? '（' + attacker.name + ' 的爪击）' : ''), {
      playerId: player.id, attackerId: attacker ? attacker.id : null
    });
    checkVictory(state);
  }

  function rollAnimationFaces(state) {
    state.dice.forEach(function (die) {
      if (!die.locked) die.face = randomFace(state);
    });
  }

  function resolveSmash(state, attacker, clawCount) {
    var targets;
    if (attacker.location) {
      targets = state.players.filter(function (p) { return p.alive && p.location === null; });
    } else {
      targets = state.players.filter(function (p) { return p.alive && p.location !== null; });
    }

    log(state, 'smash', attacker.name + ' 结算 ' + clawCount + ' 个爪击' +
      (targets.length ? '，命中 ' + targets.length + ' 个目标' : '，但东京里没有人'), {
      playerId: attacker.id, claws: clawCount, targetIds: targets.map(function (p) { return p.id; })
    });

    if (!targets.length) return;

    var bonus = 0;
    if (hasCard(attacker, 'acid-claw')) bonus += 1;
    if (hasCard(attacker, 'spiked-tail')) bonus += 1;
    var baseDamage = clawCount + bonus;
    state.stats.attacks += 1;
    var yieldQueue = [];

    targets.forEach(function (target) {
      if (state.gameOver || !target.alive) return;
      var armor = 0;
      if (hasCard(target, 'lava-armor')) armor += 1;
      if (hasCard(target, 'tidal-shell') && target.location) armor += 1;
      var damage = Math.max(0, baseDamage - armor);
      if (damage <= 0) {
        log(state, 'block', target.name + ' 的护甲挡下了这次爪击', {
          playerId: attacker.id, targetId: target.id, amount: 0
        });
        return;
      }
      target.hp -= damage;
      state.stats.damage += damage;
      log(state, 'attack', target.name + ' 受到 ' + damage + ' 点伤害', {
        playerId: attacker.id, targetId: target.id, amount: damage
      });
      if (target.hp <= 0) {
        eliminate(state, target, attacker);
      } else if (target.location) {
        target.tookClawDamage = true;
        yieldQueue.push(target.id);
      }
    });

    if (state.gameOver) return;
    if (yieldQueue.length) {
      state.pending = { type: 'yield', playerId: yieldQueue[0], queue: yieldQueue, playerIds: yieldQueue.slice() };
      state.phase = 'yield';
    }
  }

  function resolveDice(state) {
    var player = state.players[state.current];
    var counts = diceCounts(state);
    var faces = state.dice.map(function (die) { return die.face; });

    log(state, 'resolve', player.name + ' 结算：' + faces.map(function (face) {
      return FACE_LABELS[face];
    }).join('、'), { playerId: player.id, faces: faces });

    /* 数字三连：3 个同数字得该数字分，之后每多 1 个再 +1 分。 */
    ['1', '2', '3'].forEach(function (face) {
      if (counts[face] >= 3) {
        gainVP(state, player, parseInt(face, 10) + (counts[face] - 3), '数字 ' + face + ' 三连');
      }
    });
    checkVictory(state);
    if (state.gameOver) return;

    /* 能量面：每颗 1 能量；能量虹吸在三颗以上时额外 +1。 */
    if (counts.energy > 0) {
      gainEnergy(state, player, counts.energy, '能量面');
      if (hasCard(player, 'energy-siphon') && counts.energy >= 3) {
        gainEnergy(state, player, 1, '能量虹吸');
      }
    }

    /* 治疗面：东京外每颗回复 1；在东京内不回复。 */
    if (counts.heart > 0) {
      if (player.location) {
        log(state, 'noheal', player.name + ' 在东京内无法用治疗面回复生命', {
          playerId: player.id, amount: 0
        });
      } else {
        var heal = counts.heart + (hasCard(player, 'regen-gland') ? 1 : 0);
        var healed = healPlayer(state, player, heal, '治疗面');
        if (healed === 0) {
          log(state, 'noheal', player.name + ' 生命已满，治疗无效', {
            playerId: player.id, amount: 0
          });
        }
      }
    }

    /* 爪击：在东京内打所有城外怪兽；在城外打东京城/湾内的怪兽。 */
    if (counts.claw > 0) {
      resolveSmash(state, player, counts.claw);
    }
    if (state.gameOver) return;

    if (hasCard(player, 'hunter-instinct') && counts.claw >= 3) {
      gainVP(state, player, 1, '猎手直觉');
    }
    checkVictory(state);
    if (state.gameOver) return;

    if (state.pending && state.pending.type === 'yield') {
      state.phase = 'yield';
      return;
    }
    afterResolution(state);
  }

  function afterResolution(state) {
    if (state.gameOver) return;
    var player = state.players[state.current];
    if (!player || !player.alive) {
      advanceTurn(state);
      return;
    }
    if (player.location === null) {
      var city = getOccupant(state, 'city');
      var bay = bayEnabled(state) ? getOccupant(state, 'bay') : null;
      if (!city) {
        state.pending = { type: 'enter', playerId: player.id, options: ['city'], forced: true };
        state.phase = 'enter';
        return;
      }
      if (bayEnabled(state) && !bay) {
        state.pending = { type: 'enter', playerId: player.id, options: ['bay'], forced: false };
        state.phase = 'enter';
        return;
      }
    }
    state.pending = null;
    state.phase = 'buy';
  }

  function startTurn(state) {
    var player = state.players[state.current];
    state.pending = null;
    state.phase = 'rolling';
    state.rollsLeft = MAX_ROLLS;
    state.rollCount = 0;
    state.buyCountThisTurn = 0;
    state.dice = [];
    for (var i = 0; i < START_DICE; i++) state.dice.push({ face: '1', locked: false });
    if (player) player.tookClawDamage = false;

    log(state, 'turn', '轮到 ' + player.name + '（第 ' + state.round + ' 轮）', {
      playerId: player.id, round: state.round
    });

    if (player && player.alive && player.location) {
      gainVP(state, player, 2, '东京驻守');
      if (hasCard(player, 'royal-presence')) gainVP(state, player, 2, '王者威仪');
    }
    if (player && player.alive && hasCard(player, 'thunder-crown')) {
      gainVP(state, player, 1, '雷鸣王冠');
    }
    if (player && player.alive && hasCard(player, 'solar-core')) {
      gainEnergy(state, player, 1, '太阳能核');
    }
    checkVictory(state);
  }

  function advanceTurn(state) {
    var start = state.current;
    var next = start;
    for (var step = 1; step <= state.playerCount; step++) {
      var candidate = (start + step) % state.playerCount;
      if (state.players[candidate].alive) { next = candidate; break; }
    }
    state.current = next;
    state.turn += 1;
    state.round = Math.floor((state.turn - 1) / state.playerCount) + 1;
    startTurn(state);
  }

  function createGame(options) {
    var opts = options || {};
    var configs = opts.players || null;
    var count = opts.playerCount != null ? opts.playerCount : (configs ? configs.length : 2);
    if (count < 2 || count > 4) throw new Error('玩家人数必须是 2–4 人');
    if (configs && configs.length !== count) throw new Error('players 数量与 playerCount 不一致');

    var seed = opts.seed == null ? (Date.now() >>> 0) : (opts.seed >>> 0);
    var state = {
      seed: seed,
      rng: seed >>> 0,
      playerCount: count,
      players: [],
      current: 0,
      turn: 1,
      round: 1,
      phase: 'rolling',
      rollsLeft: MAX_ROLLS,
      rollCount: 0,
      buyCountThisTurn: 0,
      dice: [],
      deck: [],
      shop: [],
      discard: [],
      pending: null,
      gameOver: false,
      winner: null,
      winnerName: null,
      winReason: null,
      log: [],
      logSeq: 0,
      stats: { rolls: 0, attacks: 0, damage: 0, cardsBought: 0, turns: 0 }
    };

    for (var i = 0; i < count; i++) {
      var cfg = configs ? (configs[i] || {}) : {};
      var monster = cfg.monsterId ? DATA.monsterById(cfg.monsterId) : DATA.MONSTERS[i % DATA.MONSTERS.length];
      if (!monster) monster = DATA.MONSTERS[i % DATA.MONSTERS.length];
      var maxHp = monster.maxHp || START_HP;
      state.players.push({
        id: 'p' + i,
        name: cfg.name || (i === 0 ? '你' : 'AI ' + i),
        monsterId: monster.id,
        ai: cfg.ai == null ? i !== 0 : !!cfg.ai,
        hp: maxHp,
        maxHp: maxHp,
        vp: 0,
        energy: 0,
        location: null,
        alive: true,
        cards: [],
        tookClawDamage: false
      });
    }

    for (var d = 0; d < START_DICE; d++) state.dice.push({ face: '1', locked: false });

    state.deck = Shuffle.shuffle(DATA.CARDS.map(function (card) { return card.id; }), { seed: state.seed });
    state.shop = state.deck.splice(0, 3);

    log(state, 'start', '东京妖都开局：' + state.players.map(function (p) { return p.name; }).join('、') +
      '。先达到 20 分或成为最后存活者即可加冕。', {});
    startTurn(state);
    return state;
  }

  function sameMove(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    if (a.type === 'toggleLock') return a.index === b.index;
    if (a.type === 'enterTokyo') return a.slot === b.slot;
    if (a.type === 'yieldDecision') return !!a.leave === !!b.leave;
    if (a.type === 'buyCard') return a.cardId === b.cardId;
    return true;
  }

  function getLegalMoves(state) {
    if (!state || state.gameOver) return [];
    if (state.pending) {
      if (state.pending.type === 'yield') {
        return [
          { type: 'yieldDecision', leave: true },
          { type: 'yieldDecision', leave: false }
        ];
      }
      if (state.pending.type === 'enter') {
        var moves = [];
        (state.pending.options || []).forEach(function (slot) {
          moves.push({ type: 'enterTokyo', slot: slot });
        });
        if (!state.pending.forced) moves.push({ type: 'skipEnter' });
        return moves;
      }
    }

    var player = state.players[state.current];
    if (!player || !player.alive) return [];

    if (state.phase === 'rolling') {
      var rolling = [];
      if (state.rollCount === 0) {
        rolling.push({ type: 'roll' });
        return rolling;
      }
      if (state.rollsLeft > 0) rolling.push({ type: 'roll' });
      rolling.push({ type: 'resolveRoll' });
      state.dice.forEach(function (die, index) {
        rolling.push({ type: 'toggleLock', index: index });
      });
      return rolling;
    }

    if (state.phase === 'buy') {
      var shopping = [];
      state.shop.forEach(function (cardId, index) {
        if (!cardId) return;
        var card = DATA.cardById(cardId);
        if (card && player.energy >= card.cost) {
          shopping.push({ type: 'buyCard', cardId: cardId, index: index });
        }
      });
      if (player.energy >= SWEEP_COST) shopping.push({ type: 'sweep' });
      shopping.push({ type: 'endTurn' });
      return shopping;
    }

    return [];
  }

  function applyMove(state, action) {
    if (!state) throw new Error('缺少 state');
    if (!action || !action.type) throw new Error('缺少动作');
    var legal = getLegalMoves(state);
    var accepted = legal.some(function (item) { return sameMove(item, action); });
    if (!accepted) throw new Error('非法动作：' + action.type);

    var next = clone(state);
    var player = next.players[next.current];

    if (action.type === 'roll') {
      rollAnimationFaces(next);
      next.rollsLeft -= 1;
      next.rollCount += 1;
      next.stats.rolls += 1;
      next.phase = 'rolling';
      log(next, 'roll', player.name + ' 掷骰：' + next.dice.map(function (die) {
        return FACE_LABELS[die.face];
      }).join('、'), {
        playerId: player.id,
        faces: next.dice.map(function (die) { return die.face; })
      });
      return next;
    }

    if (action.type === 'toggleLock') {
      var die = next.dice[action.index];
      if (!die) throw new Error('骰子不存在');
      die.locked = !die.locked;
      log(next, 'lock', player.name + (die.locked ? ' 锁定' : ' 解锁') + ' ' + FACE_LABELS[die.face], {
        playerId: player.id, index: action.index, locked: die.locked, face: die.face
      });
      return next;
    }

    if (action.type === 'resolveRoll') {
      resolveDice(next);
      return next;
    }

    if (action.type === 'yieldDecision') {
      var pending = next.pending;
      var yielding = playerById(next, pending.playerId);
      if (yielding) {
        if (action.leave) {
          yielding.location = null;
          log(next, 'yield', yielding.name + ' 撤离东京', { playerId: yielding.id });
        } else {
          log(next, 'stay', yielding.name + ' 坚守东京', { playerId: yielding.id });
        }
      }
      var queue = (pending.queue || []).slice(1);
      if (queue.length) {
        next.pending = { type: 'yield', playerId: queue[0], queue: queue, playerIds: queue.slice() };
        next.phase = 'yield';
      } else {
        next.pending = null;
        afterResolution(next);
      }
      return next;
    }

    if (action.type === 'enterTokyo') {
      var slot = action.slot;
      if (TOKYO_SLOTS.indexOf(slot) === -1) throw new Error('未知东京区域');
      if (getOccupant(next, slot)) throw new Error('东京区域已被占据');
      player.location = slot;
      var gain = 1 + (hasCard(player, 'city-climber') ? 1 : 0);
      gainVP(next, player, gain, '进入' + SLOT_LABELS[slot]);
      log(next, 'enter', player.name + ' 进入' + SLOT_LABELS[slot], {
        playerId: player.id, slot: slot
      });
      next.pending = null;
      checkVictory(next);
      if (!next.gameOver) next.phase = 'buy';
      return next;
    }

    if (action.type === 'skipEnter') {
      log(next, 'skip', player.name + ' 留在城外', { playerId: player.id });
      next.pending = null;
      next.phase = 'buy';
      return next;
    }

    if (action.type === 'buyCard') {
      var index = -1;
      for (var i = 0; i < next.shop.length; i++) {
        if (next.shop[i] === action.cardId) { index = i; break; }
      }
      if (index < 0) throw new Error('市场中没有这张卡');
      var card = DATA.cardById(action.cardId);
      if (!card) throw new Error('未知能力卡');
      if (player.energy < card.cost) throw new Error('能量不足');
      player.energy -= card.cost;
      player.cards.push(card.id);
      next.stats.cardsBought += 1;
      next.buyCountThisTurn = (next.buyCountThisTurn || 0) + 1;
      log(next, 'buy', player.name + ' 购买「' + card.name + '」花费 ' + card.cost + ' 能量', {
        playerId: player.id, cardId: card.id, cost: card.cost
      });
      if (card.effect === 'buy-vp') gainVP(next, player, 2, '宣传机器');
      if (card.effect === 'max-hp') {
        player.maxHp += 2;
        var healed = healPlayer(next, player, 2, '巨化骨骼');
        if (healed === 0) log(next, 'noheal', player.name + ' 生命已满，巨化骨骼只提升上限', {
          playerId: player.id, amount: 0
        });
      }
      next.shop[index] = next.deck.length ? next.deck.shift() : null;
      checkVictory(next);
      return next;
    }

    if (action.type === 'sweep') {
      player.energy -= SWEEP_COST;
      next.shop.forEach(function (cardId) { if (cardId) next.discard.push(cardId); });
      next.shop = [];
      for (var s = 0; s < 3; s++) next.shop.push(next.deck.length ? next.deck.shift() : null);
      log(next, 'sweep', player.name + ' 花费 2 能量刷新市场', { playerId: player.id });
      return next;
    }

    if (action.type === 'endTurn') {
      if (hasCard(player, 'field-medkit') && !player.location && player.hp < player.maxHp) {
        healPlayer(next, player, 1, '野战急救包');
      }
      next.stats.turns += 1;
      advanceTurn(next);
      return next;
    }

    throw new Error('未处理的动作：' + action.type);
  }

  /* ------------------------------------------------------------------ */
  /* AI：只从合法动作中选择，保证 30 局自对弈不非法、不死循环。          */
  /* ------------------------------------------------------------------ */

  function aiWantsYield(state, player) {
    if (!player) return true;
    if (player.vp >= 18 && player.hp > 2) return false;
    return player.hp <= Math.max(3, Math.floor(player.maxHp * 0.4));
  }

  function desiredLocks(state, player) {
    var counts = diceCounts(state);
    var keep = {};
    var bestNum = null;
    var bestCount = 0;
    ['1', '2', '3'].forEach(function (face) {
      if (counts[face] > bestCount) { bestNum = face; bestCount = counts[face]; }
    });
    if (bestNum && bestCount >= 2) keep[bestNum] = true;
    if (counts.claw >= 2) keep.claw = true;
    if (!player.location && counts.heart >= 2) keep.heart = true;
    if (counts.energy >= 2) keep.energy = true;
    return state.dice.map(function (die) { return !!keep[die.face]; });
  }

  function aiShouldResolve(state, player) {
    var counts = diceCounts(state);
    if (counts.claw >= 3) return true;
    if (counts['1'] >= 3 || counts['2'] >= 3 || counts['3'] >= 3) return true;
    if (!player.location && counts.heart >= 4) return true;
    if (counts.energy >= 4) return true;
    return false;
  }

  function cardScore(state, player, card) {
    var base = {
      'giant-bones': player.hp <= 6 ? 112 : 78,
      'lava-armor': 100,
      'tidal-shell': player.location ? 96 : 58,
      'regen-gland': 92,
      'acid-claw': 86,
      'spiked-tail': 84,
      'solar-core': 82,
      'royal-presence': player.location ? 90 : 72,
      'thunder-crown': 76,
      'energy-siphon': 74,
      'city-climber': player.vp >= 17 ? 98 : 68,
      'hunter-instinct': 66,
      'propaganda': player.vp >= 17 ? 100 : 64,
      'field-medkit': 60
    };
    return base[card.id] || card.cost * 10;
  }

  function selectAIMove(state) {
    if (!state || state.gameOver) return null;
    var legal = getLegalMoves(state);
    if (!legal.length) return null;

    if (state.pending && state.pending.type === 'yield') {
      var yielding = playerById(state, state.pending.playerId);
      var leave = aiWantsYield(state, yielding);
      return legal.filter(function (m) {
        return m.type === 'yieldDecision' && !!m.leave === leave;
      })[0] || legal[0];
    }

    if (state.pending && state.pending.type === 'enter') {
      var playerForEnter = state.players[state.current];
      var options = state.pending.options || [];
      if (options.indexOf('city') !== -1) {
        return legal.filter(function (m) { return m.type === 'enterTokyo' && m.slot === 'city'; })[0];
      }
      if (options.indexOf('bay') !== -1) {
        if (playerForEnter.hp >= 6 && playerForEnter.vp < 20) {
          return legal.filter(function (m) { return m.type === 'enterTokyo' && m.slot === 'bay'; })[0];
        }
        return legal.filter(function (m) { return m.type === 'skipEnter'; })[0] || legal[0];
      }
    }

    var player = state.players[state.current];
    if (!player || !player.alive) return legal[0];

    if (state.phase === 'rolling') {
      if (state.rollCount === 0) return { type: 'roll' };
      var wanted = desiredLocks(state, player);
      var allWantedLocked = true;
      for (var i = 0; i < state.dice.length; i++) {
        if (!!state.dice[i].locked !== wanted[i]) {
          return { type: 'toggleLock', index: i };
        }
        if (!wanted[i]) allWantedLocked = false;
      }
      if (state.rollsLeft > 0 && !allWantedLocked && !aiShouldResolve(state, player)) {
        return { type: 'roll' };
      }
      return { type: 'resolveRoll' };
    }

    if (state.phase === 'buy') {
      nextCard: {
        if ((state.buyCountThisTurn || 0) >= 2) break nextCard;
        var candidates = legal.filter(function (m) { return m.type === 'buyCard'; });
        if (!candidates.length) break nextCard;
        var best = null;
        var bestScore = -1;
        candidates.forEach(function (m) {
          var card = DATA.cardById(m.cardId);
          if (!card) return;
          var score = cardScore(state, player, card);
          if (score > bestScore || (score === bestScore && card.cost < best.cost)) {
            best = m; bestScore = score;
          }
        });
        if (best) return best;
      }
      return { type: 'endTurn' };
    }

    return legal[0];
  }

  function autoPlay(state, maxActions) {
    var current = state;
    var limit = maxActions || 4000;
    var actions = 0;
    while (!current.gameOver && actions < limit) {
      var move = selectAIMove(current);
      if (!move) break;
      current = applyMove(current, move);
      actions += 1;
    }
    return { state: current, actions: actions, finished: current.gameOver };
  }

  return {
    DATA: DATA,
    USES_SHARED_SHUFFLE: true,
    FACES: FACES,
    FACE_LABELS: FACE_LABELS,
    TOKYO_SLOTS: TOKYO_SLOTS,
    SLOT_LABELS: SLOT_LABELS,
    CONSTANTS: {
      WIN_VP: WIN_VP,
      START_HP: START_HP,
      START_DICE: START_DICE,
      MAX_ROLLS: MAX_ROLLS,
      SWEEP_COST: SWEEP_COST
    },
    createGame: createGame,
    getLegalMoves: getLegalMoves,
    applyMove: applyMove,
    selectAIMove: selectAIMove,
    autoPlay: autoPlay,
    getOccupant: getOccupant,
    hasCard: hasCard,
    diceCounts: diceCounts,
    bayEnabled: bayEnabled,
    checkVictory: checkVictory
  };
});
