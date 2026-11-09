var I18N = {
  en: { eyebrow:'Mini game', title:'Memory Pairs 8×6', tagline:'Flip cards to find matching pairs', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Find all matching pairs with the least moves.', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Try to remember card positions' },
  zh: { eyebrow:'迷你游戏', title:'翻牌记忆 8×6', tagline:'翻牌寻找配对', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'用最少的步数找到所有配对。', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'试着记住卡牌位置' },
  id: { eyebrow:'Permainan mini', title:'Memori Pasangan 8×6', tagline:'Balik kartu untuk menemukan pasangan yang cocok', score:'Skor', best:'Terbaik', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Temukan semua pasangan yang cocok dengan langkah terkecil.', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang indie',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Coba ingat posisi kartu' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.memory-8x6.best';
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
    var html = '';
    for (var i = 0; i < S.cards.length; i++) {
      var card = S.cards[i];
      var up = card.up || card.matched;
      html += '<div class="card' + (up ? ' up' : '') + '" data-index="' + i + '"></div>';
    }
    E.board.innerHTML = html;
    E.score.textContent = S.flips;
    E.best.textContent = best;
    E.extra.textContent = S.moves;
    var status = CORE.status(S);
    if (status === 'won') {
      E.overlayTitle.textContent = I18N[I18N.lang].overlayWin;
      E.overlayText.textContent = '';
      E.overlay.hidden = false;
      best = Arcade.setBest(BEST_KEY, S.flips);
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
  }

  function input(action) {
    var result = CORE.act(S, action, Math.random);
    if (result.changed) {
      S = result.state;
      if (result.gained > 0) {
        E.feedback.textContent = 'Match found!';
        setTimeout(function() { E.feedback.textContent = ''; }, 1000);
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
  E.board.addEventListener('click', function(e) {
    var index = e.target.dataset.index;
    if (index !== undefined) input(parseInt(index));
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
