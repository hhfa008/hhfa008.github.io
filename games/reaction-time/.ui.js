var I18N = {
  en: { eyebrow:'Mini Game', title:'Reaction Test', tagline:'Click when the light turns green!', score:'Score', best:'Best', extraLabel:'Hits',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Click the button when the light turns green. Misses cost time.', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Click when the light turns green!' },
  zh: { eyebrow:'小游戏', title:'反应测试', tagline:'灯光变绿时点击！', score:'得分', best:'最高分', extraLabel:'命中',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'灯光变绿时点击按钮。未命中会消耗时间。', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'灯光变绿时点击！' },
  id: { eyebrow:'Permainan Mini', title:'Tes Reaksi', tagline:'Klik ketika lampu berubah hijau!', score:'Skor', best:'Terbaik', extraLabel:'Hit',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Klik tombol ketika lampu berubah hijau. Kesalahan akan mengurangi waktu.', rules:'Aturan (Bahasa Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Klik ketika lampu berubah hijau!' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.reaction-time.best';
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
  var S = CORE.newGame();
  var best = Arcade.best(BEST_KEY, 0);

  function render() {
    E.score.textContent = S.score;
    E.best.textContent = best;
    E.extra.textContent = S.hits;
    E.board.className = 'board ' + (S.timeLeft > 0 ? 'active' : 'inactive');
    ArcadeReactionArt.ensure(E.board, 'lamp');
    if (S.over) {
      E.overlay.hidden = false;
      E.overlayTitle.textContent = S.hits >= 3 ? I18N[I18N.lang].overlayWin : I18N[I18N.lang].overlayLose;
      E.overlayText.textContent = S.hits >= 3 ? 'You hit ' + S.hits + ' times!' : 'You missed ' + S.misses + ' times.';
    } else {
      E.overlay.hidden = true;
    }
  }

  function input(action) {
    var result = CORE.act(S, action);
    if (result.changed) {
      S = result.state;
      if (S.over) {
        best = Arcade.setBest(BEST_KEY, S.score);
      }
      render();
    }
  }

  function newGame() {
    S = CORE.newGame();
    best = Arcade.best(BEST_KEY, 0);
    render();
  }

  E.btnNew.addEventListener('click', newGame);
  E.btnOverlay.addEventListener('click', newGame);
  E.btnHint.addEventListener('click', function () {
    E.feedback.textContent = I18N[I18N.lang].hintText;
    setTimeout(function () { E.feedback.textContent = ''; }, 2000);
  });
  Arcade.onKeys({ ' ': 'hit' }, input);
  Arcade.onSwipe(E.board, function (dir) { if (dir === 'tap') input('hit'); });
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
  // 每秒一步（固定步长累加器）；标签页隐藏时不推进，回前台不补步。
  var TICKER = ArcadeTick.create({
    step: 1000,
    onStep: function () { input('tick'); }
  });
  TICKER.start();
})();
