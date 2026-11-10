var I18N = {
  en: { eyebrow:'Mini Game', title:'Reaction aim-15', tagline:'Click as fast as you can!', score:'Score', best:'Best', extraLabel:'Hits',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Click the board when the timer reaches zero.', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Click when timer reaches zero' },
  zh: { eyebrow:'迷你游戏', title:'反应挑战 aim-15', tagline:'尽可能快地点击！', score:'得分', best:'最高分', extraLabel:'点击次数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'当计时器归零时点击棋盘。', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'计时器归零时点击' },
  id: { eyebrow:'Permainan Mini', title:'Reaksi aim-15', tagline:'Klik secepat mungkin!', score:'Skor', best:'Tertinggi', extraLabel:'Klik',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Klik papan ketika penghitung waktu mencapai nol.', rules:'Aturan (Bahasa Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Klik ketika penghitung waktu mencapai nol' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.aim-15.best';
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
    E.score.textContent = S.score;
    E.best.textContent = best;
    E.extra.textContent = S.hits;
    E.board.setAttribute('aria-label', I18N[Arcade.lang()][E.board.dataset.aria]);
    ArcadeReactionArt.ensure(E.board, 'target');
    if (S.over) {
      E.overlay.hidden = false;
      if (S.running) {
        E.overlayTitle.textContent = I18N[Arcade.lang()].overlayWin;
        E.overlayText.textContent = '';
      } else {
        E.overlayTitle.textContent = I18N[Arcade.lang()].overlayLose;
        E.overlayText.textContent = '';
      }
    } else {
      E.overlay.hidden = true;
    }
  }

  function input(action) {
    var result = CORE.act(S, action, Math.random);
    if (result.changed) {
      S = result.state;
      if (result.gained > 0) {
        E.feedback.textContent = '+' + result.gained;
        setTimeout(() => { E.feedback.textContent = ''; }, 500);
      }
      best = Arcade.setBest(BEST_KEY, S.score, best);
      render();
    }
  }

  function newGame() {
    S = CORE.newGame(Math.random);
    best = Arcade.best(BEST_KEY, 0);
    render();
  }

  E.board.addEventListener('click', () => input('hit'));
  E.btnNew.addEventListener('click', newGame);
  E.btnOverlay.addEventListener('click', newGame);
  E.btnHint.addEventListener('click', () => {
    E.feedback.textContent = I18N[Arcade.lang()].hintText;
    setTimeout(() => { E.feedback.textContent = ''; }, 1000);
  });
  Arcade.onKeys({ ' ': () => input('hit'), 'Enter': () => input('hit') }, input);
  Arcade.onSwipe(E.board, input);
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
