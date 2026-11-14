/* Shared poker table UI for the card games.

   UMD: browsers read window.PokerUI (include this file after shared/sfx.js and
   shared/shuffle.js), Node reads module.exports. No hard dependencies: Sfx and
   Shuffle are probed at call time and degrade silently when absent.

   What this is
   ------------
   One implementation of the pieces every poker/card page kept re-writing:

     - standard 52-card face + card back + empty slot (texas-holdem source)
     - visible deck pile with a count badge (love-letter / no-thanks source)
     - chip stacks, a community-card board, seats, and action buttons
     - hand layouts: row / overlap / fan / scroll / grid
     - the deal / flip motion texas-holdem never had

   Contract
   --------
   - Creating a node without a document returns null; nothing throws.
   - renderFace returns an HTML string, so innerHTML pages can use it directly.
   - All class names are pui-prefixed. Migrating pages pass their legacy class
     names through `className`; the shared sheet never styles bare .card,
     .hand, .chip or .deck.
   - deal() / flip() only animate visuals. They always resolve (never reject),
     and game state must not depend on their result. Reduced motion resolves
     immediately.
   - No storage, no network, no game rules, no state mutation.
*/
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PokerUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var doc = root && root.document ? root.document : null;

  var SUITS = ['s', 'h', 'd', 'c'];
  var SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
  var RANK_LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  var RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  var SUIT_ALIASES = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c', S: 's', H: 'h', D: 'd', C: 'c' };
  var RANK_ALIASES = { T: 10, J: 11, Q: 12, K: 13, A: 14 };

  /* ------------------------------------------------------------------ *
   * Card model                                                        *
   * ------------------------------------------------------------------ */

  function rankLabel(r) {
    return RANK_LABELS[r] || String(r);
  }

  function suitSymbol(s) {
    return SUIT_SYMBOLS[s] || String(s == null ? '' : s);
  }

  function isRed(card) {
    return !!card && (card.s === 'h' || card.s === 'd');
  }

  function parseRank(value) {
    if (typeof value === 'number' && value % 1 === 0) {
      return value >= 2 && value <= 14 ? value : null;
    }
    var s = String(value == null ? '' : value).trim().toUpperCase();
    if (!s) return null;
    if (/^(10|[2-9])$/.test(s)) return Number(s);
    if (RANK_ALIASES[s]) return RANK_ALIASES[s];
    return null;
  }

  function parseSuit(value) {
    var s = String(value == null ? '' : value).trim();
    if (!s) return null;
    if (SUIT_SYMBOLS[s]) return s;
    if (SUIT_ALIASES[s]) return SUIT_ALIASES[s];
    return null;
  }

  // "As" | "10h" | {r:14,s:'s'} | {rank:'A',suit:'spades'} -> {r,s}
  // Jokers: "BJ"/"RJ" or {joker:'big'|'small'} -> {joker,r:0,s:''}
  // Anything unrecognised returns null; this function never throws.
  function normalizeCard(input) {
    if (input == null) return null;
    if (typeof input === 'string') {
      var raw = input.trim();
      if (!raw) return null;
      if (/^(bj|bigjoker|joker_big|redjoker|大王)$/i.test(raw)) return { joker: 'big', r: 0, s: '' };
      if (/^(sj|smalljoker|joker_small|blackjoker|小王)$/i.test(raw)) return { joker: 'small', r: 0, s: '' };
      var m = /^(10|[2-9JQKAT])\s*([SHDC♠♥♦♣])$/i.exec(raw) ||
              /^([SHDC♠♥♦♣])\s*(10|[2-9JQKAT])$/i.exec(raw);
      if (!m) return null;
      var isSuitFirst = !/^(10|[2-9JQKAT])$/i.test(m[1]);
      var r = parseRank(isSuitFirst ? m[2] : m[1]);
      var s = parseSuit(isSuitFirst ? m[1] : m[2]);
      return r != null && s ? { r: r, s: s } : null;
    }
    if (typeof input !== 'object') return null;
    if (input.joker) {
      var kind = input.joker === true ? 'small' : String(input.joker).toLowerCase();
      return { joker: /big|red|大/.test(kind) ? 'big' : 'small', r: 0, s: '' };
    }
    var r = parseRank(input.r != null ? input.r : (input.rank != null ? input.rank : input.value));
    var s = parseSuit(input.s != null ? input.s : input.suit);
    return r != null && s ? { r: r, s: s } : null;
  }

  function cardAria(card) {
    if (!card) return '';
    if (card.joker) return card.joker === 'big' ? '大王' : '小王';
    return rankLabel(card.r) + suitSymbol(card.s);
  }

  /* ------------------------------------------------------------------ *
   * Face markup                                                       *
   * ------------------------------------------------------------------ */

  function faceInner(card, opts) {
    if (card.joker) {
      return '<span class="pui-face__joker">JOKER</span>' +
             '<span class="pui-face__suit">' + (card.joker === 'big' ? '★' : '☆') + '</span>';
    }
    var label = rankLabel(card.r);
    var sym = suitSymbol(card.s);
    var mode = '';
    if (opts.pips === 'auto' && card.r >= 2 && card.r <= 10) mode = 'pips';
    else if (opts.court === 'auto' && card.r >= 11 && card.r <= 13) mode = 'court';

    if (mode === 'pips') {
      var pips = '';
      for (var i = 0; i < card.r; i++) pips += '<span class="pui-pip">' + sym + '</span>';
      return '<span class="pui-face__corner pui-face__corner--tl">' + label + sym + '</span>' +
             '<span class="pui-pips">' + pips + '</span>' +
             '<span class="pui-face__corner pui-face__corner--br">' + label + sym + '</span>';
    }
    if (mode === 'court') {
      return '<span class="pui-face__corner pui-face__corner--tl">' + label + sym + '</span>' +
             '<span class="pui-court">' + label + '</span>' +
             '<span class="pui-face__court-suit">' + sym + '</span>' +
             '<span class="pui-face__corner pui-face__corner--br">' + label + sym + '</span>';
    }
    return '<span class="pui-face__rank">' + label + '</span>' +
           '<span class="pui-face__suit">' + sym + '</span>';
  }

  // HTML string. opts: see createCard; additionally pips/court/joker/label.
  function renderFace(cardInput, opts) {
    opts = opts || {};
    var card = normalizeCard(cardInput);
    if (!card && !opts.hidden) return '';
    if (card && card.joker && !opts.joker) return '';
    var size = opts.size || 'md';
    var classes = ['pui', 'pui-card', 'pui-card--' + size, 'pui-face'];
    if (opts.hidden) classes.push('is-back');
    if (isRed(card)) classes.push('is-red');
    if (opts.best) classes.push('is-best');
    if (opts.className) classes.push(opts.className);
    var label = opts.label || (opts.hidden ? '隐藏的牌' : cardAria(card));
    var inner = opts.hidden
      ? '<span class="pui-card__back-mark" aria-hidden="true">♠</span>'
      : faceInner(card, opts);
    return '<span class="' + classes.join(' ') + '" role="img" aria-label="' +
      escapeAttr(label) + '">' + inner + '</span>';
  }

  function escapeAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ------------------------------------------------------------------ *
   * Node helpers                                                      *
   * ------------------------------------------------------------------ */

  function node(tag, className) {
    if (!doc) return null;
    var el = doc.createElement(tag || 'div');
    if (className) el.className = className;
    return el;
  }

  function applyStyle(el, style) {
    if (!el || !style || !el.style) return;
    Object.keys(style).forEach(function (key) {
      var value = style[key];
      if (value == null) return;
      if (key.indexOf('--') === 0) {
        el.style.setProperty(key, String(value));
      } else {
        try { el.style[key] = value; } catch (e) { /* invalid property */ }
      }
    });
  }

  function applyAttrs(el, attrs) {
    if (!el || !attrs || !el.setAttribute) return;
    Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value == null || value === false) return;
      el.setAttribute(key, value === true ? '' : String(value));
    });
  }

  function applyDataset(el, data) {
    if (!el || !data || !el.dataset) return;
    Object.keys(data).forEach(function (key) {
      el.dataset[key] = String(data[key]);
    });
  }

  function playSfx(name) {
    if (!name || !root || !root.Sfx || typeof root.Sfx.play !== 'function') return;
    try { root.Sfx.play(name); } catch (e) { /* audio is best-effort */ }
  }

  function prefersReducedMotion() {
    try {
      return !!(root && root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Cards                                                             *
   * ------------------------------------------------------------------ */

  // card: card input or null. opts:
  //   face:'standard'|'custom', faceHtml, hidden, size, className, backArt,
  //   interactive, tag, onClick, ariaLabel, attrs, dataset, style, disabled,
  //   pips:'auto'|'none', court:'auto'|'none', joker, best, title
  function createCard(cardInput, opts) {
    opts = opts || {};
    if (!doc) return null;
    var card = opts.face === 'custom' ? null : normalizeCard(cardInput);
    if (opts.face !== 'custom' && !card && !opts.hidden) return null;
    if (card && card.joker && !opts.hidden && !opts.joker) return null;

    var tag = opts.tag || (opts.interactive || opts.onClick ? 'button' : 'span');
    var el = node(tag);
    if (!el) return null;
    var classes = ['pui', 'pui-card', 'pui-card--' + (opts.size || 'md')];
    if (opts.face === 'custom') classes.push('pui-card--custom');
    if (opts.hidden) classes.push('is-back');
    if (isRed(card)) classes.push('is-red');
    if (opts.best) classes.push('is-best');
    if (opts.className) classes.push(opts.className);
    el.className = classes.join(' ');
    if (tag === 'button') el.type = 'button';

    if (opts.hidden) {
      el.innerHTML = '<span class="pui-card__back-mark" aria-hidden="true">♠</span>';
    } else if (opts.face === 'custom') {
      el.innerHTML = opts.faceHtml == null ? '' : String(opts.faceHtml);
    } else {
      el.innerHTML = faceInner(card, opts);
    }

    var label = opts.ariaLabel || opts.label || (opts.hidden ? '隐藏的牌' : cardAria(card));
    el.setAttribute('aria-label', label);
    if (opts.title) el.setAttribute('title', opts.title);
    if (opts.backArt) el.style.backgroundImage = String(opts.backArt);
    applyStyle(el, opts.style);
    applyAttrs(el, opts.attrs);
    applyDataset(el, opts.dataset);
    if (opts.disabled) {
      if (tag === 'button') el.disabled = true;
      else el.setAttribute('aria-disabled', 'true');
    }
    if (opts.onClick && !opts.disabled) el.addEventListener('click', opts.onClick);
    return el;
  }

  function createCardBack(opts) {
    opts = opts || {};
    return createCard(null, {
      hidden: true,
      size: opts.size,
      className: opts.className,
      backArt: opts.backArt,
      ariaLabel: opts.ariaLabel || '隐藏的牌',
      attrs: opts.attrs,
      dataset: opts.dataset,
      style: opts.style,
      tag: opts.tag
    });
  }

  function createSlot(opts) {
    opts = opts || {};
    if (!doc) return null;
    var tag = opts.tag || (opts.onClick ? 'button' : 'span');
    var el = node(tag);
    if (!el) return null;
    var classes = ['pui', 'pui-card', 'pui-card--' + (opts.size || 'md'), 'is-slot'];
    if (opts.className) classes.push(opts.className);
    el.className = classes.join(' ');
    if (tag === 'button') el.type = 'button';
    el.setAttribute('aria-hidden', opts.ariaLabel ? 'false' : 'true');
    if (opts.ariaLabel) el.setAttribute('aria-label', opts.ariaLabel);
    if (opts.text != null) {
      var text = doc.createElement('span');
      text.className = 'pui-slot__text';
      text.textContent = String(opts.text);
      el.appendChild(text);
    }
    applyStyle(el, opts.style);
    applyAttrs(el, opts.attrs);
    if (opts.onClick) el.addEventListener('click', opts.onClick);
    return el;
  }

  /* ------------------------------------------------------------------ *
   * Deck pile                                                         *
   * ------------------------------------------------------------------ */

  function createDeckPile(opts) {
    opts = opts || {};
    if (!doc) return null;
    var tag = opts.tag || (opts.onClick ? 'button' : 'div');
    var el = node(tag);
    if (!el) return null;
    var classes = ['pui', 'pui-deck'];
    if (opts.className) classes.push(opts.className);
    el.className = classes.join(' ');
    if (tag === 'button') el.type = 'button';
    if (opts.backArt) el.style.backgroundImage = String(opts.backArt);
    el.style.setProperty('--pui-deck-w', (opts.width || 58) + 'px');
    el.style.setProperty('--pui-deck-h', (opts.height || 81) + 'px');

    var layers = opts.layers == null ? 2 : Math.max(0, Math.min(3, Number(opts.layers) || 0));
    for (var i = 1; i <= layers; i++) {
      var stack = doc.createElement('span');
      stack.className = 'pui-deck__stack pui-deck__stack--' + i;
      stack.setAttribute('aria-hidden', 'true');
      el.appendChild(stack);
    }
    var count = doc.createElement('span');
    count.className = 'pui-deck__count';
    if (opts.countId) count.id = String(opts.countId);
    count.textContent = String(opts.count == null ? 0 : opts.count);
    el.appendChild(count);

    el.setAttribute('data-count', String(opts.count == null ? 0 : opts.count));
    el.setAttribute('data-label', opts.label || '牌堆');
    if (opts.onClick) el.addEventListener('click', opts.onClick);
    updateDeckPile(el, { count: opts.count, empty: opts.count === 0, emptyText: opts.emptyText, label: opts.label });
    return el;
  }

  function updateDeckPile(el, opts) {
    opts = opts || {};
    if (!el) return null;
    var count = opts.count == null ? Number(el.getAttribute('data-count')) || 0 : Number(opts.count) || 0;
    var badge = el.querySelector ? el.querySelector('.pui-deck__count') : null;
    if (!badge && el.querySelector) badge = el.querySelector('#deckCount');
    if (badge) badge.textContent = String(count);
    el.setAttribute('data-count', String(count));
    var empty = opts.empty == null ? count === 0 : !!opts.empty;
    if (el.classList) {
      el.classList.toggle('is-empty', empty);
      // Legacy class kept so existing page CSS (.deck-pile.empty) still works.
      el.classList.toggle('empty', empty);
    }
    var label = opts.label || el.getAttribute('data-label') || '牌堆';
    el.setAttribute('data-label', label);
    el.setAttribute('aria-label', empty
      ? (label + (opts.emptyText ? '，' + opts.emptyText : '，已空'))
      : (label + '，剩余 ' + count + ' 张'));
    return el;
  }

  /* ------------------------------------------------------------------ *
   * Chips                                                             *
   * ------------------------------------------------------------------ */

  function formatNumber(value) {
    var n = Number(value);
    if (!isFinite(n)) return String(value == null ? '' : value);
    return String(Math.round(n));
  }

  function chipBreakdown(value, denominations, max) {
    var out = [];
    var left = Math.max(0, Math.floor(Number(value) || 0));
    var list = Array.isArray(denominations) && denominations.length ? denominations : [100, 25, 5, 1];
    var cap = max == null ? 14 : Math.max(0, Number(max) || 0);
    for (var d = 0; d < list.length && out.length < cap; d++) {
      var denom = Number(list[d]);
      if (!(denom > 0)) continue;
      var take = Math.floor(left / denom);
      left -= take * denom;
      for (var i = 0; i < take && out.length < cap; i++) out.push(denom);
    }
    return out;
  }

  function createChipStack(opts) {
    opts = opts || {};
    if (!doc) return null;
    var el = node(opts.tag || 'span');
    if (!el) return null;
    var classes = ['pui', 'pui-chips'];
    if (opts.size === 'lg') classes.push('pui-chips--lg');
    if (opts.animate) classes.push('is-anim');
    if (opts.className) classes.push(opts.className);
    el.className = classes.join(' ');
    var chips = chipBreakdown(opts.value, opts.denominations, opts.max);
    for (var i = 0; i < chips.length; i++) {
      var chip = doc.createElement('span');
      chip.className = 'pui-chip';
      if (opts.artUrl) chip.style.backgroundImage = String(opts.artUrl);
      chip.setAttribute('aria-hidden', 'true');
      chip.style.setProperty('--pui-chip-delay', (i * 24) + 'ms');
      if (opts.showValues) chip.textContent = String(chips[i]);
      el.appendChild(chip);
    }
    var label = opts.label || formatNumber(opts.value || 0);
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label);
    el.setAttribute('title', label);
    return el;
  }

  /* ------------------------------------------------------------------ *
   * Board / seats / actions                                           *
   * ------------------------------------------------------------------ */

  function createBoard(opts) {
    opts = opts || {};
    if (!doc) return null;
    var el = node('div', 'pui pui-board' + (opts.className ? ' ' + opts.className : ''));
    if (!el) return null;
    var slots = opts.slots == null ? 5 : Math.max(0, Number(opts.slots) || 0);
    var cards = Array.isArray(opts.cards) ? opts.cards : [];
    for (var i = 0; i < slots; i++) {
      // Pages with their own face markup (texas-holdem's .pcard, doudizhu's
      // 54-card faces) pass renderCard / renderSlot and keep full control.
      var slot = null;
      if (cards[i]) {
        slot = typeof opts.renderCard === 'function'
          ? opts.renderCard(cards[i], i)
          : createCard(cards[i], { size: opts.size || 'md', className: opts.slotClassName });
      } else {
        slot = typeof opts.renderSlot === 'function'
          ? opts.renderSlot(i)
          : createSlot({ size: opts.size || 'md', className: opts.slotClassName });
      }
      if (slot) {
        slot.setAttribute('data-slot', String(i));
        if (opts.onSlotClick) {
          slot.classList.add('is-interactive');
          slot.setAttribute('role', 'button');
          slot.setAttribute('tabindex', '0');
          (function (index) {
            slot.addEventListener('click', function () { opts.onSlotClick(index); });
            slot.addEventListener('keydown', function (ev) {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                opts.onSlotClick(index);
              }
            });
          })(i);
        }
        el.appendChild(slot);
      }
    }
    el.setAttribute('role', 'group');
    if (opts.label) el.setAttribute('aria-label', opts.label);
    return el;
  }

  function createSeat(opts) {
    opts = opts || {};
    if (!doc) return null;
    var el = node(opts.onClick ? 'button' : 'div');
    if (!el) return null;
    if (el.tagName === 'BUTTON') el.type = 'button';
    var classes = ['pui', 'pui-seat'];
    if (opts.active) classes.push('is-active');
    if (opts.folded) classes.push('is-folded');
    if (opts.out) classes.push('is-out');
    if (opts.onClick) classes.push('is-interactive');
    if (opts.className) classes.push(opts.className);
    el.className = classes.join(' ');

    var head = doc.createElement('div');
    head.className = 'pui-seat__head';
    var avatar = doc.createElement('span');
    avatar.className = 'pui-seat__avatar';
    avatar.setAttribute('aria-hidden', 'true');
    if (opts.avatar && /^(https?:|data:|\/|\.)/.test(String(opts.avatar))) {
      var img = doc.createElement('img');
      img.src = String(opts.avatar);
      img.alt = '';
      avatar.appendChild(img);
    } else {
      avatar.textContent = String(opts.avatar || opts.name || '?').slice(0, 3);
    }
    head.appendChild(avatar);
    var meta = doc.createElement('div');
    meta.className = 'pui-seat__meta';
    var name = doc.createElement('strong');
    name.className = 'pui-seat__name';
    name.textContent = String(opts.name || '');
    meta.appendChild(name);
    if (opts.chips != null || opts.chipsText != null) {
      var chips = doc.createElement('span');
      chips.className = 'pui-seat__chips' + (opts.chipsClassName ? ' ' + opts.chipsClassName : '');
      chips.textContent = opts.chipsText != null
        ? String(opts.chipsText)
        : formatNumber(opts.chips);
      meta.appendChild(chips);
    }
    head.appendChild(meta);
    el.appendChild(head);

    var hole = doc.createElement('div');
    hole.className = 'pui-seat__hole' + (opts.holeClassName ? ' ' + opts.holeClassName : '');
    var holeCards = Array.isArray(opts.holeCards) ? opts.holeCards : [];
    for (var i = 0; i < holeCards.length; i++) {
      var card;
      if (typeof opts.renderCard === 'function') {
        card = opts.renderCard(holeCards[i], i, !!opts.hidden);
      } else {
        card = opts.hidden
          ? createCardBack({ size: opts.size || 'sm' })
          : createCard(holeCards[i], { size: opts.size || 'sm' });
      }
      if (card) hole.appendChild(card);
    }
    el.appendChild(hole);

    if (Array.isArray(opts.badges) && opts.badges.length) {
      var badges = doc.createElement('div');
      badges.className = 'pui-seat__badges';
      opts.badges.forEach(function (badge) {
        var b = doc.createElement('span');
        b.className = 'pui-badge' + (badge && badge.className ? ' ' + badge.className : '');
        b.textContent = String(badge && badge.text != null ? badge.text : badge);
        badges.appendChild(b);
      });
      el.appendChild(badges);
    }

    if (opts.bet != null && opts.bet !== '') {
      var bet = doc.createElement('div');
      bet.className = 'pui-seat__bet';
      bet.textContent = '+' + formatNumber(opts.bet);
      el.appendChild(bet);
    }

    if (opts.name) el.setAttribute('aria-label', String(opts.name) +
      (opts.chips != null ? '，' + formatNumber(opts.chips) + ' 筹码' : '') +
      (opts.active ? '，行动中' : '') + (opts.out ? '，已出局' : ''));
    if (opts.onClick) el.addEventListener('click', opts.onClick);
    return el;
  }

  function createActionBar(opts) {
    opts = opts || {};
    if (!doc) return null;
    var el = node('div', 'pui pui-actions' + (opts.className ? ' ' + opts.className : ''));
    if (!el) return null;
    var actions = Array.isArray(opts.actions) ? opts.actions : [];
    var visible = actions.filter(function (action) { return action && !action.hidden; }).length;
    var cols = opts.columns || visible || 5;
    el.style.setProperty('--pui-action-cols', String(cols));
    actions.forEach(function (action) {
      if (!action || action.hidden) return;
      var btn = doc.createElement('button');
      btn.type = 'button';
      var kind = action.kind || 'custom';
      btn.className = 'pui-btn pui-btn--' + kind +
        (action.primary ? ' is-primary' : '') +
        (action.wide ? ' is-wide' : '') +
        (action.className ? ' ' + action.className : '');
      btn.textContent = String(action.label == null ? action.id : action.label);
      if (action.id != null) btn.setAttribute('data-action', String(action.id));
      if (action.elementId != null) btn.id = String(action.elementId);
      if (action.disabled) btn.disabled = true;
      if (action.ariaLabel) btn.setAttribute('aria-label', action.ariaLabel);
      applyAttrs(btn, action.attrs);
      applyDataset(btn, action.dataset);
      if (action.onClick) btn.addEventListener('click', action.onClick);
      else if (opts.onAction) {
        (function (item) {
          btn.addEventListener('click', function () { opts.onAction(item.id, item); });
        })(action);
      }
      el.appendChild(btn);
    });
    if (opts.label) el.setAttribute('aria-label', opts.label);
    return el;
  }

  /* ------------------------------------------------------------------ *
   * Hand layout                                                       *
   * ------------------------------------------------------------------ */

  function readPxVar(el, name) {
    if (!el || !root || !root.getComputedStyle) return 0;
    try {
      var raw = root.getComputedStyle(el).getPropertyValue(name);
      var n = parseFloat(raw);
      return isFinite(n) ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  function childCards(container) {
    var out = [];
    if (!container || !container.children) return out;
    for (var i = 0; i < container.children.length; i++) {
      var child = container.children[i];
      if (child.nodeType === 1) out.push(child);
    }
    return out;
  }

  var HAND_MODES = { row: 1, overlap: 1, fan: 1, scroll: 1, grid: 1 };

  function layoutHand(container, opts) {
    opts = opts || {};
    var mode = HAND_MODES[opts.mode] ? opts.mode : 'row';
    var refresh = function () {};
    var destroy = function () {};
    if (!container || !container.classList) return { refresh: refresh, destroy: destroy, mode: mode };

    var saved = [];
    function remember(el) {
      if (el.__puiHandStyle === undefined) el.__puiHandStyle = el.getAttribute('style');
    }
    function restore(el) {
      if (el.__puiHandStyle === undefined) return;
      if (el.__puiHandStyle === null) el.removeAttribute('style');
      else el.setAttribute('style', el.__puiHandStyle);
      delete el.__puiHandStyle;
    }
    function clearInline() {
      saved.forEach(restore);
      saved = [];
    }

    if (mode === 'fan' && opts.maxFan != null && childCards(container).length > opts.maxFan) mode = 'row';

    container.classList.add('pui-hand', 'pui-hand--' + mode);
    if (opts.className) container.classList.add(opts.className);

    function place() {
      clearInline();
      var cards = childCards(container);
      if (!cards.length) return;
      var n = cards.length;
      var width = container.clientWidth || (container.getBoundingClientRect ? container.getBoundingClientRect().width : 0) || 320;
      var cardWidth = Number(opts.cardWidth) || readPxVar(container, '--pui-card-w') || (cards[0].offsetWidth || 38);
      var gap = opts.gap == null ? readPxVar(container, '--pui-gap') : Number(opts.gap);
      if (!isFinite(gap)) gap = 4;

      if (mode === 'row' || mode === 'scroll' || mode === 'grid') {
        container.style.setProperty('--pui-gap', gap + 'px');
        return;
      }

      var stepRatio = opts.stepRatio == null ? (mode === 'fan' ? 0.82 : 0.72) : Number(opts.stepRatio);
      var minStep = opts.minStep == null ? 10 : Number(opts.minStep);
      var step = Math.max(0, cardWidth * stepRatio);
      if (n > 1) step = Math.min(step, Math.max(minStep, (width - cardWidth) / (n - 1)));
      step = Math.max(minStep, step);
      var overlap = Math.max(0, cardWidth - step);

      cards.forEach(function (card, i) {
        remember(card);
        card.style.position = 'relative';
        card.style.flex = '0 0 auto';
        card.style.marginLeft = i === 0 ? '0' : (-overlap) + 'px';
        card.style.zIndex = String(i + 1);
        if (mode === 'fan') {
          var t = n === 1 ? 0 : (i / (n - 1) - 0.5);
          var arc = opts.arc == null ? 24 : Number(opts.arc);
          var lift = opts.lift == null ? 12 : Number(opts.lift);
          card.style.transform = 'translateY(' + (-(lift * (1 - Math.abs(t) * 2))).toFixed(2) + 'px) rotate(' +
            (t * arc).toFixed(3) + 'deg)';
          card.style.transformOrigin = '50% 100%';
        }
      });
      container.style.setProperty('--pui-gap', '0px');
    }

    var scheduled = false;
    function refreshSoon() {
      if (scheduled) return;
      scheduled = true;
      var raf = root && root.requestAnimationFrame;
      if (typeof raf === 'function') raf(function () { scheduled = false; place(); });
      else { scheduled = false; place(); }
    }

    var observer = null;
    var onResize = null;
    if (opts.watch !== false) {
      if (root && typeof root.ResizeObserver === 'function') {
        observer = new root.ResizeObserver(refreshSoon);
        observer.observe(container);
      } else if (root && root.addEventListener) {
        onResize = refreshSoon;
        root.addEventListener('resize', onResize);
      }
    }

    refresh = function () { place(); return container; };
    destroy = function () {
      if (observer) observer.disconnect();
      if (onResize && root.removeEventListener) root.removeEventListener('resize', onResize);
      clearInline();
      container.classList.remove('pui-hand', 'pui-hand--row', 'pui-hand--overlap',
        'pui-hand--fan', 'pui-hand--scroll', 'pui-hand--grid');
      if (opts.className) container.classList.remove(opts.className);
      container.style.removeProperty('--pui-gap');
    };

    place();
    return { refresh: refresh, destroy: destroy, mode: mode };
  }

  /* ------------------------------------------------------------------ *
   * Motion                                                            *
   * ------------------------------------------------------------------ */

  function rectOf(source) {
    if (!source) return null;
    if (source.nodeType === 1 && source.getBoundingClientRect) {
      try { return source.getBoundingClientRect(); } catch (e) { return null; }
    }
    if (typeof source.left === 'number' && typeof source.top === 'number') return source;
    return null;
  }

  // Visual deal: cards fly from `from` (deck element / rect) to their targets.
  // Resolves false when motion is skipped; never rejects.
  function deal(container, opts) {
    opts = opts || {};
    if (!doc) return Promise.resolve(false);
    var targets = Array.isArray(opts.targets) ? opts.targets.slice() : childCards(container);
    targets = targets.filter(function (el) { return el && el.nodeType === 1; });
    if (!targets.length) return Promise.resolve(false);

    var reduced = opts.reducedMotion === 'off' ? false : prefersReducedMotion();
    if (reduced || typeof targets[0].animate !== 'function') {
      playSfx(opts.sfx === false ? null : (opts.sfx || 'deal'));
      return Promise.resolve(false);
    }

    var from = rectOf(opts.from);
    if (!from) {
      var host = container && container.getBoundingClientRect
        ? container.getBoundingClientRect()
        : { left: 0, top: 0, width: 0, height: 0 };
      from = { left: host.left + host.width / 2 - 20, top: host.top - 48, width: 40, height: 56 };
    }
    var stagger = opts.stagger == null ? 60 : Math.max(0, Number(opts.stagger) || 0);
    var duration = opts.duration == null ? 260 : Math.max(0, Number(opts.duration) || 0);
    var easing = opts.easing || 'cubic-bezier(.2,.9,.25,1.2)';
    playSfx(opts.sfx === false ? null : (opts.sfx || 'deal'));

    var pending = [];
    targets.forEach(function (target, index) {
      pending.push(new Promise(function (resolve) {
        setTimeout(function () {
          var to;
          try { to = target.getBoundingClientRect(); } catch (e) { resolve(false); return; }
          if (!to || !to.width || !to.height) { resolve(false); return; }
          var dx = (from.left + (from.width || 0) / 2) - (to.left + to.width / 2);
          var dy = (from.top + (from.height || 0) / 2) - (to.top + to.height / 2);
          var done = false;
          function finish(value) { if (!done) { done = true; resolve(value); } }
          var anim;
          try {
            anim = target.animate([
              { transform: 'translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px) scale(.92)', opacity: 0 },
              { transform: 'translate(0,0) scale(1)', opacity: 1 }
            ], { duration: duration, easing: easing, fill: 'both' });
          } catch (e) { finish(false); return; }
          anim.onfinish = function () { try { anim.cancel(); } catch (e) {} finish(true); };
          anim.oncancel = function () { finish(false); };
          setTimeout(function () { finish(false); }, duration + 300);
        }, index * stagger);
      }));
    });
    return Promise.all(pending).then(function (results) {
      return results.some(Boolean);
    }, function () { return false; });
  }

  // Flip a card in place. opts: faceUp (default true), duration, faceHtml,
  // backHtml, sfx, reducedMotion:'off' to force motion.
  function flip(el, opts) {
    opts = opts || {};
    if (!el) return Promise.resolve(false);
    var faceUp = opts.faceUp !== false;
    var originalHtml = el.innerHTML;
    var apply = function () {
      if (el.classList) {
        el.classList.toggle('is-back', !faceUp);
        el.classList.toggle('is-face', faceUp);
      }
      if (faceUp) {
        if (opts.faceHtml != null) el.innerHTML = String(opts.faceHtml);
        else el.innerHTML = originalHtml;
      } else if (opts.backHtml != null) {
        el.innerHTML = String(opts.backHtml);
      } else if (doc && !(el.querySelector && el.querySelector('.pui-card__back-mark'))) {
        var mark = doc.createElement('span');
        mark.className = 'pui-card__back-mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = '♠';
        el.innerHTML = '';
        el.appendChild(mark);
      }
    };
    var reduced = opts.reducedMotion === 'off' ? false : prefersReducedMotion();
    var duration = opts.duration == null ? 220 : Math.max(0, Number(opts.duration) || 0);
    if (reduced || !duration || typeof el.animate !== 'function') {
      apply();
      playSfx(opts.sfx === false ? null : (opts.sfx || 'move'));
      return Promise.resolve(false);
    }
    var half = Math.max(50, duration / 2);
    return new Promise(function (resolve) {
      var done = false;
      function finish(value) { if (!done) { done = true; resolve(value); } }
      var out;
      try {
        out = el.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(90deg)' }],
          { duration: half, easing: 'ease-in', fill: 'both' });
      } catch (e) { apply(); finish(false); return; }
      out.onfinish = function () {
        // Release the half-turn fill before the second half starts; otherwise
        // the finished first animation keeps rotateY(90deg) applied.
        out.oncancel = null;
        try { out.cancel(); } catch (e) { /* already finished */ }
        apply();
        var back;
        try {
          back = el.animate([{ transform: 'rotateY(-90deg)' }, { transform: 'rotateY(0deg)' }],
            { duration: half, easing: 'ease-out', fill: 'both' });
        } catch (e) { finish(false); return; }
        back.onfinish = function () { try { back.cancel(); } catch (e) {} finish(true); };
        back.oncancel = function () { finish(false); };
      };
      out.oncancel = function () { apply(); finish(false); };
      setTimeout(function () { finish(false); }, duration + 350);
    });
  }

  /* ------------------------------------------------------------------ *
   * Small utilities                                                   *
   * ------------------------------------------------------------------ */

  function toast(message, opts) {
    opts = opts || {};
    if (!doc) return null;
    var mount = opts.mount || doc.body;
    if (!mount || !mount.appendChild) return null;
    var el = doc.createElement('div');
    el.className = 'pui pui-toast' + (opts.className ? ' ' + opts.className : '');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.textContent = String(message == null ? '' : message);
    mount.appendChild(el);
    var ms = opts.duration == null ? 2200 : Math.max(0, Number(opts.duration) || 0);
    setTimeout(function () {
      try { el.remove(); } catch (e) { if (el.parentNode) el.parentNode.removeChild(el); }
    }, ms);
    return el;
  }

  var tokens = {
    set: function (map) {
      if (!doc || !doc.documentElement || !map) return;
      Object.keys(map).forEach(function (key) {
        doc.documentElement.style.setProperty(key, String(map[key]));
      });
    },
    reset: function (list) {
      if (!doc || !doc.documentElement) return;
      var style = doc.documentElement.style;
      if (Array.isArray(list)) {
        list.forEach(function (key) { style.removeProperty(key); });
        return;
      }
      var names = [];
      for (var i = 0; i < style.length; i++) {
        var name = style.item ? style.item(i) : style[i];
        if (name && name.indexOf('--pui-') === 0) names.push(name);
      }
      names.forEach(function (name) { style.removeProperty(name); });
    }
  };

  return {
    version: VERSION,
    RANKS: RANKS,
    SUITS: SUITS,
    SUIT_SYMBOLS: SUIT_SYMBOLS,
    RANK_LABELS: RANK_LABELS,
    rankLabel: rankLabel,
    suitSymbol: suitSymbol,
    isRed: isRed,
    normalizeCard: normalizeCard,
    renderFace: renderFace,
    createCard: createCard,
    createCardBack: createCardBack,
    createSlot: createSlot,
    createDeckPile: createDeckPile,
    updateDeckPile: updateDeckPile,
    createChipStack: createChipStack,
    createBoard: createBoard,
    createSeat: createSeat,
    createActionBar: createActionBar,
    layoutHand: layoutHand,
    deal: deal,
    flip: flip,
    toast: toast,
    prefersReducedMotion: prefersReducedMotion,
    tokens: tokens
  };
});
