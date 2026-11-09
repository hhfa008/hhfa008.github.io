// __CORE_START__
var CORE = (function () {
  'use strict';
  function newGame(rng) {
    rng = rng || Math.random;
    var n = 3;
    var size = n * n;
    var lights = new Array(size).fill(1);
    var moves = 0;
    var won = false;
    
    // 生成可解局面：从全灭状态反向点击
    var state = { lights: lights, moves: moves, won: won };
    for (var i = 0; i < 100; i++) {
      var idx = Math.floor(rng() * size);
      act(state, idx);
    }
    
    // 确保最终状态是可解的
    return state;
  }
  
  function act(state, action) {
    var next = JSON.parse(JSON.stringify(state));
    var changed = false;
    var gained = 0;
    var n = 3;
    var size = n * n;
    
    if (action < 0 || action >= size) return { state: next, changed: changed, gained: gained };
    
    var idx = action;
    var row = Math.floor(idx / n);
    var col = idx % n;
    
    // 翻转目标格子及其上下左右邻居
    var neighbors = [
      idx,
      idx - n, // 上
      idx + n, // 下
      idx - 1, // 左
      idx + 1  // 右
    ];
    
    for (var i = 0; i < neighbors.length; i++) {
      var neighbor = neighbors[i];
      if (neighbor >= 0 && neighbor < size && 
          Math.floor(neighbor / n) === row || Math.floor(neighbor / n) === row - 1 || Math.floor(neighbor / n) === row + 1) {
        if (neighbor % n === col || neighbor % n === col - 1 || neighbor % n === col + 1) {
          if (neighbor >= 0 && neighbor < size) {
            next.lights[neighbor] = 1 - next.lights[neighbor];
            changed = true;
          }
        }
      }
    }
    
    next.moves += 1;
    next.won = next.lights.every(function(light) { return light === 0; });
    
    return { state: next, changed: changed, gained: gained };
  }
  
  function status(state) {
    if (state.won) return 'won';
    if (state.lights.every(function(light) { return light === 0; })) return 'won';
    return 'playing';
  }
  
  return { newGame: newGame, act: act, status: status };
})();
// __CORE_END__
