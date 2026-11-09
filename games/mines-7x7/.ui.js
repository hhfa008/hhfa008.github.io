var I18N = {
  en: { eyebrow:'Classic puzzle game', title:'Minesweeper 7×7', tagline:'Clear the board without detonating any mines', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Tip: Click a tile to reveal it. Right-click to flag a mine.', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'No more moves available.' },
  zh: { eyebrow:'经典益智游戏', title:'扫雷 7×7', tagline:'在不引爆任何地雷的情况下清除棋盘', score:'分数', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'提示：点击方块来翻开它。右键标记地雷。', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'没有更多可走的步了。' },
  id: { eyebrow:'Permainan teka-teki klasik', title:'Sapu Ranjau 7×7', tagline:'Bersihkan papan tanpa meledakkan bom apa pun', score:'Skor', best:'Tertinggi', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Tip: Klik petak untuk mengungkapnya. Klik kanan untuk menandai bom.', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang indie',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Tidak ada langkah tersisa.' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.mines-7x7.best';
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
    E.board.style.gridTemplateColumns = `repeat(${S.cols}, 1fr)`;
    for (var i = 0; i < size; i++) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.index = i;
      if (S.revealed[i]) {
        if (S.mines.includes(i)) {
          cell.classList.add('mine');
        } else {
          var count = CORE.adjacent(S, i);
          if (count > 0) {
            cell.textContent = count;
            cell.classList.add('number-' + count);
          }
        }
      } else {
        if (S.flags[i]) {
          cell.classList.add('flag');
        } else {
          cell.classList.add('hidden');
        }
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
    E.extra.textContent = 0;
    E.best.textContent = best;

    if (S.status !== 'playing') {
      E.overlay.hidden = false;
      if (S.status === 'won') {
        E.overlayTitle.textContent = I18N[I18N.lang || 'en'].overlayWin;
        E.overlayText.textContent = '';
      } else if (S.status === 'lost') {
        E.overlayTitle.textContent = I18N[I18N.lang || 'en'].overlayLose;
        E.overlayText.textContent = '';
      } else if (S.status === 'draw') {
        E.overlayTitle.textContent = I18N[I18N.lang || 'en'].overlayDraw;
        E.overlayText.textContent = I18N[I18N.lang || 'en'].hintText;
      }
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
          best = Arcade.setBest(BEST_KEY, best, S);
        }
      }
      render();
    } else {
      E.feedback.textContent = I18N[I18N.lang || 'en'].hintText;
      setTimeout(() => { E.feedback.textContent = ''; }, 1000);
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
    E.feedback.textContent = I18N[I18N.lang || 'en'].hintText;
    setTimeout(() => { E.feedback.textContent = ''; }, 1000);
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
