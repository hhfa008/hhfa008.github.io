/* 古宅回声 — original branching-narrative engine with AI host (UMD).
 * Pure rules, seeded RNG, no DOM. Node: require('./engine.js'); browser: window.MiniEngine.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var CFG = {
  "name": "古宅回声",
  "start": "start",
  "maxSteps": 12,
  "scenes": {
    "start": {
      "text": "你继承了一栋没有窗户的古宅。钥匙插进锁孔时，屋里有人轻轻说了一句“终于来了”。",
      "choices": [
        {
          "label": "直接进屋",
          "text": "你决定沿着第一条线索追下去。",
          "next": "mid0",
          "flags": {
            "path": "a"
          }
        },
        {
          "label": "先绕宅一圈",
          "text": "你选择先观察，再决定立场。",
          "next": "mid1",
          "flags": {
            "path": "b"
          }
        },
        {
          "label": "在门外问是谁",
          "text": "你绕开正面，从侧面接近真相。",
          "next": "mid2",
          "flags": {
            "path": "c"
          }
        }
      ]
    },
    "mid0": {
      "text": "走廊尽头挂着一幅和你长相相同的肖像，落款是一百年前。",
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
      "text": "屋后有一扇被砖封住的门，砖缝里透出灯光。",
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
      "text": "声音没有回答，但门自己开了一条缝。",
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
      "text": "你在阁楼找到家族日记，明白自己为什么从小就会做这栋房子的梦。",
      "ending": "good"
    },
    "endBad": {
      "text": "你退到街上，古宅的灯一盏盏熄灭，钥匙在口袋里变冷。",
      "ending": "bad"
    },
    "endHidden": {
      "text": "你留下修补屋顶，成为下一位讲述“终于来了”的人。",
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