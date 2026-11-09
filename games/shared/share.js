/* Share button for the games hall and every game page.
 *
 * Pure front-end, same-origin, no third-party SDK and no analytics.
 * - Tries the native Web Share sheet when the browser has it.
 * - Otherwise copies the page URL to the clipboard and shows a 2-second toast.
 * - Shared links keep only functional parameters (e.g. voice-room ?room=1234)
 *   and drop any known tracking parameters. No user id is ever attached.
 *
 * The page supplies the localized game name on the script tag:
 *   <script src="/games/shared/share.js"
 *           data-name-zh="四子棋" data-name-en="Connect Four" data-name-id="Connect Four"></script>
 */
(function () {
  'use strict';

  var TRACKING = {
    utm_source: 1, utm_medium: 1, utm_campaign: 1, utm_term: 1, utm_content: 1, utm_id: 1,
    fbclid: 1, gclid: 1, dclid: 1, msclkid: 1, mc_cid: 1, mc_eid: 1,
    ref: 1, referrer: 1, source: 1, spm: 1, scm: 1, from: 1
  };
  var PHRASE = {
    zh: '打开就能玩，不用下载',
    en: 'Open and play, no download',
    id: 'Langsung main, tanpa unduh'
  };
  var LABEL = {
    zh: '分享本页',
    en: 'Share this page',
    id: 'Bagikan halaman ini'
  };
  var SHORT = { zh: '分享', en: 'Share', id: 'Bagikan' };
  var COPIED = { zh: '链接已复制', en: 'Link copied', id: 'Tautan disalin' };
  var FAILED = {
    zh: '复制失败，请手动复制地址栏链接',
    en: 'Could not copy — please copy the address bar link',
    id: 'Gagal menyalin — salin tautan dari bilah alamat'
  };

  function currentLang() {
    var l = String(document.documentElement.getAttribute('lang') || 'en').toLowerCase();
    if (l.indexOf('zh') === 0) return 'zh';
    if (l.indexOf('id') === 0) return 'id';
    return 'en';
  }

  function shareScript() {
    return document.querySelector('script[src$="/shared/share.js"], script[src$="shared/share.js"]');
  }

  function gameName(lang) {
    var el = shareScript();
    if (el) {
      var order = lang === 'zh' ? ['zh', 'en', 'id'] : lang === 'id' ? ['id', 'en', 'zh'] : ['en', 'zh', 'id'];
      for (var i = 0; i < order.length; i++) {
        var v = el.getAttribute('data-name-' + order[i]);
        if (v && v.trim()) return v.trim();
      }
    }
    var main = document.getElementById('titleMain');
    if (main && main.textContent.trim()) return main.textContent.trim();
    var title = String(document.title || '').split(/[·•|]/)[0].trim();
    return title || 'Devin';
  }

  function shareUrl() {
    try {
      var u = new URL(location.href);
      var drop = [];
      u.searchParams.forEach(function (value, key) {
        if (TRACKING[key]) drop.push(key);
      });
      for (var i = 0; i < drop.length; i++) u.searchParams.delete(drop[i]);
      return u.toString();
    } catch (e) {
      return location.href;
    }
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    var sel = document.getSelection && document.getSelection();
    var previous = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    var ok = false;
    try {
      ta.select();
      ta.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
    } catch (e) {}
    document.body.removeChild(ta);
    if (previous && sel) {
      sel.removeAllRanges();
      sel.addRange(previous);
    }
    return ok;
  }

  function ensureStyle() {
    if (document.getElementById('share-style')) return;
    var style = document.createElement('style');
    style.id = 'share-style';
    style.textContent =
      '.share-row{display:flex;align-items:center;gap:8px;margin:0 0 10px}' +
      '.share-btn:hover{border-color:currentColor !important}' +
      '.share-btn:focus-visible{outline:2px solid currentColor;outline-offset:3px}' +
      '#share-toast{position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));' +
      'transform:translateX(-50%) translateY(8px);background:#243040;border:1px solid #3a4a5e;' +
      'color:#eef3f8;padding:12px 18px;border-radius:999px;font-size:14px;line-height:1.4;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.3);opacity:0;pointer-events:none;' +
      'transition:opacity .18s,transform .18s;max-width:calc(100vw - 32px);text-align:center;' +
      'z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}' +
      '#share-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}';
    document.head.appendChild(style);
  }

  var toastTimer = null;
  function toast(text, ms) {
    ensureStyle();
    var el = document.getElementById('share-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'share-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 2000);
  }

  function copyUrl(url) {
    var lang = currentLang();
    function ok() { toast(COPIED[lang], 2000); }
    function fail() { toast(FAILED[lang], 2600); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(ok, function () {
        if (legacyCopy(url)) ok(); else fail();
      });
      return;
    }
    if (legacyCopy(url)) ok(); else fail();
  }

  function doShare() {
    var lang = currentLang();
    var url = shareUrl();
    var name = gameName(lang);
    var text = name + ' · ' + PHRASE[lang];
    if (typeof navigator.share === 'function') {
      try {
        var result = navigator.share({ title: name, text: text, url: url });
        if (result && typeof result.then === 'function') {
          result.catch(function (err) {
            if (err && err.name === 'AbortError') return;
            copyUrl(url);
          });
        }
        return;
      } catch (e) {}
    }
    copyUrl(url);
  }

  function syncLabels() {
    var lang = currentLang();
    var buttons = document.querySelectorAll('[data-share-btn]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-label', LABEL[lang]);
      buttons[i].setAttribute('title', LABEL[lang]);
      var label = buttons[i].querySelector('[data-share-label]');
      if (label) label.textContent = SHORT[lang];
    }
  }

  function init() {
    syncLabels();
    if (window.MutationObserver) {
      new MutationObserver(syncLabels).observe(document.documentElement, {
        attributes: true, attributeFilter: ['lang']
      });
    }
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-share-btn]') : null;
      if (!btn) return;
      e.preventDefault();
      doShare();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
