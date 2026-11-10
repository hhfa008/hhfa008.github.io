/* 迷雾庄园 — original branching-narrative engine with AI host (UMD).
 * Pure rules, seeded RNG, no DOM. Node: require('./engine.js'); browser: window.MiniEngine.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var CFG = {
  "name": "迷雾庄园",
  "start": "start",
  "maxSteps": 12,
  "scenes": {
    "start": {
      "text": "雾把庄园的铁门裹住了。门缝里塞着一封写着你名字的信，落款却是三年前失踪的管家。",
      "choices": [
        {
          "label": "推开铁门",
          "text": "你决定沿着第一条线索追下去。",
          "next": "mid0",
          "flags": {
            "path": "a"
          }
        },
        {
          "label": "绕到侧窗",
          "text": "你选择先观察，再决定立场。",
          "next": "mid1",
          "flags": {
            "path": "b"
          }
        },
        {
          "label": "先读信",
          "text": "你绕开正面，从侧面接近真相。",
          "next": "mid2",
          "flags": {
            "path": "c"
          }
        }
      ]
    },
    "mid0": {
      "text": "门厅的钟停在午夜，楼梯上有一串潮湿的脚印。",
      "choices": [
        {
          "label": "追查到底",
          "text": "把最后一条线索握在手里。",
          "next": "endGood",
          "flags": {
            "resolve": "truth"
          }
        },
        {
          "label": "立刻离开",
          "text": "保命比真相重要。",
          "next": "endBad",
          "flags": {
            "resolve": "flee"
          }
        }
      ]
    },
    "mid1": {
      "text": "侧窗后是书房，桌上的茶还冒着热气。",
      "choices": [
        {
          "label": "相信线索",
          "text": "你决定押上全部判断。",
          "next": "endHidden",
          "flags": {
            "resolve": "trust"
          }
        },
        {
          "label": "保持沉默",
          "text": "不表态，悄悄退场。",
          "next": "endBad",
          "flags": {
            "resolve": "silent"
          }
        }
      ]
    },
    "mid2": {
      "text": "信里只有一句话：别相信戴白手套的人。",
      "choices": [
        {
          "label": "打开暗门",
          "text": "门后也许就是答案。",
          "next": "endGood",
          "flags": {
            "resolve": "open"
          }
        },
        {
          "label": "原路返回",
          "text": "你记住了暗门的位置。",
          "next": "endHidden",
          "flags": {
            "resolve": "mark"
          }
        }
      ]
    },
    "endGood": {
      "text": "你在钟楼里找到了管家留下的账本，庄园的秘密被公之于众。",
      "ending": "good"
    },
    "endBad": {
      "text": "你从侧门离开，雾在身后合拢，问题永远没有答案。",
      "ending": "bad"
    },
    "endHidden": {
      "text": "你戴上白手套，成为庄园新的守门人，没有人再见过你。",
      "ending": "secret"
    }
  }
};
  var SCENES = CFG.scenes;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 40) state.log.shift();
  }
  function currentScene(state) {
    return SCENES[state.scene] || null;
  }
  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 20261110 : opts.seed;
    var rng = mulberry32(seed);
    var state = {
      seed: seed, rng: rng, scene: CFG.start, flags: {},
      visited: [CFG.start], over: false, ending: null, winner: null,
      reason: '', log: [], stepCount: 0
    };
    log(state, '开场：' + SCENES[CFG.start].text);
    return state;
  }
  function legalActions(state) {
    if (state.over) return [];
    var sc = currentScene(state);
    return sc && sc.choices ? sc.choices.map(function (_, i) { return i; }) : [];
  }
  function applyAction(state, idx) {
    if (!state || state.over) throw new Error('story is over');
    var sc = currentScene(state);
    if (!sc || !sc.choices) throw new Error('no choices here');
    if (typeof idx !== 'number' || idx < 0 || idx >= sc.choices.length) throw new Error('illegal choice');
    var ch = sc.choices[idx];
    state.stepCount++;
    if (ch.flags) {
      Object.keys(ch.flags).forEach(function (k) { state.flags[k] = ch.flags[k]; });
    }
    log(state, '选择「' + ch.label + '」：' + ch.text);
    state.scene = ch.next;
    state.visited.push(ch.next);
    var next = currentScene(state);
    if (!next) throw new Error('broken scene link: ' + ch.next);
    log(state, next.text);
    if (next.ending) {
      state.over = true;
      state.ending = next.ending;
      state.winner = 'ending:' + next.ending;
      state.reason = next.text;
      log(state, '抵达结局：' + next.ending);
      return state;
    }
    if (state.stepCount >= CFG.maxSteps) {
      state.over = true;
      state.ending = 'lost';
      state.winner = 'ending:lost';
      state.reason = '你在故事里绕得太久，线索中断了。';
      log(state, '步数用尽，故事中断');
    }
    return state;
  }
  function aiAction(state) {
    if (!state || state.over) return null;
    var acts = legalActions(state);
    if (!acts.length) return null;
    return acts[Math.floor(state.rng() * acts.length)];
  }
  function selfPlay(seed) {
    var g = createGame({ seed: seed });
    var guard = 0;
    while (!g.over && guard < 50) {
      applyAction(g, aiAction(g));
      guard++;
    }
    if (!g.over) throw new Error('self-play did not terminate');
    return g;
  }
  return {
    CFG: CFG, scenes: SCENES, createGame: createGame, currentScene: currentScene,
    legalActions: legalActions, applyAction: applyAction, aiAction: aiAction, selfPlay: selfPlay
  };
});