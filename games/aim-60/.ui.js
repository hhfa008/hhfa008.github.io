var I18N = {
  en: { eyebrow:'Mini Game', title:'Reaction aim-60', tagline:'Click as fast as you can!', score:'Score', best:'Best', extraLabel:'Hits',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Click the board when it turns green', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Click when green!' },
  zh: { eyebrow:'迷你游戏', title:'反应挑战 aim-60', tagline:'尽可能快地点击！', score:'得分', best:'最高分', extraLabel:'命中',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'当棋盘变绿时点击', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'变绿时点击！' },
  id: { eyebrow:'Permainan Mini', title:'Reaksi aim-60', tagline:'Klik secepat mungkin!', score:'Skor', best:'Terbaik', extraLabel:'Hit',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Klik papan saat berubah hijau', rules:'Aturan (Chinese)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Klik saat hijau!' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.aim-60.best';
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
  var timer;

  function render() {
    E.score.textContent = S.score;
    E.best.textContent = best;
    E.extra.textContent = S.hits;
    E.board.style.backgroundColor = S.timeLeft > 0 ? '#f3ead9' : '#f3ead9';
    if (S.timeLeft <= 0) {
      E.board.style.backgroundColor = '#f3ead9';
    }
    if (S.timeLeft > 0 && S.timeLeft <= 5) {
      E.board.style.backgroundColor = '#ff6b6b';
    }
    if (S.timeLeft > 5 && S.timeLeft <= 10) {
      E.board.style.backgroundColor = '#ffd166';
    }
    if (S.timeLeft > 10 && S.timeLeft <= 20) {
      E.board.style.backgroundColor = '#06d6a0';
    }
    if (S.timeLeft > 20) {
      E.board.style.backgroundColor = '#118ab2';
    }

    if (S.over) {
      E.overlay.hidden = false;
      if (S.score > best) {
        best = S.score;
        Arcade.setBest(BEST_KEY, best);
      }
      E.overlayTitle.textContent = S.score > best ? I18N[I18N.lang].overlayWin : I18N[I18N.lang].overlayLose;
      E.overlayText.textContent = S.score > best ? I18N[I18N.lang].overlayWin : I18N[I18N.lang].overlayLose;
    } else {
      E.overlay.hidden = true;
    }
  }

  function input(action) {
    if (action === 'hit') {
      if (S.timeLeft > 0) {
        var result = CORE.act(S, 'hit');
        S = result.state;
        if (result.changed) {
          render();
        }
      }
    } else if (action === 'miss') {
      if (S.timeLeft > 0) {
        var result = CORE.act(S, 'miss');
        S = result.state;
        if (result.changed) {
          render();
        }
      }
    } else if (action === 'tick') {
      if (S.running) {
        var result = CORE.act(S, 'tick');
        S = result.state;
        if (result.changed) {
          render();
        }
      }
    }
  }

  function newGame() {
    S = CORE.newGame(Math.random);
    best = Arcade.best(BEST_KEY, 0);
    render();
  }

  function startTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      input('tick');
    }, 1000);
  }

  E.btnNew.addEventListener('click', newGame);
  E.btnOverlay.addEventListener('click', newGame);
  E.board.addEventListener('click', function () {
    if (S.running && S.timeLeft > 0) {
      input('hit');
    }
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
  startTimer();
})();
