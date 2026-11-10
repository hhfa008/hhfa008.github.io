/* 词链传动 (mini-party-a-23) — pure UMD rules engine. Single-player party microgame vs. a local AI.
 * Node: require("./engine.js"); Browser: window.MiniPartyEngine
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MiniPartyEngine = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CONFIG = {
  "slug": "mini-party-a-23",
  "name": "词链传动",
  "mode": "chain",
  "offset": 4,
  "rounds": [
    {
      "prompt": "月光",
      "options": [
        "潮汐",
        "石头",
        "键盘",
        "螺钉"
      ],
      "answer": 0,
      "note": "月亮牵引潮汐，这是最自然的联想。"
    },
    {
      "prompt": "面包",
      "options": [
        "黄油",
        "铁钉",
        "雨伞",
        "电池"
      ],
      "answer": 0,
      "note": "面包配黄油，是最顺口的搭配。"
    },
    {
      "prompt": "冬天",
      "options": [
        "雪花",
        "西瓜",
        "凉鞋",
        "风扇"
      ],
      "answer": 0,
      "note": "冬天的典型意象是雪花。"
    },
    {
      "prompt": "钢笔",
      "options": [
        "墨水",
        "石头",
        "面粉",
        "绳子"
      ],
      "answer": 0,
      "note": "钢笔需要墨水才能写字。"
    },
    {
      "prompt": "森林",
      "options": [
        "树木",
        "沙漠",
        "海洋",
        "城市"
      ],
      "answer": 0,
      "note": "森林由树木组成。"
    },
    {
      "prompt": "咖啡",
      "options": [
        "苦涩",
        "锋利",
        "柔软",
        "明亮"
      ],
      "answer": 0,
      "note": "咖啡最直接的味道联想是苦涩。"
    },
    {
      "prompt": "海浪",
      "options": [
        "沙滩",
        "高山",
        "云端",
        "地底"
      ],
      "answer": 0,
      "note": "海浪拍向沙滩，是自然衔接。"
    },
    {
      "prompt": "图书馆",
      "options": [
        "安静",
        "嘈杂",
        "油腻",
        "刺眼"
      ],
      "answer": 0,
      "note": "图书馆的标志性氛围是安静。"
    },
    {
      "prompt": "蜡烛",
      "options": [
        "火焰",
        "冰块",
        "钢铁",
        "砂纸"
      ],
      "answer": 0,
      "note": "点燃蜡烛就会出现火焰。"
    },
    {
      "prompt": "医生",
      "options": [
        "听诊器",
        "画笔",
        "锅铲",
        "扳手"
      ],
      "answer": 0,
      "note": "听诊器是医生最典型的工具。"
    },
    {
      "prompt": "跑道",
      "options": [
        "钉鞋",
        "雨靴",
        "拖鞋",
        "舞鞋"
      ],
      "answer": 0,
      "note": "跑道上的运动员常穿钉鞋。"
    },
    {
      "prompt": "键盘",
      "options": [
        "敲击",
        "搅拌",
        "切割",
        "缝补"
      ],
      "answer": 0,
      "note": "使用键盘的动作是敲击。"
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
