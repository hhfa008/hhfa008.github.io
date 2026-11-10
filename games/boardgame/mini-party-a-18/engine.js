/* 线索阶梯 (mini-party-a-18) — pure UMD rules engine. Single-player party microgame vs. a local AI.
 * Node: require("./engine.js"); Browser: window.MiniPartyEngine
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MiniPartyEngine = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CONFIG = {
  "slug": "mini-party-a-18",
  "name": "线索阶梯",
  "mode": "deduce",
  "offset": 4,
  "rounds": [
    {
      "prompt": "我在想一个家里的东西。",
      "clues": [
        "它会发出声音，但不是乐器。",
        "它的肚子里很冷。",
        "打开它时会亮起来。"
      ],
      "options": [
        "冰箱",
        "洗衣机",
        "微波炉",
        "电视"
      ],
      "answer": 0,
      "note": "会响、会冷、开门亮灯，是冰箱。"
    },
    {
      "prompt": "我在想一个天上的东西。",
      "clues": [
        "它自己不发光。",
        "它每晚换一个样子。",
        "人们常用它寄托思念。"
      ],
      "options": [
        "月亮",
        "太阳",
        "路灯",
        "星星"
      ],
      "answer": 0,
      "note": "不发光、会圆缺、常被写进思念，是月亮。"
    },
    {
      "prompt": "我在想一件随身物品。",
      "clues": [
        "下雨时才想起它。",
        "它能张开也能合拢。",
        "不用时挂在门边。"
      ],
      "options": [
        "雨伞",
        "帽子",
        "雨衣",
        "窗帘"
      ],
      "answer": 0,
      "note": "可开合、挡雨、挂门边，是雨伞。"
    },
    {
      "prompt": "我在想床头常见的东西。",
      "clues": [
        "它每天都会叫你。",
        "它有两个耳朵。",
        "它常常放在床头。"
      ],
      "options": [
        "闹钟",
        "手机",
        "水壶",
        "台灯"
      ],
      "answer": 0,
      "note": "每天叫人、两个铃铛耳朵、放在床头，是闹钟。"
    },
    {
      "prompt": "我在想一个安静的东西。",
      "clues": [
        "它有很多页。",
        "读完一本要花很久。",
        "图书馆里最多。"
      ],
      "options": [
        "书",
        "水杯",
        "椅子",
        "钥匙"
      ],
      "answer": 0,
      "note": "很多页、需要读、图书馆最多，是书。"
    },
    {
      "prompt": "我在想一种小动物。",
      "clues": [
        "它很爱干净。",
        "它走路几乎没有声音。",
        "它很怕水。"
      ],
      "options": [
        "猫",
        "狗",
        "兔子",
        "鸟"
      ],
      "answer": 0,
      "note": "爱干净、脚步轻、怕水，是猫。"
    },
    {
      "prompt": "我在想一种天气现象。",
      "clues": [
        "它从天上落下来。",
        "它通常是白色的。",
        "落在手心会化。"
      ],
      "options": [
        "雪",
        "雨",
        "冰雹",
        "云"
      ],
      "answer": 0,
      "note": "从天而降、白色、遇热就化，是雪。"
    },
    {
      "prompt": "我在想一种交通工具。",
      "clues": [
        "它在隧道里跑。",
        "它一趟接一趟。",
        "人们排队上车。"
      ],
      "options": [
        "地铁",
        "火车",
        "公交车",
        "电梯"
      ],
      "answer": 0,
      "note": "隧道、班次密、排队上车，是地铁。"
    },
    {
      "prompt": "我在想天上的一个东西。",
      "clues": [
        "它每天都会升起。",
        "它让人感到温暖。",
        "不能直视它太久。"
      ],
      "options": [
        "太阳",
        "月亮",
        "星星",
        "灯泡"
      ],
      "answer": 0,
      "note": "每天升起、带来温暖、不能直视，是太阳。"
    },
    {
      "prompt": "我在想一个跟着你的东西。",
      "clues": [
        "它总是跟着你。",
        "它不会说话。",
        "有光才有它。"
      ],
      "options": [
        "影子",
        "回声",
        "脚印",
        "镜子"
      ],
      "answer": 0,
      "note": "跟着人、不会说话、需要光，是影子。"
    },
    {
      "prompt": "我在想楼里的一个东西。",
      "clues": [
        "它会上上下下。",
        "它有一个小房间。",
        "它靠按钮指挥。"
      ],
      "options": [
        "电梯",
        "楼梯",
        "扶梯",
        "门"
      ],
      "answer": 0,
      "note": "上下移动、有小房间、按钮控制，是电梯。"
    },
    {
      "prompt": "我在想一件常拿在手里的东西。",
      "clues": [
        "它常被拿在手里。",
        "它能拍照。",
        "它最怕没电。"
      ],
      "options": [
        "手机",
        "相机",
        "手表",
        "遥控器"
      ],
      "answer": 0,
      "note": "常在手边、能拍照、怕没电，是手机。"
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
