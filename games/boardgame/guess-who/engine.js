/*
 * Guess Who / 猜猜我是谁 — pure game rules.
 *
 * 24 characters, 7 public attributes. Each side secretly owns one character.
 * Both sides ask yes/no questions (one per turn), eliminate candidates and may
 * guess at any time on their turn. A correct guess wins; a wrong guess loses.
 *
 * No DOM, no network. Works in the browser (globalThis.GuessWhoEngine) and in
 * Node (`require('./engine.js')`).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GuessWhoEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_TURNS = 40;

  /*
   * Attribute definitions. `options` preserve display labels while `value` is
   * the canonical value stored on each character.
   */
  var ATTRIBUTES = [
    {
      key: 'hair',
      label: '发色',
      options: [
        { value: 'black', label: '黑发' },
        { value: 'brown', label: '棕发' },
        { value: 'blond', label: '金发' },
        { value: 'red', label: '红发' },
        { value: 'gray', label: '灰发' }
      ]
    },
    {
      key: 'glasses',
      label: '眼镜',
      options: [
        { value: true, label: '戴眼镜' },
        { value: false, label: '不戴眼镜' }
      ]
    },
    {
      key: 'hat',
      label: '帽子',
      options: [
        { value: true, label: '戴帽子' },
        { value: false, label: '不戴帽子' }
      ]
    },
    {
      key: 'longHair',
      label: '头发长度',
      options: [
        { value: true, label: '长发' },
        { value: false, label: '短发' }
      ]
    },
    {
      key: 'beard',
      label: '胡子',
      options: [
        { value: true, label: '有胡子' },
        { value: false, label: '没胡子' }
      ]
    },
    {
      key: 'freckles',
      label: '雀斑',
      options: [
        { value: true, label: '有雀斑' },
        { value: false, label: '没有雀斑' }
      ]
    },
    {
      key: 'smile',
      label: '表情',
      options: [
        { value: true, label: '在笑' },
        { value: false, label: '没在笑' }
      ]
    }
  ];

  var ATTRIBUTE_BY_KEY = {};
  ATTRIBUTES.forEach(function (attr) { ATTRIBUTE_BY_KEY[attr.key] = attr; });

  var CHARACTER_DATA = [
    { name: '阿明', hair: 'black', glasses: true,  hat: true,  longHair: false, beard: false, freckles: false, smile: true  },
    { name: '小雅', hair: 'black', glasses: false, hat: false, longHair: true,  beard: false, freckles: true,  smile: true  },
    { name: '老陈', hair: 'black', glasses: true,  hat: false, longHair: true,  beard: true,  freckles: false, smile: false },
    { name: '林娜', hair: 'black', glasses: false, hat: true,  longHair: true,  beard: false, freckles: true,  smile: false },
    { name: '大伟', hair: 'black', glasses: true,  hat: true,  longHair: false, beard: true,  freckles: true,  smile: false },

    { name: '小梅', hair: 'brown', glasses: false, hat: true,  longHair: true,  beard: false, freckles: false, smile: true  },
    { name: '阿强', hair: 'brown', glasses: true,  hat: false, longHair: false, beard: true,  freckles: true,  smile: false },
    { name: '丽丽', hair: 'brown', glasses: false, hat: true,  longHair: true,  beard: false, freckles: true,  smile: true  },
    { name: '老王', hair: 'brown', glasses: true,  hat: false, longHair: false, beard: true,  freckles: false, smile: true  },
    { name: '小芳', hair: 'brown', glasses: false, hat: false, longHair: true,  beard: false, freckles: true,  smile: false },

    { name: '阿杰', hair: 'blond', glasses: true,  hat: true,  longHair: false, beard: false, freckles: false, smile: true  },
    { name: '婷婷', hair: 'blond', glasses: false, hat: false, longHair: true,  beard: false, freckles: true,  smile: true  },
    { name: '老赵', hair: 'blond', glasses: true,  hat: true,  longHair: false, beard: true,  freckles: false, smile: false },
    { name: '小雪', hair: 'blond', glasses: false, hat: false, longHair: true,  beard: false, freckles: false, smile: true  },
    { name: '阿鹏', hair: 'blond', glasses: true,  hat: false, longHair: false, beard: true,  freckles: true,  smile: false },

    { name: '玲玲', hair: 'red',   glasses: false, hat: true,  longHair: true,  beard: false, freckles: true,  smile: true  },
    { name: '老李', hair: 'red',   glasses: true,  hat: false, longHair: false, beard: true,  freckles: false, smile: true  },
    { name: '小云', hair: 'red',   glasses: false, hat: true,  longHair: true,  beard: false, freckles: false, smile: false },
    { name: '阿凯', hair: 'red',   glasses: true,  hat: false, longHair: false, beard: true,  freckles: true,  smile: false },

    { name: '静静', hair: 'gray',  glasses: false, hat: false, longHair: true,  beard: false, freckles: true,  smile: true  },
    { name: '老周', hair: 'gray',  glasses: true,  hat: true,  longHair: false, beard: true,  freckles: false, smile: true  },
    { name: '小燕', hair: 'gray',  glasses: false, hat: false, longHair: true,  beard: false, freckles: false, smile: false },
    { name: '阿龙', hair: 'gray',  glasses: true,  hat: true,  longHair: false, beard: true,  freckles: true,  smile: false },
    { name: '慧慧', hair: 'gray',  glasses: false, hat: true,  longHair: false, beard: false, freckles: false, smile: true  }
  ];

  var CHARACTERS = CHARACTER_DATA.map(function (c, i) {
    var copy = { id: i, name: c.name };
    ATTRIBUTES.forEach(function (attr) { copy[attr.key] = c[attr.key]; });
    return copy;
  });

  var ALL_IDS = CHARACTERS.map(function (c) { return c.id; });
  var SIDES = ['player', 'ai'];

  /* ---------- utilities ---------- */

  function fail(error, extra) {
    var out = { ok: false, error: error };
    if (extra) {
      Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    }
    return out;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalizeSeed(seed) {
    if (typeof seed === 'number' && isFinite(seed)) return seed >>> 0;
    if (typeof seed === 'string' && seed.trim() !== '' && isFinite(Number(seed))) {
      return Number(seed) >>> 0;
    }
    return Date.now() >>> 0;
  }

  function resolveRng(state, rng) {
    if (typeof rng === 'function') return rng;
    if (state && typeof state._rng === 'function') return state._rng;
    return mulberry32(state && state.seed != null ? state.seed : Date.now());
  }

  function otherSide(side) {
    return side === 'player' ? 'ai' : 'player';
  }

  function validState(state) {
    return !!state &&
      state.status !== undefined &&
      Array.isArray(state.playerCandidates) &&
      Array.isArray(state.aiCandidates) &&
      Array.isArray(state.history);
  }

  function sideCandidates(state, side) {
    if (side === 'player') return state.playerCandidates;
    if (side === 'ai') return state.aiCandidates;
    return null;
  }

  function sideTargetId(state, side) {
    return side === 'player' ? state.aiCharacterId : state.playerCharacterId;
  }

  /* ---------- public data helpers ---------- */

  function characterById(id) {
    if (!Number.isInteger(id) || id < 0 || id >= CHARACTERS.length) return null;
    return CHARACTERS[id];
  }

  function attribute(key) {
    return ATTRIBUTE_BY_KEY[key] || null;
  }

  function optionLabel(attrKey, value) {
    var attr = ATTRIBUTE_BY_KEY[attrKey];
    if (!attr) return '';
    for (var i = 0; i < attr.options.length; i++) {
      if (attr.options[i].value === value) return attr.options[i].label;
    }
    return '';
  }

  function isValidQuestion(attrKey, value) {
    var attr = ATTRIBUTE_BY_KEY[attrKey];
    if (!attr) return false;
    for (var i = 0; i < attr.options.length; i++) {
      if (attr.options[i].value === value) return true;
    }
    return false;
  }

  function matches(characterOrId, attrKey, value) {
    var c = typeof characterOrId === 'number' ? characterById(characterOrId) : characterOrId;
    if (!c || !isValidQuestion(attrKey, value)) return false;
    return c[attrKey] === value;
  }

  function filterCandidates(candidates, attrKey, value) {
    if (!Array.isArray(candidates) || !isValidQuestion(attrKey, value)) return [];
    var out = [];
    for (var i = 0; i < candidates.length; i++) {
      var c = characterById(candidates[i]);
      if (c && c[attrKey] === value) out.push(c.id);
    }
    return out;
  }

  function remaining(state, side) {
    if (!state) return 0;
    var list = sideCandidates(state, side);
    return list ? list.length : 0;
  }

  function candidateIds(state, side) {
    var list = state ? sideCandidates(state, side) : null;
    return list ? list.slice() : [];
  }

  function status(state) {
    return state ? state.status : null;
  }

  function winner(state) {
    return state ? state.winner : null;
  }

  function isOver(state) {
    return !!state && state.status !== 'playing';
  }

  /* ---------- game creation ---------- */

  function newGame(seed, playerCharacterId) {
    var normalizedSeed = normalizeSeed(seed);
    var rng = mulberry32(normalizedSeed);
    var playerId;

    if (Number.isInteger(playerCharacterId) &&
        playerCharacterId >= 0 && playerCharacterId < CHARACTERS.length) {
      playerId = playerCharacterId;
    } else {
      playerId = Math.floor(rng() * CHARACTERS.length);
    }

    var aiId = Math.floor(rng() * CHARACTERS.length);

    var state = {
      seed: normalizedSeed,
      playerCharacterId: playerId,
      aiCharacterId: aiId,
      playerCandidates: ALL_IDS.slice(),
      aiCandidates: ALL_IDS.slice(),
      turn: 'player',
      status: 'playing',
      winner: null,
      turnCount: 0,
      maxTurns: MAX_TURNS,
      pending: null,
      guess: null,
      history: []
    };

    Object.defineProperty(state, '_rng', {
      value: rng,
      enumerable: false,
      writable: true,
      configurable: true
    });

    return state;
  }

  /* ---------- answers ---------- */

  function aiAnswer(state, attrKey, value) {
    if (!state || !isValidQuestion(attrKey, value)) return null;
    var c = characterById(state.aiCharacterId);
    return c ? c[attrKey] === value : null;
  }

  function playerAnswer(state, attrKey, value) {
    if (!state || !isValidQuestion(attrKey, value)) return null;
    var c = characterById(state.playerCharacterId);
    return c ? c[attrKey] === value : null;
  }

  function answerForSide(state, side, attrKey, value) {
    return side === 'player' ? aiAnswer(state, attrKey, value) : playerAnswer(state, attrKey, value);
  }

  /* ---------- turn limit ---------- */

  function checkTurnLimit(state) {
    if (state.turnCount >= state.maxTurns) {
      state.status = 'draw';
      state.winner = null;
      state.turn = null;
      state.pending = null;
      state.history.push({ type: 'limit', turn: state.turnCount });
      return true;
    }
    return false;
  }

  /* ---------- actions ---------- */

  function ask(state, side, attrKey, value) {
    if (!validState(state)) return fail('badState');
    if (state.status !== 'playing') return fail('gameOver');
    if (SIDES.indexOf(side) === -1) return fail('badSide');
    if (state.pending) return fail('pendingAnswer');
    if (state.turn !== side) return fail('notYourTurn');
    if (!isValidQuestion(attrKey, value)) return fail('badQuestion');

    var answer = answerForSide(state, side, attrKey, value);
    var before = sideCandidates(state, side);
    var after = filterCandidates(before, attrKey, value);

    if (side === 'player') state.playerCandidates = after;
    else state.aiCandidates = after;

    state.turnCount += 1;
    state.history.push({
      type: 'ask',
      side: side,
      attr: attrKey,
      value: value,
      answer: answer,
      remaining: after.length,
      turn: state.turnCount
    });

    var ended = checkTurnLimit(state);
    if (!ended) state.turn = otherSide(side);

    return {
      ok: true,
      answer: answer,
      remaining: after.length,
      candidates: after.slice(),
      status: state.status,
      turn: state.turn,
      turnCount: state.turnCount
    };
  }

  function guess(state, side, characterId) {
    if (!validState(state)) return fail('badState');
    if (state.status !== 'playing') return fail('gameOver');
    if (SIDES.indexOf(side) === -1) return fail('badSide');
    if (state.pending) return fail('pendingAnswer');
    if (state.turn !== side) return fail('notYourTurn');
    if (!Number.isInteger(characterId) || !characterById(characterId)) {
      return fail('badCharacter');
    }

    var targetId = sideTargetId(state, side);
    var correct = characterId === targetId;
    var winnerSide = correct ? side : otherSide(side);

    state.turnCount += 1;
    state.guess = {
      side: side,
      characterId: characterId,
      correct: correct,
      winner: winnerSide,
      targetCharacterId: targetId
    };
    state.status = winnerSide;
    state.winner = winnerSide;
    state.turn = null;
    state.pending = null;
    state.history.push({
      type: 'guess',
      side: side,
      characterId: characterId,
      correct: correct,
      winner: winnerSide
    });

    return {
      ok: true,
      correct: correct,
      winner: winnerSide,
      status: state.status,
      characterId: characterId,
      targetCharacterId: targetId
    };
  }

  /* ---------- question selection ---------- */

  function bestQuestionForCandidates(candidates, rng) {
    if (!Array.isArray(candidates) || candidates.length < 2) return null;

    var bestScore = Infinity;
    var best = [];
    var total = candidates.length;

    ATTRIBUTES.forEach(function (attr) {
      attr.options.forEach(function (option) {
        var yes = 0;
        for (var i = 0; i < candidates.length; i++) {
          var c = characterById(candidates[i]);
          if (c && c[attr.key] === option.value) yes += 1;
        }
        if (yes === 0 || yes === total) return; // no candidate would be removed
        var score = Math.abs(yes - (total - yes)); // smaller = closer to half
        if (score < bestScore) {
          bestScore = score;
          best = [{ attr: attr.key, value: option.value, yes: yes, no: total - yes }];
        } else if (score === bestScore) {
          best.push({ attr: attr.key, value: option.value, yes: yes, no: total - yes });
        }
      });
    });

    if (!best.length) return null;
    var index = Math.floor(rng() * best.length);
    if (index < 0) index = 0;
    if (index >= best.length) index = best.length - 1;
    var pick = best[index];
    return {
      attr: pick.attr,
      value: pick.value,
      yes: pick.yes,
      no: pick.no,
      remaining: total
    };
  }

  function pickQuestion(state, side, rng) {
    if (!state || state.status !== 'playing') return null;
    var list = sideCandidates(state, side);
    if (!list) return null;
    return bestQuestionForCandidates(list, resolveRng(state, rng));
  }

  function aiPickQuestion(state, rng) {
    return pickQuestion(state, 'ai', rng);
  }

  function randomFrom(list, rng) {
    if (!list || !list.length) return null;
    var i = Math.floor(rng() * list.length);
    if (i < 0) i = 0;
    if (i >= list.length) i = list.length - 1;
    return list[i];
  }

  /*
   * The AI takes its turn. With one candidate left it guesses. Near the turn
   * limit it guesses rather than allowing a guaranteed draw. Otherwise it
   * stages a near-half question in `state.pending`; the caller answers via
   * answerAiQuestion() so the UI can show the yes/no buttons.
   */
  function aiTurn(state, rng) {
    if (!validState(state)) return fail('badState');
    if (state.status !== 'playing') return fail('gameOver');
    if (state.turn !== 'ai') return fail('notYourTurn');
    if (state.pending) return fail('pendingAnswer');

    var pickRng = resolveRng(state, rng);

    if (state.aiCandidates.length <= 1 || state.turnCount >= state.maxTurns - 1) {
      var guessId;
      if (state.aiCandidates.length === 1) {
        guessId = state.aiCandidates[0];
      } else {
        guessId = randomFrom(state.aiCandidates.length ? state.aiCandidates : ALL_IDS, pickRng);
      }
      if (guessId == null) return fail('noCandidates');
      var g = guess(state, 'ai', guessId);
      return {
        ok: true,
        action: 'guess',
        characterId: guessId,
        correct: g.correct,
        winner: g.winner,
        status: g.status
      };
    }

    var question = bestQuestionForCandidates(state.aiCandidates, pickRng);
    if (!question) {
      var fallbackId = randomFrom(state.aiCandidates, pickRng);
      if (fallbackId == null) return fail('noCandidates');
      var fg = guess(state, 'ai', fallbackId);
      return {
        ok: true,
        action: 'guess',
        characterId: fallbackId,
        correct: fg.correct,
        winner: fg.winner,
        status: fg.status
      };
    }

    state.pending = {
      side: 'ai',
      attr: question.attr,
      value: question.value,
      remaining: state.aiCandidates.length
    };

    return {
      ok: true,
      action: 'question',
      attr: question.attr,
      value: question.value,
      yes: question.yes,
      no: question.no,
      remaining: state.aiCandidates.length,
      status: state.status,
      turn: state.turn
    };
  }

  function answerAiQuestion(state, answer) {
    if (!validState(state)) return fail('badState');
    if (state.status !== 'playing') return fail('gameOver');
    if (state.turn !== 'ai' || !state.pending) return fail('noPendingQuestion');
    if (typeof answer !== 'boolean') return fail('badAnswer');

    var pending = state.pending;
    var truth = playerAnswer(state, pending.attr, pending.value);

    if (answer !== truth) {
      return fail('incorrectAnswer', {
        expected: truth,
        attr: pending.attr,
        value: pending.value
      });
    }

    var before = state.aiCandidates.length;
    state.aiCandidates = filterCandidates(state.aiCandidates, pending.attr, pending.value);
    state.pending = null;
    state.turnCount += 1;

    state.history.push({
      type: 'answer',
      side: 'player',
      attr: pending.attr,
      value: pending.value,
      answer: truth,
      before: before,
      remaining: state.aiCandidates.length,
      turn: state.turnCount
    });

    var ended = checkTurnLimit(state);
    if (!ended) state.turn = 'player';

    return {
      ok: true,
      answer: truth,
      remaining: state.aiCandidates.length,
      candidates: state.aiCandidates.slice(),
      attr: pending.attr,
      value: pending.value,
      status: state.status,
      turn: state.turn,
      turnCount: state.turnCount
    };
  }

  return {
    CHARACTERS: CHARACTERS,
    ATTRIBUTES: ATTRIBUTES,
    MAX_TURNS: MAX_TURNS,
    SIDES: SIDES,

    createRng: mulberry32,
    mulberry32: mulberry32,

    newGame: newGame,
    ask: ask,
    guess: guess,
    aiPickQuestion: aiPickQuestion,
    pickQuestion: pickQuestion,
    aiAnswer: aiAnswer,
    playerAnswer: playerAnswer,
    aiTurn: aiTurn,
    answerAiQuestion: answerAiQuestion,

    status: status,
    winner: winner,
    getStatus: status,
    getWinner: winner,
    isOver: isOver,

    matches: matches,
    filterCandidates: filterCandidates,
    remaining: remaining,
    candidateIds: candidateIds,
    characterById: characterById,
    attribute: attribute,
    optionLabel: optionLabel,
    isValidQuestion: isValidQuestion
  };
});
