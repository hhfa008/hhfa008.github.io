/* Codenames (行动代号) — pure, dependency-free engine.
 * UMD: require() in node tests, window.CodenamesEngine in the browser.
 * All randomness comes from an injected RNG so games are reproducible.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CodenamesEngine = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var WORD_BANK = [
    { text: '苹果', tags: ['水果', '食物'] },
    { text: '香蕉', tags: ['水果', '食物'] },
    { text: '西瓜', tags: ['水果', '食物'] },
    { text: '葡萄', tags: ['水果', '食物'] },
    { text: '老虎', tags: ['动物', '自然'] },
    { text: '熊猫', tags: ['动物', '自然'] },
    { text: '海豚', tags: ['动物', '自然'] },
    { text: '猫头鹰', tags: ['动物', '自然'] },
    { text: '地铁', tags: ['交通', '城市'] },
    { text: '飞机', tags: ['交通', '科技'] },
    { text: '自行车', tags: ['交通', '运动'] },
    { text: '轮船', tags: ['交通', '自然'] },
    { text: '下雨', tags: ['天气', '自然'] },
    { text: '彩虹', tags: ['天气', '颜色'] },
    { text: '台风', tags: ['天气', '自然'] },
    { text: '雪花', tags: ['天气', '冬天'] },
    { text: '书包', tags: ['学校', '物品'] },
    { text: '黑板', tags: ['学校', '物品'] },
    { text: '考试', tags: ['学校', '压力'] },
    { text: '操场', tags: ['学校', '运动'] },
    { text: '妈妈', tags: ['家庭', '人物'] },
    { text: '爷爷', tags: ['家庭', '人物'] },
    { text: '厨房', tags: ['家庭', '食物'] },
    { text: '沙发', tags: ['家庭', '物品'] },
    { text: '篮球', tags: ['运动', '球类'] },
    { text: '游泳', tags: ['运动', '水'] },
    { text: '滑雪', tags: ['运动', '冬天'] },
    { text: '马拉松', tags: ['运动', '坚持'] },
    { text: '红色', tags: ['颜色', '热烈'] },
    { text: '蓝色', tags: ['颜色', '安静'] },
    { text: '绿色', tags: ['颜色', '自然'] },
    { text: '黄色', tags: ['颜色', '明亮'] },
    { text: '面条', tags: ['食物', '主食'] },
    { text: '火锅', tags: ['食物', '热闹'] },
    { text: '蛋糕', tags: ['食物', '节日'] },
    { text: '咖啡', tags: ['食物', '饮料'] },
    { text: '医生', tags: ['职业', '医院'] },
    { text: '教师', tags: ['职业', '学校'] },
    { text: '厨师', tags: ['职业', '食物'] },
    { text: '宇航员', tags: ['职业', '科技'] },
    { text: '森林', tags: ['自然', '绿色'] },
    { text: '沙漠', tags: ['自然', '炎热'] },
    { text: '海洋', tags: ['自然', '水'] },
    { text: '火山', tags: ['自然', '危险'] },
    { text: '手机', tags: ['科技', '物品'] },
    { text: '电脑', tags: ['科技', '物品'] },
    { text: '机器人', tags: ['科技', '未来'] },
    { text: '火箭', tags: ['科技', '交通'] },
    { text: '春节', tags: ['节日', '家庭'] },
    { text: '中秋', tags: ['节日', '食物'] },
    { text: '生日', tags: ['节日', '蛋糕'] },
    { text: '婚礼', tags: ['节日', '家庭'] },
    { text: '眼镜', tags: ['身体', '物品'] },
    { text: '手套', tags: ['身体', '冬天'] },
    { text: '影子', tags: ['身体', '自然'] },
    { text: '梦', tags: ['身体', '幻想'] }
  ];

  var TAG_POOL = ['水果', '动物', '交通', '天气', '学校', '家庭', '运动', '颜色',
    '食物', '职业', '自然', '科技', '物品', '节日', '冬天', '水'];

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
    if (state.log.length > 60) state.log.shift();
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 1 : opts.seed;
    var rng = opts.rng || mulberry32(seed);
    var bag = shuffle(WORD_BANK.slice(), rng).slice(0, 25);
    var colors = [];
    var i;
    for (i = 0; i < 9; i++) colors.push('red');
    for (i = 0; i < 8; i++) colors.push('blue');
    for (i = 0; i < 7; i++) colors.push('neutral');
    colors.push('assassin');
    shuffle(colors, rng);
    var words = bag.map(function (w, idx) {
      return { text: w.text, tags: w.tags.slice(), color: colors[idx], revealed: false };
    });
    var state = {
      mode: opts.mode || 'captain',
      words: words,
      turn: 'red',
      phase: 'clue',
      clue: null,
      guessesLeft: 0,
      scores: { red: 0, blue: 0 },
      winner: null,
      log: [],
      rng: rng,
      seed: seed
    };
    log(state, '新对局开始：红队 9 词、蓝队 8 词、中立 7 词、刺客 1 词。');
    if (state.mode === 'operative') {
      var a = aiClue(state);
      applyAction(state, a);
      log(state, 'AI 队长给出线索，轮到你猜词。');
    }
    return state;
  }

  function isOver(state) { return state.phase === 'over' || !!state.winner; }

  function targetScore(team) { return team === 'red' ? 9 : 8; }

  function other(team) { return team === 'red' ? 'blue' : 'red'; }

  function maskColor(state, seat) {
    if (state.mode === 'captain' && seat === 0) return false;
    return true;
  }

  function viewFor(state, seat) {
    var hide = maskColor(state, seat) && !isOver(state);
    return {
      mode: state.mode,
      turn: state.turn,
      phase: state.phase,
      clue: state.clue,
      guessesLeft: state.guessesLeft,
      scores: { red: state.scores.red, blue: state.scores.blue },
      winner: state.winner,
      log: state.log.slice(),
      words: state.words.map(function (w) {
        return {
          text: w.text,
          tags: w.tags.slice(),
          revealed: w.revealed,
          color: (hide && !w.revealed) ? 'hidden' : w.color
        };
      })
    };
  }

  function needsHuman(state) {
    if (isOver(state)) return false;
    if (state.turn !== 'red') return false;
    if (state.phase === 'clue') return state.mode === 'captain';
    if (state.phase === 'guess') return state.mode === 'operative';
    return false;
  }

  function clueTextTaken(state, text) {
    return state.words.some(function (w) { return w.text === text; });
  }

  function validClue(state, text, count) {
    if (typeof text !== 'string') return false;
    text = text.trim();
    if (!text || text.length > 20) return false;
    if (clueTextTaken(state, text)) return false;
    if (!Number.isInteger(count) || count < 1 || count > 9) return false;
    return true;
  }

  function scoreWord(state, clueText, word) {
    var score = 0;
    if (clueText === word.text) return -99;
    word.tags.forEach(function (tag) {
      if (clueText === tag) score += 6;
      else if (clueText.indexOf(tag) >= 0 || tag.indexOf(clueText) >= 0) score += 4;
    });
    var i;
    for (i = 0; i < clueText.length; i++) {
      if (word.text.indexOf(clueText.charAt(i)) >= 0) score += 0.5;
    }
    return score + state.rng() * 2;
  }

  function guessRanking(state) {
    var text = state.clue.text;
    return state.words.map(function (w, idx) {
      return { index: idx, word: w, score: w.revealed ? -100 : scoreWord(state, text, w) };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  function aiClue(state) {
    var team = state.turn;
    var own = state.words.filter(function (w) { return !w.revealed && w.color === team; });
    if (!own.length) return { type: 'clue', text: '继续', count: 1 };
    var counts = {};
    own.forEach(function (w) {
      w.tags.forEach(function (tag) { if (TAG_POOL.indexOf(tag) >= 0) counts[tag] = (counts[tag] || 0) + 1; });
    });
    var best = null, bestN = -1;
    Object.keys(counts).forEach(function (tag) {
      if (clueTextTaken(state, tag)) return;
      var n = counts[tag] + state.rng();
      if (n > bestN) { bestN = n; best = tag; }
    });
    if (!best) best = '主题';
    return { type: 'clue', text: best, count: Math.min(3, Math.max(1, counts[best] || 1)) };
  }

  function aiGuess(state) {
    var ranked = guessRanking(state).filter(function (r) { return !r.word.revealed; });
    if (!ranked.length) return { type: 'pass' };
    return { type: 'guess', index: ranked[0].index };
  }

  function aiAction(state) {
    if (isOver(state)) return null;
    if (state.phase === 'clue') {
      if (needsHuman(state)) return null;
      return aiClue(state);
    }
    if (state.phase === 'guess') {
      if (needsHuman(state)) return null;
      return aiGuess(state);
    }
    return null;
  }

  function checkWin(state) {
    if (state.scores.red >= targetScore('red')) { state.winner = 'red'; state.phase = 'over'; return true; }
    if (state.scores.blue >= targetScore('blue')) { state.winner = 'blue'; state.phase = 'over'; return true; }
    return false;
  }

  function endTurn(state) {
    if (isOver(state)) return;
    state.clue = null;
    state.guessesLeft = 0;
    state.turn = other(state.turn);
    state.phase = 'clue';
    log(state, '轮到' + (state.turn === 'red' ? '红队' : '蓝队') + '。');
  }

  function reveal(state, index, byAI) {
    var w = state.words[index];
    if (!w || w.revealed) return false;
    w.revealed = true;
    var team = state.turn;
    var who = byAI ? 'AI 队员' : '你';
    if (w.color === 'assassin') {
      state.winner = other(team);
      state.phase = 'over';
      log(state, who + '翻开“' + w.text + '”：刺客！' + (team === 'red' ? '红' : '蓝') + '队落败。');
      return true;
    }
    if (w.color === team) {
      state.scores[team]++;
      log(state, who + '猜中“' + w.text + '”（' + (team === 'red' ? '红' : '蓝') + '队）。');
      if (checkWin(state)) {
        log(state, (team === 'red' ? '红队' : '蓝队') + '找齐全部词，获胜！');
        return true;
      }
    } else if (w.color === 'neutral') {
      log(state, who + '翻开“' + w.text + '”：中立词，回合结束。');
      endTurn(state);
      return true;
    } else {
      state.scores[other(team)]++;
      log(state, who + '翻开“' + w.text + '”：对方词，回合结束。');
      if (checkWin(state)) {
        log(state, (state.scores.red >= 9 ? '红队' : '蓝队') + '获胜！');
        return true;
      }
      endTurn(state);
      return true;
    }
    state.guessesLeft--;
    if (state.guessesLeft <= 0) {
      log(state, '猜词次数用尽。');
      endTurn(state);
    }
    return true;
  }

  function applyAction(state, action) {
    if (!action || isOver(state)) return { ok: false, error: '对局已结束' };
    if (state.phase === 'clue') {
      if (needsHuman(state) && action.by !== 'human' && action.type === 'clue') {
        // UI calls applyAction with an explicit human clue; tests pass human:true.
      }
      if (!validClue(state, action.text, action.count)) {
        return { ok: false, error: '线索需为 1–20 字、不能是场上词，数字 1–9。' };
      }
      state.clue = { text: action.text.trim(), count: action.count, team: state.turn };
      state.guessesLeft = action.count + 1;
      state.phase = 'guess';
      log(state, (state.turn === 'red' ? '红队' : '蓝队') + '线索：「' + state.clue.text + '」' + action.count + '。');
      return { ok: true };
    }
    if (state.phase === 'guess') {
      if (action.type === 'pass') { endTurn(state); return { ok: true }; }
      if (!Number.isInteger(action.index)) return { ok: false, error: '无效的词位' };
      var ok = reveal(state, action.index, !!action.ai);
      return ok ? { ok: true } : { ok: false, error: '该词已翻开或不存在' };
    }
    return { ok: false, error: '当前不能行动' };
  }

  function autoRun(state, limit) {
    var n = 0, acts = [];
    limit = limit || 200;
    while (!isOver(state) && !needsHuman(state) && n++ < limit) {
      var a = aiAction(state);
      if (!a) break;
      var r = applyAction(state, a);
      if (!r.ok) break;
      acts.push(a);
    }
    return acts;
  }

  return {
    WORD_BANK: WORD_BANK,
    createGame: createGame,
    viewFor: viewFor,
    needsHuman: needsHuman,
    validClue: validClue,
    aiAction: aiAction,
    applyAction: applyAction,
    autoRun: autoRun,
    isOver: isOver,
    _scoreWord: scoreWord,
    _guessRanking: guessRanking
  };
}));
