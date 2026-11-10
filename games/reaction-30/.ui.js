var I18N = {
  en: { eyebrow:'Mini Game', title:'Reaction reaction-30', tagline:'Click as fast as you can!', score:'Score', best:'Best', extraLabel:'Hits',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Click the board when it turns green', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Click when green!' },
  zh: { eyebrow:'迷你游戏', title:'反应挑战 reaction-30', tagline:'尽可能快地点击！', score:'得分', best:'最高分', extraLabel:'点击数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'当棋盘变绿时点击', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'变绿时点击！' },
  id: { eyebrow:'Permainan Mini', title:'Reaksi reaction-30', tagline:'Klik secepat mungkin!', score:'Skor', best:'Best', extraLabel:'Klik',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Klik papan ketika berubah hijau', rules:'Aturan (Chinese)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Klik ketika hijau!' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.reaction-30.best';
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
  var TICKER = null;

  function render() {
    E.score.textContent = S.score;
    E.best.textContent = best;
    E.extra.textContent = S.hits;
    E.board.style.backgroundColor = S.timeLeft > 0 ? '#f3ead9' : '#f3ead9';
    if (S.timeLeft <= 0) {
      E.board.style.backgroundColor = '#f3ead9';
    }
    if (S.timeLeft <= 0) {
      E.board.textContent = 'Time\'s up!';
    } else if (S.hits > 0 && S.misses === 0) {
      E.board.textContent = 'Click!';
    } else {
      E.board.textContent = '';
    }
    ArcadeReactionArt.ensure(E.board, 'lamp');

    var status = CORE.status(S);
    if (status === 'won') {
      E.overlayTitle.textContent = I18N[I18N.lang].overlayWin;
      E.overlayText.textContent = 'Hits: ' + S.hits + ', Misses: ' + S.misses;
      E.overlay.hidden = false;
    } else if (status === 'playing') {
      E.overlay.hidden = true;
    }
  }

  function input(action) {
    if (action === 'hit') {
      if (S.timeLeft > 0) {
        var result = CORE.act(S, 'hit');
        S = result.state;
        if (result.changed) {
          best = Arcade.setBest(BEST_KEY, Math.max(best, S.score));
          render();
        }
      }
    } else if (action === 'miss') {
      if (S.timeLeft > 0) {
        var result = CORE.act(S, 'miss');
        S = result.state;
        if (result.changed) {
          best = Arcade.setBest(BEST_KEY, Math.max(best, S.score));
          render();
        }
      }
    } else if (action === 'tick') {
      var result = CORE.act(S, 'tick');
      S = result.state;
      if (result.changed) {
        best = Arcade.setBest(BEST_KEY, Math.max(best, S.score));
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
  E.board.addEventListener('click', () => {
    if (S.timeLeft > 0) {
      input('hit');
    }
  });

  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
  // 每秒一步（固定步长累加器）；标签页隐藏时不推进，回前台不补步。
  TICKER = ArcadeTick.create({
    step: 1000,
    onStep: function () { input('tick'); }
  });
  TICKER.start();
})();
