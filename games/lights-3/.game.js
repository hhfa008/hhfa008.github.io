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

var I18N = {
  en: { eyebrow:'Logic', title:'Lights Out', tagline:'Turn off all the lights!', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Click a tile to toggle it and its neighbors.', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', hintText:'Try clicking the center tile.' },
  zh: { eyebrow:'逻辑', title:'点亮游戏', tagline:'关闭所有灯！', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'点击一个格子来切换它和它的邻居。', rules:'规则', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', hintText:'试试点击中间的格子。' },
  id: { eyebrow:'Logika', title:'Lights Out', tagline:'Matikan semua lampu!', score:'Skor', best:'Terbaik', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Klik tile untuk mengalihkannya dan tetangganya.', rules:'Aturan (Bahasa Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang indie',
        overlayWin:'Anda menang!', overlayLose:'Permainan berakhir', hintText:'Coba klik tile tengah.' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.lights-3.best';
  var E = {
    board: document.getElementById('board'),
    score: document.getElementById('stat-score'),
    best: document.getElementById('stat-best'),
    extra: document.getElementById('stat-extra'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayText: document.getElementById('overlay-text'),
    feedback: document.getElementById('feedback'),
    btnNew: document.getElementById('btn-new'),
    btnHint: document.getElementById('btn-hint'),
    btnOverlay: document.getElementById('btn-overlay')
  };
  var S = null;
  var best = Arcade.best(BEST_KEY, 0);

  function showOverlay(kind) {
    if (kind === 'win' || kind === 'lose') {
      E.overlayTitle.textContent = I18N[Arcade.lang()][kind === 'win' ? 'overlayWin' : 'overlayLose'];
      E.overlayText.innerHTML = I18N[Arcade.lang()].note;
      E.overlay.hidden = false;
    } else {
      E.overlay.hidden = true;
    }
  }

  function render() {
    var lang = Arcade.lang();
    E.score.textContent = S.moves;
    E.best.textContent = best;
    E.extra.textContent = I18N[lang].extraLabel;
    E.board.setAttribute('aria-label', I18N[lang].boardAria);
    E.board.innerHTML = '';
    var n = 3;
    var size = n * n;
    for (var i = 0; i < size; i++) {
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.index = i;
      tile.textContent = S.lights[i] ? '●' : '○';
      tile.style.pointerEvents = 'none';
      E.board.appendChild(tile);
    }
    var status = CORE.status(S);
    if (status === 'won') {
      showOverlay('win');
    } else if (status === 'lost') {
      showOverlay('lose');
    } else {
      showOverlay('none');
    }
  }

  function input(action) {
    var result = CORE.act(S, action);
    if (result.changed) {
      S = result.state;
      if (S.moves > best) {
        best = S.moves;
        localStorage.setItem(BEST_KEY, best);
      }
      render();
      if (CORE.status(S) === 'won') {
        showOverlay('win');
      }
    }
  }

  function newGame() {
    S = CORE.newGame(Math.random);
    best = Arcade.best(BEST_KEY, 0);
    render();
  }

  E.btnNew.addEventListener('click', newGame);
  E.btnOverlay.addEventListener('click', newGame);
  if (E.btnHint) E.btnHint.addEventListener('click', function () {
    var hint = Math.floor(Math.random() * 9);
    E.feedback.textContent = I18N[Arcade.lang()].hintText;
    setTimeout(function () { E.feedback.textContent = ''; }, 2000);
    input(hint);
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  newGame();
})();
