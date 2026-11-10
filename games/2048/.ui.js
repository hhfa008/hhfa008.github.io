var I18N = {
  en: { eyebrow:'Classic', title:'2048', tagline:'Join the tiles, get to 2048!', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Use arrow keys or WASD to move. Swipe on mobile.', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', hintText:'Try to reach 2048!' },
  zh: { eyebrow:'经典', title:'2048', tagline:'合并数字方块，达到 2048！', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'再玩一次', newGame:'新游戏', hint:'提示',
        note:'使用方向键或 WASD 移动。手机上可滑动。', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', hintText:'试着达到 2048！' },
  id: { eyebrow:'Klasik', title:'2048', tagline:'Gabungkan ubin-ubin, capai 2048!', score:'Skor', best:'Tertinggi', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Gunakan tombol panah atau WASD untuk bergerak. Gesek di ponsel.', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', hintText:'Coba capai 2048!' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.2048.best';
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
    if (kind === 'won') {
      E.overlayTitle.textContent = I18N[Arcade.lang()].overlayWin;
      E.overlayText.textContent = I18N[Arcade.lang()].hintText;
    } else if (kind === 'lost') {
      E.overlayTitle.textContent = I18N[Arcade.lang()].overlayLose;
      E.overlayText.textContent = '';
    }
    E.overlay.hidden = false;
  }

  function render() {
    var lang = Arcade.lang();
    E.score.textContent = S.score;
    E.best.textContent = best;
    E.extra.textContent = S.moves;
    E.board.innerHTML = '';
    for (var i = 0; i < 16; i++) {
      var tile = document.createElement('div');
      tile.className = 'tile';
      if (S.board[i]) {
        tile.classList.add('tile-' + S.board[i]);
        tile.textContent = S.board[i];
      }
      E.board.appendChild(tile);
    }
    var status = CORE.status(S);
    if (status === 'won' && !S.won) {
      S.won = true;
      showOverlay('won');
      setTimeout(function () { E.overlay.hidden = true; }, 1400);
    } else if (status === 'lost' && E.overlay.hidden) {
      showOverlay('lost');
    }
  }

  function input(action) {
    var result = CORE.act(S, action);
    if (result.changed) {
      S = result.state;
      if (S.score > best) {
        best = S.score;
        Arcade.setBest(BEST_KEY, best);
      }
      render();
    }
  }

  function newGame() {
    S = CORE.newGame(Math.random);
    best = Arcade.best(BEST_KEY, 0);
    E.overlay.hidden = true;
    E.feedback.textContent = '';
    render();
  }

  E.btnNew.addEventListener('click', newGame);
  E.btnOverlay.addEventListener('click', newGame);
  if (E.btnHint) E.btnHint.addEventListener('click', function () {
    E.feedback.textContent = I18N[Arcade.lang()].hintText;
    setTimeout(() => { E.feedback.textContent = ''; }, 3000);
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  newGame();
})();
