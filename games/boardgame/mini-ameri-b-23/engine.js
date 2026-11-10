/* 断线电台 — original branching-narrative engine with AI host (UMD).
 * Pure rules, seeded RNG, no DOM. Node: require('./engine.js'); browser: window.MiniEngine.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var CFG = {
  "name": "断线电台",
  "start": "start",
  "maxSteps": 12,
  "scenes": {
    "start": {
      "text": "暴雪压断了天线，电台只剩一个频率还能收到声音。对面自称是山另一侧的守夜人，声音却和你一模一样。",
      "choices": [
        {
          "label": "回应呼叫",
          "text": "你决定沿着第一条线索追下去。",
          "next": "mid0",
          "flags": {
            "path": "a"
          }
        },
        {
          "label": "关闭电台",
          "text": "你选择先观察，再决定立场。",
          "next": "mid1",
          "flags": {
            "path": "b"
          }
        },
        {
          "label": "按声音指示出门",
          "text": "你绕开正面，从侧面接近真相。",
          "next": "mid2",
          "flags": {
            "path": "c"
          }
        }
      ]
    },
    "mid0": {
      "text": "对面准确说出了你桌上的每一样东西，包括那杯冷掉的咖啡。",
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
      "text": "你关掉电台，寂静里仍有微弱的电流声从墙壁里渗出来。",
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
      "text": "雪地里有一串刚留下的脚印，通向没有灯的山路。",
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
      "text": "你沿着频率找到另一个自己，两段人生在雪夜里对上了暗号。",
      "ending": "good"
    },
    "endBad": {
      "text": "你烧掉天线，无线电从此沉默，但你偶尔还会听见自己的声音。",
      "ending": "bad"
    },
    "endHidden": {
      "text": "你走进山里，再没有回来，频率开始用你的声音呼叫下一个人。",
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