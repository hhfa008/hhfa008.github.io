var I18N = {
  en: { eyebrow:'Mini Game', title:'Pong 1.5×', tagline:'A fast-paced twist on the classic arcade game', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Use ↑↓ keys or swipe to move your paddle', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Try to keep the ball in play' },
  zh: { eyebrow:'迷你游戏', title:'乒乓 1.5×', tagline:'经典街机游戏的快节奏变体', score:'得分', best:'最高分', extraLabel:'移动次数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'使用 ↑↓ 键或滑动控制球拍', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'尽量让球保持在比赛中' },
  id: { eyebrow:'Permainan Mini', title:'Pong 1.5×', tagline:'Varian cepat dari permainan arcade klasik', score:'Skor', best:'Terbaik', extraLabel:'Gerakan',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Gunakan tombol ↑↓ atau gesek untuk menggerakkan paddle', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Coba pertahankan bola tetap dalam permainan' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.pong-1-5.best';
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
    var state = S;
    E.score.textContent = state.score[0] + ' - ' + state.score[1];
    E.best.textContent = best;
    E.extra.textContent = '';
    E.board.innerHTML = '';
    var ball = document.createElement('div');
    ball.className = 'ball';
    ball.style.left = (state.ball.x - 1) + 'px';
    ball.style.top = (state.ball.y - 1) + 'px';
    E.board.appendChild(ball);
    var leftPaddle = document.createElement('div');
    leftPaddle.className = 'paddle left';
    leftPaddle.style.top = (state.left.y - 8) + 'px';
    E.board.appendChild(leftPaddle);
    var rightPaddle = document.createElement('div');
    rightPaddle.className = 'paddle right';
    rightPaddle.style.top = (state.right.y - 8) + 'px';
    E.board.appendChild(rightPaddle);
    var status = CORE.status(S);
    if (status !== 'playing') {
      E.overlay.hidden = false;
      E.overlayTitle.textContent = I18N[Arcade.lang()][Arcade.overlayKey(status)] || '';
      E.overlayText.textContent = I18N[Arcade.lang()].hintText;
      E.btnOverlay.textContent = I18N[Arcade.lang()].playAgain;
    } else {
      E.overlay.hidden = true;
    }
    ArcadeBoardArt.decorate(E.board, 'pong');
  }

  function input(action) {
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
    render();
  }

  E.btnNew.addEventListener('click', newGame);
  E.btnOverlay.addEventListener('click', newGame);
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
