var I18N = {
  en: { eyebrow:'N-in-a-row', title:'Tic-tac-toe 4×4', tagline:'Classic game on a 4×4 grid', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'You play as X, the AI plays as O', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Try to block the AI from winning' },
  zh: { eyebrow:'N连棋', title:'四子棋 4×4', tagline:'经典4×4棋盘游戏', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'你执X，AI执O', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'试着阻止AI获胜' },
  id: { eyebrow:'N dalam baris', title:'Tic-tac-toe 4×4', tagline:'Permainan klasik di papan 4×4', score:'Skor', best:'Terbaik', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Kamu main X, AI main O', rules:'Aturan (Chinese)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang indie',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Coba blokir AI menang' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.tictactoe-4.best';
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
    var board = S.board;
    var n = S.n;
    var size = n * n;
    E.board.innerHTML = '';
    for (var i = 0; i < size; i++) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.index = i;
      if (board[i] === 1) cell.textContent = 'X';
      else if (board[i] === 2) cell.textContent = 'O';
      cell.addEventListener('click', function () {
        input(parseInt(this.dataset.index));
      });
      E.board.appendChild(cell);
    }
    E.score.textContent = 0;
    E.best.textContent = best;
    E.extra.textContent = 0;
    if (S.status !== 'playing') {
      E.overlay.hidden = false;
      if (S.status === 'won') {
        E.overlayTitle.textContent = I18N[Arcade.lang()].overlayWin;
        E.overlayText.textContent = '';
      } else if (S.status === 'lost') {
        E.overlayTitle.textContent = I18N[Arcade.lang()].overlayLose;
        E.overlayText.textContent = '';
      } else if (S.status === 'draw') {
        E.overlayTitle.textContent = I18N[Arcade.lang()].overlayDraw;
        E.overlayText.textContent = '';
      }
    } else {
      E.overlay.hidden = true;
    }
    ArcadeBoardArt.decorate(E.board, 'tictactoe');
  }

  function input(action) {
    var result = CORE.act(S, action, Math.random);
    if (result.changed) {
      S = result.state;
      if (S.status !== 'playing') {
        if (S.status === 'won' || S.status === 'lost' || S.status === 'draw') {
          best = Arcade.setBest(BEST_KEY, best, 0);
        }
      }
      render();
    } else {
      E.feedback.textContent = I18N[Arcade.lang()].hintText;
      setTimeout(function () {
        E.feedback.textContent = '';
      }, 2000);
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
    setTimeout(function () {
      E.feedback.textContent = '';
    }, 2000);
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
