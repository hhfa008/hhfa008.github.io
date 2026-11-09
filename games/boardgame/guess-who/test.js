'use strict';

/*
 * Guess Who engine test suite.
 * Run from this directory with: node test.js
 * No third-party dependencies. Tests call the same UMD engine the page uses.
 */

var E = require('./engine.js');

var passed = 0;
var failed = 0;

function group(name) {
  console.log('\n[' + name + ']');
}

function ok(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('PASS ' + name);
    return true;
  }
  failed += 1;
  console.error('FAIL ' + name + (detail === undefined ? '' : ' :: ' + detail));
  return false;
}

function eq(name, actual, expected) {
  var same = JSON.stringify(actual) === JSON.stringify(expected);
  return ok(name, same, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function allQuestions() {
  var out = [];
  E.ATTRIBUTES.forEach(function (attr) {
    attr.options.forEach(function (option) {
      out.push({ attr: attr.key, value: option.value });
    });
  });
  return out;
}

function firstQuestionFor(state, side, rng) {
  return E.pickQuestion(state, side, rng || E.createRng(1));
}

function aiGame(seed) {
  var state = E.newGame(seed);
  var rng = E.createRng((seed * 2654435761) >>> 0);
  var illegal = [];
  var steps = 0;
  var questionKeys = [];

  while (state.status === 'playing' && steps < 200) {
    steps += 1;

    if (state.turn === 'player') {
      var candidates = state.playerCandidates;
      if (candidates.length <= 1 || state.turnCount >= state.maxTurns - 1) {
        var guessId = candidates.length
          ? candidates[Math.floor(rng() * candidates.length)]
          : 0;
        var guess = E.guess(state, 'player', guessId);
        if (!guess.ok) illegal.push('player guess: ' + guess.error);
      } else {
        var question = E.pickQuestion(state, 'player', rng);
        if (question) {
          questionKeys.push(question.attr + ':' + String(question.value));
          var asked = E.ask(state, 'player', question.attr, question.value);
          if (!asked.ok) illegal.push('player ask: ' + asked.error);
        } else {
          var fallback = candidates[Math.floor(rng() * candidates.length)];
          var guessed = E.guess(state, 'player', fallback);
          if (!guessed.ok) illegal.push('player fallback guess: ' + guessed.error);
        }
      }
    } else if (state.turn === 'ai') {
      var move = E.aiTurn(state, rng);
      if (!move.ok) {
        illegal.push('ai turn: ' + move.error);
      } else if (move.action === 'question') {
        questionKeys.push(move.attr + ':' + String(move.value));
        var truth = E.playerAnswer(state, move.attr, move.value);
        var answer = E.answerAiQuestion(state, truth);
        if (!answer.ok) illegal.push('player answer: ' + answer.error);
      }
    } else {
      illegal.push('invalid turn');
      break;
    }
  }

  return {
    state: state,
    steps: steps,
    illegal: illegal,
    questionKeys: questionKeys
  };
}

/* ------------------------------------------------------------------ */
group('角色与属性数据');

eq('角色数量为 24', E.CHARACTERS.length, 24);
ok('属性至少 5 个', E.ATTRIBUTES.length >= 5, 'got ' + E.ATTRIBUTES.length);
eq('实际属性数为 7', E.ATTRIBUTES.length, 7);

var names = E.CHARACTERS.map(function (c) { return c.name; });
eq('名字互不重复', new Set(names).size, 24);

var everyCharacterValid = E.CHARACTERS.every(function (c) {
  return Number.isInteger(c.id) &&
    E.ATTRIBUTES.every(function (attr) {
      return attr.options.some(function (option) { return option.value === c[attr.key]; });
    });
});
ok('每位角色都有全部合法属性值', everyCharacterValid);

var profiles = new Set(E.CHARACTERS.map(function (c) {
  return E.ATTRIBUTES.map(function (attr) { return attr.key + '=' + String(c[attr.key]); }).join('|');
}));
eq('24 个属性组合互不相同', profiles.size, 24);

var minOptionCount = Infinity;
E.ATTRIBUTES.forEach(function (attr) {
  attr.options.forEach(function (option) {
    var count = E.CHARACTERS.filter(function (c) { return c[attr.key] === option.value; }).length;
    if (count < minOptionCount) minOptionCount = count;
  });
});
ok('每个属性选项都有人使用', minOptionCount > 0, 'min=' + minOptionCount);

ok('匹配函数识别属性', E.matches(E.CHARACTERS[0], 'hair', 'black') === true);
ok('匹配函数拒绝非法属性', E.matches(E.CHARACTERS[0], 'zodiac', 'rat') === false);
ok('问题合法性校验', E.isValidQuestion('glasses', true) && !E.isValidQuestion('glasses', 'true'));
eq('非法角色 id 返回 null', E.characterById(99), null);

var glassesFiltered = E.filterCandidates(E.CHARACTERS.map(function (c) { return c.id; }), 'glasses', true);
eq('按戴眼镜过滤得到 12 人', glassesFiltered.length, 12);
eq('非法属性过滤返回空数组', E.filterCandidates([0, 1], 'hair', 'purple'), []);

/* ------------------------------------------------------------------ */
group('新局与随机种子');

var s1 = E.newGame(123456);
eq('新局状态为进行中', [s1.status, s1.turn, s1.winner], ['playing', 'player', null]);
eq('双方初始候选均为 24', [s1.playerCandidates.length, s1.aiCandidates.length], [24, 24]);
eq('初始提问计数为 0', s1.turnCount, 0);
eq('导出回合上限', s1.maxTurns, E.MAX_TURNS);
ok('回合上限在合理范围', E.MAX_TURNS >= 10 && E.MAX_TURNS <= 100, 'got ' + E.MAX_TURNS);

var s2 = E.newGame(123456);
eq('同种子玩家角色可复现', [s2.playerCharacterId, s2.aiCharacterId], [s1.playerCharacterId, s1.aiCharacterId]);
eq('同种子候选列表可复现', s2.playerCandidates, s1.playerCandidates);

var requested = E.newGame(7, 5);
eq('指定玩家角色被采用', requested.playerCharacterId, 5);
ok('指定角色后 AI 角色仍合法', requested.aiCharacterId >= 0 && requested.aiCharacterId < 24);
var fallback = E.newGame(8, 999);
ok('非法玩家角色回退到合法角色', fallback.playerCharacterId >= 0 && fallback.playerCharacterId < 24);
var stringSeed = E.newGame('123456');
eq('字符串种子同样可复现', [stringSeed.playerCharacterId, stringSeed.aiCharacterId],
  [s1.playerCharacterId, s1.aiCharacterId]);
var defaultGame = E.newGame();
ok('无种子也能正常开局', defaultGame.status === 'playing' && typeof defaultGame.seed === 'number');

/* ------------------------------------------------------------------ */
group('提问与如实回答');

var answerState = E.newGame(2024);
var aiCharacter = E.characterById(answerState.aiCharacterId);
var allAiAnswersCorrect = allQuestions().every(function (q) {
  return E.aiAnswer(answerState, q.attr, q.value) === (aiCharacter[q.attr] === q.value);
});
ok('AI 对所有合法问题给出真实答案', allAiAnswersCorrect);
eq('aiAnswer 拒绝非法属性', E.aiAnswer(answerState, 'zodiac', true), null);

var answerState2 = E.newGame(2025);
var playerCharacter = E.characterById(answerState2.playerCharacterId);
var allPlayerAnswersCorrect = allQuestions().every(function (q) {
  return E.playerAnswer(answerState2, q.attr, q.value) === (playerCharacter[q.attr] === q.value);
});
ok('玩家角色答案也正确', allPlayerAnswersCorrect);

var eachQuestionCorrect = true;
allQuestions().forEach(function (q) {
  var state = E.newGame(777);
  var expectedAnswer = E.matches(state.aiCharacterId, q.attr, q.value);
  var expectedRemaining = E.filterCandidates(state.playerCandidates, q.attr, q.value).length;
  var result = E.ask(state, 'player', q.attr, q.value);
  if (!result.ok || result.answer !== expectedAnswer ||
      result.remaining !== expectedRemaining ||
      state.playerCandidates.length !== expectedRemaining ||
      state.turn !== 'ai') {
    eachQuestionCorrect = false;
  }
});
ok('每种属性问题都正确回答并过滤', eachQuestionCorrect);

var askState = E.newGame(42);
var question = firstQuestionFor(askState, 'player', E.createRng(9));
var expectedYes = E.filterCandidates(askState.playerCandidates, question.attr, question.value).length;
var askResult = E.ask(askState, 'player', question.attr, question.value);
ok('提问返回正确答案', askResult.answer === E.matches(askState.aiCharacterId, question.attr, question.value));
eq('提问返回正确候选数', askResult.remaining, expectedYes);
eq('提问后切换到 AI 回合', askState.turn, 'ai');
eq('历史记录增加提问', askState.history.filter(function (h) { return h.type === 'ask'; }).length, 1);

var badAttrState = E.newGame(101);
var beforeBad = [badAttrState.playerCandidates.join(','), badAttrState.turn];
var badAttr = E.ask(badAttrState, 'player', 'zodiac', 'rat');
ok('拒绝非法属性', badAttr.ok === false && badAttr.error === 'badQuestion');
var badValue = E.ask(badAttrState, 'player', 'hair', 'purple');
ok('拒绝非法属性值', badValue.ok === false && badValue.error === 'badQuestion');
var badSide = E.ask(badAttrState, 'nobody', 'hair', 'black');
ok('拒绝非法阵营', badSide.ok === false && badSide.error === 'badSide');
var wrongTurn = E.ask(badAttrState, 'ai', 'hair', 'black');
ok('拒绝非本方回合提问', wrongTurn.ok === false && wrongTurn.error === 'notYourTurn');
eq('非法提问不改变状态', [badAttrState.playerCandidates.join(','), badAttrState.turn], beforeBad);

var aiAskState = E.newGame(600);
var pQ = firstQuestionFor(aiAskState, 'player', E.createRng(4));
E.ask(aiAskState, 'player', pQ.attr, pQ.value);
var aiQ = E.pickQuestion(aiAskState, 'ai', E.createRng(5));
var aiAskResult = E.ask(aiAskState, 'ai', aiQ.attr, aiQ.value);
ok('ask 也支持 AI 侧并自动取真实答案', aiAskResult.ok &&
  aiAskResult.answer === E.playerAnswer(aiAskState, aiQ.attr, aiQ.value));
eq('AI 侧提问后轮到玩家', aiAskState.turn, 'player');

/* ------------------------------------------------------------------ */
group('猜人与胜负');

var correctState = E.newGame(301);
var correctGuess = E.guess(correctState, 'player', correctState.aiCharacterId);
ok('猜中立即获胜', correctGuess.ok && correctGuess.correct &&
  correctState.status === 'player' && correctState.winner === 'player');
eq('猜中后回合结束', correctState.turn, null);

var wrongState = E.newGame(302);
var wrongId = (wrongState.aiCharacterId + 1) % 24;
var wrongGuess = E.guess(wrongState, 'player', wrongId);
ok('猜错立即判负', wrongGuess.ok && !wrongGuess.correct &&
  wrongState.status === 'ai' && wrongState.winner === 'ai');
eq('猜错时揭示真实目标', wrongGuess.targetCharacterId, wrongState.aiCharacterId);

var aiWinState = E.newGame(303);
aiWinState.turn = 'ai';
aiWinState.aiCandidates = [aiWinState.playerCharacterId];
var aiWinMove = E.aiTurn(aiWinState);
ok('AI 只剩一个候选时直接猜中', aiWinMove.ok && aiWinMove.action === 'guess' &&
  aiWinMove.correct && aiWinState.status === 'ai');

var aiLoseState = E.newGame(304);
aiLoseState.turn = 'ai';
aiLoseState.aiCandidates = [(aiLoseState.playerCharacterId + 1) % 24];
var aiLoseMove = E.aiTurn(aiLoseState);
ok('AI 猜错时玩家获胜', aiLoseMove.ok && aiLoseMove.action === 'guess' &&
  !aiLoseMove.correct && aiLoseState.status === 'player');

var badGuessState = E.newGame(305);
var badGuess = E.guess(badGuessState, 'player', 999);
ok('拒绝非法猜测目标', badGuess.ok === false && badGuess.error === 'badCharacter');
eq('非法猜测不改变回合', badGuessState.turn, 'player');

var wrongSideGuess = E.guess(badGuessState, 'nobody', 1);
ok('拒绝非法猜测阵营', wrongSideGuess.ok === false && wrongSideGuess.error === 'badSide');

var afterOver = E.ask(correctState, 'player', 'hair', 'black');
ok('结束后拒绝继续提问', afterOver.ok === false && afterOver.error === 'gameOver');
var guessAfterOver = E.guess(correctState, 'player', 0);
ok('结束后拒绝继续猜测', guessAfterOver.ok === false && guessAfterOver.error === 'gameOver');

ok('status 辅助函数', E.status(correctState) === 'player' && E.getStatus(correctState) === 'player');
ok('winner 辅助函数', E.winner(correctState) === 'player' && E.getWinner(correctState) === 'player');
ok('isOver 辅助函数', E.isOver(correctState) === true && E.isOver(wrongState) === true);

/* ------------------------------------------------------------------ */
group('AI 问题选择与回合');

var pickState = E.newGame(401);
var beforePick = pickState.aiCandidates.join(',');
var pickRng = E.createRng(77);
var aiQuestion = E.aiPickQuestion(pickState, pickRng);
ok('AI 返回合法问题', !!aiQuestion && E.isValidQuestion(aiQuestion.attr, aiQuestion.value));
ok('AI 问题能缩小候选', !!aiQuestion && aiQuestion.yes > 0 && aiQuestion.no > 0,
  aiQuestion ? 'yes=' + aiQuestion.yes + ', no=' + aiQuestion.no : 'null');
eq('AI 问题两侧人数等于候选总数', aiQuestion.yes + aiQuestion.no, pickState.aiCandidates.length);
eq('AI 选择问题时不修改候选', pickState.aiCandidates.join(','), beforePick);

var varietyRng = E.createRng(123);
var variety = {};
for (var i = 0; i < 30; i++) {
  var qv = E.aiPickQuestion(pickState, varietyRng);
  if (qv) variety[qv.attr + ':' + String(qv.value)] = true;
}
ok('AI 不会永远重复同一个问题', Object.keys(variety).length > 1,
  'unique=' + Object.keys(variety).length);

var notAiTurn = E.aiTurn(E.newGame(402), E.createRng(1));
ok('非 AI 回合拒绝 aiTurn', notAiTurn.ok === false && notAiTurn.error === 'notYourTurn');
var noPendingAnswer = E.answerAiQuestion(E.newGame(403), true);
ok('没有 AI 问题时的回答被拒绝', noPendingAnswer.ok === false && noPendingAnswer.error === 'noPendingQuestion');

var aiTurnState = E.newGame(404);
var setupQ = firstQuestionFor(aiTurnState, 'player', E.createRng(6));
E.ask(aiTurnState, 'player', setupQ.attr, setupQ.value);
var aiTurnResult = E.aiTurn(aiTurnState);
ok('AI 回合提出待回答问题', aiTurnResult.ok && aiTurnResult.action === 'question');
ok('待回答问题保存在 pending', !!aiTurnState.pending &&
  aiTurnState.pending.attr === aiTurnResult.attr &&
  aiTurnState.pending.value === aiTurnResult.value);
eq('待回答时回合仍属于 AI', aiTurnState.turn, 'ai');

var pendingAsk = E.ask(aiTurnState, 'ai', 'hair', 'black');
ok('待回答时拒绝再次提问', pendingAsk.ok === false && pendingAsk.error === 'pendingAnswer');
var pendingGuess = E.guess(aiTurnState, 'ai', 0);
ok('待回答时拒绝猜测', pendingGuess.ok === false && pendingGuess.error === 'pendingAnswer');
var badAnswer = E.answerAiQuestion(aiTurnState, 1);
ok('拒绝非布尔回答', badAnswer.ok === false && badAnswer.error === 'badAnswer');

var aiTruth = E.playerAnswer(aiTurnState, aiTurnState.pending.attr, aiTurnState.pending.value);
var beforeWrongAnswer = aiTurnState.aiCandidates.join(',');
var dishonest = E.answerAiQuestion(aiTurnState, !aiTruth);
ok('拒绝与玩家角色不符的回答', dishonest.ok === false && dishonest.error === 'incorrectAnswer');
eq('错误回答不改变 AI 候选', aiTurnState.aiCandidates.join(','), beforeWrongAnswer);
ok('错误回答后 pending 仍保留', !!aiTurnState.pending);

var answered = E.answerAiQuestion(aiTurnState, aiTruth);
ok('真实回答后推进回合', answered.ok && aiTurnState.turn === 'player' && aiTurnState.pending === null);
eq('回答后候选数正确', aiTurnState.aiCandidates.length, answered.remaining);

var reproducible1 = E.newGame(808);
var reproducible2 = E.newGame(808);
var fixedQ = firstQuestionFor(reproducible1, 'player', E.createRng(1));
E.ask(reproducible1, 'player', fixedQ.attr, fixedQ.value);
E.ask(reproducible2, 'player', fixedQ.attr, fixedQ.value);
var repMove1 = E.aiTurn(reproducible1);
var repMove2 = E.aiTurn(reproducible2);
ok('AI 行为可按种子复现', repMove1.ok && repMove2.ok &&
  repMove1.action === repMove2.action &&
  repMove1.attr === repMove2.attr &&
  repMove1.value === repMove2.value);

var repeatState = E.newGame(909);
var repeatRng = E.createRng(11);
var repeatQ = firstQuestionFor(repeatState, 'player', repeatRng);
E.ask(repeatState, 'player', repeatQ.attr, repeatQ.value);
var askedQuestions = {};
var repeats = 0;
for (var round = 0; round < 10 && repeatState.status === 'playing'; round++) {
  var move = E.aiTurn(repeatState, repeatRng);
  if (!move.ok) break;
  if (move.action === 'guess') break;
  var key = move.attr + ':' + String(move.value);
  if (askedQuestions[key]) repeats += 1;
  askedQuestions[key] = true;
  var truth = E.playerAnswer(repeatState, move.attr, move.value);
  var answerResult = E.answerAiQuestion(repeatState, truth);
  if (!answerResult.ok || repeatState.status !== 'playing') break;
  var pQ2 = E.pickQuestion(repeatState, 'player', repeatRng);
  if (pQ2) E.ask(repeatState, 'player', pQ2.attr, pQ2.value);
  else if (repeatState.playerCandidates.length) {
    E.guess(repeatState, 'player', repeatState.playerCandidates[0]);
  }
}
ok('AI 连续提问不重复空问', repeats === 0, 'repeats=' + repeats);
ok('AI 在数轮中持续缩小范围', Object.keys(askedQuestions).length >= 3,
  'questions=' + Object.keys(askedQuestions).length);

/* ------------------------------------------------------------------ */
group('回合上限与终止');

var limitState = E.newGame(505);
limitState.turnCount = E.MAX_TURNS - 1;
var limitQ = firstQuestionFor(limitState, 'player', E.createRng(3));
var limitResult = E.ask(limitState, 'player', limitQ.attr, limitQ.value);
ok('达到上限时结束提问', limitResult.ok && limitState.turnCount >= E.MAX_TURNS);
eq('上限触发平局', [limitState.status, limitState.winner, limitState.turn], ['draw', null, null]);
var afterDraw = E.guess(limitState, 'player', 0);
ok('平局后拒绝动作', afterDraw.ok === false && afterDraw.error === 'gameOver');

/* ------------------------------------------------------------------ */
group('30 局 AI 对 AI 自对弈');

var games = [];
var allEnded = true;
var allWithinLimit = true;
var allNoIllegal = true;
var allQuestionKeys = {};
var outcomes = { player: 0, ai: 0, draw: 0 };

for (var g = 0; g < 30; g++) {
  var played = aiGame(1000 + g * 37);
  games.push(played);
  if (played.state.status === 'playing') allEnded = false;
  if (played.steps > E.MAX_TURNS + 5) allWithinLimit = false;
  if (played.illegal.length) allNoIllegal = false;
  if (played.state.turnCount > E.MAX_TURNS) allWithinLimit = false;
  if (outcomes[played.state.status] !== undefined) outcomes[played.state.status] += 1;
  played.questionKeys.forEach(function (key) { allQuestionKeys[key] = true; });
}

ok('30 局全部结束', allEnded, games.filter(function (x) { return x.state.status === 'playing'; }).length + ' still playing');
ok('30 局均无非法动作', allNoIllegal,
  games.map(function (x) { return x.illegal.join(';'); }).filter(Boolean).join(' | '));
ok('30 局均在回合上限内终止', allWithinLimit);
ok('30 局结果分布有效', outcomes.player + outcomes.ai + outcomes.draw === 30, JSON.stringify(outcomes));
ok('自对弈覆盖多种问题', Object.keys(allQuestionKeys).length >= 8,
  'unique=' + Object.keys(allQuestionKeys).length);
ok('每局最终状态不是进行中', games.every(function (x) {
  return x.state.status === 'player' || x.state.status === 'ai' || x.state.status === 'draw';
}));

/* ------------------------------------------------------------------ */

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exitCode = 1;
