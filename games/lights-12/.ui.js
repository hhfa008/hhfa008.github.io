var I18N = {
  en: { eyebrow:'Mini Game', title:'Lights Out 12×12', tagline:'Turn off all the lights!', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Click a light to toggle it and its neighbors', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Try to turn off all lights in fewer moves.' },
  zh: { eyebrow:'迷你游戏', title:'关灯 12×12', tagline:'关闭所有灯！', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'点击一个灯泡来切换它和它的邻居', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'尝试用更少的步数关闭所有灯。' },
  id: { eyebrow:'Permainan Mini', title:'Matikan Lampu 12×12', tagline:'Matikan semua lampu!', score:'Skor', best:'Terbaik', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Klik sebuah lampu untuk mengalihkannya dan tetangganya', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang indie',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Coba matikan semua lampu dalam langkah yang lebih sedikit.' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.lights-12.best';
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
    var n = 12;
    var N = n * n;
    E.board.innerHTML = '';
    for (var i = 0; i < N; i++) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.index = i;
      cell.style.backgroundColor = S.lights[i] ? '#f0f0f0' : '#333';
      cell.addEventListener('click', function () {
        input(parseInt(this.dataset.index));
      });
      E.board.appendChild(cell);
    }
    E.score.textContent = S.moves;
    E.extra.textContent = S.moves;
    E.best.textContent = best;
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
    ArcadeBoardArt.decorate(E.board, 'lights');
  }

  function input(action) {
    var result = CORE.act(S, action, Math.random);
    if (result.changed) {
      S = result.state;
      render();
    } else {
      E.feedback.textContent = 'Invalid move';
      setTimeout(function () { E.feedback.textContent = ''; }, 1000);
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
    setTimeout(function () { E.feedback.textContent = ''; }, 3000);
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
