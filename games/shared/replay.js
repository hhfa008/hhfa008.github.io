/* 存档 / 复盘 / 观战数据（UMD，零依赖）。
 *
 *   var replay = Replay.create({ game, version, seed, params })
 *   replay.add(action)                  // 玩家动作（可 JSON 化）
 *   replay.toJSON()                     // {game,version,seed,params,actions,createdAt}
 *   Replay.fromJSON(text|obj)           // 版本不符抛错，不静默错读
 *   Replay.spectator(view, hiddenKeys)  // 观战视图脱敏（隐藏手牌/身份/答案）
 *   Replay.saveLocal(key, replay) / Replay.loadLocal(key)
 *
 * 复盘前提：游戏必须“种子确定 + 动作可重放”。引擎按 seed 初始化，
 * 重放同一 actions 序列必须得到同一结果（由各游戏测试保证）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.Replay = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var CURRENT_VERSION = 1;

  function create(cfg) {
    var conf = cfg || {};
    if (!conf.game) throw new Error('create: game required');
    var actions = [];
    var createdAt = conf.createdAt || new Date().toISOString();
    return {
      game: conf.game,
      version: conf.version || CURRENT_VERSION,
      seed: conf.seed == null ? null : conf.seed,
      params: Object.assign({}, conf.params || {}),
      add: function (action) {
        actions.push(JSON.parse(JSON.stringify(action)));
        return actions.length;
      },
      actions: function () { return actions.slice(); },
      toJSON: function () {
        return {
          game: conf.game,
          version: conf.version || CURRENT_VERSION,
          seed: conf.seed == null ? null : conf.seed,
          params: Object.assign({}, conf.params || {}),
          actions: actions.slice(),
          createdAt: createdAt
        };
      }
    };
  }

  function fromJSON(input) {
    var data = typeof input === 'string' ? JSON.parse(input) : input;
    if (!data || !data.game) throw new Error('fromJSON: missing game');
    if (Number(data.version) !== CURRENT_VERSION) {
      throw new Error('fromJSON: unsupported version ' + data.version + ' (expected ' + CURRENT_VERSION + ')');
    }
    if (!Array.isArray(data.actions)) throw new Error('fromJSON: actions must be an array');
    var replay = create({
      game: data.game,
      version: Number(data.version),
      seed: data.seed,
      params: data.params,
      createdAt: data.createdAt
    });
    data.actions.forEach(function (action) { replay.add(action); });
    return replay;
  }

  // 观战：只读视图 + 隐藏字段脱敏（递归删 key），永不改原对象。
  function spectator(view, hiddenKeys) {
    var hidden = {};
    (hiddenKeys || []).forEach(function (k) { hidden[k] = true; });
    function walk(value) {
      if (Array.isArray(value)) return value.map(walk);
      if (value && typeof value === 'object') {
        var out = {};
        Object.keys(value).forEach(function (k) {
          if (hidden[k]) return;
          out[k] = walk(value[k]);
        });
        return out;
      }
      return value;
    }
    return walk(view);
  }

  function saveLocal(key, replay) {
    try {
      var text = JSON.stringify(replay && replay.toJSON ? replay.toJSON() : replay);
      root.localStorage.setItem(key, text);
      return true;
    } catch (e) { return false; }
  }

  function loadLocal(key) {
    try {
      var text = root.localStorage.getItem(key);
      if (!text) return null;
      return fromJSON(text);
    } catch (e) { return null; }
  }

  return {
    create: create,
    fromJSON: fromJSON,
    spectator: spectator,
    saveLocal: saveLocal,
    loadLocal: loadLocal,
    version: CURRENT_VERSION
  };
});
