/* Arcade kit: 汉诺塔。state = { disks, pegs:[[...],[...],[]], moves, won, cursor:{from,to} }
 *
 * 输入契约（两种等价写法）：
 *   - 数组 [from,to]：直接移动（原有契约，测试与老页面继续用）。
 *   - 方向字符串（模板的 KEYMAP 只给得出这种）：在共享层规范化成 [from,to]——
 *       left/right 循环选择源柱，up/down 循环选择目标柱，activate 执行移动。
 *   这样 10 个页面不需要各自适配，键盘/滑动都能真正移动盘片。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArcadeKit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create(params) {
    var disks = (params && params.disks) || 4;
    var DEFAULT_CURSOR = { from: 0, to: 2 };

    function newGame() {
      var first = [];
      for (var d = disks; d >= 1; d--) first.push(d);
      return {
        disks: disks, pegs: [first, [], []], moves: 0, won: false,
        cursor: { from: DEFAULT_CURSOR.from, to: DEFAULT_CURSOR.to },
      };
    }

    function rawAct(state, from, to) {
      if (from === to || from < 0 || from > 2 || to < 0 || to > 2) return { state: state, changed: false, gained: 0 };
      var src = state.pegs[from], dst = state.pegs[to];
      if (!src.length) return { state: state, changed: false, gained: 0 };
      var moving = src[src.length - 1];
      if (dst.length && dst[dst.length - 1] < moving) return { state: state, changed: false, gained: 0 };
      var pegs = state.pegs.map(function (p) { return p.slice(); });
      pegs[from].pop();
      pegs[to].push(moving);
      var won = pegs[2].length === disks;
      var cursor = state.cursor || DEFAULT_CURSOR;
      return {
        state: {
          disks: disks, pegs: pegs, moves: state.moves + 1, won: won,
          cursor: { from: cursor.from, to: cursor.to },
        },
        changed: true,
        gained: 0,
      };
    }

    function act(state, action) {
      // 页面模板只传方向字符串；这里一次性规范化，页面不用改。
      if (typeof action === 'string') {
        var cursor = state.cursor || DEFAULT_CURSOR;
        var next = { from: cursor.from, to: cursor.to };
        if (action === 'left') next.from = (next.from + 2) % 3;
        else if (action === 'right') next.from = (next.from + 1) % 3;
        else if (action === 'up') next.to = (next.to + 2) % 3;
        else if (action === 'down') next.to = (next.to + 1) % 3;
        else if (action === 'activate') return rawAct(state, cursor.from, cursor.to);
        else return { state: state, changed: false, gained: 0 };
        return {
          state: {
            disks: state.disks, pegs: state.pegs, moves: state.moves, won: state.won,
            cursor: next,
          },
          changed: true,
          gained: 0,
        };
      }
      if (!Array.isArray(action) || action.length !== 2) return { state: state, changed: false, gained: 0 };
      return rawAct(state, action[0], action[1]);
    }

    function status(state) { return state.pegs[2].length === disks ? 'won' : 'playing'; }

    return {
      newGame: newGame,
      act: act,
      status: status,
      actions: function () { return ['[from,to]', 'left/right/up/down/activate']; },
    };
  }
  return { create: create };
});
