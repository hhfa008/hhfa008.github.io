var I18N = {
  en: { eyebrow:'Classic puzzle game', title:'Minesweeper 14×14', tagline:'Clear the board without detonating any mines', score:'Score', best:'Best', extraLabel:'Flags',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Tip: Click to reveal, right-click to flag', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'No more hints available' },
  zh: { eyebrow:'经典益智游戏', title:'扫雷 14×14', tagline:'在不引爆任何地雷的情况下清除棋盘', score:'得分', best:'最高分', extraLabel:'标记',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'提示：点击翻开，右键标记', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'没有更多提示了' },
  id: { eyebrow:'Permainan teka-teki klasik', title:'Sapu Ranjau 14×14', tagline:'Bersihkan papan tanpa meledakkan bom apa pun', score:'Skor', best:'Tertinggi', extraLabel:'Bendera',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Tip: Klik untuk mengungkap, klik kanan untuk menandai', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Tidak ada petunjuk lagi' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.mines-14x14.best';
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
  var S = CORE.newGame(Math.random);
  var best = Arcade.best(BEST_KEY, 0);

  function render() {
    var size = S.rows * S.cols;
    E.board.innerHTML = '';
    E.board.setAttribute('style', `--rows:${S.rows}; --cols:${S.cols};`);
    for (var i = 0; i < size; i++) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.index = i;
      if (S.revealed[i]) {
        cell.classList.add('revealed');
        if (S.mines.includes(i)) {
          cell.classList.add('mine');
        } else {
          var adjacent = CORE.adjacent(S, i);
          if (adjacent > 0) {
            cell.textContent = adjacent;
            cell.classList.add(`adjacent-${adjacent}`);
          }
        }
      } else {
        if (S.flags[i]) {
          cell.classList.add('flag');
        }
      }
      E.board.appendChild(cell);
    }
    E.score.textContent = 0;
    E.best.textContent = best;
    E.extra.textContent = S.flags.filter(Boolean).length;
    if (S.status !== 'playing') {
      E.overlay.hidden = false;
      E.overlayTitle.textContent = I18N[Arcade.lang()][Arcade.overlayKey(S.status)];
      E.overlayText.textContent = '';
      E.btnOverlay.textContent = I18N[Arcade.lang()].playAgain;
    } else {
      E.overlay.hidden = true;
    }
  }

  function input(action) {
    var result = CORE.act(S, action, Math.random);
    if (result.changed) {
      S = result.state;
      if (S.status !== 'playing') {
        if (S.status === 'won' || S.status === 'lost') {
          best = Arcade.setBest(BEST_KEY, best, S.revealed.filter(Boolean).length);
        }
      }
      render();
    }
  }

  function newGame() {
    S = CORE.newGame(Math.random);
    best = Arcade.best(BEST_KEY, 0);
    render();
  }

  E.btnNew.addEventListener('click', newGame);
  E.btnOverlay.addEventListener('click', newGame);
  E.btnHint.addEventListener('click', function () {
    E.feedback.textContent = I18N[Arcade.lang()].hintText;
    setTimeout(function () { E.feedback.textContent = ''; }, 2000);
  });
  E.board.addEventListener('click', function (e) {
    var cell = e.target.closest('.cell');
    if (cell) {
      var index = parseInt(cell.dataset.index);
      input({ type: 'reveal', index: index });
    }
  });
  E.board.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    var cell = e.target.closest('.cell');
    if (cell) {
      var index = parseInt(cell.dataset.index);
      input({ type: 'flag', index: index });
    }
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
