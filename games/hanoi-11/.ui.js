var I18N = {
  en: { eyebrow:'Classic puzzle game', title:'Tower of Hanoi 11', tagline:'Move all disks to the rightmost peg', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'Use keyboard, mouse or touch to play', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'Move the top disk from one peg to another' },
  zh: { eyebrow:'经典益智游戏', title:'汉诺塔 11 盘', tagline:'将所有盘子移动到最右边的柱子上', score:'分数', best:'最高分', extraLabel:'步数',
        boardAria:'游戏棋盘', playAgain:'重新开始', newGame:'新游戏', hint:'提示',
        note:'使用键盘、鼠标或触摸操作', rules:'规则（中文）', hall:'所有游戏', moreLink:'由独立开发者制作',
        overlayWin:'恭喜你！', overlayLose:'游戏结束', overlayDraw:'平局', hintText:'将一个柱子顶部的盘子移到另一个柱子上' },
  id: { eyebrow:'Permainan teka-teki klasik', title:'Menara Hanoi 11', tagline:'Pindahkan semua cakram ke tiang paling kanan', score:'Skor', best:'Tertinggi', extraLabel:'Langkah',
        boardAria:'Papan permainan', playAgain:'Main lagi', newGame:'Permainan baru', hint:'Petunjuk',
        note:'Gunakan keyboard, mouse, atau sentuh untuk bermain', rules:'Aturan (Bahasa Tiongkok)', hall:'Semua permainan', moreLink:'Dibuat oleh pengembang independen',
        overlayWin:'Anda menang!', overlayLose:'Permainan berakhir', overlayDraw:'Seri', hintText:'Pindahkan cakram teratas dari satu tiang ke tiang lainnya' }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.hanoi-11.best';
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
    var state = S;
    E.score.textContent = state.moves;
    E.best.textContent = best;
    E.extra.textContent = state.moves;
    E.board.innerHTML = '';
    for (var i = 0; i < 3; i++) {
      var peg = document.createElement('div');
      peg.className = 'peg';
      var disks = state.pegs[i];
      for (var j = 0; j < disks.length; j++) {
        var disk = document.createElement('div');
        disk.className = 'disk';
        disk.style.width = (disks[j] * 10 + 40) + 'px';
        disk.textContent = disks[j];
        peg.appendChild(disk);
      }
      E.board.appendChild(peg);
    }
    var status = CORE.status(S);
    if (status === 'won') {
      E.overlayTitle.textContent = I18N[I18N.lang].overlayWin;
      E.overlayText.textContent = I18N[I18N.lang].overlayWin;
      E.overlay.hidden = false;
      if (state.moves < best) {
        best = state.moves;
        Arcade.setBest(BEST_KEY, best);
        E.best.textContent = best;
      }
    } else if (status === 'lost' || status === 'draw') {
      E.overlayTitle.textContent = I18N[I18N.lang].overlayLose;
      E.overlayText.textContent = I18N[I18N.lang].overlayLose;
      E.overlay.hidden = false;
    } else {
      E.overlay.hidden = true;
    }
    ArcadeBoardArt.decorate(E.board, 'hanoi');
  }

  function input(action) {
    var result = CORE.act(S, action, Math.random);
    if (result.changed) {
      S = result.state;
      best = Arcade.best(BEST_KEY, 0);
      render();
    } else {
      E.feedback.textContent = I18N[I18N.lang].hintText;
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
    setTimeout(function () { E.feedback.textContent = ''; }, 1000);
  });
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
