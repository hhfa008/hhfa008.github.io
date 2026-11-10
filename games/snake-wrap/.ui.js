var I18N = {
  en: { eyebrow:'Mini Game', title:'Snake Wrap', tagline:'Guide the snake to eat food and grow. Wrap around the edges!', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Use arrow keys or swipe to control the snake', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Snake cannot reverse direction' },
  zh: { eyebrow:'小游戏', title:'贪吃蛇·穿墙', tagline:'引导蛇吃食物并成长。穿墙而过！', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'使用方向键或滑动控制蛇的移动', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'蛇不能反向移动' },
  id: { eyebrow:'Permainan Mini', title:'Ular Tembus', tagline:'Bawa ular untuk makan makanan dan tumbuh. Melingkar di tepi!', score:'Skor', best:'Terbaik', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Gunakan tombol panah atau gesek untuk mengontrol ular', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang indie',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Ular tidak bisa membalik arah' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.snake-wrap.best';
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
    var size = S.size;
    var cellSize = Math.min(390 / size, 24);
    E.board.style.width = (size * cellSize) + 'px';
    E.board.style.height = (size * cellSize) + 'px';
    E.board.innerHTML = '';
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var cell = document.createElement('div');
        cell.className = 'cell';
        cell.style.width = cellSize + 'px';
        cell.style.height = cellSize + 'px';
        if (S.body.some(function (p) { return p[0] === r && p[1] === c; })) {
          cell.classList.add('snake');
          if (S.body[0][0] === r && S.body[0][1] === c) cell.classList.add('head');
        }
        if (S.food && S.food[0] === r && S.food[1] === c) cell.classList.add('food');
        E.board.appendChild(cell);
      }
    }
    E.score.textContent = S.score;
    E.best.textContent = best;
    E.extra.textContent = S.body.length - 3;
    var status = CORE.status(S);
    if (status === 'playing') {
      E.overlay.hidden = true;
    } else {
      E.overlayTitle.textContent = I18N[I18N.lang][status === 'won' ? 'overlayWin' : status === 'lost' ? 'overlayLose' : 'overlayDraw'];
      E.overlayText.textContent = status === 'won' ? 'Congratulations!' : status === 'lost' ? 'Game over!' : 'It\'s a draw!';
      E.overlay.hidden = false;
    }
    ArcadeBoardArt.decorate(E.board, 'snake');
  }

  function input(action) {
    var result = CORE.act(S, action, Math.random);
    if (result.changed) {
      S = result.state;
      if (S.score > best) {
        best = S.score;
        Arcade.setBest(BEST_KEY, best);
      }
      render();
      if (result.gained > 0) {
        E.feedback.textContent = '+' + result.gained;
        setTimeout(function () { E.feedback.textContent = ''; }, 500);
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
  E.btnHint.addEventListener('click', function () {
    E.feedback.textContent = I18N[I18N.lang].hintText;
    setTimeout(function () { E.feedback.textContent = ''; }, 2000);
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
