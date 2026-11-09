var I18N = {
  en: { eyebrow:'Mini Game', title:'Whack-a-Mole', tagline:'Hit the moles as they pop up!', score:'Score', best:'Best', extraLabel:'Hits',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Click or tap the moles to whack them!', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Moles appear randomly' },
  zh: { eyebrow:'迷你游戏', title:'打地鼠', tagline:'地鼠冒出来就打！', score:'得分', best:'最高分', extraLabel:'命中',
        boardAria:'游戏棋盘', playAgain:'再玩一次', newGame:'新游戏', hint:'提示',
        note:'点击或轻触地鼠来打它们！', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'地鼠随机出现' },
  id: { eyebrow:'Permainan Mini', title:'Pukul Tikus', tagline:'Pukul tikus saat mereka muncul!', score:'Skor', best:'Terbaik', extraLabel:'Pukulan',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Klik atau sentuh tikus untuk memukulnya!', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Tikus muncul secara acak' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.whack.best';
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
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.index = i;
      if (Math.random() > 0.7) {
        cell.classList.add('mole');
        cell.dataset.mole = 'up';
      }
      E.board.appendChild(cell);
    }

    if (S.over) {
      E.overlay.hidden = false;
      if (S.score > 0) {
        E.overlayTitle.textContent = I18N[I18N.lang].overlayWin;
        E.overlayText.textContent = I18N[I18N.lang].hintText;
      } else {
        E.overlayTitle.textContent = I18N[I18N.lang].overlayLose;
        E.overlayText.textContent = '';
      }
    } else {
      E.overlay.hidden = true;
    }
  }

  function input(action) {
    if (action === 'hit') {
      const mole = document.querySelector('.cell.mole');
      if (mole) {
        mole.classList.remove('mole');
        mole.classList.add('hit');
        setTimeout(() => mole.remove(), 200);
      }
    } else if (action === 'miss') {
      E.feedback.textContent = 'Missed!';
      setTimeout(() => { E.feedback.textContent = ''; }, 1000);
    } else if (action === 'tick') {
      const moles = document.querySelectorAll('.cell.mole');
      moles.forEach(mole => {
        mole.classList.remove('mole');
        mole.classList.add('missed');
        setTimeout(() => mole.remove(), 200);
      });
    }
    const result = CORE.act(S, action);
    S = result.state;
    if (result.changed) {
      if (result.gained > 0) {
        E.feedback.textContent = '+1';
        setTimeout(() => { E.feedback.textContent = ''; }, 500);
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
  E.btnHint.addEventListener('click', () => {
    E.feedback.textContent = I18N[I18N.lang].hintText;
    setTimeout(() => { E.feedback.textContent = ''; }, 2000);
  });
  Arcade.onKeys({ ' ': 'hit' }, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
