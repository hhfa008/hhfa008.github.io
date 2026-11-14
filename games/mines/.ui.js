var I18N = {
  en: { eyebrow:'Classic puzzle game', title:'Minesweeper', tagline:'Clear the minefield without detonating any mines', score:'Score', best:'Best', extraLabel:'Flags',
        boardAria:'Minesweeper board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Tip: Click a number to reveal its neighbors if all flags are placed correctly', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Right-click to flag a cell' },
  zh: { eyebrow:'经典益智游戏', title:'扫雷', tagline:'在不引爆任何地雷的情况下清除雷区', score:'分数', best:'最高分', extraLabel:'标记',
        boardAria:'扫雷棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'提示：如果所有标记都正确，点击数字可揭示其相邻格子', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'右键标记格子' },
  id: { eyebrow:'Permainan teka-teki klasik', title:'Sapu Ranjau', tagline:'Bersihkan medan ranjau tanpa meledakkan bom apa pun', score:'Skor', best:'Tertinggi', extraLabel:'Bendera',
        boardAria:'Papan sapu ranjau', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Tip: Klik angka untuk mengungkap tetangga jika semua bendera ditempatkan dengan benar', rules:'Aturan (中文)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang indie',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Klik kanan untuk menandai sel' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.mines.best';
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
    E.board.style.setProperty('--rows', S.rows);
    E.board.style.setProperty('--cols', S.cols);
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
            cell.classList.add('n' + adjacent);
          }
        }
      } else {
        if (S.flags[i]) {
          cell.classList.add('flag');
        }
      }
      cell.addEventListener('click', function () {
        if (S.status === 'playing') {
          input({ type: 'reveal', index: parseInt(this.dataset.index) });
        }
      });
      cell.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        if (S.status === 'playing') {
          input({ type: 'flag', index: parseInt(this.dataset.index) });
        }
      });
      E.board.appendChild(cell);
    }
    E.score.textContent = 0;
    E.extra.textContent = S.flags.filter(Boolean).length;
    E.best.textContent = best;
    if (S.status !== 'playing') {
      E.overlay.hidden = false;
      E.overlayTitle.textContent = I18N[Arcade.lang()][Arcade.overlayKey(S.status)];
      E.overlayText.textContent = S.status === 'won' ? '' : I18N[Arcade.lang()].hintText;
    } else {
      E.overlay.hidden = true;
    }
    ArcadeBoardArt.decorate(E.board, 'mines');
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
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
