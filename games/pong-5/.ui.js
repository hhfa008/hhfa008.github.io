var I18N = {
  en: { eyebrow:'Mini Game', title:'Pong 5×', tagline:'First to 7 points wins', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Use ↑↓ keys or swipe to move paddle', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Try to hit the ball back' },
  zh: { eyebrow:'迷你游戏', title:'乒乓 5×', tagline:'先得 7 分者胜', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'再玩一次', newGame:'新游戏', hint:'提示',
        note:'使用 ↑↓ 键或滑动来移动球拍', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'试着把球打回去' },
  id: { eyebrow:'Permainan Mini', title:'Pong 5×', tagline:'Pertama yang mendapat 7 poin menang', score:'Skor', best:'Terbaik', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Gunakan tombol ↑↓ atau gesek untuk menggerakkan paddle', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Coba pantulkan bola kembali' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.pong-5.best';
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
    var ball = state.ball;
    var left = state.left;
    var right = state.right;
    var w = state.w;
    var h = state.h;
    var ctx = E.board.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(4 - 1, left.y - 8, 2, 16);
    ctx.fillRect(w - 4 - 1, right.y - 8, 2, 16);
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 2, 0, Math.PI * 2);
    ctx.fill();
    if (state.over) {
      E.overlay.hidden = false;
      var status = CORE.status(state);
      if (status === 'won') {
        E.overlayTitle.textContent = I18N[I18N.lang].overlayWin;
        E.overlayText.textContent = '';
      } else if (status === 'lost') {
        E.overlayTitle.textContent = I18N[I18N.lang].overlayLose;
        E.overlayText.textContent = '';
      } else if (status === 'draw') {
        E.overlayTitle.textContent = I18N[I18N.lang].overlayDraw;
        E.overlayText.textContent = '';
      }
    } else {
      E.overlay.hidden = true;
    }
    ArcadeBoardArt.decorate(E.board, 'pong');
  }

  function input(action) {
    var result = CORE.act(S, action, Math.random);
    if (result.changed) {
      S = result.state;
      if (S.score[0] >= 7 || S.score[1] >= 7) {
        S.over = true;
      }
      best = Arcade.setBest(BEST_KEY, Math.max(best, S.score[0] + S.score[1]));
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
  E.btnHint.addEventListener('click', function () {
    E.feedback.textContent = I18N[I18N.lang].hintText;
    setTimeout(function () {
      E.feedback.textContent = '';
    }, 2000);
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
