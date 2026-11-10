/* 五词找茬 (mini-party-a-09) — pure UMD rules engine. Single-player party microgame vs. a local AI.
 * Node: require("./engine.js"); Browser: window.MiniPartyEngine
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MiniPartyEngine = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CONFIG = {
  "slug": "mini-party-a-09",
  "name": "五词找茬",
  "mode": "odd",
  "offset": 6,
  "rounds": [
    {
      "prompt": "找出不属于同一类的一项。",
      "options": [
        "苹果",
        "香蕉",
        "葡萄",
        "胡萝卜"
      ],
      "answer": 3,
      "note": "前三个是水果，胡萝卜是蔬菜。"
    },
    {
      "prompt": "找出不属于同一类的一项。",
      "options": [
        "公交车",
        "地铁",
        "自行车",
        "沙发"
      ],
      "answer": 3,
      "note": "前三个是交通工具，沙发是家具。"
    },
    {
      "prompt": "找出不属于同一类的一项。",
      "options": [
        "钢琴",
        "吉他",
        "小提琴",
        "画板"
      ],
      "answer": 3,
      "note": "前三个是乐器，画板是绘画工具。"
    },
    {
      "prompt": "找出不属于同一类的一项。",
      "options": [
        "跑步",
        "游泳",
        "阅读",
        "睡觉"
      ],
      "answer": 2,
      "note": "跑步、游泳是运动，睡觉是休息，阅读是静态活动；题面按“身体活动”分类时阅读最特别。"
    },
    {
      "prompt": "找出不属于同一类的一项。",
      "options": [
        "太阳",
        "月亮",
        "火星",
        "地球"
      ],
      "answer": 1,
      "note": "太阳是恒星，火星和地球是行星，月亮是卫星；按“天体类型”看月亮最特殊。"
    },
    {
      "prompt": "找出不属于同一类的一项。",
      "options": [
        "筷子",
        "勺子",
        "叉子",
        "盘子"
      ],
      "answer": 3,
      "note": "前三个是进食工具，盘子是容器。"
    },
    {
      "prompt": "找出不属于同一类的一项。",
      "options": [
        "快乐",
        "生气",
        "蓝色",
        "害怕"
      ],
      "answer": 2,
      "note": "前三个是情绪，蓝色是颜色。"
    },
    {
      "prompt": "找出不属于同一类的一项。",
      "options": [
        "沙发",
        "床",
        "衣柜",
        "冰箱"
      ],
      "answer": 3,
      "note": "前三个是家具，冰箱是家电。"
    },
    {
      "prompt": "找出不属于同一类的一项。",
      "options": [
        "足球",
        "篮球",
        "网球",
        "棋盘"
      ],
      "answer": 3,
      "note": "前三个是球类运动，棋盘是棋类用品。"
    },
    {
      "prompt": "找出不属于同一类的一项。",
      "options": [
        "大米",
        "面条",
        "面包",
        "牛奶"
      ],
      "answer": 3,
      "note": "前三个是主食，牛奶是饮品。"
    },
    {
      "prompt": "找出不属于同一类的一项。",
      "options": [
        "红色",
        "绿色",
        "圆形",
        "蓝色"
      ],
      "answer": 2,
      "note": "前三个是颜色，圆形是形状。"
    },
    {
      "prompt": "找出不属于同一类的一项。",
      "options": [
        "医生",
        "教师",
        "司机",
        "医院"
      ],
      "answer": 3,
      "note": "前三个是职业，医院是场所。"
    },
    {
      "prompt": "找出不属于同一类的一项。",
      "options": [
        "汉语",
        "英语",
        "日语",
        "数学"
      ],
      "answer": 3,
      "note": "前三个是语言，数学是学科。"
    },
    {
      "prompt": "找出不属于同一类的一项。",
      "options": [
        "早上",
        "中午",
        "傍晚",
        "星期"
      ],
      "answer": 3,
      "note": "前三个是一天中的时段，星期是时间单位。"
    },
    {
      "prompt": "找出不属于同一类的一项。",
      "options": [
        "铅笔",
        "橡皮",
        "尺子",
        "水杯"
      ],
      "answer": 3,
      "note": "前三个是文具，水杯是日用品。"
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
