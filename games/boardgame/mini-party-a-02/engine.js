/* 半句知音 (mini-party-a-02) — pure UMD rules engine. Single-player party microgame vs. a local AI.
 * Node: require("./engine.js"); Browser: window.MiniPartyEngine
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MiniPartyEngine = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CONFIG = {
  "slug": "mini-party-a-02",
  "name": "半句知音",
  "mode": "guess",
  "offset": 2,
  "rounds": [
    {
      "prompt": "它白天挂在天上，会发光也会发热。",
      "options": [
        "太阳",
        "月亮",
        "灯泡",
        "蜡烛"
      ],
      "answer": 0,
      "note": "“白天”和“发热”把答案锁死在太阳上。"
    },
    {
      "prompt": "它会叫，会看家，有四条腿。",
      "options": [
        "狗",
        "猫",
        "桌子",
        "马"
      ],
      "answer": 0,
      "note": "会叫、看家、四条腿三个特征同时命中狗。"
    },
    {
      "prompt": "下雨时打开，收起来像一根短棍。",
      "options": [
        "雨伞",
        "帽子",
        "扇子",
        "旗子"
      ],
      "answer": 0,
      "note": "可开合又能挡雨，只有雨伞符合。"
    },
    {
      "prompt": "冬天戴在手上，总是成双成对。",
      "options": [
        "手套",
        "袜子",
        "围巾",
        "耳罩"
      ],
      "answer": 0,
      "note": "戴在手上、必须成双，答案是手套。"
    },
    {
      "prompt": "会滚动，能拍打，球场上很常见。",
      "options": [
        "篮球",
        "苹果",
        "车轮",
        "西瓜"
      ],
      "answer": 0,
      "note": "能拍打又会滚，球场上常见的是篮球。"
    },
    {
      "prompt": "生来很酸，做菜常放，个头不大。",
      "options": [
        "柠檬",
        "葡萄",
        "草莓",
        "青椒"
      ],
      "answer": 0,
      "note": "酸味和烹饪用途指向柠檬。"
    },
    {
      "prompt": "背在肩上，用来装书和电脑。",
      "options": [
        "书包",
        "水杯",
        "椅子",
        "闹钟"
      ],
      "answer": 0,
      "note": "能背、能装书和电脑的是书包。"
    },
    {
      "prompt": "夜里发亮，数量很多，数也数不清。",
      "options": [
        "星星",
        "路灯",
        "萤火虫",
        "钻石"
      ],
      "answer": 0,
      "note": "夜里成片出现且数不清，最符合星星。"
    },
    {
      "prompt": "在水里游，有鳞片，会吐泡泡。",
      "options": [
        "鱼",
        "鸭子",
        "船",
        "青蛙"
      ],
      "answer": 0,
      "note": "有鳞片又会吐泡泡，答案是鱼。"
    },
    {
      "prompt": "戴在脸上，主要用来挡住阳光。",
      "options": [
        "墨镜",
        "口罩",
        "头盔",
        "耳机"
      ],
      "answer": 0,
      "note": "挡阳光又戴在脸上，墨镜最合适。"
    },
    {
      "prompt": "一根一根，能写字，用久了会变短。",
      "options": [
        "铅笔",
        "筷子",
        "吸管",
        "蜡烛"
      ],
      "answer": 0,
      "note": "写字、变短，指向铅笔。"
    },
    {
      "prompt": "圆圆的，切开有籽，夏天吃起来最甜。",
      "options": [
        "西瓜",
        "南瓜",
        "苹果",
        "柚子"
      ],
      "answer": 0,
      "note": "夏天、多籽、清甜，是西瓜的典型特征。"
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

  function newRound(g) {
    if (g.round >= g.maxRounds) { g.phase = "over"; g.current = null; return; }
    var src = CONFIG.rounds[(CONFIG.offset + g.round) % CONFIG.rounds.length];
    var c = {
      prompt: src.prompt,
      options: src.options.slice(),
      answerIndex: src.answer,
      note: src.note
    };
    if (CONFIG.mode === "deduce") { c.clues = src.clues.slice(); c.revealed = 1; }
    if (g.rng() < 0.65) c.aiChoice = c.answerIndex;
    else {
      var alt = Math.floor(g.rng() * c.options.length);
      if (alt === c.answerIndex) alt = (alt + 1) % c.options.length;
      c.aiChoice = alt;
    }
    g.current = c;
    g.phase = "choose";
  }

  function createGame(opts) {
    opts = opts || {};
    var g = {
      slug: CONFIG.slug, name: CONFIG.name, mode: CONFIG.mode,
      seed: opts.seed == null ? 1 : opts.seed,
      round: 0, maxRounds: 5, score: 0, aiScore: 0,
      phase: "choose", current: null, history: [], log: []
    };
    g.rng = mulberry32(g.seed);
    newRound(g);
    return g;
  }

  function choose(g, index) {
    if (!g || g.phase !== "choose" || !g.current) throw new Error("not choosing");
    if (typeof index !== "number" || index % 1 !== 0 || index < 0 || index >= g.current.options.length) {
      throw new Error("bad choice");
    }
    var c = g.current;
    var correct = index === c.answerIndex;
    var points = 0;
    if (correct) points = CONFIG.mode === "deduce" ? Math.max(1, 4 - c.revealed) : 2;
    var aiCorrect = c.aiChoice === c.answerIndex;
    var aiPoints = aiCorrect ? 1 : 0;
    g.score += points; g.aiScore += aiPoints;
    g.history.push({
      round: g.round, playerChoice: index, answerIndex: c.answerIndex,
      aiChoice: c.aiChoice, correct: correct, points: points, aiPoints: aiPoints
    });
    g.phase = "reveal"; g.log.push(correct ? "hit" : "miss");
    return { correct: correct, points: points, answerIndex: c.answerIndex, aiChoice: c.aiChoice, note: c.note || "" };
  }

  function revealClue(g) {
    if (!g || g.mode !== "deduce" || g.phase !== "choose" || !g.current) throw new Error("cannot reveal");
    if (g.current.revealed >= g.current.clues.length) throw new Error("no more clues");
    g.current.revealed += 1;
    return g.current.revealed;
  }

  function next(g) {
    if (!g || g.phase !== "reveal") throw new Error("not revealed");
    g.round += 1;
    if (g.round >= g.maxRounds) { g.phase = "over"; g.current = null; }
    else newRound(g);
    return g;
  }

  function publicView(g) {
    var v = {
      slug: g.slug, name: g.name, mode: g.mode, round: g.round,
      maxRounds: g.maxRounds, score: g.score, aiScore: g.aiScore,
      phase: g.phase, history: g.history.map(function (h) {
        return { round: h.round, playerChoice: h.playerChoice, answerIndex: h.answerIndex, aiChoice: h.aiChoice, correct: h.correct, points: h.points, aiPoints: h.aiPoints };
      })
    };
    if (!g.current) return v;
    var c = { prompt: g.current.prompt, options: g.current.options.slice() };
    if (CONFIG.mode === "deduce") { c.clues = g.current.clues.slice(0, g.current.revealed); c.revealed = g.current.revealed; }
    if (g.phase === "reveal") { c.answerIndex = g.current.answerIndex; c.aiChoice = g.current.aiChoice; c.note = g.current.note; }
    v.current = c;
    return v;
  }

  function selfPlay(seed) {
    var g = createGame({ seed: seed });
    var guard = 0;
    while (g.phase !== "over" && guard < 60) {
      if (CONFIG.mode === "deduce" && g.current.revealed < 3 && g.rng() < 0.35) {
        revealClue(g);
      } else {
        var idx = Math.floor(g.rng() * g.current.options.length);
        if (g.rng() < 0.55) idx = g.current.answerIndex;
        choose(g, idx);
        next(g);
      }
      guard += 1;
    }
    if (g.phase !== "over") throw new Error("self-play did not finish");
    return { round: g.round, score: g.score, aiScore: g.aiScore, phase: g.phase, history: g.history.slice() };
  }

  return {
    createGame: createGame, choose: choose, revealClue: revealClue, next: next,
    publicView: publicView, selfPlay: selfPlay, CONFIG: CONFIG, mulberry32: mulberry32
  };
});
