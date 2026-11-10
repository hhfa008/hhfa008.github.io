var I18N = {
  en: { eyebrow:'Mini game', title:'Memory Pairs 5×4', tagline:'Flip cards to find matching pairs', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Find all matching pairs with the least moves.', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Try to remember card positions' },
  zh: { eyebrow:'迷你游戏', title:'翻牌记忆 5×4', tagline:'翻开卡片寻找匹配的对子', score:'得分', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'用最少的步数找到所有匹配的对子。', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'你赢了！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'试着记住卡片的位置' },
  id: { eyebrow:'Permainan mini', title:'Memori Pasangan 5×4', tagline:'Balik kartu untuk menemukan pasangan yang cocok', score:'Skor', best:'Terbaik', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Temukan semua pasangan yang cocok dengan langkah terkecil.', rules:'Aturan (Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang indie',
        overlayWin:'Kamu menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Coba ingat posisi kartu' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.memory-5x4.best';
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
  var FLIP_BACK_MS = 600;
  var locked = false;
  var pendingFlipBack = null;

  function render(peek) {
    var html = '';
    var cards = S.cards;
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var up = card.up || card.matched || (Array.isArray(peek) && (i === peek[0] || i === peek[1]));
      var klass = up ? 'card up' : 'card';
      var faceKey = card.pair >= 0 ? ArcadeMemorySymbols.faceFor(card.pair) : '';
      html += '<div class="' + klass + '" data-index="' + i + '">' +
        (faceKey ? '<img class="face" data-symbol="' + faceKey + '" src="' + ArcadeMemorySymbols.url(faceKey) + '" alt="" draggable="false">' : '') +
        '</div>';
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
      if (S.moves < best) {
        best = S.moves;
        Arcade.setBest(BEST_KEY, best);
        E.best.textContent = best;
      }
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

  function matchFeedback() { return 'Match found!'; }

  function input(action) {
    // 翻回动画期间（locked）忽略一切输入：连点同一张卡不会「翻回后又翻开」。
    if (locked || typeof action !== 'number') return;
    var before = S;
    var result = CORE.act(S, action, Math.random);
    if (!result.changed) return;
    S = result.state;

    var upBefore = [];
    for (var k = 0; k < before.cards.length; k++) {
      if (before.cards[k].up && !before.cards[k].matched) upBefore.push(k);
    }
    // 第二张与第一张不匹配：两张继续可见 600ms，再翻回；期间锁输入。
    if (result.gained === 0 && upBefore.length === 1) {
      locked = true;
      render([upBefore[0], action]);
      if ('No match. Try again.') {
        E.feedback.textContent = 'No match. Try again.';
        setTimeout(function () { E.feedback.textContent = ''; }, 600 + 400);
      }
      pendingFlipBack = setTimeout(function () {
        pendingFlipBack = null;
        locked = false;
        render();
      }, 600);
      return;
    }
    if (result.gained > 0) {
      E.feedback.textContent = matchFeedback();
      setTimeout(function () { E.feedback.textContent = ''; }, 1000);
    }
    render();
  }

  function newGame() {
    if (pendingFlipBack) { clearTimeout(pendingFlipBack); pendingFlipBack = null; }
    locked = false;
    S = CORE.newGame(Math.random);
    best = Arcade.best(BEST_KEY, 0);
    render();
  }

  E.btnNew.addEventListener('click', newGame);
  E.btnOverlay.addEventListener('click', newGame);
  E.btnHint.addEventListener('click', function() {
    E.feedback.textContent = I18N[I18N.lang].hintText;
    setTimeout(function() { E.feedback.textContent = ''; }, 2000);
  });
  E.board.addEventListener('click', function(e) {
    var el = e.target.closest('.card');
    if (el) {
      var index = parseInt(el.dataset.index);
      input(index);
    }
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
