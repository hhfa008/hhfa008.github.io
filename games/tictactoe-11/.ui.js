var I18N = {
  en: { eyebrow:'11×11 Tic-tac-toe', title:'Tic-tac-toe 11×11', tagline:'Get 11 in a row to win', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'You play as X, the AI plays as O', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'AI is thinking...' },
  zh: { eyebrow:'11×11 井字棋', title:'11×11 井字棋', tagline:'连成11子获胜', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'你执 X，AI执 O', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'AI 正在思考...' },
  id: { eyebrow:'Tic-tac-toe 11×11', title:'Tic-tac-toe 11×11', tagline:'Dapatkan 11 dalam satu baris untuk menang', score:'Skor', best:'Terbaik', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Kamu main X, AI main O', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang indie',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'AI sedang berpikir...' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.tictactoe-11.best';
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
      E.board.appendChild(cell);
    }
    E.score.textContent = S.turn === 1 ? '0' : '1';
    E.best.textContent = best;
    E.extra.textContent = Math.floor((size - board.filter(v => v === 0).length) / 2);
    var status = S.status;
    if (status === 'won') {
      E.overlayTitle.textContent = I18N[I18N.lang || 'en'].overlayWin;
      E.overlayText.textContent = '';
      E.overlay.hidden = false;
    } else if (status === 'lost') {
      E.overlayTitle.textContent = I18N[I18N.lang || 'en'].overlayLose;
      E.overlayText.textContent = '';
      E.overlay.hidden = false;
    } else if (status === 'draw') {
      E.overlayTitle.textContent = I18N[I18N.lang || 'en'].overlayDraw;
      E.overlayText.textContent = '';
      E.overlay.hidden = false;
    } else {
      E.overlay.hidden = true;
    }
  }

  function input(action) {
    if (typeof action === 'number') {
      var result = CORE.act(S, action, Math.random);
      if (result.changed) {
        S = result.state;
        if (S.status === 'won' || S.status === 'lost' || S.status === 'draw') {
          if (S.status === 'won' || S.status === 'lost') {
            var score = S.status === 'won' ? 1 : 0;
            if (score > best) {
              best = score;
              Arcade.setBest(BEST_KEY, best);
            }
          }
        }
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
