var I18N = {
  en: { eyebrow:'Classic puzzle game', title:'2048', tagline:'Join the tiles, get to 2048!', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', hintText:'Try to reach 2048!' },
  zh: { eyebrow:'经典益智游戏', title:'2048', tagline:'合并方块，达到 2048！', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'提示：使用方向键或滑动操作合并相同数字的方块', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'恭喜你获胜了！', overlayLose:'游戏结束', hintText:'尝试达到 2048！' },
  id: { eyebrow:'Permainan teka-teki klasik', title:'2048', tagline:'Gabungkan tile, capai 2048!', score:'Skor', best:'Terbaik', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Petunjuk: Gunakan tombol arah atau gesek untuk menggabungkan tile dengan angka yang sama', rules:'Aturan (Bahasa Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', hintText:'Coba capai 2048!' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.2048-3.best';
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
    if (kind === 'win' || kind === 'lose') {
      E.overlayTitle.textContent = I18N[Arcade.lang()][kind === 'win' ? 'overlayWin' : 'overlayLose'];
      E.overlayText.textContent = I18N[Arcade.lang()][kind === 'win' ? 'overlayWin' : 'overlayLose'];
      E.overlay.classList.remove('hidden');
    } else {
      E.overlay.classList.add('hidden');
    }
  }

  function render() {
    var lang = Arcade.lang();
    E.score.textContent = S.score;
    E.best.textContent = best;
    E.extra.textContent = S.moves;
    E.board.setAttribute('aria-label', I18N[lang].boardAria);
    E.board.innerHTML = '';
    var n = 3;
    var size = n * n;
    for (var i = 0; i < size; i++) {
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.textContent = S.board[i] || '';
      if (S.board[i]) {
        tile.classList.add('tile-' + S.board[i]);
      }
      E.board.appendChild(tile);
    }
    var status = CORE.status(S);
    if (status === 'won') {
      showOverlay('win');
    } else if (status === 'lost') {
      showOverlay('lose');
    } else {
      showOverlay('none');
    }
  }

  function input(action) {
    var result = CORE.act(S, action, Math.random);
    if (result.changed) {
      S = result.state;
      if (S.score > best) {
        best = S.score;
        localStorage.setItem(BEST_KEY, best);
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
  if (E.btnHint) E.btnHint.addEventListener('click', function () {
    E.feedback.textContent = I18N[Arcade.lang()].hintText;
    setTimeout(() => { E.feedback.textContent = ''; }, 2000);
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  newGame();
})();
