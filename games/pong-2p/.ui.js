var I18N = {
  en: { eyebrow:'Mini Game', title:'Pong 2P', tagline:'Classic arcade action in a compact form', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Use W/S keys to move the left paddle', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Press W/S to move paddle' },
  zh: { eyebrow:'迷你游戏', title:'乒乓·双人', tagline:'经典街机玩法，小巧精致', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'使用 W/S 键控制左侧球拍', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'按 W/S 键移动球拍' },
  id: { eyebrow:'Permainan Mini', title:'Pong 2 Pemain', tagline:'Aksi arcade klasik dalam bentuk ringkas', score:'Skor', best:'Terbaik', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Gunakan tombol W/S untuk menggerakkan paddle kiri', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Tekan W/S untuk menggerakkan paddle' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.pong-2p.best';
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
      E.overlayTitle.textContent = I18N[I18N.lang][status === 'won' ? 'overlayWin' : status === 'lost' ? 'overlayLose' : 'overlayDraw'];
      E.overlayText.textContent = status === 'won' ? 'Congratulations!' : status === 'lost' ? 'Better luck next time!' : 'It\'s a draw!';
    } else {
      E.overlay.hidden = true;
    }
  }

  function input(action) {
    var result = CORE.act(S, action, Math.random);
    if (result.changed) {
      S = result.state;
      if (S.over) {
        best = Arcade.setBest(BEST_KEY, Math.max(best, S.score[0]));
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
  E.btnHint.addEventListener('click', function () {
    E.feedback.textContent = I18N[I18N.lang].hintText;
    setTimeout(function () { E.feedback.textContent = ''; }, 2000);
  });
  Arcade.onKeys({ 'w': 'up', 's': 'down', 'W': 'up', 'S': 'down' }, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
