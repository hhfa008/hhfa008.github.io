var I18N = {
  en: { eyebrow:'Classic puzzle game', title:'Minesweeper Medium', tagline:'Clear the board without detonating any mines', score:'Score', best:'Best', extraLabel:'Flags',
        boardAria:'Minesweeper board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Tip: Left-click to reveal a tile, right-click to flag a mine', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'No more hints available' },
  zh: { eyebrow:'经典益智游戏', title:'扫雷·中级', tagline:'在不引爆任何地雷的情况下清除棋盘', score:'得分', best:'最高分', extraLabel:'标记',
        boardAria:'扫雷棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'提示：左键点击翻开格子，右键点击标记地雷', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'没有更多提示了' },
  id: { eyebrow:'Permainan teka-teki klasik', title:'Sapu Ranjau Sedang', tagline:'Bersihkan papan tanpa meledakkan bom apa pun', score:'Skor', best:'Tertinggi', extraLabel:'Bendera',
        boardAria:'Papan sapu ranjau', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Tips: Klik kiri untuk membuka tile, klik kanan untuk menandai bom', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Tidak ada petunjuk lagi' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.mines-mid.best';
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
    var N = S.rows * S.cols;
    E.board.innerHTML = '';
    E.board.setAttribute('data-aria', I18N[Arcade.lang()].boardAria);
    E.score.textContent = 0;
    E.best.textContent = best;
    E.extra.textContent = S.flags.filter(Boolean).length;
    E.overlay.hidden = true;

    for (var i = 0; i < N; i++) {
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
            cell.classList.add('n' + adjacent);
          }
        }
      } else {
        if (S.flags[i]) {
          cell.classList.add('flag');
        }
      }
      E.board.appendChild(cell);
    }

    if (S.status !== 'playing') {
      E.overlay.hidden = false;
      E.overlayTitle.textContent = I18N[Arcade.lang()][S.status === 'won' ? 'overlayWin' : S.status === 'lost' ? 'overlayLose' : 'overlayDraw'];
      E.overlayText.textContent = '';
    }
    ArcadeBoardArt.decorate(E.board, 'mines');
  }

  function input(action) {
    var result = CORE.act(S, action, Math.random);
    if (result.changed) {
      S = result.state;
      if (S.status === 'won' || S.status === 'lost') {
        if (S.status === 'won') {
          best = Arcade.setBest(BEST_KEY, best, 0);
        }
        render();
      } else {
        render();
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
