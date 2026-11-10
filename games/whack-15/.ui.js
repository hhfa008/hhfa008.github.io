var I18N = {
  en: { eyebrow:'Mini Game', title:'Reaction whack-15', tagline:'Click as fast as you can!', score:'Score', best:'Best', extraLabel:'Hits',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Click the targets as they appear. Misses cost time.', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Time\'s up!', overlayDraw:'Draw', hintText:'Click targets as they appear' },
  zh: { eyebrow:'迷你游戏', title:'反应挑战 whack-15', tagline:'尽可能快地点击！', score:'得分', best:'最高分', extraLabel:'命中',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'点击出现的目标。未击中会消耗时间。', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'时间到！', overlayDraw:'平局', hintText:'点击出现的目标' },
  id: { eyebrow:'Permainan Mini', title:'Reaksi whack-15', tagline:'Klik secepat mungkin!', score:'Skor', best:'Tertinggi', extraLabel:'Hit',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Klik target saat mereka muncul. Klik salah mengurangi waktu.', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Waktunya habis!', overlayDraw:'Seri', hintText:'Klik target saat mereka muncul' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.whack-15.best';
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
  var TICKER = null;

  function render() {
    E.score.textContent = S.score;
    E.best.textContent = best;
    E.extra.textContent = S.hits;
    E.board.innerHTML = '';
    if (S.running) {
      var target = document.createElement('div');
      target.className = 'target';
      target.appendChild(ArcadeReactionArt.sprite('mole'));
      target.style.left = Math.random() * 300 + 'px';
      target.style.top = Math.random() * 300 + 'px';
      target.addEventListener('click', function() {
        input('hit');
        target.remove();
      });
      E.board.appendChild(target);
    }
    if (S.over) {
      E.overlay.hidden = false;
      if (S.hits > 0) {
        E.overlayTitle.textContent = I18N[I18N.lang].overlayWin;
        E.overlayText.textContent = I18N[I18N.lang].overlayWin;
      } else {
        E.overlayTitle.textContent = I18N[I18N.lang].overlayLose;
        E.overlayText.textContent = I18N[I18N.lang].overlayLose;
      }
    } else {
      E.overlay.hidden = true;
    }
  }

  function input(action) {
    var result = CORE.act(S, action);
    if (result.changed) {
      S = result.state;
      if (result.gained > 0) {
        E.feedback.textContent = '+' + result.gained;
        setTimeout(() => { E.feedback.textContent = ''; }, 500);
      }
      if (S.timeLeft <= 0) {
        S.over = true;
        S.running = false;
      }
      best = Arcade.setBest(BEST_KEY, Math.max(best, S.score));
      render();
    }
  }

  function newGame() {
    S = CORE.newGame(Math.random);
    best = Arcade.best(BEST_KEY, 0);
    render();
  }

  function tick() {
    if (S.running) {
      input('tick');
    }
  }

  E.btnNew.addEventListener('click', newGame);
  E.btnOverlay.addEventListener('click', newGame);
  E.btnHint.addEventListener('click', function() {
    E.feedback.textContent = I18N[I18N.lang].hintText;
    setTimeout(() => { E.feedback.textContent = ''; }, 2000);
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
  // 每秒一步（固定步长累加器）；标签页隐藏时不推进，回前台不补步。
  TICKER = ArcadeTick.create({
    step: 1000,
    onStep: function () { tick(); }
  });
  TICKER.start();
})();
