var I18N = {
  en: { eyebrow:'Mini game', title:'Lights Out 5×5', tagline:'Turn off all the lights!', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Click a light to toggle it and its neighbors', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Try to turn off all lights in fewer moves.' },
  zh: { eyebrow:'迷你游戏', title:'关灯 5×5', tagline:'熄灭所有灯！', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'点击一盏灯来切换它和它的邻居', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'试着用更少的步数熄灭所有灯。' },
  id: { eyebrow:'Permainan mini', title:'Matikan Lampu 5×5', tagline:'Matikan semua lampu!', score:'Skor', best:'Terbaik', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Klik sebuah lampu untuk mengalihkannya dan tetangganya', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang indie',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Coba matikan semua lampu dalam langkah yang lebih sedikit.' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.lights-5.best';
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
    var status = CORE.status(S);
    E.score.textContent = S.moves;
    E.best.textContent = best;
    E.extra.textContent = S.moves;
    E.board.innerHTML = '';
    var n = 5;
    for (var i = 0; i < n * n; i++) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.index = i;
      cell.setAttribute('aria-label', 'Light ' + (i + 1));
      cell.style.backgroundColor = S.lights[i] ? '#f0f0f0' : '#333';
      E.board.appendChild(cell);
    }
    if (status === 'won') {
      E.overlayTitle.textContent = I18N[I18N.lang].overlayWin;
      E.overlayText.textContent = I18N[I18N.lang].hintText;
      E.overlay.hidden = false;
    } else {
      E.overlay.hidden = true;
    }
    ArcadeBoardArt.decorate(E.board, 'lights');
  }

  function input(action) {
    if (typeof action === 'number') {
      var result = CORE.act(S, action, Math.random);
      if (result.changed) {
        S = result.state;
        if (S.won) {
          best = Arcade.setBest(BEST_KEY, S.moves);
        }
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
  E.board.addEventListener('click', function (e) {
    if (e.target.classList.contains('cell')) {
      var index = parseInt(e.target.dataset.index);
      input(index);
    }
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
