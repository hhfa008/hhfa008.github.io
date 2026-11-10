var I18N = {
  en: { eyebrow:'Classic puzzle game', title:'2048 7×7', tagline:'Join the tiles, get to 2048!', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Use your keyboard or swipe to move the tiles. When two tiles with the same number touch, they merge into one!', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Try to reach 2048!' },
  zh: { eyebrow:'经典益智游戏', title:'2048 7×7', tagline:'合并数字方块，达到 2048！', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'使用键盘或滑动来移动方块。当两个相同数字的方块相碰时，它们会合并成一个！', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'试着达到 2048!' },
  id: { eyebrow:'Permainan teka-teki klasik', title:'2048 7×7', tagline:'Gabungkan ubin-ubin, capai 2048!', score:'Skor', best:'Tertinggi', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Gunakan keyboard atau gesek untuk memindahkan ubin. Ketika dua ubin dengan angka sama bersentuhan, mereka akan bergabung!', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang indie',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Coba capai 2048!' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.2048-7.best';
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
    var score = S.score;
    var moves = S.moves;
    var status = CORE.status(S);
    E.score.textContent = score;
    E.best.textContent = best;
    E.extra.textContent = moves;
    E.board.innerHTML = '';
    for (var i = 0; i < board.length; i++) {
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.textContent = board[i] || '';
      if (board[i]) tile.classList.add('tile-' + board[i]);
      E.board.appendChild(tile);
    }
    if (status !== 'playing') {
      E.overlayTitle.textContent = I18N[Arcade.lang()][Arcade.overlayKey(status)] || '';
      E.overlayText.textContent = I18N[Arcade.lang()].hintText;
      E.overlay.hidden = false;
    } else {
      E.overlay.hidden = true;
    }
    ArcadeBoardArt.decorate(E.board, '2048');
  }

  function input(action) {
    var res = CORE.act(S, action, Math.random);
    if (res.changed) {
      S = res.state;
      best = Arcade.setBest(BEST_KEY, best, S.score);
      render();
    } else {
      E.feedback.textContent = I18N[Arcade.lang()].hintText;
      setTimeout(function () { E.feedback.textContent = ''; }, 1000);
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
    setTimeout(function () { E.feedback.textContent = ''; }, 1000);
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
