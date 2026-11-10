var I18N = {
  en: { eyebrow:'Mini Game', title:'Pong 4×', tagline:'A fast-paced arcade classic', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Use ↑ ↓ to move paddle', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Try to hit the ball' },
  zh: { eyebrow:'迷你游戏', title:'乒乓 4×', tagline:'快节奏的经典街机', score:'得分', best:'最高分', extraLabel:'移动',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'使用 ↑ ↓ 控制球拍', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'试着击中球' },
  id: { eyebrow:'Permainan Mini', title:'Pong 4×', tagline:'Klasik arcade yang penuh aksi', score:'Skor', best:'Terbaik', extraLabel:'Gerakan',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Gunakan ↑ ↓ untuk menggerakkan paddle', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang indie',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Coba pukul bola' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.pong-4.best';
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
    var ctx = E.board.getContext('2d');
    var W = S.w, H = S.h, BALL = 2;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(4 - BALL, S.left.y - 8, BALL * 2, 16);
    ctx.fillRect(W - 4 - BALL, S.right.y - 8, BALL * 2, 16);
    ctx.beginPath();
    ctx.arc(S.ball.x, S.ball.y, BALL, 0, Math.PI * 2);
    ctx.fill();
    E.score.textContent = S.score[0] + ' - ' + S.score[1];
    E.best.textContent = best;
    E.extra.textContent = '';
    var status = CORE.status(S);
    if (status === 'won' || status === 'lost' || status === 'draw') {
      E.overlayTitle.textContent = I18N[I18N.lang][status === 'won' ? 'overlayWin' : status === 'lost' ? 'overlayLose' : 'overlayDraw'];
      E.overlayText.textContent = '';
      E.overlay.hidden = false;
    } else {
      E.overlay.hidden = true;
    }
    ArcadeBoardArt.decorate(E.board, 'pong');
  }

  function input(action) {
    var result = CORE.act(S, action, Math.random);
    if (result.changed) {
      S = result.state;
      if (result.gained) {
        E.feedback.textContent = 'Hit!';
        setTimeout(() => { E.feedback.textContent = ''; }, 500);
      }
      best = Arcade.setBest(BEST_KEY, best, S.score[0] + S.score[1]);
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
  E.btnHint.addEventListener('click', () => {
    E.feedback.textContent = I18N[I18N.lang].hintText;
    setTimeout(() => { E.feedback.textContent = ''; }, 1000);
  });
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
