var I18N = {
  en: { eyebrow:'Mini Game', title:'Lights Out 3×3', tagline:'Turn off all the lights!', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Click a tile to toggle it and its neighbors.', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', hintText:'Try to turn off all lights in fewer moves.' },
  zh: { eyebrow:'迷你游戏', title:'关灯 3×3', tagline:'把所有灯都关掉！', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'点击一个方块来切换它和它的邻居。', rules:'游戏规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', hintText:'试着用更少的步数关闭所有灯。' },
  id: { eyebrow:'Permainan Mini', title:'Matikan Lampu 3×3', tagline:'Matikan semua lampu!', score:'Skor', best:'Tertinggi', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Klik sebuah kotak untuk mengalihkannya dan tetangganya.', rules:'Aturan (Bahasa Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', hintText:'Coba matikan semua lampu dalam langkah yang lebih sedikit.' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.lights-3.best';
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
    } else {
      E.overlayTitle.textContent = I18N[Arcade.lang()].overlayLose;
      E.overlayText.textContent = '';
    }
    E.overlay.hidden = false;
  }

  function render() {
    var lights = S.lights;
    var n = 3;
    var N = n * n;
    E.board.innerHTML = '';
    for (var i = 0; i < N; i++) {
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.index = i;
      tile.setAttribute('aria-label', 'Tile ' + (i + 1));
      tile.style.backgroundColor = lights[i] ? '#f0f0f0' : '#333';
      tile.addEventListener('click', function () {
        input(parseInt(this.dataset.index));
      });
      E.board.appendChild(tile);
    }
    E.score.textContent = S.moves;
    E.best.textContent = best;
    E.extra.textContent = S.moves;
    var status = CORE.status(S);
    if (status === 'won') {
      showOverlay('won');
      Arcade.setBest(BEST_KEY, S.moves);
    }
  }

  function input(action) {
    var result = CORE.act(S, action);
    if (result.changed) {
      S = result.state;
      best = Math.min(best, S.moves);
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
    setTimeout(function () { E.feedback.textContent = ''; }, 3000);
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  newGame();
})();
