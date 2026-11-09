var I18N = {
  en: { eyebrow:'Mini Game', title:'Reaction reaction-20', tagline:'Click as fast as you can!', score:'Score', best:'Best', extraLabel:'Hits',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Click the board when the timer turns red.', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Click when red!' },
  zh: { eyebrow:'迷你游戏', title:'反应挑战 reaction-20', tagline:'尽可能快地点击！', score:'得分', best:'最高分', extraLabel:'点击数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'当计时器变红时点击棋盘。', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'变红时点击！' },
  id: { eyebrow:'Permainan Mini', title:'Reaksi reaction-20', tagline:'Klik secepat mungkin!', score:'Skor', best:'Tertinggi', extraLabel:'Klik',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Klik papan saat penghitung waktu berubah menjadi merah.', rules:'Aturan (Bahasa Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Klik saat berubah merah!' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.reaction-20.best';
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
  var timer = null;

  function render() {
    E.score.textContent = S.score;
    E.best.textContent = best;
    E.extra.textContent = S.hits;
    E.board.style.backgroundColor = S.timeLeft <= 5 ? '#ff6b6b' : '#f3ead9';
    if (S.over) {
      E.overlay.hidden = false;
      E.overlayTitle.textContent = S.running ? I18N[I18N.lang].overlayWin : I18N[I18N.lang].overlayLose;
      E.overlayText.textContent = I18N[I18N.lang].note;
    } else {
      E.overlay.hidden = true;
    }
  }

  function input(action) {
    if (action === 'hit' && S.running) {
      var result = CORE.act(S, 'hit');
      S = result.state;
      if (result.changed) {
        best = Arcade.setBest(BEST_KEY, S.score);
        render();
      }
    } else if (action === 'miss' && S.running) {
      var result = CORE.act(S, 'miss');
      S = result.state;
      if (result.changed) {
        best = Arcade.setBest(BEST_KEY, S.score);
        render();
      }
    } else if (action === 'tick' && S.running) {
      var result = CORE.act(S, 'tick');
      S = result.state;
      if (result.changed) {
        if (S.over) {
          best = Arcade.setBest(BEST_KEY, S.score);
        }
        render();
      }
    }
  }

  function newGame() {
    if (timer) clearInterval(timer);
    S = CORE.newGame(Math.random);
    best = Arcade.best(BEST_KEY, 0);
    render();
    timer = setInterval(() => input('tick'), 1000);
  }

  E.board.addEventListener('click', () => input('hit'));
  E.btnNew.addEventListener('click', newGame);
  E.btnOverlay.addEventListener('click', newGame);
  E.btnHint.addEventListener('click', () => {
    E.feedback.textContent = I18N[I18N.lang].hintText;
    setTimeout(() => { E.feedback.textContent = ''; }, 2000);
  });
  Arcade.onKeys({ ' ': () => input('hit') }, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
  timer = setInterval(() => input('tick'), 1000);
})();
