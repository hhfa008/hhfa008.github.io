var I18N = {
  en: { eyebrow:'Mini game', title:'Sliding Puzzle 6×6', tagline:'Slide the tiles to arrange them in order', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Try to solve the puzzle in as few moves as possible.' },
  zh: { eyebrow:'迷你游戏', title:'数字华容道 6×6', tagline:'滑动方块，将它们按顺序排列', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'恭喜你！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'尽量用最少的步数解决这个谜题。' },
  id: { eyebrow:'Permainan mini', title:'Puzzle Geser 6×6', tagline:'Geser ubin-ubin untuk menyusunnya dalam urutan', score:'Skor', best:'Terbaik', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang indie',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Coba selesaikan teka-teki ini dalam jumlah langkah seefisien mungkin.' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.slide-6.best';
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
    var n = 6;
    var N = n * n;
    E.score.textContent = S.moves;
    E.best.textContent = best;
    E.extra.textContent = S.moves;
    E.board.innerHTML = '';
    for (var i = 0; i < N; i++) {
      var tile = document.createElement('div');
      tile.className = 'tile';
      if (S.tiles[i] !== 0) {
        tile.textContent = S.tiles[i];
      } else {
        tile.classList.add('empty');
      }
      E.board.appendChild(tile);
    }
    var status = CORE.status(S);
    if (status === 'won') {
      E.overlayTitle.textContent = I18N[I18N.lang].overlayWin;
      E.overlayText.textContent = I18N[I18N.lang].hintText;
      E.overlay.hidden = false;
      best = Arcade.setBest(BEST_KEY, S.moves, best);
      E.best.textContent = best;
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
  }

  function input(action) {
    var result = CORE.act(S, action);
    if (result.changed) {
      S = result.state;
      render();
    } else {
      E.feedback.textContent = 'Invalid move';
      setTimeout(function() { E.feedback.textContent = ''; }, 1000);
    }
  }

  function newGame() {
    S = CORE.newGame(Math.random);
    best = Arcade.best(BEST_KEY, 0);
    render();
  }

  E.btnNew.addEventListener('click', newGame);
  E.btnOverlay.addEventListener('click', newGame);
  E.btnHint.addEventListener('click', function() {
    E.feedback.textContent = I18N[I18N.lang].hintText;
    setTimeout(function() { E.feedback.textContent = ''; }, 3000);
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
