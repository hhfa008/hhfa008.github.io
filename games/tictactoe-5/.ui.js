var I18N = {
  en: { eyebrow:'5×5 Tic-tac-toe', title:'Tic-tac-toe 5×5', tagline:'Get 5 in a row to win', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'You play as X, the AI plays as O', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Try to block the AI or form a line of 5' },
  zh: { eyebrow:'五子棋 5×5', title:'五子棋 5×5', tagline:'连成五子获胜', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'你执 X，AI 执 O', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'试着阻止AI或连成五子' },
  id: { eyebrow:'Tic-tac-toe 5×5', title:'Tic-tac-toe 5×5', tagline:'Dapatkan 5 dalam satu baris untuk menang', score:'Skor', best:'Terbaik', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Kamu main X, AI main O', rules:'Aturan (Bahasa Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Coba blokir AI atau buat baris 5' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.tictactoe-5.best';
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
  var moveCount = 0;

  function render() {
    var size = S.n;
    var board = S.board;
    E.board.innerHTML = '';
    E.board.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    for (var i = 0; i < board.length; i++) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.index = i;
      if (board[i] === 1) cell.textContent = 'X';
      else if (board[i] === 2) cell.textContent = 'O';
      E.board.appendChild(cell);
    }
    E.score.textContent = moveCount;
    E.best.textContent = best;
    E.extra.textContent = moveCount;
    var status = S.status;
    if (status === 'won') {
      E.overlayTitle.textContent = I18N[I18N.lang].overlayWin;
      E.overlayText.textContent = '';
      E.overlay.hidden = false;
    } else if (status === 'lost') {
      E.overlayTitle.textContent = I18N[I18N.lang].overlayLose;
      E.overlayText.textContent = '';
      E.overlay.hidden = false;
    } else if (status === 'draw') {
      E.overlayTitle.textContent = I18N[I18N.lang].overlayDraw;
      E.overlayText.textContent = '';
      E.overlay.hidden = false;
    } else {
      E.overlay.hidden = true;
    }
    ArcadeBoardArt.decorate(E.board, 'tictactoe');
  }

  function input(action) {
    if (typeof action === 'number') {
      var result = CORE.act(S, action, Math.random);
      if (result.changed) {
        S = result.state;
        moveCount++;
        if (S.status === 'playing') {
          E.feedback.textContent = I18N[I18N.lang].hintText;
        } else {
          E.feedback.textContent = '';
        }
        if (S.status !== 'playing') {
          if (S.status === 'won') {
            best = Arcade.setBest(BEST_KEY, moveCount);
          }
        }
        render();
      }
    }
  }

  function newGame() {
    S = CORE.newGame(Math.random);
    moveCount = 0;
    best = Arcade.best(BEST_KEY, 0);
    E.feedback.textContent = '';
    render();
  }

  E.btnNew.addEventListener('click', newGame);
  E.btnOverlay.addEventListener('click', newGame);
  E.btnHint.addEventListener('click', function () {
    E.feedback.textContent = I18N[I18N.lang].hintText;
  });
  E.board.addEventListener('click', function (e) {
    var cell = e.target.closest('.cell');
    if (cell) {
      var index = parseInt(cell.dataset.index);
      input(index);
    }
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
