var I18N = {
  en: { eyebrow:'Classic puzzle game', title:'Minesweeper Easy', tagline:'Clear the board without detonating any mines', score:'Score', best:'Best', extraLabel:'Flags',
        boardAria:'Minesweeper board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Click to reveal, tap and hold to flag', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Right-click or long-press to flag a cell' },
  zh: { eyebrow:'经典益智游戏', title:'扫雷·初级', tagline:'在不引爆任何地雷的情况下清空棋盘', score:'分数', best:'最高分', extraLabel:'标记',
        boardAria:'扫雷棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'点击翻开，长按标记', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'右键或长按标记单元格' },
  id: { eyebrow:'Permainan teka-teki klasik', title:'Sapu Ranjau Mudah', tagline:'Bersihkan papan tanpa meledakkan bom apa pun', score:'Skor', best:'Tertinggi', extraLabel:'Bendera',
        boardAria:'Papan Sapu Ranjau', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Klik untuk mengungkap, tekan dan tahan untuk menandai', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang indie',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Klik kanan atau tahan untuk menandai sel' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.mines-easy.best';
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
    E.board.setAttribute('style', `--rows:${S.rows}; --cols:${S.cols};`);
    for (var i = 0; i < N; i++) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.index = i;
      if (S.revealed[i]) {
        cell.classList.add('revealed');
        if (S.mines.includes(i)) {
          cell.classList.add('mine');
        } else {
          var count = CORE.adjacent(S, i);
          if (count > 0) cell.textContent = count;
        }
      } else {
        if (S.flags[i]) cell.classList.add('flag');
      }
      cell.addEventListener('click', function () {
        input({ type: 'reveal', index: parseInt(this.dataset.index) });
      });
      cell.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        input({ type: 'flag', index: parseInt(this.dataset.index) });
      });
      E.board.appendChild(cell);
    }
    E.score.textContent = 0;
    E.best.textContent = best;
    E.extra.textContent = S.flags.filter(Boolean).length;
    if (S.status !== 'playing') {
      E.overlay.hidden = false;
      E.overlayTitle.textContent = I18N[Arcade.lang()][Arcade.overlayKey(S.status)];
      E.overlayText.textContent = S.status === 'won' ? '' : S.status === 'lost' ? 'You hit a mine!' : '';
    } else {
      E.overlay.hidden = true;
    }
  }

  function input(action) {
    var result = CORE.act(S, action, Math.random);
    if (result.changed) {
      S = result.state;
      if (S.status === 'won' || S.status === 'lost') {
        if (S.status === 'won') {
          Arcade.setBest(BEST_KEY, best = Math.max(best, 0));
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
    setTimeout(function () { E.feedback.textContent = ''; }, 3000);
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
