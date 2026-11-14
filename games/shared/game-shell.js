/* 统一游戏外壳（UMD）：window.GameShell / require('./game-shell.js')
 *
 * 目标：把「尺寸切换 / 难度 / 每日挑战 / 连胜与最高分 / 复盘位」做成一份实现，
 * 每个游戏接入只写三行：
 *
 *   GameShell.init({ slug: '2048', sizes: [...], difficulties: [...] });
 *   var rng = GameShell.seed();          // 每日挑战返回可复现 RNG，否则 Math.random
 *   GameShell.finish(score);             // 一局结束时调用
 *
 * 依赖（按需，缺失时降级）：games/shared/progress.js（每日/连胜/最高分）、
 * games/shared/shuffle.js（种子 RNG）。只碰自己创建的元素，不假设页面结构。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GameShell = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var state = { slug: '', sizes: [], difficulties: [], el: null, onNewGame: null, scored: false };
  var DIFF_KEY_PREFIX = 'gs.diff.';

  function doc() { return root.document; }

  function isDaily() {
    try { return new root.URLSearchParams(root.location.search).get('daily') === '1'; }
    catch (e) { return false; }
  }

  function progress() { return root.GameProgress || null; }

  function currentDifficulty() {
    try {
      var saved = root.localStorage && root.localStorage.getItem(DIFF_KEY_PREFIX + state.slug);
      if (saved && state.difficulties.some(function (d) { return d.value === saved; })) return saved;
    } catch (e) { /* ignore */ }
    if (state.defaultDifficulty && state.difficulties.some(function (d) { return d.value === state.defaultDifficulty; })) return state.defaultDifficulty;
    return state.difficulties.length ? state.difficulties[0].value : '';
  }

  function setDifficulty(value) {
    try { root.localStorage.setItem(DIFF_KEY_PREFIX + state.slug, String(value)); } catch (e) { /* ignore */ }
    if (typeof state.onDifficulty === 'function') state.onDifficulty(value);
    render();
  }

  function seed() {
    var p = progress();
    if (!p || !isDaily()) return Math.random;
    var s;
    try { s = p.dailyState(state.slug).seed; } catch (e) { return Math.random; }
    if (s == null || !root.Shuffle || typeof root.Shuffle.createRng !== 'function') return Math.random;
    return root.Shuffle.createRng(s);
  }

  function statusText() {
    var p = progress();
    if (!p) return '';
    var ds = null, st = null;
    try { ds = p.dailyState(state.slug); } catch (e) { /* ignore */ }
    try { st = p.stats(state.slug); } catch (e) { /* ignore */ }
    var parts = [];
    if (ds) parts.push((isDaily() ? '今日挑战' : '今日') + (ds.done ? ' ✓' : ' 未完成'));
    if (ds && ds.streak > 0) parts.push('连胜 ' + ds.streak + ' 天');
    if (st && st.best > 0) parts.push('最高 ' + st.best);
    return parts.join(' · ');
  }

  function btn(text, active, onClick, title) {
    var b = doc().createElement('button');
    b.type = 'button';
    b.textContent = text;
    if (title) b.title = title;
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
    b.style.cssText = 'min-height:44px;padding:6px 12px;border-radius:9px;border:1px solid ' +
      (active ? '#3d3226' : 'rgba(0,0,0,.16)') + ';background:' + (active ? '#3d3226' : 'transparent') +
      ';color:' + (active ? '#fff' : 'inherit') + ';font:inherit;font-size:13px;cursor:pointer';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function render() {
    if (!state.el) return;
    var d = doc();
    state.el.innerHTML = '';

    // 菜单/设置是“可展开面板”，不是把选项铺成长页面：手机默认收起，
    // 桌面默认展开；展开后内部滚动，页面本身不被菜单撑长。
    var shellId = 'gs-panel-' + (state.slug || 'game');
    var collapsed = !!(root.matchMedia && root.matchMedia('(max-width: 560px)').matches);
    var lang = String((d.documentElement && d.documentElement.lang) || 'zh').slice(0, 2);
    var panelLabel = lang === 'en' || lang === 'id' ? 'Menu' : '菜单';
    var toggle = d.createElement('button');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.setAttribute('aria-controls', shellId);
    toggle.textContent = panelLabel + ' · 尺寸 / 难度 / 每日';
    toggle.style.cssText = 'display:flex;width:100%;align-items:center;justify-content:center;gap:8px;' +
      'min-height:44px;padding:6px 12px;border-radius:10px;border:1px solid rgba(0,0,0,.16);' +
      'background:transparent;font:inherit;font-size:13px;cursor:pointer';
    var body = d.createElement('div');
    body.id = shellId;
    body.style.cssText = 'overflow:auto;max-height:50vh;display:' + (collapsed ? 'none' : 'block');
    toggle.addEventListener('click', function () {
      var next = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
      body.style.display = next ? 'block' : 'none';
    });

    if (state.sizes.length) {
      var sizeRow = d.createElement('div');
      sizeRow.setAttribute('role', 'group');
      sizeRow.setAttribute('aria-label', '尺寸');
      sizeRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:8px 0 4px';
      var current = '';
      try { current = new root.URLSearchParams(root.location.search).get('n') || ''; } catch (e) { /* ignore */ }
      if (!current && state.defaultSize != null) current = String(state.defaultSize);
      state.sizes.forEach(function (s) {
        var isCur = String(s.value) === String(current);
        var a = d.createElement('a');
        a.href = s.href;
        a.textContent = s.label;
        a.setAttribute('aria-current', isCur ? 'page' : 'false');
        a.style.cssText = 'min-height:44px;display:inline-flex;align-items:center;padding:6px 10px;border-radius:8px;text-decoration:none;font-size:13px;border:1px solid ' +
          (isCur ? '#3d3226' : 'rgba(0,0,0,.16)') + ';background:' + (isCur ? '#3d3226' : 'transparent') +
          ';color:' + (isCur ? '#fff' : 'inherit');
        sizeRow.appendChild(a);
      });
      body.appendChild(sizeRow);
    }

    if (state.difficulties.length) {
      var diffRow = d.createElement('div');
      diffRow.setAttribute('role', 'group');
      diffRow.setAttribute('aria-label', '难度');
      diffRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:4px 0';
      var cur = currentDifficulty();
      state.difficulties.forEach(function (x) {
        diffRow.appendChild(btn(x.label, x.value === cur, function () { setDifficulty(x.value); }, x.title));
      });
      body.appendChild(diffRow);
    }

    var line = d.createElement('p');
    line.setAttribute('role', 'status');
    line.setAttribute('aria-live', 'polite');
    line.style.cssText = 'margin:6px 0 0;font-size:13px;opacity:.9;text-align:center';
    line.textContent = statusText();
    body.appendChild(line);
    state.el.appendChild(toggle);
    state.el.appendChild(body);
  }

  function init(opts) {
    opts = opts || {};
    state.slug = String(opts.slug || '');
    state.sizes = opts.sizes || [];
    state.defaultSize = opts.defaultSize != null ? opts.defaultSize : null;
    state.defaultDifficulty = opts.defaultDifficulty || null;
    state.difficulties = opts.difficulties || [];
    state.onDifficulty = opts.onDifficulty || null;
    state.onNewGame = opts.onNewGame || null;
    state.scored = false;

    var d = doc();
    if (!d) return null;
    var main = opts.container || d.querySelector('main.wrap') || d.querySelector('main') || d.body;
    var box = d.createElement('div');
    box.className = 'game-shell';
    box.style.cssText = 'padding:2px 0 8px';
    if (opts.insert !== false) {
      if (main.firstChild) main.insertBefore(box, main.firstChild);
      else main.appendChild(box);
    }
    state.el = box;
    render();
    return box;
  }

  function finish(score) {
    var p = progress();
    if (!p || !state.slug || state.scored) return null;
    state.scored = true;
    var out = null;
    try {
      out = p.record({ slug: state.slug, score: Number(score) || 0, mode: isDaily() ? 'daily' : 'free' });
    } catch (e) { /* 记录失败不影响玩 */ }
    render();
    return out;
  }

  function reset() { state.scored = false; render(); }

  return {
    init: init,
    render: render,
    reset: reset,
    finish: finish,
    seed: seed,
    isDaily: isDaily,
    difficulty: currentDifficulty,
    _state: state
  };
});
