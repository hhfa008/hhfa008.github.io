# Arcade 游戏契约（生成器与本地模型共同遵守）

所有新游戏由同一套基建拼装：`/games/shared/arcade/arcade.css` + `/games/shared/arcade/arcade.js`
+ 家族引擎 `/games/shared/arcade/kits/<family>.js` + 页面模板 `templates/game.html`。

**引擎不由模型编写**：同一个 kit 同时被页面和测试使用，保证测试与线上同一份逻辑。
本地模型只写三块：`GAME_UI`（三语 + 渲染/输入）、`GAME_CSS`、`RULES_HTML`。

## 一、页面里的 GAME_UI

模板已经注入：

```js
var CORE = ArcadeKit.create({...params});
```

模型接着写：

```js
var I18N = {
  en: { eyebrow:'', title:'', tagline:'', score:'Score', best:'Best', extraLabel:'Moves',
        boardAria:'Game board', playAgain:'Play again', newGame:'New game', hint:'Hint',
        note:'', rules:'Rules (Chinese)', hall:'All games', moreLink:'Built by an indie developer',
        overlayWin:'You win!', overlayLose:'Game over', overlayDraw:'Draw', hintText:'' },
  zh: { /* 同键，中文 */ },
  id: { /* 同键，印尼语 */ }
};

(function () {
  'use strict';
  var BEST_KEY = 'arcade.<slug>.best';
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

  function render() { /* 只读 S，重画 E.board 与 HUD */ }
  function input(action) { /* CORE.act(S, action, Math.random)，更新 S，处理状态，render */ }
  function newGame() { S = CORE.newGame(Math.random); best = Arcade.best(BEST_KEY, 0); render(); }

  E.btnNew.addEventListener('click', newGame);
  E.btnOverlay.addEventListener('click', newGame);
  Arcade.onKeys(Arcade.KEYMAP, input);
  Arcade.onSwipe(E.board, input);
  Arcade.onLang(render);
  Arcade.init({ strings: I18N, onLang: render });
  render();
})();
```

## 二、硬约束

- `GAME_UI` 内 **不得** 出现 `fetch`、`XMLHttpRequest`、`http://`、`https://`、外部字体、第三方脚本。
- 不得重新定义 `CORE`，不得复制 kit 代码。
- 棋盘/画布尺寸自适应，390px 宽不横向溢出；按钮与可点目标 ≥44×44。
- 键盘可达；棋盘有 `aria-label`（`data-aria="boardAria"`）。
- 分数变化放 `#stat-score`；额外计数放 `#stat-extra`；结束遮罩用 `#overlay`。
- 结算文案统一取 `I18N[Arcade.lang()][Arcade.overlayKey(status)]`：`won`/`win` → `overlayWin`，
  `lost`/`lose` → `overlayLose`，其它 → `overlayDraw`。**禁止**用 `status + 'Overlay'` 或
  `` `overlay${...}` `` 自己拼字典键。
- `#overlay` 在模板里自带 `hidden` 属性，显示/隐藏必须写 `E.overlay.hidden = false` / `= true`
  （或 `removeAttribute('hidden')`）；`classList.remove/add('hidden')` 都动不了这个属性，
  遮罩会一直 `display:none`（或显示后关不掉）。
- 语言：`Arcade.init({ strings: I18N })` 会把当前语言写回 `I18N.lang`，页面里
  `I18N[I18N.lang]` 才成立；语言切换复用同一入口，会同步更新。
- 最高分写 `localStorage`，key 固定 `arcade.<slug>.best`。
- 三语字典键必须齐全且一致（构建时会校验）。
- `CORE.status` 可能是 `playing` / `won` / `lost` / `draw`。

## 三、测试

`build-game.mjs` 会自动生成 `games/<slug>/test.js`：

```js
var kit = require('../shared/arcade/kits/<family>.js');
var run = require('../shared/arcade/tests/<family>.js');
run(kit.create(params), params, s);
s.done();
```

共享套件 `games/shared/arcade/tests/<family>.js` 覆盖该家族的规则；100 个变体共用同一套断言，
只按参数改变尺寸/难度。测试不通过说明 kit 有 bug，应由维护者修 kit，而不是改测试。

## 四、规则页（rules.html）

中文 1200–2000 字，`<html lang="zh-CN">`，与站点既有规则页一致：`Article` + `FAQPage` JSON-LD，
FAQ 页面条目与 JSON-LD 一一对应；单文件、内联样式、无外部请求；页尾有返回游戏与全部游戏链接。
