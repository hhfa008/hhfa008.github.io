var I18N = {
  en: { eyebrow:'12×12 Tic-tac-toe', title:'Tic-tac-toe 12×12', tagline:'Get 12 in a row to win', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'You play as X, the AI plays as O', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'AI is thinking...' },
  zh: { eyebrow:'12×12 井字棋', title:'井字棋 12×12', tagline:'连成12子获胜', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'你执 X，AI执 O', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'AI 正在思考...' },
  id: { eyebrow:'Tic-tac-toe 12×12', title:'Tic-tac-toe 12×12', tagline:'Dapatkan 12 dalam satu baris untuk menang', score:'Skor', best:'Terbaik', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Kamu main X, AI main O', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'AI sedang berpikir...' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.tictactoe-12.best';
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
  var hintPending = false;

  function render() {
    var n = S.n;
    var board = S.board;
    var turn = S.turn;
    var status = S.status;
    E.score.textContent = 0;
    E.best.textContent = best;
    E.extra.textContent = 0;
    E.board.innerHTML = '';
    for (var i = 0; i < n * n; i++) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.index = i;
      if (board[i] === 1) cell.textContent = 'X';
      else if (board[i] === 2) cell.textContent = 'O';
      E.board.appendChild(cell);
    }
    if (status !== 'playing') {
      E.overlay.hidden = false;
      if (status === 'won') {
        E.overlayTitle.textContent = I18N[I18N.lang].overlayWin;
        E.overlayText.textContent = '';
      } else if (status === 'lost') {
        E.overlayTitle.textContent = I18N[I18N.lang].overlayLose;
        E.overlayText.textContent = '';
      } else if (status === 'draw') {
        E.overlayTitle.textContent = I18N[I18N.lang].overlayDraw;
        E.overlayText.textContent = '';
      }
    } else {
      E.overlay.hidden = true;
    }
    ArcadeBoardArt.decorate(E.board, 'tictactoe');
  }

  function input(action) {
    if (hintPending) return;
    if (typeof action === 'number') {
      var result = CORE.act(S, action, Math.random);
      if (result.changed) {
        S = result.state;
        if (S.status !== 'playing') {
          if (S.status === 'won') {
            Arcade.setBest(BEST_KEY, best);
          } else if (S.status === 'lost') {
            Arcade.setBest(BEST_KEY, best);
          }
        }
        render();
      }
    } else if (action === 'hint') {
      hintPending = true;
      E.feedback.textContent = I18N[I18N.lang].hintText;
      setTimeout(function () {
        hintPending = false;
        E.feedback.textContent = '';
      }, 1000);
    }
  }

  function newGame() {
    S = CORE.newGame(Math.random);
    best = Arcade.best(BEST_KEY, 0);
    render();
  }

  E.btnNew.addEventListener('click', newGame);
  E.btnOverlay.addEventListener('click', newGame);
  E.btnHint.addEventListener('click', function () { input('hint'); });
  E.board.addEventListener('click', function (e) {
    if (e.target.classList.contains('cell')) {
      var index = parseInt(e.target.dataset.index);
      input(index);
    }
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
