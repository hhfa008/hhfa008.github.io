var I18N = {
  en: { eyebrow:'Mini Game', title:'Aim Trainer', tagline:'Click the targets as fast as you can!', score:'Score', best:'Best', extraLabel:'Hits',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Click targets to score points. Miss and lose points.', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Click the targets!' },
  zh: { eyebrow:'小游戏', title:'瞄准训练', tagline:'尽可能快地点击目标！', score:'得分', best:'最高分', extraLabel:'命中',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'点击目标得分。未击中则扣分。', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'点击目标！' },
  id: { eyebrow:'Permainan Mini', title:'Latihan Bidik', tagline:'Klik target secepat mungkin!', score:'Skor', best:'Best', extraLabel:'Hit',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Klik target untuk mendapatkan poin. Melesat dan kehilangan poin.', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang indie',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Klik target!' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.aim-trainer.best';
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
    E.score.textContent = S.score;
    E.best.textContent = best;
    E.extra.textContent = S.hits;
    E.board.innerHTML = '';
    if (S.running) {
      var target = document.createElement('div');
      target.className = 'target';
      target.style.position = 'absolute';
      target.style.left = Math.random() * 300 + 'px';
      target.style.top = Math.random() * 300 + 'px';
      target.style.width = '50px';
      target.style.height = '50px';
      target.style.borderRadius = '50%';
      target.style.backgroundColor = '#ff5722';
      target.style.cursor = 'pointer';
      target.addEventListener('click', function() {
        input('hit');
        target.remove();
      });
      E.board.appendChild(target);
    }
    if (S.over) {
      E.overlay.hidden = false;
      E.overlayTitle.textContent = S.score >= 10 ? I18N[I18N.lang].overlayWin : I18N[I18N.lang].overlayLose;
      E.overlayText.textContent = I18N[I18N.lang].note;
    } else {
      E.overlay.hidden = true;
    }
  }

  function input(action) {
    var result = CORE.act(S, action, Math.random);
    if (result.changed) {
      S = result.state;
      if (action === 'hit') {
        E.feedback.textContent = '+' + result.gained;
      } else if (action === 'miss') {
        E.feedback.textContent = '-' + result.gained;
      } else {
        E.feedback.textContent = '';
      }
      if (S.score > best) {
        best = S.score;
        Arcade.setBest(BEST_KEY, best);
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
  E.btnHint.addEventListener('click', function() {
    E.feedback.textContent = I18N[I18N.lang].hintText;
  });
  Arcade.onKeys({ ' ': function() { input('tick'); } }, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
