/* 谁在说谎 (mini-party-a-11) — pure UMD rules engine. Single-player party microgame vs. a local AI.
 * Node: require("./engine.js"); Browser: window.MiniPartyEngine
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MiniPartyEngine = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CONFIG = {
  "slug": "mini-party-a-11",
  "name": "谁在说谎",
  "mode": "vote",
  "offset": 0,
  "rounds": [
    {
      "prompt": "休息室的玻璃杯碎了。窗台还是湿的，但今天一整天都没下雨。",
      "options": [
        "阿澈：我刚才在擦窗台，水不小心洒了。",
        "小满：我在卧室睡午觉，没听见声音。",
        "老周：我在楼下散步，刚回来。",
        "阿宁：我在厨房洗碗，水开得很大。"
      ],
      "answer": 0,
      "note": "没下雨却只有窗台湿，擦窗台的说法正好解释了水迹，也暴露了打碎杯子后匆忙擦拭的痕迹。"
    },
    {
      "prompt": "冰箱断电了一整晚，第二天冰淇淋却几乎没化。",
      "options": [
        "阿澈：我睡前就把冰淇淋吃完了。",
        "小满：我半夜起来修好了电闸。",
        "老周：我房间离厨房最远，什么都不知道。",
        "阿宁：我戴着耳塞睡到天亮。"
      ],
      "answer": 1,
      "note": "断电一夜冰淇淋却不化，最合理的解释是有人半夜恢复了供电。"
    },
    {
      "prompt": "深夜十一点，办公室打印机打印出一份文件。门禁记录显示，九点后只有小满和老周还在楼里。",
      "options": [
        "小满：我加班到十点半，没碰打印机。",
        "老周：我整晚在外地出差，不可能回办公室。",
        "阿澈：我六点就下班回家了。",
        "阿宁：我住得很远，晚上从不过来。"
      ],
      "answer": 1,
      "note": "门禁记录与老周“人在外地”的说法直接冲突，他的口供最可疑。"
    },
    {
      "prompt": "教室的鱼缸被人换了水。讲台上的抹布是干的，地上却有一串湿脚印通向窗边。",
      "options": [
        "阿澈：我进来拿书，没靠近鱼缸。",
        "小满：我负责换水，但用的是水管。",
        "老周：我在操场打球，鞋一直是干的。",
        "阿宁：我坐在窗边看书，没动过。"
      ],
      "answer": 2,
      "note": "换水会留下湿脚印；老周强调鞋是干的，反而与地上通向窗边的湿脚印矛盾。"
    },
    {
      "prompt": "派对上的气球全部被放飞了。屋顶很高，孩子们够不到，梯子也不见了。",
      "options": [
        "阿澈：我一直在厨房切水果。",
        "小满：我搬走了梯子去修灯。",
        "老周：我在门口迎接客人。",
        "阿宁：我在阳台接电话。"
      ],
      "answer": 1,
      "note": "能碰到高处的只有搬走梯子的人，小满的说法与“梯子不见了”正好对上。"
    },
    {
      "prompt": "图书馆的安静告示牌被翻成了反面。监控显示，翻动它的人背着一把吉他。",
      "options": [
        "阿澈：我背着吉他去了排练室。",
        "小满：我空手进来还书。",
        "老周：我拎着两袋菜经过。",
        "阿宁：我抱着纸箱上楼。"
      ],
      "answer": 0,
      "note": "监控里唯一背吉他的就是阿澈，他的说法无法排除自己经过告示牌。"
    },
    {
      "prompt": "厨房的盐罐和糖罐被调换了位置。今天只有做饭的人会同时用到它们。",
      "options": [
        "阿澈：我今天只喝了咖啡。",
        "小满：我中午煮了汤，还烤了蛋糕。",
        "老周：我叫了外卖，没进厨房。",
        "阿宁：我在客厅看电视。"
      ],
      "answer": 1,
      "note": "同时用到盐和糖的，最可能是又煮汤又烤蛋糕的小满。"
    },
    {
      "prompt": "会议室的白板被擦干净了。昨晚停水，直到今早才恢复，但白板上留着一道湿痕。",
      "options": [
        "阿澈：我用湿巾擦的。",
        "小满：我昨晚没来公司。",
        "老周：我早上用干抹布擦的。",
        "阿宁：我没碰过白板。"
      ],
      "answer": 0,
      "note": "停水期间最不该出现湿巾的湿润痕迹，阿澈的说法与现场状态最矛盾。"
    },
    {
      "prompt": "宠物店的狗粮少了一袋。店门完好，只有员工有钥匙。",
      "options": [
        "阿澈：我请假去了医院。",
        "小满：我昨天值班到打烊。",
        "老周：我只负责洗狗。",
        "阿宁：我负责收银，没进仓库。"
      ],
      "answer": 1,
      "note": "门没有被撬，只有值班到打烊的小满最有机会接触仓库。"
    },
    {
      "prompt": "晚上的篝火提前熄灭了。四个人的裤脚都有灰，只有一个人的鞋底是干的。",
      "options": [
        "阿澈：我去河边提过水。",
        "小满：我一直坐在火堆旁。",
        "老周：我负责添柴。",
        "阿宁：我在帐篷里整理睡袋。"
      ],
      "answer": 0,
      "note": "去河边提水的人鞋底应当潮湿，阿澈的鞋底却是干的，说法与痕迹不符。"
    },
    {
      "prompt": "生日蛋糕上的蜡烛被提前吹灭了。房间里没有风，窗户也关着。",
      "options": [
        "阿澈：我负责关窗。",
        "小满：我在门口拆礼物。",
        "老周：我打了个喷嚏。",
        "阿宁：我在切水果。"
      ],
      "answer": 2,
      "note": "没有风也没有开窗，最可能让蜡烛熄灭的正是老周的喷嚏。"
    },
    {
      "prompt": "公交站的长椅被涂了油漆。告示写着“油漆未干”，站牌扶手上还有一块新鲜漆印。",
      "options": [
        "阿澈：我站着等车。",
        "小满：我坐过另一张椅子。",
        "老周：我靠在站牌上。",
        "阿宁：我蹲在路边系鞋带。"
      ],
      "answer": 2,
      "note": "站牌紧挨着长椅，扶手上有新鲜漆印，靠站牌的老周最可疑。"
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
