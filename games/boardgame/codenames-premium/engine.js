/* Codenames Premium (行动代号 · 豪华单机版) — pure UMD engine.
 *
 * Design goals:
 *  - No DOM, no timers, no network: every rule is testable in Node.
 *  - Injected RNG: identical seeds replay identically.
 *  - Hidden information is enforced in viewFor(): operatives never receive
 *    unrevealed card colours or the AI's internal theme tags.
 *  - The AI only reads the clue and public word tags. It never peeks at the
 *    key when guessing, and every action it returns is a legal action.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./words.js'), require('../../shared/shuffle.js'));
  } else {
    root.CodenamesEngine = factory(root.CodenamesWords, root.Shuffle);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (WORDS, Shuffle) {
  'use strict';

  if (!WORDS || !WORDS.GROUPS) throw new Error('CodenamesWords is required');
  if (!Shuffle || typeof Shuffle.createRng !== 'function' || typeof Shuffle.shuffle !== 'function') {
    throw new Error('Shared Shuffle engine is required (games/shared/shuffle.js)');
  }

  var TEAMS = ['red', 'blue'];
  var TARGET = { red: 9, blue: 8 };
  var KEY_COUNTS = { red: 9, blue: 8, neutral: 7, assassin: 1 };
  var ROLE_LABEL = { red: '红队', blue: '蓝队', neutral: '平民', assassin: '刺客' };

  // clue text -> owning theme tag, built from group names, aliases and all
  // secondary tags. Used by the AI guesser to understand its own captain.
  var TAG_NAMES = Object.create(null);
  var ALIAS_TO_TAG = Object.create(null);
  var ALIASES_FOR_TAG = Object.create(null);
  WORDS.GROUPS.forEach(function (g) {
    var tags = [g.name].concat(g.also || []);
    tags.forEach(function (t) { TAG_NAMES[t] = true; });
    ALIAS_TO_TAG[g.name] = g.name;
    (g.clues || []).forEach(function (c) { ALIAS_TO_TAG[c] = g.name; });
    ALIASES_FOR_TAG[g.name] = (g.clues || []).slice();
  });

  // Shared shuffle engine (games/shared/shuffle.js): same seeded sfc32 and
  // unbiased Fisher-Yates as the rest of the repository. No local copy.
  function mulberry32(seed) { return Shuffle.createRng(seed); }
  function shuffle(arr, rng) { return Shuffle.shuffle(arr, { rng: rng }); }
  function shuffleInPlace(arr, rng) { return Shuffle.shuffleInPlace(arr, { rng: rng }); }

  function teamName(team) { return team === 'red' ? '红队' : '蓝队'; }

  function other(team) { return team === 'red' ? 'blue' : 'red'; }

  function targetScore(team) { return TARGET[team]; }

  function isOver(state) {
    return !state || state.phase === 'over' || !!state.winner;
  }

  function pool() {
    return WORDS.all();
  }

  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 80) state.log.shift();
  }

  function ensureStats(state) {
    if (!state.stats) {
      state.stats = { clues: 0, guesses: 0, correct: 0, wrong: 0, passes: 0 };
    }
    return state.stats;
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 1 : opts.seed;
    var rng = opts.rng || mulberry32(seed);
    var picked = shuffle(pool(), rng).slice(0, 25);
    var colors = [];
    Object.keys(KEY_COUNTS).forEach(function (color) {
      for (var i = 0; i < KEY_COUNTS[color]; i++) colors.push(color);
    });
    shuffleInPlace(colors, rng);

    var state = {
      mode: opts.mode || 'captain',
      seed: seed,
      words: picked.map(function (w, i) {
        return {
          text: w.text,
          tags: w.tags.slice(),
          color: colors[i],
          revealed: false
        };
      }),
      turn: 'red',
      phase: 'clue',
      clue: null,
      guessesLeft: 0,
      guessesMade: 0,
      scores: { red: 0, blue: 0 },
      winner: null,
      turnNo: 1,
      log: [],
      rng: rng,
      stats: { clues: 0, guesses: 0, correct: 0, wrong: 0, passes: 0 }
    };
    log(state, '新对局：红队 9 词、蓝队 8 词、平民 7 词、刺客 1 词，红队先手。');
    return state;
  }

  function remaining(state, team) {
    if (!state || !state.words) return TARGET[team] || 0;
    var n = 0;
    state.words.forEach(function (w) {
      if (!w.revealed && w.color === team) n++;
    });
    return n;
  }

  function onBoard(state, text) {
    var key = String(text).toLocaleLowerCase();
    return state.words.some(function (w) {
      return w.text.toLocaleLowerCase() === key;
    });
  }

  function validClue(state, text, count) {
    if (!state || !state.words) return false;
    if (typeof text !== 'string') return false;
    var t = text.trim();
    if (!t || t.length > 12) return false;
    if (/\s/.test(t)) return false;
    if (!/^[㐀-鿿A-Za-z0-9·\-]+$/.test(t)) return false;
    if (!Number.isInteger(count) || count < 1 || count > 9) return false;
    if (onBoard(state, t)) return false;
    return true;
  }

  function revealTag(text) {
    var t = String(text || '').trim();
    if (!t) return null;
    if (TAG_NAMES[t]) return t;
    if (ALIAS_TO_TAG[t]) return ALIAS_TO_TAG[t];
    var stripped = t.replace(/(类|相关|提示语|提示|主题|线索)$/, '');
    if (TAG_NAMES[stripped]) return stripped;
    if (ALIAS_TO_TAG[stripped]) return ALIAS_TO_TAG[stripped];
    return null;
  }

  function pickClueText(state, tag, rng) {
    var options = [tag].concat(ALIASES_FOR_TAG[tag] || []);
    var i;
    for (i = 0; i < options.length; i++) {
      if (!onBoard(state, options[i])) return options[i];
    }
    var suffixes = ['类', '相关', '提示', '主题', '线索'];
    for (i = 0; i < suffixes.length; i++) {
      var candidate = tag + suffixes[i];
      if (candidate.length <= 12 && !onBoard(state, candidate)) return candidate;
    }
    return tag + (10 + Math.floor(rng() * 89));
  }

  function finish(state, winner, reason) {
    if (isOver(state)) return;
    state.winner = winner;
    state.phase = 'over';
    state.clue = null;
    state.guessesLeft = 0;
    log(state, teamName(winner) + '获胜（' +
      (reason === 'assassin' ? '对手踩中刺客' : '找齐全部己方词') + '）。');
  }

  function checkWin(state) {
    if (remaining(state, 'red') === 0) { finish(state, 'red', 'all-words'); return 'red'; }
    if (remaining(state, 'blue') === 0) { finish(state, 'blue', 'all-words'); return 'blue'; }
    return null;
  }

  function endTurn(state) {
    if (isOver(state)) return;
    state.clue = null;
    state.guessesLeft = 0;
    state.guessesMade = 0;
    state.turn = other(state.turn);
    state.phase = 'clue';
    state.turnNo++;
    log(state, '轮到' + teamName(state.turn) + '。');
  }

  function reveal(state, index) {
    var w = state.words[index];
    var stats = ensureStats(state);
    var team = state.turn;
    var correct = w.color === team;
    w.revealed = true;
    state.guessesMade++;
    state.guessesLeft--;
    stats.guesses++;
    if (correct) stats.correct++;
    else stats.wrong++;

    var events = [{
      type: 'flip',
      index: index,
      text: w.text,
      color: w.color,
      team: team,
      correct: correct
    }];

    if (w.color === 'assassin') {
      log(state, teamName(team) + '翻开“' + w.text + '”：刺客！' + teamName(team) + '落败。');
      finish(state, other(team), 'assassin');
      events.push({ type: 'win', winner: state.winner, reason: 'assassin', index: index });
      return events;
    }

    if (correct) {
      state.scores[team]++;
      log(state, teamName(team) + '猜中“' + w.text + '”。已找到 ' +
        state.scores[team] + '/' + targetScore(team) + '。');
    } else {
      if (w.color === 'red' || w.color === 'blue') state.scores[w.color]++;
      log(state, teamName(team) + '翻到“' + w.text + '”（' + ROLE_LABEL[w.color] + '），回合结束。');
    }

    var winTeam = checkWin(state);
    if (winTeam) {
      events.push({ type: 'win', winner: winTeam, reason: 'all-words', index: index });
      return events;
    }

    if (!correct) {
      endTurn(state);
      events.push({ type: 'turn', turn: state.turn, turnNo: state.turnNo });
      return events;
    }

    if (state.guessesLeft <= 0) {
      log(state, '猜词次数用尽。');
      endTurn(state);
      events.push({ type: 'turn', turn: state.turn, turnNo: state.turnNo });
    }
    return events;
  }

  function applyAction(state, action) {
    if (!state || !action) return { ok: false, error: '无效操作' };
    if (isOver(state)) return { ok: false, error: '对局已结束' };
    var stats = ensureStats(state);

    if (action.type === 'clue') {
      if (state.phase !== 'clue') return { ok: false, error: '当前不是给线索阶段' };
      if (!validClue(state, action.text, action.count)) {
        return { ok: false, error: '线索需为 1–12 字且不能是场上词，数字为 1–9。' };
      }
      var text = action.text.trim();
      state.clue = { text: text, count: action.count, team: state.turn };
      state.phase = 'guess';
      state.guessesLeft = action.count + 1;
      state.guessesMade = 0;
      stats.clues++;
      log(state, teamName(state.turn) + '线索：「' + text + '」' + action.count + '。');
      return {
        ok: true,
        events: [{
          type: 'clue',
          team: state.turn,
          text: text,
          count: action.count,
          guessesLeft: state.guessesLeft
        }]
      };
    }

    if (action.type === 'guess') {
      if (state.phase !== 'guess') return { ok: false, error: '当前不是猜词阶段' };
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= state.words.length) {
        return { ok: false, error: '无效的词位' };
      }
      if (state.words[action.index].revealed) return { ok: false, error: '该词已经翻开' };
      return { ok: true, events: reveal(state, action.index) };
    }

    if (action.type === 'pass') {
      if (state.phase !== 'guess') return { ok: false, error: '当前不是猜词阶段' };
      if (state.guessesMade < 1) return { ok: false, error: '每回合至少猜一次' };
      stats.passes++;
      endTurn(state);
      return {
        ok: true,
        events: [{ type: 'pass' }, { type: 'turn', turn: state.turn, turnNo: state.turnNo }]
      };
    }

    return { ok: false, error: '未知操作' };
  }

  function viewFor(state, revealKey) {
    if (!state) return null;
    var showAll = !!revealKey || isOver(state);
    return {
      mode: state.mode,
      seed: state.seed,
      turn: state.turn,
      phase: state.phase,
      clue: state.clue ? { text: state.clue.text, count: state.clue.count, team: state.clue.team } : null,
      guessesLeft: state.guessesLeft,
      guessesMade: state.guessesMade,
      scores: { red: state.scores.red, blue: state.scores.blue },
      remaining: { red: remaining(state, 'red'), blue: remaining(state, 'blue') },
      target: { red: TARGET.red, blue: TARGET.blue },
      winner: state.winner,
      turnNo: state.turnNo,
      stats: {
        clues: state.stats.clues,
        guesses: state.stats.guesses,
        correct: state.stats.correct,
        wrong: state.stats.wrong,
        passes: state.stats.passes
      },
      log: state.log.slice(-10),
      keyVisible: showAll,
      words: state.words.map(function (w) {
        return {
          text: w.text,
          revealed: w.revealed,
          // Tags are internal AI metadata. Operatives only receive them after
          // the game ends, so the public view cannot be mined for hints.
          tags: showAll ? w.tags.slice() : [],
          color: (showAll || w.revealed) ? w.color : 'hidden',
          role: w.revealed ? ROLE_LABEL[w.color] : null
        };
      })
    };
  }

  function publicView(state) { return viewFor(state, false); }
  function captainView(state) { return viewFor(state, true); }

  function needsHuman(state) {
    if (!state || isOver(state)) return false;
    if (state.turn !== 'red') return false;
    if (state.mode === 'captain') return state.phase === 'clue';
    if (state.mode === 'operative') return state.phase === 'guess';
    return false;
  }

  function tagStats(state, team) {
    var map = Object.create(null);
    state.words.forEach(function (w) {
      if (w.revealed) return;
      (w.tags || []).forEach(function (tag) {
        var e = map[tag];
        if (!e) e = map[tag] = { own: 0, risk: 0, assassin: 0, ownWords: [] };
        if (w.color === team) {
          e.own++;
          e.ownWords.push(w.text);
        } else {
          e.risk++;
          if (w.color === 'assassin') e.assassin++;
        }
      });
    });
    return map;
  }

  function aiClue(state) {
    if (!state || isOver(state)) return null;
    var team = state.turn;
    var map = tagStats(state, team);
    var best = null;
    Object.keys(map).forEach(function (tag) {
      var e = map[tag];
      if (e.own < 1) return;
      // Own hits dominate. Every opposing/neutral word on the same theme is a
      // risk; the assassin is weighted far more heavily.
      var score = e.own * 10
        - (e.risk - e.assassin) * 4
        - e.assassin * 16
        + (e.own >= 2 ? 3 : 0)
        + (e.own >= 3 ? 3 : 0)
        + state.rng() * 2.5;
      if (!best || score > best.score) best = { tag: tag, entry: e, score: score };
    });

    if (!best) {
      var own = state.words.filter(function (w) { return !w.revealed && w.color === team; });
      if (!own.length) return null;
      var w = own[Math.floor(state.rng() * own.length)];
      var tag = (w.tags && w.tags[0]) || '提示';
      return { type: 'clue', text: pickClueText(state, tag, state.rng), count: 1 };
    }

    return {
      type: 'clue',
      text: pickClueText(state, best.tag, state.rng),
      count: Math.max(1, Math.min(9, best.entry.own))
    };
  }

  function guessScores(state) {
    var clue = state.clue;
    var text = clue ? clue.text : '';
    var tag = revealTag(text);
    return state.words.map(function (w, index) {
      var score = 0;
      if (!w.revealed) {
        (w.tags || []).forEach(function (t) {
          if (tag && t === tag) score += 12;
          else if (t === text) score += 12;
          else if (t.indexOf(text) >= 0 || text.indexOf(t) >= 0) score += 6;
        });
        for (var i = 0; i < text.length; i++) {
          if (w.text.indexOf(text.charAt(i)) >= 0) score += 0.4;
        }
      }
      return {
        index: index,
        word: w,
        score: w.revealed ? -100 : score + state.rng() * 2.5
      };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  function aiGuess(state) {
    if (!state || isOver(state)) return null;
    var ranked = guessScores(state).filter(function (r) { return !r.word.revealed; });
    if (!ranked.length) return null;
    return { type: 'guess', index: ranked[0].index, _score: ranked[0].score };
  }

  function cleanAction(action) {
    if (!action) return action;
    return { type: action.type, text: action.text, count: action.count, index: action.index };
  }

  function aiAction(state) {
    if (!state || isOver(state)) return null;
    if (state.phase === 'clue') {
      var clue = aiClue(state);
      return clue ? cleanAction(clue) : null;
    }
    if (state.phase === 'guess') {
      var best = aiGuess(state);
      if (!best) return { type: 'pass' };
      // A team must guess at least once. After that, the AI stops when the
      // clue count is exhausted unless the next match is very confident.
      if (state.guessesMade >= 1) {
        var max = state.clue ? state.clue.count + 1 : 1;
        if (state.guessesMade >= max) return { type: 'pass' };
        if (state.guessesMade >= (state.clue ? state.clue.count : 1) && best._score < 6) {
          return { type: 'pass' };
        }
      }
      return cleanAction(best);
    }
    return null;
  }

  function autoRun(state, limit) {
    var acts = [];
    limit = limit || 500;
    var n = 0;
    while (!isOver(state) && !needsHuman(state) && n < limit) {
      var a = aiAction(state);
      if (!a) break;
      var r = applyAction(state, a);
      if (!r.ok) break;
      acts.push(a);
      n++;
    }
    return acts;
  }

  return {
    createGame: createGame,
    applyAction: applyAction,
    validClue: validClue,
    aiAction: aiAction,
    aiClue: aiClue,
    aiGuess: aiGuess,
    autoRun: autoRun,
    viewFor: viewFor,
    publicView: publicView,
    captainView: captainView,
    isOver: isOver,
    needsHuman: needsHuman,
    remaining: remaining,
    targetScore: targetScore,
    other: other,
    revealTag: revealTag,
    mulberry32: mulberry32,
    shuffle: shuffle,
    WORD_GROUPS: WORDS.GROUPS,
    wordCount: WORDS.size(),
    TARGET: TARGET,
    KEY_COUNTS: KEY_COUNTS
  };
}));
