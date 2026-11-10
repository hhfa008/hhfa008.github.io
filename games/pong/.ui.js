var I18N = {
  en: { eyebrow:'Mini Game', title:'Pong', tagline:'Classic arcade action', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Use ↑↓ keys or swipe to move paddle', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Move your paddle to hit the ball' },
  zh: { eyebrow:'小游戏', title:'乒乓', tagline:'经典街机对战', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'使用 ↑↓ 键或滑动来移动球拍', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'移动你的球拍击球' },
  id: { eyebrow:'Permainan Mini', title:'Pong', tagline:'Aksi arcade klasik', score:'Skor', best:'Terbaik', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Gunakan tombol ↑↓ atau geser untuk menggerakkan paddle', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang indie',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Gerakkan paddle kamu untuk memukul bola' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.pong.best';
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
  var hintShown = false;

  function render() {
    var ctx = E.board.getContext('2d');
    var W = S.w, H = S.h, BALL = 2;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(S.left.y - 8, 2, 4, 16);
    ctx.fillRect(S.right.y - 8, 2, 4, 16);
    ctx.fillRect(S.ball.x - BALL, S.ball.y - BALL, BALL * 2, BALL * 2);
    E.score.textContent = S.score[0] + ' - ' + S.score[1];
    E.best.textContent = best;
    E.extra.textContent = '';
    var status = CORE.status(S);
    if (status === 'won' || status === 'lost' || status === 'draw') {
      E.overlay.hidden = false;
      E.overlayTitle.textContent = I18N[I18N.lang][status === 'won' ? 'overlayWin' : status === 'lost' ? 'overlayLose' : 'overlayDraw'];
      E.overlayText.textContent = '';
    } else {
      E.overlay.hidden = true;
    }
    ArcadeBoardArt.decorate(E.board, 'pong');
  }

  function input(action) {
    if (action === 'hint' && !hintShown) {
      E.feedback.textContent = I18N[I18N.lang].hintText;
      hintShown = true;
      return;
    }
    var result = CORE.act(S, action, Math.random);
    if (result.changed) {
      S = result.state;
      if (result.gained > 0) {
        best = Arcade.setBest(BEST_KEY, Math.max(best, S.score[0] + S.score[1]));
      }
      render();
    }
  }

  function newGame() {
    S = CORE.newGame(Math.random);
    best = Arcade.best(BEST_KEY, 0);
    hintShown = false;
    E.feedback.textContent = '';
    render();
  }

  E.btnNew.addEventListener('click', newGame);
  E.btnOverlay.addEventListener('click', newGame);
  E.btnHint.addEventListener('click', () => input('hint'));
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
  // 固定步长推进：60 步/秒，标签页隐藏时由 ticker 暂停累积，回来不补帧。
  var TICKER = ArcadeTick.create({
    step: 1000 / 60,
    onStep: function () { input('tick'); }
  });
  TICKER.start();
})();
