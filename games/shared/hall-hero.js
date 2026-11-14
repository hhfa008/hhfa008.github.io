/* 大厅顶部「今天玩什么」：旗舰入口 + 每日挑战 + 你的战绩（UMD）
 *
 *   <div id="hall-hero"></div>
 *   <script src="/games/shared/hall-hero.js"></script>
 *   <script>GameHallHero.render();</script>
 *
 * 只读 localStorage 里的 gp.v1.<slug>.*（由 progress.js 写入），不写任何东西。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GameHallHero = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var NAMES = {
    azul: ['花砖物语 Azul', 'Azul', 'Azul'],
    splendor: ['璀璨宝石 Splendor', 'Splendor', 'Splendor'],
    '2048': ['2048', '2048', '2048'],
    chess: ['国际象棋', 'Chess', 'Catur'],
    xiangqi: ['中国象棋', 'Xiangqi', 'Xiangqi'],
    gomoku: ['五子棋', 'Gomoku', 'Gomoku'],
    go9: ['围棋 9 路', 'Go 9×9', 'Go 9×9'],
    reversi: ['黑白棋', 'Reversi', 'Reversi'],
    mahjong: ['麻将', 'Mahjong', 'Mahjong'],
    doudizhu: ['斗地主', 'Dou Dizhu', 'Dou Dizhu'],
    connect4: ['四子棋', 'Connect Four', 'Connect Four'],
    mines: ['扫雷', 'Minesweeper', 'Minesweeper'],
    snake: ['贪吃蛇', 'Snake', 'Snake'],
    pong: ['乒乓球', 'Pong', 'Pong']
  };

  var T = {
    zh: { title: '今天玩什么', flagship: '开始一局', daily: '今日挑战', streak: '连胜', todayDone: '今天已完成', todayOpen: '今天还没玩', mine: '你的战绩', best: '最高', none: '还没有记录——随便玩一局，这里就会出现你的成绩。', run: '局' },
    en: { title: 'Play today', flagship: 'Play now', daily: 'Daily challenge', streak: 'streak', todayDone: 'done today', todayOpen: 'not played today', mine: 'Your record', best: 'best', none: 'No record yet — play one game and it shows up here.', run: 'games' },
    id: { title: 'Main hari ini', flagship: 'Main sekarang', daily: 'Tantangan harian', streak: 'beruntun', todayDone: 'selesai hari ini', todayOpen: 'belum main hari ini', mine: 'Rekormu', best: 'terbaik', none: 'Belum ada rekor — main satu kali, rekornya muncul di sini.', run: 'main' }
  };

  function lang() {
    var l = (root.document && root.document.documentElement.getAttribute('lang')) || 'zh';
    return l.indexOf('en') === 0 ? 'en' : l.indexOf('id') === 0 ? 'id' : 'zh';
  }

  function nameOf(slug, l) {
    var n = NAMES[slug];
    if (n) return l === 'en' ? n[1] : l === 'id' ? n[2] : n[0];
    return slug;
  }

  function readRecords() {
    var out = [];
    var ls = root.localStorage;
    if (!ls) return out;
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (!k || k.indexOf('gp.v1.') !== 0) continue;
      var slug = k.slice(6, k.lastIndexOf('.'));
      if (!slug || out.some(function (r) { return r.slug === slug; })) continue;
      var best = Number(ls.getItem('gp.v1.' + slug + '.best')) || 0;
      var streak = Number(ls.getItem('gp.v1.' + slug + '.streak')) || 0;
      var runs = Number(ls.getItem('gp.v1.' + slug + '.runs')) || 0;
      var dailyDone = ls.getItem('gp.v1.' + slug + '.dailyDone') || '';
      if (!runs) continue;
      out.push({ slug: slug, best: best, streak: streak, runs: runs, dailyDone: dailyDone });
    }
    out.sort(function (a, b) { return b.runs - a.runs; });
    return out;
  }

  function today() {
    var d = new Date();
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function el(tag, css, text) {
    var n = root.document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  }

  function render(opts) {
    opts = opts || {};
    var d = root.document;
    var host = typeof opts.container === 'string' ? d.querySelector(opts.container) : (opts.container || d.getElementById('hall-hero'));
    if (!host) return null;
    var l = lang();
    var t = T[l];

    var flagship = opts.flagship || { slug: 'azul', href: '/games/boardgame/azul-premium/', blurb: '' };
    var daily = opts.daily || { slug: '2048', href: '/games/2048/?daily=1' };
    var records = readRecords();
    var dailyRecord = null;
    records.forEach(function (r) { if (r.slug === daily.slug) dailyRecord = r; });

    host.innerHTML = '';
    var box = el('section', 'margin:18px 0 6px;padding:16px;border:1px solid rgba(0,0,0,.12);border-radius:14px;background:rgba(255,255,255,.55)');
    box.setAttribute('aria-label', t.title);
    box.appendChild(el('p', 'margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.6', t.title));

    var row = el('div', 'display:flex;flex-wrap:wrap;gap:10px;align-items:stretch');
    var a1 = el('a', 'flex:1 1 220px;display:block;padding:14px 16px;border-radius:12px;background:#3d3226;color:#fff;text-decoration:none');
    a1.href = flagship.href;
    a1.appendChild(el('strong', 'display:block;font-size:18px', nameOf(flagship.slug, l)));
    a1.appendChild(el('span', 'display:block;margin-top:6px;font-size:13px;opacity:.8', t.flagship));
    row.appendChild(a1);

    var a2 = el('a', 'flex:1 1 220px;display:block;padding:14px 16px;border-radius:12px;border:1px solid rgba(0,0,0,.16);text-decoration:none;color:inherit');
    a2.href = daily.href;
    a2.appendChild(el('strong', 'display:block;font-size:16px', t.daily + ' · ' + nameOf(daily.slug, l)));
    var ds = dailyRecord && dailyRecord.dailyDone === today();
    var sub = ds ? t.todayDone : t.todayOpen;
    if (dailyRecord && dailyRecord.streak > 0) sub += ' · ' + t.streak + ' ' + dailyRecord.streak;
    a2.appendChild(el('span', 'display:block;margin-top:6px;font-size:13px;opacity:.75', sub));
    row.appendChild(a2);
    box.appendChild(row);

    var rec = el('div', 'margin-top:14px');
    rec.appendChild(el('p', 'margin:0 0 6px;font-size:13px;opacity:.6', t.mine));
    if (!records.length) {
      rec.appendChild(el('p', 'margin:0;font-size:14px;opacity:.75', t.none));
    } else {
      var ul = el('ul', 'margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:8px');
      records.slice(0, 6).forEach(function (r) {
        var li = el('li', 'padding:8px 12px;border-radius:10px;border:1px solid rgba(0,0,0,.12);font-size:13px');
        li.appendChild(el('strong', 'display:block', nameOf(r.slug, l)));
        var line = t.best + ' ' + (r.best || '—') + ' · ' + r.runs + ' ' + t.run;
        if (r.streak > 0) line += ' · ' + t.streak + ' ' + r.streak;
        li.appendChild(el('span', 'opacity:.7', line));
        ul.appendChild(li);
      });
      rec.appendChild(ul);
    }
    box.appendChild(rec);

    host.appendChild(box);
    return box;
  }

  return { render: render, readRecords: readRecords };
});
