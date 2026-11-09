/* Tool compute core — UMD, zero dependencies, runs in Node and the browser.
 *
 * Each engine below is the same pure <script id="engine"> block that the web
 * page runs (tools/<id>/index.html). The adapters validate a plain input
 * object and map it onto those engine calls, so the CLI, the MCP server and
 * the page cannot drift apart. Rebuild with the generator described in
 * tools/AI-USAGE.md; parity is checked by tools/tests/parity.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.ToolCompute = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = 1;
  var registry = Object.create(null);

  function err(code, message) {
    var e = new Error(message || code);
    e.code = code;
    e.isToolError = true;
    return e;
  }

  function must(condition, code, message) {
    if (!condition) throw err(code, message);
  }

  function okOf(result) {
    if (!result || result.ok !== true) {
      var detail = result && result.error ? String(result.error) : 'engine_error';
      throw err('invalid_input', 'engine: ' + detail);
    }
    return result;
  }

  function roundTo(value, places) {
    if (typeof value !== 'number' || !isFinite(value)) return value;
    var f = Math.pow(10, places);
    var abs = Math.abs(value);
    var r = Math.floor(abs * f + 0.5 + 1e-9) / f;
    return value < 0 ? -r : r;
  }

  function toCents(value) {
    must(typeof value === 'number' && isFinite(value), 'invalid_input', 'amount must be a finite number');
    return Math.round(value * 100);
  }

  function fromCents(value) {
    return value / 100;
  }

  function pad2(value) {
    var s = String(value);
    return s.length < 2 ? '0' + s : s;
  }

  function formatDate(parts) {
    return String(parts.y) + '-' + pad2(parts.m) + '-' + pad2(parts.d);
  }

  function seededRandom(seed) {
    var a = Number(seed) >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function errorResult(e) {
    if (e && e.isToolError) return { ok: false, code: e.code, error: e.message };
    return { ok: false, code: 'internal_error', error: String(e && e.message ? e.message : e) };
  }

  function guard(fn, engine) {
    return function (input) {
      if (input == null) input = {};
      if (typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, code: 'invalid_input', error: 'input must be a JSON object' };
      }
      var out;
      try {
        out = fn(input, engine);
      } catch (e) {
        return errorResult(e);
      }
      if (out && typeof out.then === 'function') {
        return out.then(function (value) {
          return { ok: true, result: value };
        }, errorResult);
      }
      return { ok: true, result: out };
    };
  }

  function def(id, fn, engineId) {
    registry[id] = { run: guard(fn, engines[engineId]) };
  }

  function run(id, input) {
    if (!Object.prototype.hasOwnProperty.call(registry, id)) {
      return { ok: false, code: 'unknown_tool', error: 'unknown tool: ' + id };
    }
    return registry[id].run(input);
  }

  var engines = Object.create(null);

  /* ---- base64-encoder ---- */
  engines["base64-encoder"] = (function () {

var ToolEngine = (function () {
  'use strict';

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function utf8Encode(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        var d = str.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) {
          c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00);
          i++;
        } else {
          c = 0xFFFD;
        }
      } else if (c >= 0xDC00 && c <= 0xDFFF) {
        c = 0xFFFD;
      }
      if (c < 0x80) {
        bytes.push(c);
      } else if (c < 0x800) {
        bytes.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      } else if (c < 0x10000) {
        bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else {
        bytes.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return bytes;
  }

  function utf8Decode(bytes) {
    var out = '';
    var i = 0;
    var n = bytes.length;
    function cont(b) {
      if ((b & 0xC0) !== 0x80) throw new Error('bad_utf8');
      return b;
    }
    while (i < n) {
      var b = bytes[i++];
      var cp;
      if (b < 0x80) {
        cp = b;
      } else if (b >= 0xC2 && b <= 0xDF) {
        if (i >= n) throw new Error('bad_utf8');
        cp = ((b & 0x1F) << 6) | (cont(bytes[i++]) & 0x3F);
      } else if (b >= 0xE0 && b <= 0xEF) {
        if (i + 1 >= n) throw new Error('bad_utf8');
        var b2 = cont(bytes[i++]);
        var b3 = cont(bytes[i++]);
        cp = ((b & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F);
        if (cp < 0x800 || (cp >= 0xD800 && cp <= 0xDFFF)) throw new Error('bad_utf8');
      } else if (b >= 0xF0 && b <= 0xF4) {
        if (i + 2 >= n) throw new Error('bad_utf8');
        var c2 = cont(bytes[i++]);
        var c3 = cont(bytes[i++]);
        var c4 = cont(bytes[i++]);
        cp = ((b & 0x07) << 18) | ((c2 & 0x3F) << 12) | ((c3 & 0x3F) << 6) | (c4 & 0x3F);
        if (cp < 0x10000 || cp > 0x10FFFF) throw new Error('bad_utf8');
      } else {
        throw new Error('bad_utf8');
      }
      if (cp > 0xFFFF) {
        cp -= 0x10000;
        out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      } else {
        out += String.fromCharCode(cp);
      }
    }
    return out;
  }

  function bytesToBase64(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < bytes.length ? bytes[i + 1] : -1;
      var b2 = i + 2 < bytes.length ? bytes[i + 2] : -1;
      out += B64.charAt(b0 >> 2);
      out += B64.charAt(((b0 & 3) << 4) | (b1 < 0 ? 0 : b1 >> 4));
      out += b1 < 0 ? '=' : B64.charAt(((b1 & 15) << 2) | (b2 < 0 ? 0 : b2 >> 6));
      out += b2 < 0 ? '=' : B64.charAt(b2 & 63);
    }
    return out;
  }

  function base64ToBytes(input) {
    if (typeof input !== 'string') throw new Error('bad_input');
    var s = input.replace(/[\r\n\t\f ]+/g, '');
    if (/[^A-Za-z0-9+/=_-]/.test(s)) throw new Error('bad_base64');
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    var pad = 0;
    while (s.length > 0 && s.charAt(s.length - 1) === '=') {
      pad++;
      s = s.slice(0, -1);
    }
    if (pad > 2) throw new Error('bad_base64');
    if (s.indexOf('=') !== -1) throw new Error('bad_base64');
    if (s.length % 4 === 1) throw new Error('bad_base64');
    if (pad > 0 && (s.length % 4) + pad !== 4) throw new Error('bad_base64');
    var bytes = [];
    var buffer = 0;
    var bits = 0;
    for (var i = 0; i < s.length; i++) {
      var value = B64.indexOf(s.charAt(i));
      if (value < 0) throw new Error('bad_base64');
      buffer = (buffer << 6) | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 255);
      }
    }
    if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) throw new Error('bad_base64');
    return bytes;
  }

  function toUrlSafe(b64) {
    return String(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromUrlSafe(value) {
    var s = String(value).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4 !== 0) s += '=';
    return s;
  }

  function encodeUtf8(text, opts) {
    opts = opts || {};
    if (typeof text !== 'string') return { ok: false, error: 'bad_input' };
    var bytes = utf8Encode(text);
    var b64 = bytesToBase64(bytes);
    if (opts.urlSafe) b64 = toUrlSafe(b64);
    return { ok: true, value: b64, bytes: bytes.length };
  }

  function decodeUtf8(value) {
    if (typeof value !== 'string') return { ok: false, error: 'bad_input' };
    var bytes;
    try {
      bytes = base64ToBytes(value);
    } catch (e) {
      return { ok: false, error: 'bad_base64' };
    }
    try {
      return { ok: true, value: utf8Decode(bytes), bytes: bytes.length };
    } catch (e) {
      return { ok: false, error: 'bad_utf8' };
    }
  }

  return {
    utf8Encode: utf8Encode,
    utf8Decode: utf8Decode,
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    toUrlSafe: toUrlSafe,
    fromUrlSafe: fromUrlSafe,
    encodeUtf8: encodeUtf8,
    decodeUtf8: decodeUtf8
  };
})();

  return ToolEngine;
  })();

  /* ---- case-converter ---- */
  engines["case-converter"] = (function () {

var ToolEngine = (function () {
  'use strict';

  var MINOR = ['a','an','and','as','at','but','by','for','from','in','into','nor','of','on','onto','or','over','per','the','to','up','via','with','vs'];
  var LIMIT = 200000;

  function isStr(s) { return typeof s === 'string'; }

  function normalize(s) {
    try { return s.normalize ? s.normalize('NFC') : s; } catch (e) { return s; }
  }

  function tokenize(s) {
    if (!isStr(s)) return [];
    var t = normalize(s);
    t = t.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2');
    t = t.replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2');
    return t.split(/[^\p{L}\p{N}\p{M}]+/u).filter(function (w) { return w.length > 0; });
  }

  function hasLower(w) { return /\p{Ll}/u.test(w); }
  function hasUpper(w) { return /\p{Lu}/u.test(w); }
  function isAcronym(w) { return hasUpper(w) && !hasLower(w); }

  function cap(w) {
    if (!w) return '';
    var chars = Array.from(w);
    return chars[0].toUpperCase() + chars.slice(1).join('').toLowerCase();
  }

  function toLower(s) {
    if (!isStr(s)) return '';
    return s.toLowerCase();
  }

  function toUpper(s) {
    if (!isStr(s)) return '';
    return s.toUpperCase();
  }

  function toCamel(s) {
    if (!isStr(s)) return '';
    var words = tokenize(s);
    if (!words.length) return '';
    return words.map(function (w, i) {
      if (i === 0) return w.toLowerCase();
      return isAcronym(w) ? w : cap(w);
    }).join('');
  }

  function toPascal(s) {
    if (!isStr(s)) return '';
    var words = tokenize(s);
    if (!words.length) return '';
    return words.map(function (w) {
      return isAcronym(w) ? w : cap(w);
    }).join('');
  }

  function toSnake(s) {
    if (!isStr(s)) return '';
    return tokenize(s).map(function (w) { return w.toLowerCase(); }).join('_');
  }

  function toKebab(s) {
    if (!isStr(s)) return '';
    return tokenize(s).map(function (w) { return w.toLowerCase(); }).join('-');
  }

  function toConstant(s) {
    if (!isStr(s)) return '';
    return tokenize(s).map(function (w) { return w.toUpperCase(); }).join('_');
  }

  function toAlternating(s) {
    if (!isStr(s)) return '';
    var out = '';
    var count = 0;
    var chars = Array.from(s);
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      var lo = ch.toLowerCase();
      var up = ch.toUpperCase();
      if (lo !== up) {
        out += (count % 2 === 0) ? lo : up;
        count++;
      } else {
        out += ch;
      }
    }
    return out;
  }

  function toTitle(s) {
    if (!isStr(s)) return '';
    var words = tokenize(s);
    return words.map(function (w, i) {
      if (isAcronym(w)) return w;
      if (i > 0 && i < words.length - 1 && MINOR.indexOf(w.toLowerCase()) !== -1) {
        return w.toLowerCase();
      }
      return cap(w);
    }).join(' ');
  }

  function toSentence(s) {
    if (!isStr(s)) return '';
    var lower = s.toLowerCase();
    var out = '';
    var capNext = true;
    var chars = Array.from(lower);
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (capNext && /\p{L}/u.test(ch)) {
        out += ch.toUpperCase();
        capNext = false;
      } else {
        out += ch;
      }
      if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') capNext = true;
    }
    return out;
  }

  function stats(s) {
    if (!isStr(s)) s = '';
    var chars = Array.from(s).length;
    var noSpace = Array.from(s.replace(/\s+/gu, '')).length;
    var sentences = s.split(/[.!?…。！？]+/).filter(function (part) {
      return part.trim().length > 0;
    }).length;
    return {
      chars: chars,
      charsNoSpace: noSpace,
      words: tokenize(s).length,
      sentences: sentences,
      lines: s.length === 0 ? 0 : s.split(/\r\n|\r|\n/).length
    };
  }

  var FORMATS = {
    sentence: toSentence,
    title: toTitle,
    upper: toUpper,
    lower: toLower,
    camel: toCamel,
    pascal: toPascal,
    snake: toSnake,
    kebab: toKebab,
    constant: toConstant,
    alternating: toAlternating
  };

  function convert(mode, text) {
    if (!isStr(text)) return { ok: false, error: 'bad_input' };
    if (!Object.prototype.hasOwnProperty.call(FORMATS, mode)) return { ok: false, error: 'bad_mode' };
    if (text.length > LIMIT) return { ok: false, error: 'too_long' };
    return { ok: true, value: FORMATS[mode](text) };
  }

  return {
    tokenize: tokenize,
    toSentence: toSentence,
    toTitle: toTitle,
    toUpper: toUpper,
    toLower: toLower,
    toCamel: toCamel,
    toPascal: toPascal,
    toSnake: toSnake,
    toKebab: toKebab,
    toConstant: toConstant,
    toAlternating: toAlternating,
    convert: convert,
    stats: stats
  };
})();

  return ToolEngine;
  })();

  /* ---- slug-generator ---- */
  engines["slug-generator"] = (function () {

var ToolEngine = (function () {
  'use strict';

  var STOP = {
    a: 1, an: 1, and: 1, are: 1, as: 1, at: 1, be: 1, but: 1, by: 1, for: 1,
    from: 1, has: 1, he: 1, in: 1, is: 1, it: 1, its: 1, of: 1, on: 1, or: 1,
    that: 1, the: 1, to: 1, was: 1, were: 1, will: 1, with: 1, you: 1, your: 1
  };

  function trimSep(s, sep) {
    while (s.length >= sep.length && s.slice(0, sep.length) === sep) s = s.slice(sep.length);
    while (s.length >= sep.length && s.slice(-sep.length) === sep) s = s.slice(0, -sep.length);
    return s;
  }

  function isStopWord(word) {
    return Object.prototype.hasOwnProperty.call(STOP, word);
  }

  function slugify(text, opts) {
    opts = opts || {};
    if (typeof text !== 'string') return { ok: false, error: 'bad_input' };
    var sep = opts.separator == null ? '-' : opts.separator;
    if (sep !== '-' && sep !== '_' && sep !== '.') return { ok: false, error: 'bad_separator' };
    var max = opts.maxLength == null ? 0 : opts.maxLength;
    if (typeof max !== 'number' || !isFinite(max) || Math.floor(max) !== max || max < 0 || max > 200) {
      return { ok: false, error: 'bad_length' };
    }
    var keepUnicode = opts.keepUnicode !== false;

    var s = text;
    try { s = s.normalize ? s.normalize('NFKC') : s; } catch (e) { /* keep original */ }
    s = s.toLowerCase();
    s = s.replace(/['‘’ʼ]/g, '');

    if (keepUnicode) {
      s = s.replace(/[^\p{L}\p{N}]+/gu, sep);
    } else {
      try { s = s.normalize('NFD').replace(/\p{M}+/gu, ''); } catch (e) { /* keep original */ }
      s = s.replace(/[^a-z0-9]+/g, sep);
    }

    var tokens = s.split(sep).filter(function (w) { return w.length > 0; });
    if (opts.stopWords) {
      tokens = tokens.filter(function (w) { return !isStopWord(w); });
    }
    s = tokens.join(sep);

    if (max > 0 && Array.from(s).length > max) {
      var cut = Array.from(s).slice(0, max).join('');
      var at = cut.lastIndexOf(sep);
      if (at > 0 && s.charAt(max) !== sep) cut = cut.slice(0, at);
      s = trimSep(cut, sep);
    }

    return { ok: true, value: s, tokens: tokens.length };
  }

  function tokenize(text, opts) {
    opts = opts || {};
    var result = slugify(text, { separator: '-', keepUnicode: opts.keepUnicode, stopWords: false, maxLength: 0 });
    if (!result.ok) return [];
    return result.value === '' ? [] : result.value.split('-');
  }

  return {
    slugify: slugify,
    tokenize: tokenize,
    isStopWord: isStopWord
  };
})();

  return ToolEngine;
  })();

  /* ---- url-encoder ---- */
  engines["url-encoder"] = (function () {

var ToolEngine = (function () {
  'use strict';

  function percentError(value) {
    for (var i = 0; i < value.length; i++) {
      if (value.charAt(i) === '%') {
        var pair = value.slice(i + 1, i + 3);
        if (!/^[0-9A-Fa-f]{2}$/.test(pair)) return i;
        i += 2;
      }
    }
    return -1;
  }

  function encodeComponent(value) {
    if (typeof value !== 'string') return { ok: false, error: 'bad_input' };
    try {
      return { ok: true, value: encodeURIComponent(value) };
    } catch (e) {
      return { ok: false, error: 'bad_input' };
    }
  }

  function encodeUri(value) {
    if (typeof value !== 'string') return { ok: false, error: 'bad_input' };
    try {
      return { ok: true, value: encodeURI(value) };
    } catch (e) {
      return { ok: false, error: 'bad_input' };
    }
  }

  function decodeComponent(value) {
    if (typeof value !== 'string') return { ok: false, error: 'bad_input' };
    var position = percentError(value);
    if (position !== -1) return { ok: false, error: 'bad_percent', position: position };
    try {
      return { ok: true, value: decodeURIComponent(value.replace(/\+/g, ' ')) };
    } catch (e) {
      return { ok: false, error: 'bad_percent' };
    }
  }

  function decodeUri(value) {
    if (typeof value !== 'string') return { ok: false, error: 'bad_input' };
    var position = percentError(value);
    if (position !== -1) return { ok: false, error: 'bad_percent', position: position };
    try {
      return { ok: true, value: decodeURI(value) };
    } catch (e) {
      return { ok: false, error: 'bad_percent' };
    }
  }

  function parseQuery(query) {
    if (typeof query !== 'string') return { ok: false, error: 'bad_input' };
    var value = query.charAt(0) === '?' ? query.slice(1) : query;
    var params = [];
    if (value === '') return { ok: true, params: params };
    var parts = value.split('&');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (part === '') continue;
      var eq = part.indexOf('=');
      var rawKey = eq === -1 ? part : part.slice(0, eq);
      var rawValue = eq === -1 ? '' : part.slice(eq + 1);
      var key = decodeComponent(rawKey);
      if (!key.ok) return key;
      var val = decodeComponent(rawValue);
      if (!val.ok) return val;
      params.push({ key: key.value, value: val.value });
    }
    return { ok: true, params: params };
  }

  function buildQuery(pairs) {
    if (!Array.isArray(pairs)) return { ok: false, error: 'bad_input' };
    var parts = [];
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i];
      if (!pair || typeof pair.key !== 'string') return { ok: false, error: 'bad_input' };
      var key;
      var value;
      try {
        key = encodeURIComponent(pair.key);
        value = encodeURIComponent(pair.value == null ? '' : String(pair.value));
      } catch (e) {
        return { ok: false, error: 'bad_input' };
      }
      parts.push(key + '=' + value);
    }
    return { ok: true, value: parts.join('&'), params: parts.length };
  }

  function parseUrl(input) {
    if (typeof input !== 'string') return { ok: false, error: 'bad_input' };
    var rest = input.trim();
    if (!rest) return { ok: false, error: 'empty_input' };

    var protocol = '';
    var username = '';
    var password = '';
    var host = '';
    var port = '';
    var path = '';
    var query = '';
    var hash = '';
    var params = [];

    var scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(rest);
    if (scheme) {
      protocol = scheme[1].toLowerCase();
      rest = rest.slice(scheme[0].length);
    }

    if (rest.slice(0, 2) === '//') {
      rest = rest.slice(2);
      var authorityEnd = rest.search(/[/?#]/);
      var authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
      rest = authorityEnd === -1 ? '' : rest.slice(authorityEnd);

      var at = authority.lastIndexOf('@');
      var hostport = authority;
      if (at !== -1) {
        var userinfo = authority.slice(0, at);
        hostport = authority.slice(at + 1);
        var userColon = userinfo.indexOf(':');
        if (userColon === -1) {
          username = userinfo;
        } else {
          username = userinfo.slice(0, userColon);
          password = userinfo.slice(userColon + 1);
        }
      }
      if (hostport.charAt(0) === '[') {
        var close = hostport.indexOf(']');
        if (close !== -1) {
          host = hostport.slice(0, close + 1);
          if (hostport.charAt(close + 1) === ':') port = hostport.slice(close + 2);
        } else {
          host = hostport;
        }
      } else {
        var colon = hostport.lastIndexOf(':');
        if (colon !== -1 && /^\d*$/.test(hostport.slice(colon + 1))) {
          host = hostport.slice(0, colon);
          port = hostport.slice(colon + 1);
        } else {
          host = hostport;
        }
      }
    }

    var hashAt = rest.indexOf('#');
    if (hashAt !== -1) {
      hash = rest.slice(hashAt + 1);
      rest = rest.slice(0, hashAt);
    }
    var queryAt = rest.indexOf('?');
    var hadQuery = queryAt !== -1;
    if (hadQuery) {
      query = rest.slice(queryAt + 1);
      rest = rest.slice(0, queryAt);
    }
    path = rest;

    if (hadQuery) {
      var parsed = parseQuery(query);
      if (!parsed.ok) return parsed;
      params = parsed.params;
    }

    return {
      ok: true,
      protocol: protocol,
      username: username,
      password: password,
      host: host,
      port: port,
      path: path,
      query: query,
      hash: hash,
      params: params,
      hasQuery: hadQuery
    };
  }

  return {
    percentError: percentError,
    encodeComponent: encodeComponent,
    encodeUri: encodeUri,
    decodeComponent: decodeComponent,
    decodeUri: decodeUri,
    parseQuery: parseQuery,
    buildQuery: buildQuery,
    parseUrl: parseUrl
  };
})();

  return ToolEngine;
  })();

  /* ---- html-entity-encoder ---- */
  engines["html-entity-encoder"] = (function () {

var ToolEngine = (function () {
  'use strict';

  // TOOL_ENGINE_START
  var NAMED = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  var NUMERIC = { '&': '&#38;', '<': '&#60;', '>': '&#62;', '"': '&#34;', "'": '&#39;' };
  var DECODE = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    nbsp: ' ', copy: '©', reg: '®', trade: '™',
    hellip: '…', mdash: '—', ndash: '–',
    laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’',
    ldquo: '“', rdquo: '”', euro: '€', pound: '£',
    yen: '¥', cent: '¢', sect: '§', deg: '°',
    times: '×', divide: '÷', middot: '·', bull: '•', shy: '­'
  };
  var MODES = { named: 1, numeric: 1, all: 1 };

  function fail(code) {
    return { ok: false, error: code };
  }

  function isText(s) {
    return typeof s === 'string';
  }

  // Escape one code point at a time so surrogate pairs stay intact.
  function escapeHtml(input, mode, nonAscii) {
    if (!isText(input)) return fail('bad_value');
    var m = mode == null ? 'named' : mode;
    if (!MODES[m]) return fail('bad_mode');
    var extra = !!nonAscii && m !== 'all';
    var table = m === 'numeric' ? NUMERIC : NAMED;
    var out = '';
    for (var i = 0; i < input.length; i++) {
      var ch = input.charAt(i);
      var cp = input.codePointAt(i);
      if (cp > 0xffff) i++;
      if (m === 'all') {
        out += '&#' + cp + ';';
      } else if (table[ch]) {
        out += table[ch];
      } else if (extra && cp > 127) {
        out += '&#' + cp + ';';
      } else {
        out += String.fromCodePoint(cp);
      }
    }
    return { ok: true, value: out };
  }

  function entityFromCode(code) {
    if (!isFinite(code) || code < 0 || code > 0x10ffff) return null;
    if (code >= 0xd800 && code <= 0xdfff) return null;
    return String.fromCodePoint(code);
  }

  // Single pass: &amp;lt; becomes &lt;, never <. Unknown entities stay literal.
  function unescapeHtml(input) {
    if (!isText(input)) return fail('bad_value');
    var out = input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, function (all, body) {
      if (body.charAt(0) === '#') {
        var code;
        if (body.charAt(1) === 'x' || body.charAt(1) === 'X') {
          code = parseInt(body.slice(2), 16);
        } else {
          code = parseInt(body.slice(1), 10);
        }
        var ch = entityFromCode(code);
        return ch == null ? all : ch;
      }
      var named = DECODE[body.toLowerCase()];
      return named == null ? all : named;
    });
    return { ok: true, value: out };
  }

  // Convert every code point to a decimal numeric entity.
  function toNumericEntities(input) {
    if (!isText(input)) return fail('bad_value');
    var out = '';
    for (var i = 0; i < input.length; i++) {
      var cp = input.codePointAt(i);
      if (cp > 0xffff) i++;
      out += '&#' + cp + ';';
    }
    return { ok: true, value: out };
  }

  function normalizeEntities(input, mode, nonAscii) {
    var decoded = unescapeHtml(input);
    if (!decoded.ok) return decoded;
    return escapeHtml(decoded.value, mode, nonAscii);
  }

  // Count entity-looking sequences (used for the double-escaping warning).
  function detectEntities(input) {
    if (!isText(input)) return fail('bad_value');
    var matches = input.match(/&(?:#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g) || [];
    var names = [];
    for (var i = 0; i < matches.length && names.length < 8; i++) names.push(matches[i]);
    return { ok: true, count: matches.length, names: names };
  }
  // TOOL_ENGINE_END

  return {
    escapeHtml: escapeHtml,
    unescapeHtml: unescapeHtml,
    toNumericEntities: toNumericEntities,
    normalizeEntities: normalizeEntities,
    detectEntities: detectEntities
  };
})();

  return ToolEngine;
  })();

  /* ---- csv-to-json ---- */
  engines["csv-to-json"] = (function () {

var ToolEngine = (function () {
  'use strict';

  function fail(code) { return { ok: false, error: code }; }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  /* Parse RFC 4180 style CSV. Rows carry their starting line for error hints. */
  function parseCsv(text, opts) {
    opts = opts || {};
    var delimiter = opts.delimiter == null ? ',' : String(opts.delimiter);
    if (typeof text !== 'string') return fail('invalid_input');
    if (delimiter.length !== 1) return fail('bad_delimiter');

    var source = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    var rows = [];
    var cells = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    var line = 1;
    var column = 1;
    var rowLine = 1;
    var quoteLine = 1;
    var quoteColumn = 1;

    function pushRow() {
      cells.push(field);
      rows.push({ cells: cells, line: rowLine });
      cells = [];
      field = '';
    }

    while (i < source.length) {
      var ch = source.charAt(i);

      if (inQuotes) {
        if (ch === '"') {
          if (source.charAt(i + 1) === '"') {
            field += '"';
            i += 2;
            column += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          column += 1;
          continue;
        }
        if (ch === '\r' && source.charAt(i + 1) === '\n') {
          field += '\n';
          i += 2;
          line += 1;
          column = 1;
          continue;
        }
        if (ch === '\n' || ch === '\r') {
          field += '\n';
          i += 1;
          line += 1;
          column = 1;
          continue;
        }
        field += ch;
        i += 1;
        column += 1;
        continue;
      }

      if (ch === '"') {
        if (field === '') {
          inQuotes = true;
          quoteLine = line;
          quoteColumn = column;
          i += 1;
          column += 1;
          continue;
        }
        return { ok: false, error: 'bad_quote', line: line, column: column };
      }

      if (ch === delimiter) {
        cells.push(field);
        field = '';
        i += 1;
        column += 1;
        continue;
      }

      if (ch === '\r' || ch === '\n') {
        pushRow();
        if (ch === '\r' && source.charAt(i + 1) === '\n') { i += 2; } else { i += 1; }
        line += 1;
        column = 1;
        rowLine = line;
        continue;
      }

      field += ch;
      i += 1;
      column += 1;
    }

    if (inQuotes) {
      return { ok: false, error: 'unclosed_quote', line: quoteLine, column: quoteColumn };
    }
    if (field !== '' || cells.length > 0) pushRow();
    return { ok: true, rows: rows };
  }

  /* Infer JSON scalar types without losing big integer precision. */
  function inferValue(value) {
    if (typeof value !== 'string') return value;
    var text = value.trim();
    if (text === '') return '';
    if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
    if (/^null$/i.test(text)) return null;

    if (/^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) {
      if (/^[+-]?\d+$/.test(text)) {
        var digits = text.replace(/^[+-]/, '').replace(/^0+/, '');
        if (digits.length > 15) return value;
      }
      var number = Number(text);
      if (isFinite(number)) return number;
    }
    return value;
  }

  function normalizeHeader(rawCells, warnings) {
    var used = Object.create(null);
    var header = [];
    for (var i = 0; i < rawCells.length; i++) {
      var name = String(rawCells[i] == null ? '' : rawCells[i]).trim();
      if (name === '') {
        name = 'column_' + (i + 1);
        warnings.push({ type: 'empty_header', name: name });
      }
      var candidate = name;
      var suffix = 2;
      while (used[candidate]) {
        candidate = name + '_' + suffix;
        suffix += 1;
      }
      if (candidate !== name) {
        warnings.push({ type: 'duplicate_header', name: name, as: candidate });
      }
      used[candidate] = true;
      header.push(candidate);
    }
    return header;
  }

  function deepSet(root, path, value, warnings) {
    var parts = String(path).split('.').filter(function (part) { return part !== ''; });
    if (parts.length === 0) { root[path] = value; return; }
    var current = root;
    for (var i = 0; i < parts.length; i++) {
      var key = parts[i];
      if (i === parts.length - 1) { current[key] = value; return; }
      var next = current[key];
      if (!isObject(next)) {
        if (next !== undefined) {
          warnings.push({ type: 'nested_conflict', key: parts.slice(0, i + 1).join('.') });
        }
        next = Object.create(null);
        current[key] = next;
      }
      current = next;
    }
  }

  function toJson(rows, opts) {
    opts = opts || {};
    if (!Array.isArray(rows)) return fail('invalid_input');
    var hasHeader = opts.hasHeader !== false;
    var inferTypes = opts.inferTypes === true;
    var nested = opts.nested === true;
    var warnings = [];

    if (rows.length === 0) {
      return { ok: true, data: [], warnings: warnings, columns: [] };
    }

    var header = null;
    var columns = 0;
    var start = 0;
    if (hasHeader) {
      header = normalizeHeader(rows[0].cells, warnings);
      columns = header.length;
      start = 1;
    } else {
      for (var r = 0; r < rows.length; r++) {
        columns = Math.max(columns, rows[r].cells.length);
      }
    }

    var output = [];
    for (var rowIndex = start; rowIndex < rows.length; rowIndex++) {
      var row = rows[rowIndex];
      var values = row.cells.slice();
      if (values.length > columns) {
        warnings.push({ type: 'extra_cells', line: row.line, n: values.length - columns });
      }
      if (inferTypes) {
        values = values.map(inferValue);
      }
      if (!hasHeader) {
        while (values.length < columns) values.push('');
        output.push(values.slice(0, columns));
        continue;
      }
      var object = Object.create(null);
      for (var col = 0; col < columns; col++) {
        var value = col < values.length ? values[col] : '';
        var key = header[col];
        if (nested && key.indexOf('.') !== -1) {
          deepSet(object, key, value, warnings);
        } else {
          object[key] = value;
        }
      }
      output.push(object);
    }

    return { ok: true, data: output, warnings: warnings, columns: header || [] };
  }

  return {
    parseCsv: parseCsv,
    inferValue: inferValue,
    toJson: toJson
  };
})();

  return ToolEngine;
  })();

  /* ---- json-to-csv ---- */
  engines["json-to-csv"] = (function () {

var ToolEngine = (function () {
  'use strict';

  function fail(code) { return { ok: false, error: code }; }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function locateJsonError(text, message) {
    var match = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message);
    if (match) return { line: Number(match[1]), column: Number(match[2]) };
    match = /position\s+(\d+)/i.exec(message);
    if (!match) return { line: 1, column: 1 };
    var position = Number(match[1]);
    if (!isFinite(position) || position < 0) position = 0;
    var line = 1;
    var column = 1;
    for (var i = 0; i < position && i < text.length; i++) {
      if (text.charAt(i) === '\n') { line += 1; column = 1; } else { column += 1; }
    }
    return { line: line, column: column };
  }

  function parseJson(text) {
    if (typeof text !== 'string') return fail('invalid_input');
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (error) {
      var at = locateJsonError(text, String(error && error.message));
      return { ok: false, error: 'invalid_json', line: at.line, column: at.column };
    }
  }

  function flatten(value, prefix, out) {
    if (value === null || typeof value !== 'object') {
      out[prefix || 'value'] = value;
      return out;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        out[prefix || 'value'] = '[]';
        return out;
      }
      for (var i = 0; i < value.length; i++) {
        flatten(value[i], prefix ? prefix + '.' + i : String(i), out);
      }
      return out;
    }
    var keys = Object.keys(value);
    if (keys.length === 0) {
      out[prefix || 'value'] = '{}';
      return out;
    }
    for (var k = 0; k < keys.length; k++) {
      flatten(value[keys[k]], prefix ? prefix + '.' + keys[k] : keys[k], out);
    }
    return out;
  }

  function flattenObject(row) {
    var out = Object.create(null);
    flatten(row, '', out);
    return out;
  }

  function collectKeys(rows, flattenNested) {
    var seen = Object.create(null);
    var columns = [];
    function add(key) {
      if (!seen[key]) { seen[key] = true; columns.push(key); }
    }
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (flattenNested) {
        var flat = flattenObject(row);
        Object.keys(flat).forEach(add);
      } else if (isObject(row)) {
        Object.keys(row).forEach(add);
      } else {
        add('value');
      }
    }
    return columns;
  }

  function escapeCell(value, delimiter) {
    if (value === null || value === undefined) return '';
    var text;
    if (typeof value === 'object') {
      try { text = JSON.stringify(value); } catch (error) { text = String(value); }
    } else {
      text = String(value);
    }
    var mustQuote = text.indexOf('"') !== -1 ||
      text.indexOf('\n') !== -1 || text.indexOf('\r') !== -1 ||
      text.indexOf(delimiter) !== -1 || /^\s|\s$/.test(text);
    if (!mustQuote) return text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function toCsv(rows, opts) {
    opts = opts || {};
    if (!Array.isArray(rows)) return fail('not_array');
    var delimiter = opts.delimiter == null ? ',' : String(opts.delimiter);
    if (delimiter.length !== 1) return fail('bad_delimiter');
    var flattenNested = opts.flatten !== false;
    var includeHeader = opts.header !== false;
    var bom = opts.bom === true;
    var prefix = bom ? '﻿' : '';

    if (rows.length === 0) {
      return { ok: true, csv: prefix, columns: [], rowCount: 0, warnings: [] };
    }

    var columns = collectKeys(rows, flattenNested);
    if (columns.length === 0) {
      return { ok: true, csv: prefix, columns: [], rowCount: rows.length, warnings: [] };
    }

    var lines = [];
    if (includeHeader) {
      lines.push(columns.map(function (column) { return escapeCell(column, delimiter); }).join(delimiter));
    }
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var flat;
      if (flattenNested) {
        flat = flattenObject(row);
      } else if (isObject(row)) {
        flat = row;
      } else {
        flat = { value: row };
      }
      var cells = [];
      for (var c = 0; c < columns.length; c++) {
        var key = columns[c];
        var value = Object.prototype.hasOwnProperty.call(flat, key) ? flat[key] : '';
        cells.push(escapeCell(value, delimiter));
      }
      lines.push(cells.join(delimiter));
    }

    return {
      ok: true,
      csv: prefix + lines.join('\r\n') + '\r\n',
      columns: columns,
      rowCount: rows.length,
      warnings: []
    };
  }

  return {
    parseJson: parseJson,
    locateJsonError: locateJsonError,
    flatten: flatten,
    flattenObject: flattenObject,
    collectKeys: collectKeys,
    escapeCell: escapeCell,
    toCsv: toCsv
  };
})();

  return ToolEngine;
  })();

  /* ---- json-formatter ---- */
  engines["json-formatter"] = (function () {

var ToolEngine = (function () {
  'use strict';

  var MAX_BYTES = 5 * 1024 * 1024;

  function byteLength(value) {
    var str = typeof value === 'string' ? value : (value == null ? '' : String(value));
    var bytes = 0;
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
        var next = str.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          bytes += 4;
          i++;
        } else {
          bytes += 3;
        }
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  function isTooLarge(value) {
    return byteLength(value) > MAX_BYTES;
  }

  function errorResult(code, message, text, position) {
    var line = 1;
    var column = 1;
    var lineText = '';
    var caret = '^';
    if (text && typeof text === 'string' && typeof position === 'number') {
      var start = 0;
      for (var i = 0; i < position && i < text.length; i++) {
        if (text.charCodeAt(i) === 10) {
          line++;
          start = i + 1;
        }
      }
      column = position - start + 1;
      if (column < 1) column = 1;
      var end = text.indexOf('\n', start);
      if (end < 0) end = text.length;
      lineText = text.slice(start, end);
      if (lineText.charAt(lineText.length - 1) === '\r') lineText = lineText.slice(0, -1);
      caret = caretFor(lineText, column);
    }
    return {
      ok: false,
      error: code,
      message: message,
      line: line,
      column: column,
      position: typeof position === 'number' ? position : 0,
      lineText: lineText,
      caret: caret
    };
  }

  function caretFor(lineText, column) {
    var out = '';
    var limit = Math.max(0, column - 1);
    for (var i = 0; i < limit; i++) {
      out += lineText.charAt(i) === '\t' ? '\t' : ' ';
    }
    return out + '^';
  }

  function codePoints(str) {
    return Array.from ? Array.from(str) : str.split('');
  }

  function compareCodePoints(a, b) {
    var ai = codePoints(String(a));
    var bi = codePoints(String(b));
    var n = Math.min(ai.length, bi.length);
    for (var i = 0; i < n; i++) {
      var ac = ai[i].codePointAt(0);
      var bc = bi[i].codePointAt(0);
      if (ac !== bc) return ac < bc ? -1 : 1;
    }
    return ai.length - bi.length;
  }

  function positionFromLineColumn(text, line, column) {
    var current = 1;
    var start = 0;
    for (var i = 0; i < text.length && current < line; i++) {
      if (text.charCodeAt(i) === 10) {
        current++;
        start = i + 1;
      }
    }
    return Math.min(text.length, start + Math.max(0, column - 1));
  }

  function lineStartAt(text, line) {
    var current = 1;
    var start = 0;
    for (var i = 0; i < text.length && current < line; i++) {
      if (text.charCodeAt(i) === 10) {
        current++;
        start = i + 1;
      }
    }
    return start;
  }

  function locateError(text, error) {
    var source = typeof text === 'string' ? text : '';
    var message = error && error.message ? String(error.message) : String(error == null ? '' : error);
    var position = -1;
    var line = -1;
    var column = -1;

    var positionMatch = message.match(/position\s+(\d+)/i);
    if (positionMatch) position = parseInt(positionMatch[1], 10);

    var lineColumnMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
    if (lineColumnMatch) {
      line = parseInt(lineColumnMatch[1], 10);
      column = parseInt(lineColumnMatch[2], 10);
    }

    if (position < 0 && line > 0 && column > 0) {
      position = positionFromLineColumn(source, line, column);
    }
    if (position < 0) {
      position = /unexpected end|end of json/i.test(message) ? source.length : 0;
    }
    if (position > source.length) position = source.length;
    if (position < 0) position = 0;

    var computedLine = 1;
    var computedStart = 0;
    for (var i = 0; i < position; i++) {
      if (source.charCodeAt(i) === 10) {
        computedLine++;
        computedStart = i + 1;
      }
    }
    if (line < 1) line = computedLine;
    if (column < 1) column = position - computedStart + 1;
    if (column < 1) column = 1;

    var start = lineStartAt(source, line);
    var end = source.indexOf('\n', start);
    if (end < 0) end = source.length;
    var lineText = source.slice(start, end);
    if (lineText.charAt(lineText.length - 1) === '\r') lineText = lineText.slice(0, -1);

    return {
      message: message,
      position: position,
      line: line,
      column: column,
      lineText: lineText,
      caret: caretFor(lineText, column)
    };
  }

  function validate(text) {
    if (typeof text !== 'string') {
      return errorResult('type', 'Input must be a string', '', 0);
    }
    if (text.replace(/\s/g, '') === '') {
      return errorResult('empty', 'Empty input', text, 0);
    }
    if (isTooLarge(text)) {
      return errorResult('too_large', 'Input exceeds 5 MB', '', 0);
    }
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (error) {
      var location = locateError(text, error);
      return {
        ok: false,
        error: 'invalid',
        message: location.message,
        position: location.position,
        line: location.line,
        column: location.column,
        lineText: location.lineText,
        caret: location.caret
      };
    }
  }

  function sortDeep(value) {
    if (Array.isArray(value)) {
      var array = [];
      for (var i = 0; i < value.length; i++) array.push(sortDeep(value[i]));
      return array;
    }
    if (value && typeof value === 'object') {
      var object = Object.create(null);
      var keys = Object.keys(value).sort(compareCodePoints);
      for (var j = 0; j < keys.length; j++) {
        object[keys[j]] = sortDeep(value[keys[j]]);
      }
      return object;
    }
    return value;
  }

  function indentUnit(indent) {
    if (indent === 'tab' || indent === '\t' || indent === 'tabs') return '\t';
    var count = Number(indent);
    if (!isFinite(count)) count = 2;
    count = Math.floor(count);
    if (count < 0) count = 0;
    if (count > 10) count = 10;
    var unit = '';
    for (var i = 0; i < count; i++) unit += ' ';
    return unit;
  }

  function stringifySorted(value, unit) {
    function render(item, depth) {
      if (item === null) return 'null';
      if (typeof item === 'string') return JSON.stringify(item);
      if (typeof item === 'boolean') return item ? 'true' : 'false';
      if (typeof item === 'number') return isFinite(item) ? String(item) : 'null';
      if (Array.isArray(item)) {
        if (!item.length) return '[]';
        var arrayPad = repeat(unit, depth + 1);
        var arrayClose = repeat(unit, depth);
        var parts = [];
        for (var i = 0; i < item.length; i++) {
          parts.push(arrayPad + render(item[i], depth + 1));
        }
        return '[\n' + parts.join(',\n') + '\n' + arrayClose + ']';
      }
      if (item && typeof item === 'object') {
        var keys = Object.keys(item).sort(compareCodePoints);
        if (!keys.length) return '{}';
        var objectPad = repeat(unit, depth + 1);
        var objectClose = repeat(unit, depth);
        var members = [];
        for (var j = 0; j < keys.length; j++) {
          members.push(objectPad + JSON.stringify(keys[j]) + ': ' + render(item[keys[j]], depth + 1));
        }
        return '{\n' + members.join(',\n') + '\n' + objectClose + '}';
      }
      return 'null';
    }
    return render(value, 0);
  }

  function repeat(unit, count) {
    var out = '';
    for (var i = 0; i < count; i++) out += unit;
    return out;
  }

  function formatJson(text, options) {
    var result = validate(text);
    if (!result.ok) return result;
    var opts = options || {};
    var unit = indentUnit(opts.indent);
    var value = opts.sortKeys ? sortDeep(result.value) : result.value;
    try {
      var output = opts.sortKeys
        ? stringifySorted(result.value, unit)
        : JSON.stringify(result.value, null, unit);
      return { ok: true, text: output, value: value };
    } catch (error) {
      return {
        ok: false,
        error: 'stringify',
        message: String(error && error.message ? error.message : error),
        line: 1,
        column: 1,
        position: 0,
        lineText: '',
        caret: '^'
      };
    }
  }

  function minify(text) {
    var result = validate(text);
    if (!result.ok) return result;
    try {
      return { ok: true, text: JSON.stringify(result.value), value: result.value };
    } catch (error) {
      return {
        ok: false,
        error: 'stringify',
        message: String(error && error.message ? error.message : error),
        line: 1,
        column: 1,
        position: 0,
        lineText: '',
        caret: '^'
      };
    }
  }

  function summarize(value) {
    var summary = {
      type: value === null ? 'null' : (Array.isArray(value) ? 'array' : typeof value),
      nodes: 0,
      keys: 0,
      objects: 0,
      arrays: 0,
      depth: 0
    };
    function walk(item, depth) {
      summary.nodes++;
      if (depth > summary.depth) summary.depth = depth;
      if (Array.isArray(item)) {
        summary.arrays++;
        for (var i = 0; i < item.length; i++) walk(item[i], depth + 1);
      } else if (item && typeof item === 'object') {
        summary.objects++;
        var keys = Object.keys(item);
        summary.keys += keys.length;
        for (var j = 0; j < keys.length; j++) walk(item[keys[j]], depth + 1);
      }
    }
    walk(value, 0);
    return summary;
  }

  return {
    MAX_BYTES: MAX_BYTES,
    byteLength: byteLength,
    isTooLarge: isTooLarge,
    validate: validate,
    formatJson: formatJson,
    minify: minify,
    sortDeep: sortDeep,
    locateError: locateError,
    summarize: summarize
  };
})();

  return ToolEngine;
  })();

  /* ---- json-to-typescript ---- */
  engines["json-to-typescript"] = (function () {

var ToolEngine = (function () {
  'use strict';

  function fail(code) { return { ok: false, error: code }; }

  function locateJsonError(text, message) {
    var match = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message);
    if (match) return { line: Number(match[1]), column: Number(match[2]) };
    match = /position\s+(\d+)/i.exec(message);
    if (!match) return { line: 1, column: 1 };
    var position = Number(match[1]);
    if (!isFinite(position) || position < 0) position = 0;
    var line = 1;
    var column = 1;
    for (var i = 0; i < position && i < text.length; i++) {
      if (text.charAt(i) === '\n') { line += 1; column = 1; } else { column += 1; }
    }
    return { line: line, column: column };
  }

  function parseJsonText(text) {
    if (typeof text !== 'string') return fail('invalid_input');
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (error) {
      var at = locateJsonError(text, String(error && error.message));
      return { ok: false, error: 'invalid_json', line: at.line, column: at.column };
    }
  }

  function inferType(value) {
    if (value === null) return { kind: 'null' };
    if (Array.isArray(value)) {
      if (value.length === 0) return { kind: 'array', element: { kind: 'unknown' } };
      var element = inferType(value[0]);
      for (var i = 1; i < value.length; i++) {
        element = mergeTypes(element, inferType(value[i]));
      }
      return { kind: 'array', element: element };
    }
    if (typeof value === 'string') return { kind: 'string' };
    if (typeof value === 'number') return { kind: 'number' };
    if (typeof value === 'boolean') return { kind: 'boolean' };
    if (typeof value === 'object') {
      var props = [];
      var keys = Object.keys(value);
      for (var k = 0; k < keys.length; k++) {
        props.push({ name: keys[k], type: inferType(value[keys[k]]), optional: false });
      }
      return { kind: 'object', props: props };
    }
    return { kind: 'unknown' };
  }

  function signature(type) {
    try { return JSON.stringify(type); } catch (error) { return String(type); }
  }

  function unionOf(members) {
    var flat = [];
    var seen = Object.create(null);
    function add(member) {
      if (member.kind === 'union') {
        for (var i = 0; i < member.types.length; i++) add(member.types[i]);
        return;
      }
      var key = signature(member);
      if (!seen[key]) { seen[key] = true; flat.push(member); }
    }
    for (var i = 0; i < members.length; i++) add(members[i]);
    if (flat.length === 1) return flat[0];
    return { kind: 'union', types: flat };
  }

  function mergeObjects(left, right) {
    var rightMap = Object.create(null);
    var leftMap = Object.create(null);
    var i;
    for (i = 0; i < right.props.length; i++) rightMap[right.props[i].name] = right.props[i];
    for (i = 0; i < left.props.length; i++) leftMap[left.props[i].name] = true;
    var props = [];
    for (i = 0; i < left.props.length; i++) {
      var leftProp = left.props[i];
      var rightProp = rightMap[leftProp.name];
      props.push({
        name: leftProp.name,
        type: rightProp ? mergeTypes(leftProp.type, rightProp.type) : leftProp.type,
        optional: leftProp.optional || !rightProp
      });
    }
    for (i = 0; i < right.props.length; i++) {
      if (!leftMap[right.props[i].name]) {
        props.push({ name: right.props[i].name, type: right.props[i].type, optional: true });
      }
    }
    return { kind: 'object', props: props };
  }

  function mergeTypes(left, right) {
    if (!left) return right;
    if (!right) return left;
    if (left.kind === 'unknown') return right;
    if (right.kind === 'unknown') return left;
    if (left.kind === 'object' && right.kind === 'object') return mergeObjects(left, right);
    if (left.kind === 'array' && right.kind === 'array') {
      return { kind: 'array', element: mergeTypes(left.element, right.element) };
    }
    if (left.kind === right.kind) {
      if (left.kind === 'union') return unionOf([left, right]);
      return left;
    }
    return unionOf([left, right]);
  }

  function sanitizeName(raw) {
    var text = String(raw == null ? '' : raw).replace(/[^A-Za-z0-9_$]+/g, ' ').trim();
    if (!text) return 'Root';
    var parts = text.split(/\s+/);
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      out += part.charAt(0).toUpperCase() + part.slice(1);
    }
    if (/^[0-9]/.test(out)) out = '_' + out;
    return out;
  }

  function isIdentifier(name) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
  }

  function propertyLabel(name) {
    return isIdentifier(name) ? name : JSON.stringify(name);
  }

  function toTypeScript(value, opts) {
    opts = opts || {};
    var rootName = sanitizeName(opts.rootName || 'Root');
    var unit = opts.indent === 4 ? '    ' : '  ';
    var mode = opts.mode === 'type' ? 'type' : 'interface';
    var exportPrefix = opts.export === false ? '' : 'export ';
    var root = inferType(value);
    var interfaces = [];
    var used = Object.create(null);
    var fieldCount = 0;

    function pad(depth) {
      var out = '';
      for (var i = 0; i < depth; i++) out += unit;
      return out;
    }

    function uniqueName(base) {
      var name = sanitizeName(base);
      var candidate = name;
      var counter = 2;
      while (used[candidate]) {
        candidate = name + counter;
        counter += 1;
      }
      used[candidate] = true;
      return candidate;
    }

    function objectRef(type, baseName, depth) {
      if (type.props.length === 0) return 'Record<string, unknown>';
      if (mode === 'type') return inlineObject(type, depth);
      var name = uniqueName(baseName);
      interfaces.push({ name: name, type: type });
      return name;
    }

    function inlineObject(type, depth) {
      if (type.props.length === 0) return 'Record<string, unknown>';
      var lines = ['{'];
      for (var i = 0; i < type.props.length; i++) {
        var prop = type.props[i];
        fieldCount += 1;
        lines.push(pad(depth + 1) + propertyLabel(prop.name) + (prop.optional ? '?' : '') + ': ' +
          typeRender(prop.type, 'Field' + sanitizeName(prop.name), depth + 1) + ';');
      }
      lines.push(pad(depth) + '}');
      return lines.join('\n');
    }

    function typeRender(type, baseName, depth) {
      var level = depth || 0;
      if (type.kind === 'object') return objectRef(type, baseName, level);
      if (type.kind === 'array') {
        var element = typeRender(type.element, baseName + 'Item', level);
        if (type.element.kind === 'union') return 'Array<' + element + '>';
        return element + '[]';
      }
      if (type.kind === 'union') {
        var members = [];
        for (var i = 0; i < type.types.length; i++) {
          var memberBase = i === 0 ? baseName : baseName + 'Alt' + (i + 1);
          members.push(typeRender(type.types[i], memberBase, level));
        }
        return members.join(' | ');
      }
      if (type.kind === 'null') return 'null';
      if (type.kind === 'string' || type.kind === 'number' || type.kind === 'boolean') return type.kind;
      return 'unknown';
    }

    function interfaceText(record) {
      var lines = [exportPrefix + 'interface ' + record.name + ' {'];
      for (var i = 0; i < record.type.props.length; i++) {
        var prop = record.type.props[i];
        fieldCount += 1;
        var childName = record.name + sanitizeName(prop.name);
        lines.push(unit + propertyLabel(prop.name) + (prop.optional ? '?' : '') + ': ' +
          typeRender(prop.type, childName, 1) + ';');
      }
      lines.push('}');
      return lines.join('\n');
    }

    var declarations = [];
    if (mode === 'interface' && root.kind === 'object' && root.props.length > 0) {
      used[rootName] = true;
      interfaces.push({ name: rootName, type: root });
      for (var i = 0; i < interfaces.length; i++) {
        declarations.push(interfaceText(interfaces[i]));
      }
    } else {
      var rendered = typeRender(root, rootName, 0);
      declarations.push(exportPrefix + 'type ' + rootName + ' = ' + rendered + ';');
      if (mode === 'interface') {
        for (var j = 0; j < interfaces.length; j++) {
          declarations.push(interfaceText(interfaces[j]));
        }
      }
    }

    return {
      ok: true,
      code: declarations.join('\n\n'),
      rootName: rootName,
      interfaces: interfaces.length,
      fields: fieldCount,
      rootKind: root.kind
    };
  }

  return {
    parseJsonText: parseJsonText,
    locateJsonError: locateJsonError,
    inferType: inferType,
    mergeTypes: mergeTypes,
    sanitizeName: sanitizeName,
    toTypeScript: toTypeScript
  };
})();

  return ToolEngine;
  })();

  /* ---- jwt-decoder ---- */
  engines["jwt-decoder"] = (function () {

var ToolEngine = (function () {
  'use strict';

  // TOOL_ENGINE_START
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function fail(code) {
    return { ok: false, error: code };
  }

  function isNum(n) {
    return typeof n === 'number' && isFinite(n);
  }

  // Minimal UTF-8 decoder: works in browsers and in plain Node tests.
  function utf8Decode(bytes) {
    var out = '';
    var i = 0;
    while (i < bytes.length) {
      var b = bytes[i++];
      if (b < 0x80) { out += String.fromCharCode(b); continue; }
      var need, cp, ok = true;
      if ((b & 0xe0) === 0xc0) { need = 1; cp = b & 0x1f; }
      else if ((b & 0xf0) === 0xe0) { need = 2; cp = b & 0x0f; }
      else if ((b & 0xf8) === 0xf0) { need = 3; cp = b & 0x07; }
      else { out += '�'; continue; }
      if (i + need > bytes.length) { out += '�'; break; }
      for (var k = 0; k < need; k++) {
        var nb = bytes[i + k];
        if ((nb & 0xc0) !== 0x80) { ok = false; break; }
        cp = (cp << 6) | (nb & 0x3f);
      }
      if (!ok) { out += '�'; continue; }
      i += need;
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) { out += '�'; continue; }
      out += String.fromCodePoint(cp);
    }
    return out;
  }

  function b64urlDecode(input) {
    if (typeof input !== 'string') return fail('bad_value');
    var clean = input.replace(/=+$/g, '');
    if (clean.length % 4 === 1) return fail('bad_segment');
    if (!/^[A-Za-z0-9_-]*$/.test(clean)) return fail('bad_segment');
    var bytes = [];
    var buffer = 0;
    var bits = 0;
    for (var i = 0; i < clean.length; i++) {
      var value = B64.indexOf(clean.charAt(i));
      if (value < 0) return fail('bad_segment');
      buffer = (buffer << 6) | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }
    return { ok: true, bytes: bytes, text: utf8Decode(bytes) };
  }

  function decodePart(segment) {
    var decoded = b64urlDecode(segment);
    if (!decoded.ok) return decoded;
    var value;
    try {
      value = JSON.parse(decoded.text);
    } catch (e) {
      return fail('bad_json');
    }
    if (value === null || typeof value !== 'object') return fail('bad_json');
    return { ok: true, value: value, text: decoded.text };
  }

  function decodeJwt(token) {
    if (typeof token !== 'string' || !token.trim()) return fail('empty_input');
    var parts = token.trim().split('.');
    if (parts.length !== 3) return fail('bad_parts');
    if (!parts[0] || !parts[1]) return fail('bad_segment');
    if (!/^[A-Za-z0-9_-]*$/.test(parts[2])) return fail('bad_segment');
    var header = decodePart(parts[0]);
    if (!header.ok) return header;
    var payload = decodePart(parts[1]);
    if (!payload.ok) return payload;
    return {
      ok: true,
      header: header.value,
      payload: payload.value,
      signature: parts[2],
      headerText: header.text,
      payloadText: payload.text,
      signed: parts[2].length > 0
    };
  }

  function claimInfo(value, now, kind) {
    if (value === undefined) return { state: 'missing', value: null };
    if (!isNum(value)) return { state: 'invalid', value: null };
    var state = 'valid';
    if (kind === 'exp' && now >= value) state = 'expired';
    if (kind === 'nbf' && now < value) state = 'not_yet_valid';
    if (kind === 'iat' && value > now) state = 'in_future';
    return { state: state, value: value };
  }

  function claimsStatus(payload, nowSeconds) {
    if (!payload || typeof payload !== 'object') return fail('bad_value');
    if (!isNum(nowSeconds)) return fail('bad_value');
    var exp = claimInfo(payload.exp, nowSeconds, 'exp');
    var iat = claimInfo(payload.iat, nowSeconds, 'iat');
    var nbf = claimInfo(payload.nbf, nowSeconds, 'nbf');
    var status = 'active';
    if (exp.state === 'expired') status = 'expired';
    else if (nbf.state === 'not_yet_valid') status = 'not_yet_valid';
    else if (exp.state === 'missing' && nbf.state === 'missing' && iat.state === 'missing') {
      status = 'no_time_claims';
    }
    return { ok: true, exp: exp, iat: iat, nbf: nbf, status: status };
  }
  // TOOL_ENGINE_END

  return {
    utf8Decode: utf8Decode,
    b64urlDecode: b64urlDecode,
    decodePart: decodePart,
    decodeJwt: decodeJwt,
    claimsStatus: claimsStatus
  };
})();

  return ToolEngine;
  })();

  /* ---- text-diff ---- */
  engines["text-diff"] = (function () {

var ToolEngine = (function () {
  'use strict';

  // TOOL_ENGINE_START
  var MAX_LINES = 2000;
  var MAX_CELLS = 4000000;

  function fail(code) {
    return { ok: false, error: code };
  }

  function splitLines(text) {
    if (typeof text !== 'string') return fail('bad_value');
    if (text === '') return [];
    return text.replace(/\r\n?/g, '\n').split('\n');
  }

  function normalizeLine(line, opts) {
    var out = line;
    if (opts.ignoreWhitespace) out = out.replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
    if (opts.ignoreCase) out = out.toLowerCase();
    return out;
  }

  function diffLines(a, b, opts) {
    if (typeof a !== 'string' || typeof b !== 'string') return fail('bad_value');
    var left = splitLines(a);
    var right = splitLines(b);
    var n = left.length;
    var m = right.length;
    if (n > MAX_LINES || m > MAX_LINES) return fail('too_large');
    if (n * m > MAX_CELLS) return fail('too_large');
    var options = opts || {};
    var normA = new Array(n);
    var normB = new Array(m);
    for (var i = 0; i < n; i++) normA[i] = normalizeLine(left[i], options);
    for (var j = 0; j < m; j++) normB[j] = normalizeLine(right[j], options);
    var width = m + 1;
    var dp = new Int32Array((n + 1) * width);
    for (var x = n - 1; x >= 0; x--) {
      for (var y = m - 1; y >= 0; y--) {
        if (normA[x] === normB[y]) {
          dp[x * width + y] = dp[(x + 1) * width + y + 1] + 1;
        } else {
          var down = dp[(x + 1) * width + y];
          var across = dp[x * width + y + 1];
          dp[x * width + y] = down >= across ? down : across;
        }
      }
    }
    var rows = [];
    var ai = 0;
    var bi = 0;
    var aNo = 1;
    var bNo = 1;
    while (ai < n && bi < m) {
      if (normA[ai] === normB[bi]) {
        rows.push({ type: 'same', text: left[ai], aLine: aNo, bLine: bNo });
        ai++; bi++; aNo++; bNo++;
      } else if (dp[(ai + 1) * width + bi] >= dp[ai * width + bi + 1]) {
        rows.push({ type: 'del', text: left[ai], aLine: aNo, bLine: null });
        ai++; aNo++;
      } else {
        rows.push({ type: 'add', text: right[bi], aLine: null, bLine: bNo });
        bi++; bNo++;
      }
    }
    while (ai < n) {
      rows.push({ type: 'del', text: left[ai], aLine: aNo, bLine: null });
      ai++; aNo++;
    }
    while (bi < m) {
      rows.push({ type: 'add', text: right[bi], aLine: null, bLine: bNo });
      bi++; bNo++;
    }
    var stats = { added: 0, removed: 0, unchanged: 0, aLines: n, bLines: m, changes: 0 };
    for (var r = 0; r < rows.length; r++) {
      if (rows[r].type === 'add') stats.added++;
      else if (rows[r].type === 'del') stats.removed++;
      else stats.unchanged++;
    }
    stats.changes = stats.added + stats.removed;
    return { ok: true, rows: rows, stats: stats };
  }

  function unifiedText(rows) {
    if (!Array.isArray(rows)) return fail('bad_value');
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var sign = row.type === 'add' ? '+ ' : (row.type === 'del' ? '- ' : '  ');
      out.push(sign + row.text);
    }
    return { ok: true, value: out.join('\n') };
  }

  // Pair delete/add runs so the side-by-side view lines them up.
  function sideBySide(rows) {
    if (!Array.isArray(rows)) return fail('bad_value');
    var pairs = [];
    var dels = [];
    var adds = [];
    function flush() {
      var count = Math.max(dels.length, adds.length);
      for (var k = 0; k < count; k++) {
        pairs.push({ left: dels[k] || null, right: adds[k] || null });
      }
      dels = [];
      adds = [];
    }
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.type === 'del') dels.push(row);
      else if (row.type === 'add') adds.push(row);
      else {
        flush();
        pairs.push({ left: row, right: row });
      }
    }
    flush();
    return { ok: true, pairs: pairs };
  }
  // TOOL_ENGINE_END

  return {
    splitLines: splitLines,
    diffLines: diffLines,
    unifiedText: unifiedText,
    sideBySide: sideBySide
  };
})();

  return ToolEngine;
  })();

  /* ---- color-converter ---- */
  engines["color-converter"] = (function () {

var ToolEngine = (function () {
  'use strict';

  function fail(code) { return { ok: false, error: code }; }

  function isNum(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function clampByte(value) {
    var rounded = Math.round(value);
    if (rounded < 0) return 0;
    if (rounded > 255) return 255;
    return rounded;
  }

  function validByte(value) {
    return isNum(value) && value >= 0 && value <= 255;
  }

  function validPercent(value) {
    return isNum(value) && value >= 0 && value <= 100;
  }

  function normalizeHue(value) {
    if (!isNum(value)) return null;
    return ((value % 360) + 360) % 360;
  }

  var NAMED = {
    black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00',
    blue: '#0000ff', yellow: '#ffff00', aqua: '#00ffff', cyan: '#00ffff',
    fuchsia: '#ff00ff', magenta: '#ff00ff', silver: '#c0c0c0', gray: '#808080',
    grey: '#808080', maroon: '#800000', olive: '#808000', green: '#008000',
    purple: '#800080', teal: '#008080', navy: '#000080', orange: '#ffa500',
    pink: '#ffc0cb', brown: '#a52a2a', gold: '#ffd700'
  };

  function hexToRgb(hex) {
    if (typeof hex !== 'string') return fail('invalid_color');
    var text = hex.trim().replace(/^#/, '');
    if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(text)) return fail('invalid_color');
    if (text.length === 3) {
      text = text[0] + text[0] + text[1] + text[1] + text[2] + text[2];
    }
    return {
      ok: true,
      r: parseInt(text.slice(0, 2), 16),
      g: parseInt(text.slice(2, 4), 16),
      b: parseInt(text.slice(4, 6), 16)
    };
  }

  function rgbToHex(r, g, b) {
    if (!validByte(r) || !validByte(g) || !validByte(b)) return fail('bad_value');
    function pair(value) {
      var text = Math.round(value).toString(16);
      return text.length === 1 ? '0' + text : text;
    }
    return { ok: true, value: '#' + pair(r) + pair(g) + pair(b) };
  }

  function rgbToHsl(r, g, b) {
    if (!validByte(r) || !validByte(g) || !validByte(b)) return fail('bad_value');
    var red = r / 255;
    var green = g / 255;
    var blue = b / 255;
    var max = Math.max(red, green, blue);
    var min = Math.min(red, green, blue);
    var delta = max - min;
    var lightness = (max + min) / 2;
    var hue = 0;
    var saturation = 0;
    if (delta !== 0) {
      saturation = delta / (1 - Math.abs(2 * lightness - 1));
      if (max === red) {
        hue = 60 * (((green - blue) / delta) % 6);
      } else if (max === green) {
        hue = 60 * ((blue - red) / delta + 2);
      } else {
        hue = 60 * ((red - green) / delta + 4);
      }
    }
    hue = normalizeHue(hue);
    if (saturation < 0) saturation = 0;
    if (saturation > 1) saturation = 1;
    return { ok: true, h: hue, s: saturation * 100, l: lightness * 100 };
  }

  function hueToChannels(hue, chroma) {
    var x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
    if (hue < 60) return [chroma, x, 0];
    if (hue < 120) return [x, chroma, 0];
    if (hue < 180) return [0, chroma, x];
    if (hue < 240) return [0, x, chroma];
    if (hue < 300) return [x, 0, chroma];
    return [chroma, 0, x];
  }

  function hslToRgb(h, s, l) {
    var hue = normalizeHue(h);
    if (hue === null || !validPercent(s) || !validPercent(l)) return fail('bad_value');
    var saturation = s / 100;
    var lightness = l / 100;
    var chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    var channels = hueToChannels(hue, chroma);
    var match = lightness - chroma / 2;
    return {
      ok: true,
      r: clampByte((channels[0] + match) * 255),
      g: clampByte((channels[1] + match) * 255),
      b: clampByte((channels[2] + match) * 255)
    };
  }

  function rgbToHsv(r, g, b) {
    if (!validByte(r) || !validByte(g) || !validByte(b)) return fail('bad_value');
    var red = r / 255;
    var green = g / 255;
    var blue = b / 255;
    var max = Math.max(red, green, blue);
    var min = Math.min(red, green, blue);
    var delta = max - min;
    var hue = 0;
    if (delta !== 0) {
      if (max === red) {
        hue = 60 * (((green - blue) / delta) % 6);
      } else if (max === green) {
        hue = 60 * ((blue - red) / delta + 2);
      } else {
        hue = 60 * ((red - green) / delta + 4);
      }
    }
    return {
      ok: true,
      h: normalizeHue(hue),
      s: max === 0 ? 0 : (delta / max) * 100,
      v: max * 100
    };
  }

  function hsvToRgb(h, s, v) {
    var hue = normalizeHue(h);
    if (hue === null || !validPercent(s) || !validPercent(v)) return fail('bad_value');
    var saturation = s / 100;
    var value = v / 100;
    var chroma = value * saturation;
    var channels = hueToChannels(hue, chroma);
    var match = value - chroma;
    return {
      ok: true,
      r: clampByte((channels[0] + match) * 255),
      g: clampByte((channels[1] + match) * 255),
      b: clampByte((channels[2] + match) * 255)
    };
  }

  function rgbToCmyk(r, g, b) {
    if (!validByte(r) || !validByte(g) || !validByte(b)) return fail('bad_value');
    var red = r / 255;
    var green = g / 255;
    var blue = b / 255;
    var max = Math.max(red, green, blue);
    var key = 1 - max;
    if (key >= 1) return { ok: true, c: 0, m: 0, y: 0, k: 100 };
    return {
      ok: true,
      c: ((1 - red - key) / (1 - key)) * 100,
      m: ((1 - green - key) / (1 - key)) * 100,
      y: ((1 - blue - key) / (1 - key)) * 100,
      k: key * 100
    };
  }

  function cmykToRgb(c, m, y, k) {
    if (!validPercent(c) || !validPercent(m) || !validPercent(y) || !validPercent(k)) return fail('bad_value');
    var cc = c / 100;
    var mm = m / 100;
    var yy = y / 100;
    var kk = k / 100;
    return {
      ok: true,
      r: clampByte(255 * (1 - cc) * (1 - kk)),
      g: clampByte(255 * (1 - mm) * (1 - kk)),
      b: clampByte(255 * (1 - yy) * (1 - kk))
    };
  }

  function relativeLuminance(rgb) {
    function channel(value) {
      var normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  }

  function contrastRatio(first, second) {
    if (!first || !second) return fail('bad_value');
    if (!validByte(first.r) || !validByte(first.g) || !validByte(first.b)) return fail('bad_value');
    if (!validByte(second.r) || !validByte(second.g) || !validByte(second.b)) return fail('bad_value');
    var l1 = relativeLuminance(first);
    var l2 = relativeLuminance(second);
    var ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    ratio = Math.round(ratio * 100) / 100;
    return {
      ok: true,
      ratio: ratio,
      aa: ratio >= 4.5,
      aaa: ratio >= 7,
      aaLarge: ratio >= 3
    };
  }

  function colorName(r, g, b) {
    if (!validByte(r) || !validByte(g) || !validByte(b)) return fail('bad_value');
    var hex = rgbToHex(r, g, b).value;
    var names = Object.keys(NAMED);
    var best = null;
    var bestDistance = Infinity;
    var canonical = Object.create(null);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var value = NAMED[name];
      if (!canonical[value]) {
        canonical[value] = name;
        var target = hexToRgb(value);
        var distance = Math.pow(target.r - r, 2) + Math.pow(target.g - g, 2) + Math.pow(target.b - b, 2);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { name: name, hex: value };
        }
      }
    }
    var exact = !!best && best.hex === hex;
    return { ok: true, name: best.name, hex: best.hex, exact: exact };
  }

  function parseColor(text) {
    if (typeof text !== 'string') return fail('invalid_color');
    var value = text.trim().toLowerCase();
    if (!value) return fail('empty_input');
    if (NAMED[value]) {
      var named = hexToRgb(NAMED[value]);
      named.format = 'name';
      return named;
    }
    if (value.charAt(0) === '#') {
      var hex = hexToRgb(value);
      if (hex.ok) hex.format = 'hex';
      return hex;
    }
    var match = /^rgba?\(([^)]+)\)$/.exec(value);
    if (match) {
      var parts = match[1].split(/\s*,\s*/);
      if (parts.length < 3 || parts.length > 4) return fail('invalid_color');
      var channels = [];
      for (var i = 0; i < 3; i++) {
        var part = parts[i];
        var number = part.indexOf('%') !== -1 ? (parseFloat(part) / 100) * 255 : parseFloat(part);
        if (!isNum(number)) return fail('invalid_color');
        channels.push(clampByte(number));
      }
      return { ok: true, r: channels[0], g: channels[1], b: channels[2], format: 'rgb' };
    }
    match = /^hsla?\(([^)]+)\)$/.exec(value);
    if (match) {
      var hslParts = match[1].split(/\s*,\s*/);
      if (hslParts.length < 3 || hslParts.length > 4) return fail('invalid_color');
      var rgb = hslToRgb(parseFloat(hslParts[0]), parseFloat(hslParts[1]), parseFloat(hslParts[2]));
      if (rgb.ok) rgb.format = 'hsl';
      return rgb;
    }
    match = /^hs[vb]a?\(([^)]+)\)$/.exec(value);
    if (match) {
      var hsvParts = match[1].split(/\s*,\s*/);
      if (hsvParts.length < 3 || hsvParts.length > 4) return fail('invalid_color');
      var hsvRgb = hsvToRgb(parseFloat(hsvParts[0]), parseFloat(hsvParts[1]), parseFloat(hsvParts[2]));
      if (hsvRgb.ok) hsvRgb.format = 'hsv';
      return hsvRgb;
    }
    match = /^cmyk\(([^)]+)\)$/.exec(value);
    if (match) {
      var cmykParts = match[1].split(/\s*,\s*/);
      if (cmykParts.length !== 4) return fail('invalid_color');
      var cmykRgb = cmykToRgb(
        parseFloat(cmykParts[0]), parseFloat(cmykParts[1]),
        parseFloat(cmykParts[2]), parseFloat(cmykParts[3])
      );
      if (cmykRgb.ok) cmykRgb.format = 'cmyk';
      return cmykRgb;
    }
    return fail('invalid_color');
  }

  return {
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    rgbToHsl: rgbToHsl,
    hslToRgb: hslToRgb,
    rgbToHsv: rgbToHsv,
    hsvToRgb: hsvToRgb,
    rgbToCmyk: rgbToCmyk,
    cmykToRgb: cmykToRgb,
    relativeLuminance: relativeLuminance,
    contrastRatio: contrastRatio,
    colorName: colorName,
    parseColor: parseColor
  };
})();

  return ToolEngine;
  })();

  /* ---- number-base-converter ---- */
  engines["number-base-converter"] = (function () {

var ToolEngine = (function () {
  'use strict';

  var DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

  function fail(code) { return { ok: false, error: code }; }

  function validBase(base) {
    var number = Number(base);
    return isFinite(number) && Math.floor(number) === number && number >= 2 && number <= 36;
  }

  function digitValue(character) {
    return DIGITS.indexOf(String(character).toLowerCase());
  }

  function power(base, exponent) {
    var out = 1n;
    var step = BigInt(base);
    for (var i = 0; i < exponent; i++) out *= step;
    return out;
  }

  function parseBase(input, base) {
    if (typeof input !== 'string') return fail('bad_value');
    if (!validBase(base)) return fail('bad_base');
    var radix = Number(base);
    var text = input.trim();
    if (!text) return fail('empty_input');

    var sign = 1;
    var offset = 0;
    if (text.charAt(0) === '+' || text.charAt(0) === '-') {
      if (text.charAt(0) === '-') sign = -1;
      offset = 1;
    }
    var body = text.slice(offset);
    if (!body) return fail('empty_input');
    if (body.charAt(0) === '.') return { ok: false, error: 'bad_digit', index: offset, digit: '.' };

    var dot = body.indexOf('.');
    if (dot !== -1 && body.indexOf('.', dot + 1) !== -1) {
      return { ok: false, error: 'bad_digit', index: offset + dot, digit: '.' };
    }
    var intText = dot === -1 ? body : body.slice(0, dot);
    var fracText = dot === -1 ? '' : body.slice(dot + 1);
    if (dot !== -1 && fracText === '') {
      return { ok: false, error: 'bad_digit', index: offset + body.length - 1, digit: '.' };
    }
    if (!intText) intText = '0';

    var integer = 0n;
    for (var i = 0; i < intText.length; i++) {
      var digit = digitValue(intText.charAt(i));
      if (digit < 0 || digit >= radix) {
        return { ok: false, error: 'bad_digit', index: offset + i, digit: intText.charAt(i) };
      }
      integer = integer * BigInt(radix) + BigInt(digit);
    }

    var fractionNum = 0n;
    var fractionDen = 1n;
    for (var j = 0; j < fracText.length; j++) {
      var fracDigit = digitValue(fracText.charAt(j));
      if (fracDigit < 0 || fracDigit >= radix) {
        return { ok: false, error: 'bad_digit', index: offset + intText.length + 1 + j, digit: fracText.charAt(j) };
      }
      fractionNum = fractionNum * BigInt(radix) + BigInt(fracDigit);
      fractionDen *= BigInt(radix);
    }

    return {
      ok: true,
      value: sign < 0 ? -integer : integer,
      negative: sign < 0,
      hasFraction: fracText.length > 0,
      fraction: { num: fractionNum, den: fractionDen },
      base: radix,
      integerText: intText,
      fractionText: fracText
    };
  }

  function convertFraction(num, den, base, precision) {
    var out = '';
    var remainder = num;
    var step = BigInt(base);
    for (var i = 0; i < precision; i++) {
      if (remainder === 0n) break;
      remainder *= step;
      var digit = remainder / den;
      remainder %= den;
      out += DIGITS.charAt(Number(digit));
    }
    return { text: out.toUpperCase(), remainder: remainder };
  }

  function convertBase(input, fromBase, toBase, precision) {
    var parsed = parseBase(input, fromBase);
    if (!parsed.ok) return parsed;
    if (!validBase(toBase)) return fail('bad_base');
    var p = precision == null ? 8 : Number(precision);
    if (!isFinite(p) || Math.floor(p) !== p || p < 0 || p > 32) return fail('bad_precision');
    var target = Number(toBase);

    var negative = parsed.value < 0n;
    var magnitude = negative ? -parsed.value : parsed.value;
    var intText = magnitude.toString(target).toUpperCase();
    var fracText = '';
    var truncated = false;
    if (parsed.hasFraction) {
      var fraction = convertFraction(parsed.fraction.num, parsed.fraction.den, target, p);
      fracText = fraction.text;
      truncated = fraction.remainder !== 0n;
    }

    return {
      ok: true,
      value: (negative ? '-' : '') + intText + (fracText ? '.' + fracText : ''),
      intText: intText,
      fracText: fracText,
      negative: negative,
      base: target,
      truncated: truncated
    };
  }

  function formatGroup(value, groupSize, separator) {
    if (typeof value !== 'string') return fail('bad_value');
    var size = Number(groupSize);
    if (!isFinite(size) || Math.floor(size) !== size || size < 1 || size > 8) return fail('bad_value');
    var sep = separator == null ? ' ' : String(separator);
    if (!sep) return fail('bad_value');
    var text = value.trim();
    if (!text) return fail('empty_input');

    var sign = '';
    if (text.charAt(0) === '+' || text.charAt(0) === '-') {
      sign = text.charAt(0);
      text = text.slice(1);
    }
    var dot = text.indexOf('.');
    var intText = dot === -1 ? text : text.slice(0, dot);
    var fracText = dot === -1 ? '' : text.slice(dot);
    if (!intText) return fail('bad_value');

    var groups = [];
    for (var end = intText.length; end > 0; end -= size) {
      groups.unshift(intText.slice(Math.max(0, end - size), end));
    }
    return { ok: true, value: sign + groups.join(sep) + fracText };
  }

  return {
    parseBase: parseBase,
    convertBase: convertBase,
    formatGroup: formatGroup,
    validBase: validBase
  };
})();

  return ToolEngine;
  })();

  /* ---- roman-numeral-converter ---- */
  engines["roman-numeral-converter"] = (function () {

var ToolEngine = (function () {
  'use strict';

  // TOOL_ENGINE_START
  var TABLE = [
    { value: 1000, symbol: 'M' },
    { value: 900, symbol: 'CM' },
    { value: 500, symbol: 'D' },
    { value: 400, symbol: 'CD' },
    { value: 100, symbol: 'C' },
    { value: 90, symbol: 'XC' },
    { value: 50, symbol: 'L' },
    { value: 40, symbol: 'XL' },
    { value: 10, symbol: 'X' },
    { value: 9, symbol: 'IX' },
    { value: 5, symbol: 'V' },
    { value: 4, symbol: 'IV' },
    { value: 1, symbol: 'I' }
  ];

  var VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

  function isNum(x) {
    return typeof x === 'number' && isFinite(x);
  }

  function repeat(text, count) {
    var out = '';
    for (var i = 0; i < count; i++) out += text;
    return out;
  }

  function toRoman(n) {
    if (!isNum(n) || Math.floor(n) !== n) return { ok: false, error: 'bad_value' };
    if (n < 1 || n > 3999) return { ok: false, error: 'range' };
    var remaining = n;
    var roman = '';
    var steps = [];
    for (var i = 0; i < TABLE.length; i++) {
      var entry = TABLE[i];
      if (remaining >= entry.value) {
        var count = Math.floor(remaining / entry.value);
        roman += repeat(entry.symbol, count);
        remaining -= entry.value * count;
        steps.push({ value: entry.value, symbol: entry.symbol, count: count });
      }
    }
    return {
      ok: true,
      value: n,
      roman: roman,
      lower: roman.toLowerCase(),
      steps: steps
    };
  }

  function fromRoman(text) {
    if (typeof text !== 'string') return { ok: false, error: 'bad_value' };
    var upper = text.trim().toUpperCase();
    if (!upper) return { ok: false, error: 'empty_input' };
    if (!/^[IVXLCDM]+$/.test(upper)) return { ok: false, error: 'invalid_roman' };
    var total = 0;
    for (var i = 0; i < upper.length; i++) {
      var cur = VALUES[upper.charAt(i)];
      var next = i + 1 < upper.length ? VALUES[upper.charAt(i + 1)] : 0;
      total += cur < next ? -cur : cur;
    }
    if (total < 1 || total > 3999) return { ok: false, error: 'range' };
    var canonical = toRoman(total);
    if (!canonical.ok) return canonical;
    if (canonical.roman !== upper) return { ok: false, error: 'invalid_roman' };
    return {
      ok: true,
      value: total,
      roman: canonical.roman,
      lower: canonical.lower,
      steps: canonical.steps
    };
  }

  function validate(input) {
    if (typeof input === 'number') {
      var fromNumber = toRoman(input);
      if (!fromNumber.ok) return fromNumber;
      return {
        ok: true,
        source: 'number',
        value: fromNumber.value,
        roman: fromNumber.roman,
        lower: fromNumber.lower,
        steps: fromNumber.steps
      };
    }
    if (typeof input === 'string') {
      var fromText = fromRoman(input);
      if (!fromText.ok) return fromText;
      return {
        ok: true,
        source: 'roman',
        value: fromText.value,
        roman: fromText.roman,
        lower: fromText.lower,
        steps: fromText.steps
      };
    }
    return { ok: false, error: 'bad_value' };
  }
  // TOOL_ENGINE_END

  return {
    isNum: isNum,
    toRoman: toRoman,
    fromRoman: fromRoman,
    validate: validate
  };
})();

  return ToolEngine;
  })();

  /* ---- fraction-calculator ---- */
  engines["fraction-calculator"] = (function () {

var ToolEngine = (function () {
  'use strict';

  var MAX_DIGITS = 40;

  function fail(code) {
    return { ok: false, error: code };
  }

  function absBig(n) {
    return n < 0n ? -n : n;
  }

  // Accept BigInt, safe integer, or an integer string of at most MAX_DIGITS digits.
  function toBig(value) {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && isFinite(value) && Math.floor(value) === value &&
        Math.abs(value) <= 9007199254740991) {
      return BigInt(value);
    }
    if (typeof value === 'string') {
      var s = value.trim();
      if (/^[+-]?\d+$/.test(s) && s.replace(/^[+-]/, '').length <= MAX_DIGITS) {
        return BigInt(s);
      }
    }
    return null;
  }

  function gcdValue(a, b) {
    var x = absBig(a);
    var y = absBig(b);
    while (y) {
      var t = x % y;
      x = y;
      y = t;
    }
    return x;
  }

  function gcd(a, b) {
    var x = toBig(a);
    var y = toBig(b);
    if (x === null || y === null) return fail('bad_value');
    return { ok: true, value: gcdValue(x, y) };
  }

  function normalize(num, den) {
    if (den < 0n) return { num: -num, den: -den };
    return { num: num, den: den };
  }

  function simplify(num, den) {
    var n = toBig(num);
    var d = toBig(den);
    if (n === null || d === null) return fail('bad_value');
    if (d === 0n) return fail('zero_denominator');
    var s = normalize(n, d);
    var g = s.num === 0n ? s.den : gcdValue(s.num, s.den);
    return { ok: true, num: s.num / g, den: s.den / g, gcd: g };
  }

  function finishParse(num, den) {
    var s = normalize(num, den);
    return { ok: true, num: s.num, den: s.den };
  }

  function parseFraction(text) {
    if (typeof text !== 'string') return fail('bad_value');
    var s = text.trim().replace(/\s+/g, ' ');
    if (!s) return fail('empty_input');
    var m = /^([+-]?\d+) (\d+)\s*\/\s*(\d+)$/.exec(s);
    if (m) {
      var whole = toBig(m[1]);
      var part = toBig(m[2]);
      var d = toBig(m[3]);
      if (whole === null || part === null || d === null) return fail('bad_value');
      if (d === 0n) return fail('zero_denominator');
      if (part >= d) return fail('bad_mixed');
      var mag = absBig(whole) * d + part;
      return finishParse(whole < 0n ? -mag : mag, d);
    }
    m = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(s);
    if (m) {
      var n1 = toBig(m[1]);
      var d1 = toBig(m[2]);
      if (n1 === null || d1 === null) return fail('bad_value');
      if (d1 === 0n) return fail('zero_denominator');
      return finishParse(n1, d1);
    }
    m = /^[+-]?\d+$/.exec(s);
    if (m) {
      var n2 = toBig(s);
      if (n2 === null) return fail('bad_value');
      return finishParse(n2, 1n);
    }
    return fail('bad_value');
  }

  function compute(aText, op, bText) {
    if (['+', '-', '*', '/'].indexOf(op) === -1) return fail('bad_op');
    var a = parseFraction(String(aText == null ? '' : aText));
    if (!a.ok) return a;
    var b = parseFraction(String(bText == null ? '' : bText));
    if (!b.ok) return b;

    var num;
    var den;
    if (op === '+') {
      num = a.num * b.den + b.num * a.den;
      den = a.den * b.den;
    } else if (op === '-') {
      num = a.num * b.den - b.num * a.den;
      den = a.den * b.den;
    } else if (op === '*') {
      num = a.num * b.num;
      den = a.den * b.den;
    } else {
      if (b.num === 0n) return fail('divide_by_zero');
      num = a.num * b.den;
      den = a.den * b.num;
    }
    var raw = normalize(num, den);
    var s = simplify(raw.num, raw.den);
    if (!s.ok) return s;
    return {
      ok: true,
      op: op,
      left: a,
      right: b,
      rawNum: raw.num,
      rawDen: raw.den,
      num: s.num,
      den: s.den,
      gcd: s.gcd,
      mixed: toMixed(s.num, s.den)
    };
  }

  function add(a, b) { return compute(a, '+', b); }
  function sub(a, b) { return compute(a, '-', b); }
  function mul(a, b) { return compute(a, '*', b); }
  function div(a, b) { return compute(a, '/', b); }

  function toMixed(num, den) {
    var n = toBig(num);
    var d = toBig(den);
    if (n === null || d === null || d === 0n) return fail('bad_value');
    var s = normalize(n, d);
    var sign = s.num < 0n ? -1n : 1n;
    var mag = absBig(s.num);
    return {
      ok: true,
      whole: sign * (mag / s.den),
      num: mag % s.den,
      den: s.den
    };
  }

  function formatFraction(num, den) {
    var n = toBig(num);
    var d = toBig(den);
    if (n === null || d === null || d === 0n) return '—';
    var s = normalize(n, d);
    if (s.den === 1n) return s.num.toString();
    return s.num.toString() + '/' + s.den.toString();
  }

  // Long division with half-up rounding; returns a plain string (not localized).
  function toDecimal(num, den, places) {
    var n = toBig(num);
    var d = toBig(den);
    if (n === null || d === null || d === 0n) return '—';
    if (typeof places !== 'number' || !isFinite(places) || places < 0 || places > 20 ||
        Math.floor(places) !== places) {
      places = 10;
    }
    var s = normalize(n, d);
    var sign = s.num < 0n ? '-' : '';
    var mag = absBig(s.num);
    var whole = mag / s.den;
    var rem = mag % s.den;
    if (rem === 0n) return sign + whole.toString();
    var digits = '';
    for (var i = 0; i < places; i++) {
      rem *= 10n;
      digits += (rem / s.den).toString();
      rem %= s.den;
    }
    if ((rem * 10n) / s.den >= 5n) {
      var arr = digits.split('');
      var carry = 1;
      for (var j = arr.length - 1; j >= 0 && carry; j--) {
        var v = Number(arr[j]) + carry;
        if (v >= 10) {
          arr[j] = '0';
          carry = 1;
        } else {
          arr[j] = String(v);
          carry = 0;
        }
      }
      digits = arr.join('');
      if (carry) whole += 1n;
    }
    digits = digits.replace(/0+$/, '');
    if (!digits) return sign + whole.toString();
    return sign + whole.toString() + '.' + digits;
  }

  return {
    gcd: gcd,
    simplify: simplify,
    parseFraction: parseFraction,
    compute: compute,
    add: add,
    sub: sub,
    mul: mul,
    div: div,
    toMixed: toMixed,
    formatFraction: formatFraction,
    toDecimal: toDecimal
  };
})();

  return ToolEngine;
  })();

  /* ---- percentage-calculator ---- */
  engines["percentage-calculator"] = (function () {

var ToolEngine = (function () {
  'use strict';

  /* All functions take and return plain numbers or { ok, error } objects.
     The engine never touches the DOM, storage, or the clock. */

  function isNum(n) {
    return typeof n === 'number' && isFinite(n);
  }

  function fail(code) {
    return { ok: false, error: code };
  }

  /* Round half away from zero at `decimals` places, working in decimal space
     so binary artifacts such as 1.005 * 100 = 100.49999999999999 do not flip
     the result. This is a display helper; callers keep full precision. */
  function round(n, decimals) {
    if (!isNum(n)) return fail('bad_value');
    var d = decimals == null ? 2 : decimals;
    if (!isNum(d) || d < 0 || d > 6 || Math.floor(d) !== d) return fail('bad_decimals');
    var f = Math.pow(10, d);
    var abs = Math.abs(n);
    var scaled = abs * f;
    var rounded = Math.floor(scaled + 0.5 + 1e-9) / f;
    if (rounded === 0) return { ok: true, value: 0 };
    return { ok: true, value: n < 0 ? -rounded : rounded };
  }

  /* p percent of n. */
  function percentOf(p, n) {
    if (!isNum(p)) return fail('bad_percent');
    if (!isNum(n)) return fail('bad_value');
    var out = n * p / 100;
    if (!isFinite(out)) return fail('overflow');
    return { ok: true, value: out };
  }

  /* x as a percentage of y. */
  function whatPercent(x, y) {
    if (!isNum(x)) return fail('bad_value');
    if (!isNum(y)) return fail('bad_base');
    if (y === 0) return fail('zero_base');
    var out = x / y * 100;
    if (!isFinite(out)) return fail('overflow');
    return { ok: true, value: out };
  }

  /* Percentage change from `from` to `to`, using |from| as the denominator. */
  function percentChange(from, to) {
    if (!isNum(from)) return fail('bad_from');
    if (!isNum(to)) return fail('bad_to');
    if (from === 0) return fail('zero_base');
    var out = (to - from) / Math.abs(from) * 100;
    if (!isFinite(out)) return fail('overflow');
    var direction = out > 0 ? 'increase' : out < 0 ? 'decrease' : 'none';
    return { ok: true, value: out, direction: direction };
  }

  /* Apply a percentage increase or decrease to `value`. A negative percentage
     reverses the direction, which is the expected algebraic behavior. */
  function applyPercent(value, percent, mode) {
    if (!isNum(value)) return fail('bad_value');
    if (!isNum(percent)) return fail('bad_percent');
    var dir = mode == null ? 'increase' : mode;
    if (dir !== 'increase' && dir !== 'decrease') return fail('bad_mode');
    var factor = 1 + (dir === 'increase' ? percent : -percent) / 100;
    var out = value * factor;
    if (!isFinite(out)) return fail('overflow');
    return { ok: true, value: out };
  }

  /* Fixed-decimal display text plus the rounded numeric value. */
  function formatNumber(n, decimals) {
    var r = round(n, decimals);
    if (!r.ok) return r;
    var d = decimals == null ? 2 : decimals;
    return { ok: true, value: r.value, text: r.value.toFixed(d) };
  }

  return {
    percentOf: percentOf,
    whatPercent: whatPercent,
    percentChange: percentChange,
    applyPercent: applyPercent,
    formatNumber: formatNumber,
    round: round
  };
})();

  return ToolEngine;
  })();

  /* ---- statistics-calculator ---- */
  engines["statistics-calculator"] = (function () {

var ToolEngine = (function () {
  'use strict';

  var MAX_COUNT = 10000;
  var NUM_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

  function fail(code) {
    return { ok: false, error: code };
  }

  function parseNumbers(text) {
    if (typeof text !== 'string') return fail('bad_value');
    var tokens = text.trim().split(/[\s,;，、]+/).filter(function (t) { return t !== ''; });
    if (!tokens.length) return fail('empty_input');
    if (tokens.length > MAX_COUNT) return fail('too_many');
    var values = [];
    for (var i = 0; i < tokens.length; i++) {
      if (!NUM_RE.test(tokens[i])) return fail('bad_value');
      var n = Number(tokens[i]);
      if (!isFinite(n)) return fail('bad_value');
      values.push(n);
    }
    return { ok: true, values: values };
  }

  function valid(values) {
    if (!Array.isArray(values) || values.length === 0) return false;
    for (var i = 0; i < values.length; i++) {
      if (typeof values[i] !== 'number' || !isFinite(values[i])) return false;
    }
    return true;
  }

  // Kahan compensated summation to reduce floating-point drift on long lists.
  function kahan(values) {
    var sum = 0;
    var c = 0;
    for (var i = 0; i < values.length; i++) {
      var y = values[i] - c;
      var t = sum + y;
      c = (t - sum) - y;
      sum = t;
    }
    return sum;
  }

  function sum(values) {
    if (!valid(values)) return fail('bad_value');
    return { ok: true, value: kahan(values) };
  }

  function mean(values) {
    if (!valid(values)) return fail('bad_value');
    return { ok: true, value: kahan(values) / values.length };
  }

  function sortedCopy(values) {
    return values.slice().sort(function (a, b) { return a - b; });
  }

  function median(values) {
    if (!valid(values)) return fail('bad_value');
    var s = sortedCopy(values);
    var mid = Math.floor(s.length / 2);
    var value = s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    return { ok: true, value: value };
  }

  function mode(values) {
    if (!valid(values)) return fail('bad_value');
    var counts = new Map();
    for (var i = 0; i < values.length; i++) {
      counts.set(values[i], (counts.get(values[i]) || 0) + 1);
    }
    var maxCount = 0;
    counts.forEach(function (count) {
      if (count > maxCount) maxCount = count;
    });
    var modes = [];
    if (maxCount > 1) {
      counts.forEach(function (count, value) {
        if (count === maxCount) modes.push(value);
      });
      modes.sort(function (a, b) { return a - b; });
    }
    return {
      ok: true,
      value: { modes: modes, maxCount: maxCount, hasMode: modes.length > 0 }
    };
  }

  function rangeOf(values) {
    if (!valid(values)) return fail('bad_value');
    var min = values[0];
    var max = values[0];
    for (var i = 1; i < values.length; i++) {
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    return { ok: true, value: max - min, min: min, max: max };
  }

  function variance(values, sample) {
    if (!valid(values)) return fail('bad_value');
    var n = values.length;
    if (sample && n < 2) return fail('need_two');
    var m = kahan(values) / n;
    var squared = [];
    for (var i = 0; i < n; i++) {
      var d = values[i] - m;
      squared.push(d * d);
    }
    return { ok: true, value: kahan(squared) / (sample ? n - 1 : n) };
  }

  function stdev(values, sample) {
    var v = variance(values, sample);
    if (!v.ok) return v;
    return { ok: true, value: Math.sqrt(v.value) };
  }

  function quantile(sorted, p) {
    var pos = (sorted.length - 1) * p;
    var lo = Math.floor(pos);
    var hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  function quartiles(values) {
    if (!valid(values)) return fail('bad_value');
    var s = sortedCopy(values);
    var q1 = quantile(s, 0.25);
    var q2 = quantile(s, 0.5);
    var q3 = quantile(s, 0.75);
    return { ok: true, value: { q1: q1, q2: q2, q3: q3, iqr: q3 - q1 } };
  }

  function summarize(values) {
    if (!valid(values)) return fail('bad_value');
    var n = values.length;
    var total = kahan(values);
    var avg = total / n;
    var med = median(values).value;
    var modeResult = mode(values).value;
    var rangeResult = rangeOf(values);
    var squared = [];
    for (var i = 0; i < n; i++) {
      var d = values[i] - avg;
      squared.push(d * d);
    }
    var ss = kahan(squared);
    var quart = quartiles(values).value;
    return {
      ok: true,
      value: {
        count: n,
        sum: total,
        mean: avg,
        median: med,
        modes: modeResult.modes,
        maxCount: modeResult.maxCount,
        hasMode: modeResult.hasMode,
        min: rangeResult.min,
        max: rangeResult.max,
        range: rangeResult.value,
        variancePopulation: ss / n,
        stdevPopulation: Math.sqrt(ss / n),
        varianceSample: n > 1 ? ss / (n - 1) : null,
        stdevSample: n > 1 ? Math.sqrt(ss / (n - 1)) : null,
        q1: quart.q1,
        q2: quart.q2,
        q3: quart.q3,
        iqr: quart.iqr,
        sorted: sortedCopy(values)
      }
    };
  }

  return {
    parseNumbers: parseNumbers,
    sum: sum,
    mean: mean,
    median: median,
    mode: mode,
    range: rangeOf,
    variance: variance,
    stdev: stdev,
    quartiles: quartiles,
    summarize: summarize
  };
})();

  return ToolEngine;
  })();

  /* ---- unit-converter ---- */
  engines["unit-converter"] = (function () {

var ToolEngine = (function () {
  'use strict';

  /* Pure conversion engine. Linear categories store one factor to a base unit.
     Temperature is affine, so it uses explicit to-base / from-base functions.
     The engine never touches the DOM, storage, or the clock. */

  function isNum(n) {
    return typeof n === 'number' && isFinite(n);
  }

  function fail(code) {
    return { ok: false, error: code };
  }

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  var CATS = {
    length: {
      base: 'm',
      factor: {
        mm: 0.001, cm: 0.01, m: 1, km: 1000,
        in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852
      }
    },
    mass: {
      base: 'kg',
      factor: {
        mg: 0.000001, g: 0.001, kg: 1, t: 1000,
        oz: 0.028349523125, lb: 0.45359237, st: 6.35029318
      }
    },
    area: {
      base: 'm2',
      factor: {
        mm2: 0.000001, cm2: 0.0001, m2: 1, km2: 1000000,
        ha: 10000, acre: 4046.8564224, ft2: 0.09290304, yd2: 0.83612736
      }
    },
    volume: {
      base: 'l',
      factor: {
        ml: 0.001, l: 1, m3: 1000,
        tsp: 0.00492892159375,
        tbsp: 0.01478676478125,
        cup: 0.2365882365,
        floz: 0.0295735295625,
        gal: 3.785411784
      }
    },
    temperature: {
      base: 'c',
      affine: true,
      factor: { c: 1, f: 1, k: 1 }
    },
    speed: {
      base: 'mps',
      factor: {
        mps: 1, kmh: 1 / 3.6, mph: 0.44704,
        knot: 1852 / 3600, fps: 0.3048
      }
    },
    data: {
      base: 'byte',
      factor: {
        b: 1, kb: 1000, mb: 1000000, gb: 1000000000, tb: 1000000000000,
        kib: 1024, mib: 1048576, gib: 1073741824, tib: 1099511627776
      }
    },
    time: {
      base: 's',
      factor: {
        ms: 0.001, s: 1, min: 60, h: 3600, d: 86400, wk: 604800
      }
    }
  };

  var ORDER = ['length', 'mass', 'area', 'volume', 'temperature', 'speed', 'data', 'time'];

  function tempToC(value, id) {
    if (id === 'c') return value;
    if (id === 'f') return (value - 32) * 5 / 9;
    return value - 273.15; /* k */
  }

  function tempFromC(value, id) {
    if (id === 'c') return value;
    if (id === 'f') return value * 9 / 5 + 32;
    return value + 273.15; /* k */
  }

  /* Convert one value between two units of the same category. */
  function convert(category, value, from, to) {
    var cat = CATS[category];
    if (!cat) return fail('unknown_category');
    if (!isNum(value)) return fail('bad_value');
    if (!has(cat.factor, from) || !has(cat.factor, to)) return fail('unknown_unit');
    var out;
    if (cat.affine) {
      out = tempFromC(tempToC(value, from), to);
    } else {
      out = value * cat.factor[from] / cat.factor[to];
    }
    if (!isFinite(out)) return fail('overflow');
    return { ok: true, value: out };
  }

  /* Convert one value into every unit of the category, in display order. */
  function convertAll(category, value, from) {
    var cat = CATS[category];
    if (!cat) return fail('unknown_category');
    if (!isNum(value)) return fail('bad_value');
    if (!has(cat.factor, from)) return fail('unknown_unit');
    var ids = Object.keys(cat.factor);
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var r = convert(category, value, from, ids[i]);
      if (!r.ok) return r;
      out.push({ id: ids[i], value: r.value });
    }
    return { ok: true, value: out };
  }

  /* Unit metadata: id + factor (temperature factors are placeholders because
     that category converts through the affine functions above). */
  function units(category) {
    var cat = CATS[category];
    if (!cat) return fail('unknown_category');
    var ids = Object.keys(cat.factor);
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      out.push({ id: ids[i], factor: cat.factor[ids[i]] });
    }
    return { ok: true, value: out };
  }

  function round(n, decimals) {
    if (!isNum(n)) return fail('bad_value');
    var d = decimals == null ? 4 : decimals;
    if (!isNum(d) || d < 0 || d > 8 || Math.floor(d) !== d) return fail('bad_decimals');
    var f = Math.pow(10, d);
    var abs = Math.abs(n);
    var rounded = Math.floor(abs * f + 0.5 + 1e-9) / f;
    if (rounded === 0) return { ok: true, value: 0 };
    return { ok: true, value: n < 0 ? -rounded : rounded };
  }

  return {
    categories: ORDER.slice(),
    units: units,
    convert: convert,
    convertAll: convertAll,
    round: round
  };
})();

  return ToolEngine;
  })();

  /* ---- cooking-converter ---- */
  engines["cooking-converter"] = (function () {

var ToolEngine = (function () {
  'use strict';

  // TOOL_ENGINE_START
  var VOLUME_ML = {
    cup: 236.5882365,
    tbsp: 14.7867648,
    tsp: 4.92892159,
    floz: 29.5735295625,
    ml: 1,
    l: 1000
  };
  var WEIGHT_G = { g: 1, oz: 28.349523125, lb: 453.59237, kg: 1000 };
  var DENSITY = { water: 1.0, flour: 0.53, sugar: 0.85, rice: 0.85, butter: 0.911, milk: 1.03 };
  var MAX = 1e15;

  function isNum(n) {
    return typeof n === 'number' && isFinite(n);
  }

  function fail(code) {
    return { ok: false, error: code };
  }

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function isVolume(unit) {
    return typeof unit === 'string' && has(VOLUME_ML, unit);
  }

  function isWeight(unit) {
    return typeof unit === 'string' && has(WEIGHT_G, unit);
  }

  function unitFactor(unit) {
    if (isVolume(unit)) return { ok: true, kind: 'volume', value: VOLUME_ML[unit] };
    if (isWeight(unit)) return { ok: true, kind: 'weight', value: WEIGHT_G[unit] };
    return fail('bad_unit');
  }

  function volumeToMl(amount, unit) {
    if (!isNum(amount)) return fail('bad_value');
    if (amount < 0) return fail('range');
    if (!isVolume(unit)) return fail('bad_unit');
    var out = amount * VOLUME_ML[unit];
    if (!isFinite(out) || out > MAX) return fail('overflow');
    return { ok: true, value: out };
  }

  function weightToG(amount, unit) {
    if (!isNum(amount)) return fail('bad_value');
    if (amount < 0) return fail('range');
    if (!isWeight(unit)) return fail('bad_unit');
    var out = amount * WEIGHT_G[unit];
    if (!isFinite(out) || out > MAX) return fail('overflow');
    return { ok: true, value: out };
  }

  function densityOf(ingredient) {
    if (typeof ingredient !== 'string' || !has(DENSITY, ingredient)) return fail('not_found');
    return { ok: true, value: DENSITY[ingredient] };
  }

  function ingredients() {
    return Object.keys(DENSITY);
  }

  function convertIngredient(amount, from, to, ingredient) {
    if (!isNum(amount)) return fail('bad_value');
    if (amount < 0) return fail('range');
    if (!isVolume(from) && !isWeight(from)) return fail('bad_unit');
    if (!isVolume(to) && !isWeight(to)) return fail('bad_unit');
    var dense = densityOf(ingredient);
    if (!dense.ok) return dense;

    var ml;
    var grams;
    if (isVolume(from)) {
      ml = amount * VOLUME_ML[from];
      grams = ml * dense.value;
    } else {
      grams = amount * WEIGHT_G[from];
      ml = grams / dense.value;
    }

    var value;
    var fromKind = isVolume(from) ? 'volume' : 'weight';
    var toKind = isVolume(to) ? 'volume' : 'weight';
    if (fromKind === toKind) {
      if (toKind === 'volume') value = ml / VOLUME_ML[to];
      else value = grams / WEIGHT_G[to];
    } else if (toKind === 'volume') {
      value = ml / VOLUME_ML[to];
    } else {
      value = grams / WEIGHT_G[to];
    }
    if (!isFinite(value) || value > MAX || !isFinite(ml) || !isFinite(grams)) return fail('overflow');
    return {
      ok: true,
      value: value,
      ml: ml,
      grams: grams,
      density: dense.value,
      fromKind: fromKind,
      toKind: toKind
    };
  }
  // TOOL_ENGINE_END

  return {
    volumeToMl: volumeToMl,
    weightToG: weightToG,
    convertIngredient: convertIngredient,
    densityOf: densityOf,
    ingredients: ingredients,
    unitFactor: unitFactor,
    isNum: isNum
  };
})();

  return ToolEngine;
  })();

  /* ---- paper-size-converter ---- */
  engines["paper-size-converter"] = (function () {

var ToolEngine = (function () {
  'use strict';

  // TOOL_ENGINE_START
  var SIZES = (function () {
    var out = [];
    var a = [[841, 1189], [594, 841], [420, 594], [297, 420], [210, 297], [148, 210],
      [105, 148], [74, 105], [52, 74], [37, 52], [26, 37]];
    var b = [[1000, 1414], [707, 1000], [500, 707], [353, 500], [250, 353], [176, 250],
      [125, 176], [88, 125], [62, 88], [44, 62], [31, 44]];
    var c = [[917, 1297], [648, 917], [458, 648], [324, 458], [229, 324], [162, 229],
      [114, 162], [81, 114], [57, 81], [40, 57], [28, 40]];
    var i;
    for (i = 0; i < a.length; i++) out.push({ name: 'A' + i, widthMm: a[i][0], heightMm: a[i][1], group: 'A' });
    for (i = 0; i < b.length; i++) out.push({ name: 'B' + i, widthMm: b[i][0], heightMm: b[i][1], group: 'B' });
    for (i = 0; i < c.length; i++) out.push({ name: 'C' + i, widthMm: c[i][0], heightMm: c[i][1], group: 'C' });
    out.push({ name: 'Letter', widthMm: 215.9, heightMm: 279.4, group: 'Letter' });
    out.push({ name: 'Legal', widthMm: 215.9, heightMm: 355.6, group: 'Legal' });
    return out;
  })();
  var MAX_PX = 1e9;

  function isNum(n) {
    return typeof n === 'number' && isFinite(n);
  }

  function fail(code) {
    return { ok: false, error: code };
  }

  function paperSize(name) {
    if (typeof name !== 'string') return fail('bad_value');
    var key = name.trim().toUpperCase();
    if (!key) return fail('bad_value');
    for (var i = 0; i < SIZES.length; i++) {
      if (SIZES[i].name.toUpperCase() === key) {
        return {
          ok: true,
          name: SIZES[i].name,
          widthMm: SIZES[i].widthMm,
          heightMm: SIZES[i].heightMm,
          group: SIZES[i].group
        };
      }
    }
    return fail('not_found');
  }

  function sizes() {
    return SIZES.map(function (item) {
      return { name: item.name, widthMm: item.widthMm, heightMm: item.heightMm, group: item.group };
    });
  }

  function toPixels(mm, dpi) {
    if (!isNum(mm) || !isNum(dpi)) return fail('bad_value');
    if (mm < 0) return fail('range');
    if (dpi <= 0) return fail('range');
    var raw = (mm / 25.4) * dpi;
    var value = Math.floor(raw + 0.5 + 1e-9);
    if (!isFinite(value) || value > MAX_PX) return fail('overflow');
    return { ok: true, value: value, dpi: dpi };
  }

  function toInches(mm) {
    if (!isNum(mm)) return fail('bad_value');
    if (mm < 0) return fail('range');
    return { ok: true, value: mm / 25.4 };
  }

  function paperPixels(name, dpi) {
    var size = paperSize(name);
    if (!size.ok) return size;
    if (!isNum(dpi) || dpi <= 0) return fail(isNum(dpi) ? 'range' : 'bad_value');
    var w = toPixels(size.widthMm, dpi);
    if (!w.ok) return w;
    var h = toPixels(size.heightMm, dpi);
    if (!h.ok) return h;
    return {
      ok: true,
      name: size.name,
      widthMm: size.widthMm,
      heightMm: size.heightMm,
      widthPx: w.value,
      heightPx: h.value,
      dpi: dpi
    };
  }

  function scaleRatio(sourceName, targetName) {
    var source = paperSize(sourceName);
    if (!source.ok) return source;
    var target = paperSize(targetName);
    if (!target.ok) return target;
    var widthRatio = target.widthMm / source.widthMm;
    var heightRatio = target.heightMm / source.heightMm;
    var fitScale = Math.min(widthRatio, heightRatio);
    var areaRatio = (target.widthMm * target.heightMm) / (source.widthMm * source.heightMm);
    return {
      ok: true,
      source: source.name,
      target: target.name,
      widthRatio: widthRatio,
      heightRatio: heightRatio,
      fitScale: fitScale,
      areaRatio: areaRatio,
      fitsWithoutScaling: widthRatio >= 1 && heightRatio >= 1
    };
  }
  // TOOL_ENGINE_END

  return {
    paperSize: paperSize,
    sizes: sizes,
    toPixels: toPixels,
    toInches: toInches,
    paperPixels: paperPixels,
    scaleRatio: scaleRatio,
    isNum: isNum
  };
})();

  return ToolEngine;
  })();

  /* ---- aspect-ratio-calculator ---- */
  engines["aspect-ratio-calculator"] = (function () {

var ToolEngine = (function () {
  'use strict';

  var CAP_SIDE = 10000000;
  var CAP_RATIO = 1000000;
  var SCALE_INT = 1000000;

  function isNum(n) {
    return typeof n === 'number' && isFinite(n);
  }

  function fail(code) {
    return { ok: false, error: code };
  }

  function gcd(a, b) {
    while (b) {
      var t = a % b;
      a = b;
      b = t;
    }
    return a;
  }

  function validSide(n) {
    return isNum(n) && n > 0 && n <= CAP_SIDE;
  }

  function validRatioTerm(n) {
    return isNum(n) && n > 0 && n <= CAP_RATIO;
  }

  function simplifyRatio(width, height) {
    if (!validSide(width)) return fail('bad_width');
    if (!validSide(height)) return fail('bad_height');
    var a = Math.round(width * SCALE_INT);
    var b = Math.round(height * SCALE_INT);
    if (!isFinite(a) || !isFinite(b) || a <= 0 || b <= 0) return fail('overflow');
    var g = gcd(a, b);
    var ratioW = a / g;
    var ratioH = b / g;
    if (!isFinite(ratioW) || !isFinite(ratioH) || ratioW > 1e12 || ratioH > 1e12) return fail('overflow');
    return {
      ok: true,
      ratioW: ratioW,
      ratioH: ratioH,
      decimal: width / height
    };
  }

  function solve(input) {
    if (!input || typeof input !== 'object') return fail('bad_value');
    var mode = input.mode;
    if (mode === 'height') {
      if (!validSide(input.width)) return fail('bad_width');
      if (!validRatioTerm(input.ratioW) || !validRatioTerm(input.ratioH)) return fail('bad_ratio');
      var h = input.width * input.ratioH / input.ratioW;
      if (!isFinite(h) || h <= 0 || h > CAP_SIDE * 100) return fail('overflow');
      return {
        ok: true,
        mode: 'height',
        width: input.width,
        height: h,
        ratioW: input.ratioW,
        ratioH: input.ratioH,
        decimal: input.width / h
      };
    }
    if (mode === 'width') {
      if (!validSide(input.height)) return fail('bad_height');
      if (!validRatioTerm(input.ratioW) || !validRatioTerm(input.ratioH)) return fail('bad_ratio');
      var w = input.height * input.ratioW / input.ratioH;
      if (!isFinite(w) || w <= 0 || w > CAP_SIDE * 100) return fail('overflow');
      return {
        ok: true,
        mode: 'width',
        width: w,
        height: input.height,
        ratioW: input.ratioW,
        ratioH: input.ratioH,
        decimal: w / input.height
      };
    }
    if (mode === 'ratio') {
      var r = simplifyRatio(input.width, input.height);
      if (!r.ok) return r;
      return {
        ok: true,
        mode: 'ratio',
        width: input.width,
        height: input.height,
        ratioW: r.ratioW,
        ratioH: r.ratioH,
        decimal: r.decimal
      };
    }
    return fail('bad_mode');
  }

  function scale(width, height, target, which) {
    if (!validSide(width)) return fail('bad_width');
    if (!validSide(height)) return fail('bad_height');
    if (!validSide(target)) return fail('bad_target');
    if (which !== 'width' && which !== 'height') return fail('bad_mode');
    var factor;
    var newW;
    var newH;
    if (which === 'width') {
      factor = target / width;
      newW = target;
      newH = height * factor;
    } else {
      factor = target / height;
      newH = target;
      newW = width * factor;
    }
    if (!isFinite(newW) || !isFinite(newH) || newW <= 0 || newH <= 0 ||
        newW > CAP_SIDE * 100 || newH > CAP_SIDE * 100) {
      return fail('overflow');
    }
    return { ok: true, width: newW, height: newH, scale: factor, which: which };
  }

  var PRESETS = [
    { w: 16, h: 9 },
    { w: 4, h: 3 },
    { w: 1, h: 1 },
    { w: 9, h: 16 },
    { w: 21, h: 9 }
  ];

  return {
    PRESETS: PRESETS,
    gcd: gcd,
    simplifyRatio: simplifyRatio,
    solve: solve,
    scale: scale
  };
})();

  return ToolEngine;
  })();

  /* ---- loan-calculator ---- */
  engines["loan-calculator"] = (function () {

/* Loan math engine. Pure functions only: no DOM, no window, no dates.
   Invalid input throws TypeError whose message is an error code:
   'principal' | 'rate' | 'months' | 'extra' | 'method' | 'input'.
   All schedule/summary money values are integer cents. */
var ToolEngine = (function () {
  'use strict';

  var CURRENCIES = {
    CNY: { decimals: 2 },
    USD: { decimals: 2 },
    EUR: { decimals: 2 },
    IDR: { decimals: 0 }
  };

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function toCents(x) { return Math.round(x * 100); }
  function fromCents(c) { return c / 100; }

  function validateInputs(opts) {
    if (!opts || typeof opts !== 'object') { return { ok: false, error: 'input' }; }
    var p = opts.principal;
    var rate = opts.annualRate;
    var n = opts.months;
    var extra = opts.extra == null ? 0 : opts.extra;
    var method = opts.method == null ? 'annuity' : opts.method;
    if (!isNum(p) || p < 0.01 || p > 1e12) { return { ok: false, error: 'principal' }; }
    if (!isNum(rate) || rate < 0 || rate > 100) { return { ok: false, error: 'rate' }; }
    if (!isNum(n) || Math.floor(n) !== n || n < 1 || n > 600) { return { ok: false, error: 'months' }; }
    if (!isNum(extra) || extra < 0) { return { ok: false, error: 'extra' }; }
    if (method !== 'annuity' && method !== 'equal-principal') { return { ok: false, error: 'method' }; }
    return { ok: true };
  }

  function normalize(opts) {
    var v = validateInputs(opts);
    if (!v.ok) { throw new TypeError(v.error); }
    return {
      principal: opts.principal,
      annualRate: opts.annualRate,
      months: opts.months,
      extra: opts.extra == null ? 0 : opts.extra,
      method: opts.method == null ? 'annuity' : opts.method
    };
  }

  function pmtCents(p0, annualRate, n) {
    var r = annualRate / 1200;
    if (r === 0) { return Math.round(p0 / n); }
    var pow = Math.pow(1 + r, n);
    return Math.round(p0 * r * pow / (pow - 1));
  }

  function monthlyPayment(principal, annualRate, months) {
    var o = normalize({ principal: principal, annualRate: annualRate, months: months });
    return fromCents(pmtCents(toCents(o.principal), o.annualRate, o.months));
  }

  /* Principal repaid in equal-principal period i (1..n), based on the ideal
     balance P0 × (n − i) ÷ n. Rounding is distributed so the sum equals P0. */
  function idealPrincipal(p0, n, i) {
    var before = Math.round(p0 * (n - i + 1) / n);
    var after = Math.round(p0 * (n - i) / n);
    return before - after;
  }

  function equalPrincipalFirstPayment(principal, annualRate, months) {
    var o = normalize({ principal: principal, annualRate: annualRate, months: months });
    var p0 = toCents(o.principal);
    var r = o.annualRate / 1200;
    var principalPart = idealPrincipal(p0, o.months, 1);
    return fromCents(principalPart + Math.round(p0 * r));
  }

  function buildSchedule(opts) {
    var o = normalize(opts);
    var p0 = toCents(o.principal);
    var r = o.annualRate / 1200;
    var n = o.months;
    var extra = toCents(o.extra);
    var basePmt = o.method === 'annuity' ? pmtCents(p0, o.annualRate, n) : 0;
    var rows = [];
    var balance = p0;

    for (var i = 1; i <= n && balance > 0; i++) {
      var interest = Math.round(balance * r);
      var regular;
      var extraPart = 0;

      if (o.method === 'annuity') {
        if (i === n || balance + interest <= basePmt) {
          regular = balance;
        } else {
          regular = basePmt - interest;
          if (regular > balance) { regular = balance; }
          var room = balance - regular;
          extraPart = Math.min(extra, room);
        }
      } else {
        regular = i === n ? balance : idealPrincipal(p0, n, i);
        if (regular > balance) { regular = balance; }
        var room2 = balance - regular;
        extraPart = room2 > 0 ? Math.min(extra, room2) : 0;
      }

      var totalPrincipal = regular + extraPart;
      balance -= totalPrincipal;
      rows.push({
        period: i,
        payment: totalPrincipal + interest,
        principal: totalPrincipal,
        regularPrincipal: regular,
        interest: interest,
        extra: extraPart,
        balance: balance
      });
    }
    return rows;
  }

  function sumRows(rows, key) {
    var s = 0;
    for (var i = 0; i < rows.length; i++) { s += rows[i][key]; }
    return s;
  }

  function summarize(opts) {
    var o = normalize(opts);
    var rows = buildSchedule(o);
    var p0 = toCents(o.principal);
    var totalInterest = sumRows(rows, 'interest');
    var totalPayment = sumRows(rows, 'payment');
    var totalExtra = sumRows(rows, 'extra');
    var result = {
      method: o.method,
      principal: p0,
      firstPayment: rows.length ? rows[0].payment : 0,
      firstInterest: rows.length ? rows[0].interest : 0,
      totalInterest: totalInterest,
      totalPayment: totalPayment,
      totalPrincipal: sumRows(rows, 'principal'),
      totalExtra: totalExtra,
      actualMonths: rows.length,
      interestRatio: p0 > 0 ? totalInterest / p0 : 0,
      baselineInterest: totalInterest,
      baselineMonths: rows.length,
      extraInterestSaved: 0,
      extraMonthsSaved: 0
    };
    if (toCents(o.extra) > 0) {
      var baseline = buildSchedule({
        principal: o.principal,
        annualRate: o.annualRate,
        months: o.months,
        extra: 0,
        method: o.method
      });
      var baseInterest = sumRows(baseline, 'interest');
      result.baselineInterest = baseInterest;
      result.baselineMonths = baseline.length;
      result.extraInterestSaved = baseInterest - totalInterest;
      result.extraMonthsSaved = baseline.length - rows.length;
    }
    return result;
  }

  function formatMoney(amount, currency, lang) {
    if (!isNum(amount)) { return '—'; }
    var code = CURRENCIES[currency] ? currency : 'CNY';
    var decimals = CURRENCIES[code].decimals;
    var locale = lang === 'zh' ? 'zh-CN' : lang === 'id' ? 'id-ID' : 'en-US';
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: code,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }).format(amount);
    } catch (e) {
      return amount.toFixed(decimals);
    }
  }

  function parseAmount(value) {
    if (typeof value === 'number') { return isFinite(value) ? value : NaN; }
    if (typeof value !== 'string') { return NaN; }
    var s = value.trim().replace(/[\s,，]/g, '').replace(/[−–—]/g, '-');
    if (!s) { return NaN; }
    var direct = Number(s);
    if (isFinite(direct)) { return direct; }
    s = s.replace(/[^\d.\-+]/g, '');
    if (!s || s === '-' || s === '+' || s === '.') { return NaN; }
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  return {
    validateInputs: validateInputs,
    monthlyPayment: monthlyPayment,
    equalPrincipalFirstPayment: equalPrincipalFirstPayment,
    buildSchedule: buildSchedule,
    summarize: summarize,
    formatMoney: formatMoney,
    parseAmount: parseAmount,
    toCents: toCents,
    fromCents: fromCents,
    roundCents: function (x) { return Math.round(x * 100) / 100; },
    currencies: CURRENCIES
  };
})();

  return ToolEngine;
  })();

  /* ---- compound-interest-calculator ---- */
  engines["compound-interest-calculator"] = (function () {

var ToolEngine = (function () {
  'use strict';

  // TOOL_ENGINE_START
  var MAX_YEARS = 100;
  var FREQS = [1, 2, 4, 12, 365];

  function isNum(x) {
    return typeof x === 'number' && isFinite(x);
  }

  // Business rounding: half away from zero, to 2 decimals (minor unit).
  function round2(x) {
    if (!isNum(x)) return NaN;
    var neg = x < 0;
    var abs = Math.abs(x);
    var r = Math.floor(abs * 100 + 0.5 + 1e-9) / 100;
    return neg ? -r : r;
  }

  /*
   * compound(principal, annualRatePct, years, freq, monthlyAdd)
   * - years must be a whole number from 0 to 100
   * - freq is one of 1, 2, 4, 12, 365
   * - monthly deposits are converted to years*freq periods and added at
   *   each period end as monthlyAdd * (12 / freq)
   * - internal math keeps full precision; every returned money value is
   *   rounded to 2 decimals with half-away-from-zero rounding.
   */
  function compound(principal, annualRatePct, years, freq, monthlyAdd) {
    if (!isNum(principal) || principal < 0) return { ok: false, error: 'bad_principal' };
    if (!isNum(annualRatePct) || annualRatePct <= -100 || annualRatePct > 1000) {
      return { ok: false, error: 'bad_rate' };
    }
    if (!isNum(years) || years < 0 || Math.floor(years) !== years) {
      return { ok: false, error: 'bad_years' };
    }
    if (years > MAX_YEARS) return { ok: false, error: 'range' };
    if (!isNum(freq) || FREQS.indexOf(freq) === -1) return { ok: false, error: 'bad_freq' };
    if (!isNum(monthlyAdd) || monthlyAdd < 0) return { ok: false, error: 'bad_deposit' };

    var perRate = annualRatePct / 100 / freq;
    var depositPerPeriod = monthlyAdd * (12 / freq);
    var balance = principal;
    var deposits = 0;
    var schedule = [];

    for (var y = 1; y <= years; y++) {
      for (var p = 0; p < freq; p++) {
        balance = balance * (1 + perRate) + depositPerPeriod;
        deposits += depositPerPeriod;
        if (!isFinite(balance)) return { ok: false, error: 'overflow' };
      }
      var rowPrincipal = round2(principal + deposits);
      var rowBalance = round2(balance);
      schedule.push({
        year: y,
        balance: rowBalance,
        principal: rowPrincipal,
        interest: round2(rowBalance - rowPrincipal)
      });
    }

    var finalBalance = round2(balance);
    var principalTotal = round2(principal + deposits);
    return {
      ok: true,
      final: finalBalance,
      interest: round2(finalBalance - principalTotal),
      principalTotal: principalTotal,
      deposits: round2(deposits),
      schedule: schedule
    };
  }
  // TOOL_ENGINE_END

  return { compound: compound, round2: round2, isNum: isNum, FREQS: FREQS };
})();

  return ToolEngine;
  })();

  /* ---- savings-goal-calculator ---- */
  engines["savings-goal-calculator"] = (function () {

var ToolEngine = (function () {
  'use strict';

  // TOOL_ENGINE_START
  var MAX_MONTHS = 1200;

  function isNum(x) {
    return typeof x === 'number' && isFinite(x);
  }

  function round2(x) {
    if (!isNum(x)) return NaN;
    var neg = x < 0;
    var abs = Math.abs(x);
    var r = Math.floor(abs * 100 + 0.5 + 1e-9) / 100;
    return neg ? -r : r;
  }

  // The required deposit is rounded UP to cents so the plan always reaches
  // the target; projections use that rounded deposit.
  function ceil2(x) {
    if (!isNum(x)) return NaN;
    var neg = x < 0;
    var abs = Math.abs(x);
    var r = Math.ceil(abs * 100 - 1e-9) / 100;
    return neg ? -r : r;
  }

  function monthlyRate(annualRatePct) {
    return annualRatePct / 100 / 12;
  }

  function validCommon(target, current, annualRatePct) {
    if (!isNum(target) || target <= 0) return 'bad_target';
    if (!isNum(current) || current < 0) return 'bad_current';
    if (!isNum(annualRatePct) || annualRatePct < 0 || annualRatePct > 100) return 'bad_rate';
    return '';
  }

  /*
   * monthlyNeeded(target, current, annualRatePct, months)
   * End-of-month deposits, monthly compounding. Returns the deposit rounded
   * to cents (half away from zero) plus the projection using that rounded
   * deposit, so the displayed plan can be reproduced exactly.
   */
  function monthlyNeeded(target, current, annualRatePct, months) {
    var bad = validCommon(target, current, annualRatePct);
    if (bad) return { ok: false, error: bad };
    if (!isNum(months) || months <= 0 || Math.floor(months) !== months) {
      return { ok: false, error: 'bad_months' };
    }
    if (months > MAX_MONTHS) return { ok: false, error: 'range' };

    var i = monthlyRate(annualRatePct);
    var growth = Math.pow(1 + i, months);
    var fvCurrent = current * growth;
    if (current >= target || fvCurrent >= target) {
      return {
        ok: true,
        achieved: true,
        monthly: 0,
        exactMonthly: 0,
        projected: round2(Math.max(current, fvCurrent)),
        totalDeposits: 0,
        interest: round2(Math.max(current, fvCurrent) - current)
      };
    }

    var exact = i === 0 ? (target - current) / months
      : (target - fvCurrent) * i / (growth - 1);
    var monthly = ceil2(exact);
    var annuity = i === 0 ? months : (growth - 1) / i;
    var projectedRaw = fvCurrent + monthly * annuity;
    return {
      ok: true,
      achieved: false,
      monthly: monthly,
      exactMonthly: exact,
      projected: round2(projectedRaw),
      totalDeposits: round2(monthly * months),
      interest: round2(projectedRaw - current - monthly * months)
    };
  }

  /*
   * monthsToGoal(target, current, annualRatePct, monthly)
   * Returns the first whole month at which the balance reaches the target.
   */
  function monthsToGoal(target, current, annualRatePct, monthly) {
    var bad = validCommon(target, current, annualRatePct);
    if (bad) return { ok: false, error: bad };
    if (!isNum(monthly) || monthly <= 0) return { ok: false, error: 'bad_monthly' };
    if (current >= target) {
      return {
        ok: true, achieved: true, months: 0, exactMonths: 0,
        projected: round2(current), totalDeposits: 0, interest: 0
      };
    }

    var i = monthlyRate(annualRatePct);
    var exact;
    if (i === 0) {
      exact = (target - current) / monthly;
    } else {
      exact = Math.log((monthly + target * i) / (monthly + current * i)) / Math.log(1 + i);
    }
    if (!isFinite(exact) || exact < 0) return { ok: false, error: 'overflow' };
    var n = Math.ceil(exact - 1e-9);
    if (n > MAX_MONTHS) return { ok: false, error: 'range' };
    var growth = Math.pow(1 + i, n);
    var annuity = i === 0 ? n : (growth - 1) / i;
    var projectedRaw = current * growth + monthly * annuity;
    return {
      ok: true,
      achieved: false,
      months: n,
      exactMonths: exact,
      projected: round2(projectedRaw),
      totalDeposits: round2(monthly * n),
      interest: round2(projectedRaw - current - monthly * n)
    };
  }
  // TOOL_ENGINE_END

  return {
    monthlyNeeded: monthlyNeeded,
    monthsToGoal: monthsToGoal,
    round2: round2,
    ceil2: ceil2,
    isNum: isNum,
    MAX_MONTHS: MAX_MONTHS
  };
})();

  return ToolEngine;
  })();

  /* ---- roi-calculator ---- */
  engines["roi-calculator"] = (function () {

var ToolEngine = (function () {
  'use strict';

  // TOOL_ENGINE_START
  var LIMIT = 1e15;

  function isNum(n) {
    return typeof n === 'number' && isFinite(n);
  }
  function fail(code) {
    return { ok: false, error: code };
  }

  function netGain(costCents, returnCents) {
    if (!isNum(costCents)) return fail('bad_value');
    if (costCents === 0) return fail('zero_cost');
    if (costCents < 0) return fail('bad_value');
    if (!isNum(returnCents) || returnCents < 0) return fail('bad_value');
    var net = returnCents - costCents;
    if (!isFinite(net) || Math.abs(net) > LIMIT) return fail('overflow');
    return { ok: true, value: net };
  }

  function roi(costCents, returnCents) {
    var net = netGain(costCents, returnCents);
    if (!net.ok) return net;
    return {
      ok: true,
      costCents: costCents,
      returnCents: returnCents,
      netGainCents: net.value,
      roiPct: net.value / costCents * 100
    };
  }

  function annualizedRoi(costCents, returnCents, years) {
    var base = netGain(costCents, returnCents);
    if (!base.ok) return base;
    if (!isNum(years) || years <= 0) return fail('bad_years');
    if (returnCents <= 0) return { ok: true, value: -100 };
    var ratio = returnCents / costCents;
    var pct = (Math.pow(ratio, 1 / years) - 1) * 100;
    if (!isFinite(pct)) return fail('overflow');
    return { ok: true, value: pct };
  }

  function compute(opts) {
    opts = opts || {};
    var r = roi(opts.costCents, opts.returnCents);
    if (!r.ok) return r;
    var annual = null;
    if (opts.years != null) {
      var a = annualizedRoi(opts.costCents, opts.returnCents, opts.years);
      if (!a.ok) return a;
      annual = a.value;
    }
    var verdict = r.netGainCents > 0 ? 'gain' : (r.netGainCents < 0 ? 'loss' : 'even');
    return {
      ok: true,
      costCents: r.costCents,
      returnCents: r.returnCents,
      netGainCents: r.netGainCents,
      roiPct: r.roiPct,
      annualizedPct: annual,
      years: opts.years == null ? null : opts.years,
      multiple: r.returnCents / r.costCents,
      verdict: verdict
    };
  }
  // TOOL_ENGINE_END

  return {
    netGain: netGain,
    roi: roi,
    annualizedRoi: annualizedRoi,
    compute: compute,
    isNum: isNum
  };
})();

  return ToolEngine;
  })();

  /* ---- vat-calculator ---- */
  engines["vat-calculator"] = (function () {

var ToolEngine = (function () {
  'use strict';

  // TOOL_ENGINE_START
  function isNum(x) {
    return typeof x === 'number' && isFinite(x);
  }

  function round2(x) {
    if (!isNum(x)) return NaN;
    var neg = x < 0;
    var abs = Math.abs(x);
    var r = Math.floor(abs * 100 + 0.5 + 1e-9) / 100;
    return neg ? -r : r;
  }

  function checkAmount(amount) {
    if (!isNum(amount) || amount < 0) return 'bad_amount';
    return '';
  }

  function checkRate(ratePct) {
    if (!isNum(ratePct) || ratePct < 0 || ratePct > 100) return 'bad_rate';
    return '';
  }

  /*
   * addVat(netAmount, ratePct)
   * Net amount is rounded to cents first, then tax is calculated on it.
   * net + tax === gross exactly.
   */
  function addVat(netAmount, ratePct) {
    var bad = checkAmount(netAmount) || checkRate(ratePct);
    if (bad) return { ok: false, error: bad };
    var net = round2(netAmount);
    var tax = round2(net * ratePct / 100);
    var gross = round2(net + tax);
    if (!isFinite(gross)) return { ok: false, error: 'overflow' };
    return { ok: true, mode: 'add', net: net, tax: tax, gross: gross };
  }

  /*
   * extractVat(grossAmount, ratePct)
   * Gross amount is rounded to cents first; net is backed out and tax is the
   * difference, so net + tax === gross exactly.
   */
  function extractVat(grossAmount, ratePct) {
    var bad = checkAmount(grossAmount) || checkRate(ratePct);
    if (bad) return { ok: false, error: bad };
    var gross = round2(grossAmount);
    var net = round2(gross / (1 + ratePct / 100));
    var tax = round2(gross - net);
    if (!isFinite(tax)) return { ok: false, error: 'overflow' };
    return { ok: true, mode: 'extract', net: net, tax: tax, gross: gross };
  }
  // TOOL_ENGINE_END

  return {
    addVat: addVat,
    extractVat: extractVat,
    round2: round2,
    isNum: isNum
  };
})();

  return ToolEngine;
  })();

  /* ---- profit-margin-calculator ---- */
  engines["profit-margin-calculator"] = (function () {

var ToolEngine = (function () {
  'use strict';

  // TOOL_ENGINE_START
  var LIMIT = 1e15;

  function isNum(n) {
    return typeof n === 'number' && isFinite(n);
  }
  function fail(code) {
    return { ok: false, error: code };
  }
  function roundCents(x) {
    if (!isFinite(x)) return null;
    if (x === 0) return 0;
    var r = Math.floor(Math.abs(x) + 0.5 + 1e-9);
    if (!isFinite(r) || r > LIMIT) return null;
    return x < 0 ? -r : r;
  }

  function margin(costCents, priceCents) {
    if (!isNum(costCents)) return fail('bad_value');
    if (costCents === 0) return fail('zero_cost');
    if (costCents < 0) return fail('bad_value');
    if (!isNum(priceCents)) return fail('bad_value');
    if (priceCents === 0) return fail('zero_price');
    if (priceCents < 0) return fail('bad_value');
    var gross = priceCents - costCents;
    return {
      ok: true,
      costCents: costCents,
      priceCents: priceCents,
      grossProfitCents: gross,
      marginPct: gross / priceCents * 100,
      markupPct: gross / costCents * 100
    };
  }

  function priceForMargin(costCents, marginPct) {
    if (!isNum(costCents)) return fail('bad_value');
    if (costCents === 0) return fail('zero_cost');
    if (costCents < 0) return fail('bad_value');
    if (!isNum(marginPct)) return fail('bad_value');
    if (marginPct < 0 || marginPct >= 100) return fail('bad_margin');
    var price = roundCents(costCents / (1 - marginPct / 100));
    if (price == null) return fail('overflow');
    return { ok: true, value: price };
  }

  function compute(opts) {
    opts = opts || {};
    if (opts.mode === 'calc') {
      return margin(opts.costCents, opts.priceCents);
    }
    if (opts.mode === 'target') {
      var price = priceForMargin(opts.costCents, opts.targetMarginPct);
      if (!price.ok) return price;
      var m = margin(opts.costCents, price.value);
      if (!m.ok) return m;
      m.targetMarginPct = opts.targetMarginPct;
      return m;
    }
    return fail('bad_mode');
  }
  // TOOL_ENGINE_END

  return {
    margin: margin,
    priceForMargin: priceForMargin,
    compute: compute,
    roundCents: roundCents,
    isNum: isNum
  };
})();

  return ToolEngine;
  })();

  /* ---- bmi-calculator ---- */
  engines["bmi-calculator"] = (function () {

/*
 * Pure calculation engine. Invalid arguments throw TypeError or RangeError;
 * the UI validates ranges before calling in and translates error codes.
 */
var ToolEngine = (function () {
  'use strict';

  var ACTIVITY = Object.freeze({
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    veryActive: 1.9
  });

  var GOAL_DELTAS = Object.freeze({
    maintain: 0,
    mildLoss: -250,
    loss: -500,
    gain: 300
  });

  var LB_TO_KG = 0.45359237;
  var IN_TO_CM = 2.54;

  function num(x, name) {
    if (typeof x !== 'number' || !isFinite(x)) {
      throw new TypeError(name + ' must be a finite number');
    }
    return x;
  }

  function positive(x, name) {
    num(x, name);
    if (x <= 0) { throw new RangeError(name + ' must be greater than zero'); }
    return x;
  }

  function bmi(kg, cm) {
    positive(kg, 'weight');
    positive(cm, 'height');
    var m = cm / 100;
    return kg / (m * m);
  }

  function bmiCategory(value) {
    num(value, 'bmi');
    if (value < 0) { throw new RangeError('bmi must not be negative'); }
    if (value < 18.5) { return 'under'; }
    if (value < 25) { return 'normal'; }
    if (value < 30) { return 'over'; }
    return 'obese';
  }

  function healthyWeightRange(cm) {
    positive(cm, 'height');
    var m = cm / 100;
    var low = 18.5 * m * m;
    var high = 24.9 * m * m;
    return { min: low, max: high };
  }

  function bmrMifflin(sex, kg, cm, age) {
    positive(kg, 'weight');
    positive(cm, 'height');
    num(age, 'age');
    if (age < 0) { throw new RangeError('age must not be negative'); }
    var base = 10 * kg + 6.25 * cm - 5 * age;
    if (sex === 'male') { return base + 5; }
    if (sex === 'female') { return base - 161; }
    throw new TypeError('sex must be male or female');
  }

  function tdee(bmr, activity) {
    positive(bmr, 'bmr');
    var factor;
    if (typeof activity === 'string') {
      factor = ACTIVITY[activity];
      if (!factor) { throw new TypeError('unknown activity'); }
    } else {
      factor = num(activity, 'activity');
      if (factor <= 0) { throw new RangeError('activity factor must be positive'); }
    }
    return bmr * factor;
  }

  function calorieTargets(tdeeValue) {
    positive(tdeeValue, 'tdee');
    return {
      maintain: tdeeValue + GOAL_DELTAS.maintain,
      mildLoss: tdeeValue + GOAL_DELTAS.mildLoss,
      loss: tdeeValue + GOAL_DELTAS.loss,
      gain: tdeeValue + GOAL_DELTAS.gain
    };
  }

  function kgFromLb(lb) {
    num(lb, 'pounds');
    if (lb < 0) { throw new RangeError('pounds must not be negative'); }
    return lb * LB_TO_KG;
  }

  function cmFromFtIn(ft, inches) {
    num(ft, 'feet');
    num(inches, 'inches');
    if (ft < 0 || inches < 0) { throw new RangeError('height must not be negative'); }
    return (ft * 12 + inches) * IN_TO_CM;
  }

  return {
    bmi: bmi,
    bmiCategory: bmiCategory,
    healthyWeightRange: healthyWeightRange,
    bmrMifflin: bmrMifflin,
    tdee: tdee,
    calorieTargets: calorieTargets,
    kgFromLb: kgFromLb,
    cmFromFtIn: cmFromFtIn,
    activities: ACTIVITY,
    goals: GOAL_DELTAS
  };
})();

  return ToolEngine;
  })();

  /* ---- quadratic-solver ---- */
  engines["quadratic-solver"] = (function () {

var ToolEngine = (function () {
  'use strict';

  var MAX_ABS = 1e12;
  var REL_EPS = 1e-12;

  function fail(code) {
    return { ok: false, error: code };
  }

  function validNumber(n) {
    return typeof n === 'number' && isFinite(n) && Math.abs(n) <= MAX_ABS;
  }

  function noNegZero(n) {
    return n === 0 ? 0 : n;
  }

  function gcdInt(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) {
      var t = a % b;
      a = b;
      b = t;
    }
    return a;
  }

  function discriminant(a, b, c) {
    if (typeof a !== 'number' || typeof b !== 'number' || typeof c !== 'number') {
      return fail('bad_value');
    }
    if (!isFinite(a) || !isFinite(b) || !isFinite(c)) return fail('bad_value');
    if (Math.abs(a) > MAX_ABS || Math.abs(b) > MAX_ABS || Math.abs(c) > MAX_ABS) {
      return fail('range');
    }
    return { ok: true, value: b * b - 4 * a * c };
  }

  // Extract √n = k·√m with m squarefree. n must be a non-negative safe integer.
  function simplifySqrt(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || Math.floor(n) !== n || n > 1e12) {
      return fail('bad_value');
    }
    if (n === 0) return { ok: true, k: 0, m: 1 };
    var temp = n;
    var k = 1;
    var m = 1;
    for (var p = 2; p * p <= temp; p++) {
      if (temp % p === 0) {
        var e = 0;
        while (temp % p === 0) {
          temp /= p;
          e++;
        }
        k *= Math.pow(p, Math.floor(e / 2));
        if (e % 2 === 1) m *= p;
      }
    }
    if (temp > 1) m *= temp;
    return { ok: true, k: k, m: m };
  }

  function solveQuadratic(a, b, c) {
    if (typeof a !== 'number' || typeof b !== 'number' || typeof c !== 'number' ||
        !isFinite(a) || !isFinite(b) || !isFinite(c)) {
      return fail('bad_value');
    }
    if (Math.abs(a) > MAX_ABS || Math.abs(b) > MAX_ABS || Math.abs(c) > MAX_ABS) {
      return fail('range');
    }

    if (a === 0) {
      if (b === 0) {
        return {
          ok: true,
          mode: c === 0 ? 'identity' : 'none',
          a: a, b: b, c: c,
          discriminant: null,
          roots: [],
          vertex: null,
          factor: null,
          radical: null,
          sumRoots: null,
          productRoots: null
        };
      }
      var linearRoot = noNegZero(-c / b);
      return {
        ok: true,
        mode: 'linear',
        a: a, b: b, c: c,
        discriminant: null,
        roots: [{ re: linearRoot, im: 0 }],
        vertex: null,
        factor: null,
        radical: null,
        sumRoots: linearRoot,
        productRoots: null
      };
    }

    var rawDisc = b * b - 4 * a * c;
    var scale = Math.max(1, b * b, Math.abs(4 * a * c));
    var disc = Math.abs(rawDisc) < REL_EPS * scale ? 0 : rawDisc;
    var twoA = 2 * a;
    var re = noNegZero(-b / twoA);
    var mode;
    var roots;

    if (disc > 0) {
      var sq = Math.sqrt(disc);
      // Stable form of the quadratic formula: compute the larger-magnitude
      // numerator first, then obtain the other root from the product c/a.
      var q = -0.5 * (b + (b >= 0 ? sq : -sq));
      var rootA;
      var rootB;
      if (q === 0) {
        rootA = 0;
        rootB = noNegZero(-b / a);
      } else {
        rootA = noNegZero(q / a);
        rootB = noNegZero(c / q);
      }
      roots = [{ re: rootA, im: 0 }, { re: rootB, im: 0 }];
      roots.sort(function (p, q2) { return p.re - q2.re; });
      mode = 'two_real';
    } else if (disc === 0) {
      roots = [{ re: re, im: 0 }];
      mode = 'repeated';
    } else {
      var im = Math.sqrt(-disc) / Math.abs(twoA);
      roots = [{ re: re, im: im }, { re: re, im: -im }];
      mode = 'complex';
    }

    var vertex = { x: re, y: noNegZero(-disc / (4 * a)) };
    var factor = null;
    if (mode === 'two_real') {
      factor = { a: a, r1: roots[0].re, r2: roots[1].re, repeated: false };
    } else if (mode === 'repeated') {
      factor = { a: a, r1: roots[0].re, r2: roots[0].re, repeated: true };
    }

    var radical = null;
    if ((mode === 'two_real' || mode === 'complex') &&
        Number.isInteger(a) && Number.isInteger(b) && Number.isInteger(c) &&
        Number.isInteger(disc) && Math.abs(disc) <= 1e12) {
      var simp = simplifySqrt(Math.abs(disc));
      if (simp.ok) {
        var n = -b;
        var den = twoA;
        if (den < 0) {
          n = -n;
          den = -den;
        }
        var k = simp.k;
        var common = gcdInt(gcdInt(Math.abs(n), k), den);
        if (common > 1) {
          n /= common;
          k /= common;
          den /= common;
        }
        radical = { n: n, k: k, m: simp.m, den: den, complex: disc < 0 };
      }
    }

    return {
      ok: true,
      mode: mode,
      a: a, b: b, c: c,
      discriminant: disc,
      discriminantRaw: rawDisc,
      roots: roots,
      vertex: vertex,
      factor: factor,
      radical: radical,
      sumRoots: noNegZero(-b / a),
      productRoots: c / a
    };
  }

  return {
    discriminant: discriminant,
    simplifySqrt: simplifySqrt,
    solveQuadratic: solveQuadratic
  };
})();

  return ToolEngine;
  })();

  /* ---- gcd-lcm-calculator ---- */
  engines["gcd-lcm-calculator"] = (function () {

var ToolEngine = (function () {
  'use strict';

  var MAX_COUNT = 20;
  var MAX_DIGITS = 40;
  var FACTOR_LIMIT = 1000000000000n;
  var SUPER = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

  function fail(code) {
    return { ok: false, error: code };
  }

  function absBig(n) {
    return n < 0n ? -n : n;
  }

  function toBig(value) {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && isFinite(value) && Math.floor(value) === value &&
        Math.abs(value) <= 9007199254740991) {
      return BigInt(value);
    }
    if (typeof value === 'string') {
      var s = value.trim();
      if (/^[+-]?\d+$/.test(s) && s.replace(/^[+-]/, '').length <= MAX_DIGITS) {
        return BigInt(s);
      }
    }
    return null;
  }

  function gcdValue(a, b) {
    var x = absBig(a);
    var y = absBig(b);
    while (y) {
      var t = x % y;
      x = y;
      y = t;
    }
    return x;
  }

  function lcmValue(a, b) {
    if (a === 0n || b === 0n) return 0n;
    return absBig((a / gcdValue(a, b)) * b);
  }

  function gcd(a, b) {
    var x = toBig(a);
    var y = toBig(b);
    if (x === null || y === null) return fail('bad_value');
    return { ok: true, value: gcdValue(x, y) };
  }

  function lcm(a, b) {
    var x = toBig(a);
    var y = toBig(b);
    if (x === null || y === null) return fail('bad_value');
    return { ok: true, value: lcmValue(x, y) };
  }

  function parseList(text) {
    if (typeof text !== 'string') return fail('bad_value');
    var tokens = text.trim().split(/[\s,;，、]+/).filter(function (t) { return t !== ''; });
    if (!tokens.length) return fail('empty_input');
    if (tokens.length > MAX_COUNT) return fail('too_many');
    var values = [];
    for (var i = 0; i < tokens.length; i++) {
      if (!/^[+-]?\d+$/.test(tokens[i])) return fail('bad_value');
      var n = toBig(tokens[i]);
      if (n === null) return fail('bad_value');
      values.push(n);
    }
    return { ok: true, values: values };
  }

  function gcdAll(values) {
    if (!Array.isArray(values) || values.length === 0) return fail('bad_value');
    var acc = null;
    var steps = [];
    for (var i = 0; i < values.length; i++) {
      var n = toBig(values[i]);
      if (n === null) return fail('bad_value');
      acc = acc === null ? absBig(n) : gcdValue(acc, n);
      steps.push(acc.toString());
    }
    return { ok: true, value: acc, steps: steps };
  }

  function lcmAll(values) {
    if (!Array.isArray(values) || values.length === 0) return fail('bad_value');
    var acc = null;
    var steps = [];
    for (var i = 0; i < values.length; i++) {
      var n = toBig(values[i]);
      if (n === null) return fail('bad_value');
      acc = acc === null ? absBig(n) : lcmValue(acc, n);
      steps.push(acc.toString());
    }
    return { ok: true, value: acc, steps: steps };
  }

  function factorize(value) {
    var n = toBig(value);
    if (n === null) return fail('bad_value');
    var negative = n < 0n;
    var m = absBig(n);
    if (m === 0n) return fail('undefined_zero');
    if (m === 1n) return { ok: true, factors: [], negative: negative, one: true };
    if (m > FACTOR_LIMIT) return fail('factor_limit');

    var factors = [];
    function push(p) {
      var last = factors[factors.length - 1];
      if (last && last.p === p) last.e += 1;
      else factors.push({ p: p, e: 1 });
    }

    var small = [2n, 3n];
    for (var i = 0; i < small.length; i++) {
      while (m % small[i] === 0n) {
        push(small[i]);
        m /= small[i];
      }
    }
    var d = 5n;
    var step = 2n;
    while (d * d <= m) {
      while (m % d === 0n) {
        push(d);
        m /= d;
      }
      d += step;
      step = 6n - step;
    }
    if (m > 1n) push(m);
    return { ok: true, factors: factors, negative: negative, one: false };
  }

  function superscript(exp) {
    return String(exp).split('').map(function (ch) {
      var n = Number(ch);
      return isFinite(n) ? SUPER[n] : ch;
    }).join('');
  }

  function formatFactors(factors) {
    if (!Array.isArray(factors)) return '—';
    if (!factors.length) return '1';
    return factors.map(function (item) {
      var base = item.p.toString();
      return item.e > 1 ? base + superscript(item.e) : base;
    }).join(' × ');
  }

  return {
    gcd: gcd,
    lcm: lcm,
    gcdAll: gcdAll,
    lcmAll: lcmAll,
    parseList: parseList,
    factorize: factorize,
    formatFactors: formatFactors
  };
})();

  return ToolEngine;
  })();

  /* ---- date-calculator ---- */
  engines["date-calculator"] = (function () {

/* Date engine. Pure integer calendar math: no Date objects, no timezone,
   no DST. Dates are plain {y, m, d} objects. Strings must be YYYY-MM-DD.
   Invalid input throws TypeError with a code:
   'date' | 'number' | 'range' | 'order'. */
var ToolEngine = (function () {
  'use strict';

  function isInt(x) {
    return typeof x === 'number' && isFinite(x) && Math.floor(x) === x;
  }
  function isLeap(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }
  function daysInMonth(y, m) {
    var dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (m === 2 && isLeap(y)) { return 29; }
    return dim[m - 1];
  }
  function isValidDate(y, m, d) {
    if (!isInt(y) || !isInt(m) || !isInt(d)) { return false; }
    if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) { return false; }
    return d <= daysInMonth(y, m);
  }
  function parseDate(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      var o = { y: Number(value.y), m: Number(value.m), d: Number(value.d) };
      return isValidDate(o.y, o.m, o.d) ? o : null;
    }
    if (typeof value !== 'string') { return null; }
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) { return null; }
    var date = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
    return isValidDate(date.y, date.m, date.d) ? date : null;
  }
  function toDate(value) {
    var date = parseDate(value);
    if (!date) { throw new TypeError('date'); }
    return date;
  }
  function checkRange(date) {
    if (!date || date.y < 1 || date.y > 9999) { throw new TypeError('range'); }
    return date;
  }

  function toOrdinal(value) {
    var date = toDate(value);
    var y = date.y;
    var m = date.m;
    var d = date.d;
    y -= m <= 2 ? 1 : 0;
    var era = Math.floor(y / 400);
    var yoe = y - era * 400;
    var doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }

  function fromOrdinal(n) {
    if (!isInt(n)) { throw new TypeError('number'); }
    var z = n + 719468;
    var era = Math.floor(z / 146097);
    var doe = z - era * 146097;
    var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    var y = yoe + era * 400;
    var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    var mp = Math.floor((5 * doy + 2) / 153);
    var d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    var m = mp + (mp < 10 ? 3 : -9);
    y += m <= 2 ? 1 : 0;
    return checkRange({ y: y, m: m, d: d });
  }

  function diffDays(from, to) {
    return toOrdinal(to) - toOrdinal(from);
  }

  function weekdayIndex(value) {
    var ord = toOrdinal(value);
    return ((ord + 3) % 7 + 7) % 7; /* 0 = Monday … 6 = Sunday */
  }

  function addDays(value, n) {
    var date = toDate(value);
    if (!isInt(n)) { throw new TypeError('number'); }
    return fromOrdinal(toOrdinal(date) + n);
  }

  function addMonths(value, n) {
    var date = toDate(value);
    if (!isInt(n)) { throw new TypeError('number'); }
    var index = date.y * 12 + (date.m - 1) + n;
    var y = Math.floor(index / 12);
    var m = index - y * 12 + 1;
    var d = Math.min(date.d, daysInMonth(y, m));
    return checkRange({ y: y, m: m, d: d });
  }

  function addYears(value, n) {
    var date = toDate(value);
    if (!isInt(n)) { throw new TypeError('number'); }
    var y = date.y + n;
    var d = Math.min(date.d, daysInMonth(y, date.m));
    return checkRange({ y: y, m: date.m, d: d });
  }

  function calendarDiff(from, to) {
    var a = toDate(from);
    var b = toDate(to);
    var ordA = toOrdinal(a);
    var ordB = toOrdinal(b);
    var negative = ordB < ordA;
    var start = negative ? b : a;
    var end = negative ? a : b;
    var months = (end.y - start.y) * 12 + (end.m - start.m);
    var anchor = addMonths(start, months);
    while (toOrdinal(anchor) > toOrdinal(end)) {
      months -= 1;
      anchor = addMonths(start, months);
    }
    var days = toOrdinal(end) - toOrdinal(anchor);
    return {
      years: Math.floor(months / 12),
      months: months % 12,
      days: days,
      totalDays: ordB - ordA,
      negative: negative
    };
  }

  function countWeekdays(startOrd, endOrd) {
    if (endOrd < startOrd) { return 0; }
    var total = endOrd - startOrd + 1;
    var full = Math.floor(total / 7) * 5;
    var rem = total % 7;
    var wd = ((startOrd + 3) % 7 + 7) % 7;
    for (var i = 0; i < rem; i++) {
      if (wd < 5) { full += 1; }
      wd = (wd + 1) % 7;
    }
    return full;
  }

  /* Counts Monday–Friday in [from, to). With inclusive, the range becomes
     [from, to + 1), so both endpoints are counted. */
  function businessDays(from, to, inclusive) {
    var startOrd = toOrdinal(from);
    var endOrd = toOrdinal(to) - 1 + (inclusive ? 1 : 0);
    return countWeekdays(startOrd, endOrd);
  }

  function ageOn(birth, today) {
    var b = toDate(birth);
    var now = toDate(today);
    if (toOrdinal(b) > toOrdinal(now)) { throw new TypeError('order'); }
    var diff = calendarDiff(b, now);
    var candidate = addYears(b, now.y - b.y);
    if (toOrdinal(candidate) < toOrdinal(now)) {
      candidate = addYears(b, now.y - b.y + 1);
    }
    var daysTo = toOrdinal(candidate) - toOrdinal(now);
    return {
      years: diff.years,
      months: diff.months,
      days: diff.days,
      nextBirthday: candidate,
      daysToNextBirthday: daysTo,
      isBirthdayToday: daysTo === 0,
      isBirthdayTomorrow: daysTo === 1
    };
  }

  return {
    isLeap: isLeap,
    daysInMonth: daysInMonth,
    parseDate: parseDate,
    isValidDate: isValidDate,
    toOrdinal: toOrdinal,
    fromOrdinal: fromOrdinal,
    diffDays: diffDays,
    calendarDiff: calendarDiff,
    businessDays: businessDays,
    addDays: addDays,
    addMonths: addMonths,
    addYears: addYears,
    ageOn: ageOn,
    weekdayIndex: weekdayIndex
  };
})();

  return ToolEngine;
  })();

  /* ---- unix-timestamp-converter ---- */
  engines["unix-timestamp-converter"] = (function () {

var ToolEngine = (function () {
  'use strict';

  // TOOL_ENGINE_START
  function isNum(n) {
    return typeof n === 'number' && isFinite(n);
  }

  function fail(code) {
    return { ok: false, error: code };
  }

  function pad(n, width) {
    var s = String(Math.floor(n));
    while (s.length < width) s = '0' + s;
    return s;
  }

  function daysFromCivil(y, m, d) {
    var yy = y - (m <= 2 ? 1 : 0);
    var era = Math.floor(yy / 400);
    var yoe = yy - era * 400;
    var doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }

  function civilFromDays(z) {
    var shifted = z + 719468;
    var era = Math.floor(shifted / 146097);
    var doe = shifted - era * 146097;
    var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    var y = yoe + era * 400;
    var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    var mp = Math.floor((5 * doy + 2) / 153);
    var d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    var m = mp + (mp < 10 ? 3 : -9);
    return { y: y + (m <= 2 ? 1 : 0), m: m, d: d };
  }

  function daysInMonth(y, m) {
    if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  var MAX_MS = 8640000000000000;

  function partsFromMs(ms) {
    if (!isNum(ms)) return fail('bad_value');
    var whole = Math.floor(ms);
    if (Math.abs(whole) > MAX_MS) return fail('range');
    var days = Math.floor(whole / 86400000);
    var rem = whole - days * 86400000;
    var date = civilFromDays(days);
    var hh = Math.floor(rem / 3600000);
    rem -= hh * 3600000;
    var mm = Math.floor(rem / 60000);
    rem -= mm * 60000;
    var ss = Math.floor(rem / 1000);
    var milli = rem - ss * 1000;
    return {
      ok: true,
      value: { y: date.y, m: date.m, d: date.d, hh: hh, mm: mm, ss: ss, milli: milli }
    };
  }

  function dateTimeString(p) {
    return pad(p.y, 4) + '-' + pad(p.m, 2) + '-' + pad(p.d, 2) + 'T' +
      pad(p.hh, 2) + ':' + pad(p.mm, 2) + ':' + pad(p.ss, 2) + '.' + pad(p.milli, 3);
  }

  function isoUTC(ms) {
    var p = partsFromMs(ms);
    if (!p.ok) return p;
    return { ok: true, value: dateTimeString(p.value) + 'Z' };
  }

  function offsetSuffix(minutes) {
    var rounded = Math.round(minutes);
    var sign = rounded < 0 ? '-' : '+';
    var abs = Math.abs(rounded);
    return sign + pad(Math.floor(abs / 60), 2) + ':' + pad(abs % 60, 2);
  }

  // ISO string with an explicit numeric offset, e.g. 2024-01-01T08:00:00.000+08:00
  function isoWithOffset(ms, offsetMinutes) {
    if (!isNum(ms) || !isNum(offsetMinutes)) return fail('bad_value');
    var shifted = ms + offsetMinutes * 60000;
    var p = partsFromMs(shifted);
    if (!p.ok) return p;
    return { ok: true, value: dateTimeString(p.value) + offsetSuffix(offsetMinutes) };
  }

  function parseIso(text) {
    if (typeof text !== 'string') return fail('bad_value');
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text.trim());
    if (!m) return fail('bad_value');
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    var hh = m[4] == null ? 0 : Number(m[4]);
    var mm = m[5] == null ? 0 : Number(m[5]);
    var ss = m[6] == null ? 0 : Number(m[6]);
    var milli = m[7] == null ? 0 : Number((m[7] + '00').slice(0, 3));
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return fail('bad_value');
    if (hh > 23 || mm > 59 || ss > 59) return fail('bad_value');
    var offset = 0;
    var zone = m[8];
    if (zone && zone !== 'Z') {
      var zm = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
      if (!zm) return fail('bad_value');
      var oh = Number(zm[2]);
      var om = Number(zm[3]);
      if (oh > 23 || om > 59) return fail('bad_value');
      offset = (zm[1] === '-' ? -1 : 1) * (oh * 60 + om);
    }
    var ms = daysFromCivil(y, mo, d) * 86400000 + hh * 3600000 + mm * 60000 + ss * 1000 + milli;
    ms -= offset * 60000;
    if (Math.abs(ms) > MAX_MS) return fail('range');
    return { ok: true, value: ms };
  }

  // Values at or above 1e11 are treated as milliseconds (13 digits, year >= 1973).
  function detectUnit(value) {
    if (!isNum(value)) return fail('bad_value');
    return { ok: true, value: Math.abs(value) >= 100000000000 ? 'ms' : 's' };
  }

  function toMs(value, unit) {
    if (!isNum(value)) return fail('bad_value');
    var u = unit || 'auto';
    if (u === 'auto') {
      var detected = detectUnit(value);
      if (!detected.ok) return detected;
      u = detected.value;
    }
    if (u !== 's' && u !== 'ms') return fail('bad_unit');
    var ms = u === 's' ? value * 1000 : value;
    if (!isFinite(ms) || Math.abs(ms) > MAX_MS) return fail('range');
    return { ok: true, value: { ms: ms, unit: u } };
  }

  function toUnix(ms, unit) {
    if (!isNum(ms)) return fail('bad_value');
    var u = unit || 's';
    if (u === 's') return { ok: true, value: Math.floor(ms / 1000) };
    if (u === 'ms') return { ok: true, value: Math.floor(ms) };
    return fail('bad_unit');
  }
  // TOOL_ENGINE_END

  return {
    isNum: isNum,
    fail: fail,
    pad: pad,
    daysFromCivil: daysFromCivil,
    civilFromDays: civilFromDays,
    daysInMonth: daysInMonth,
    partsFromMs: partsFromMs,
    dateTimeString: dateTimeString,
    isoUTC: isoUTC,
    offsetSuffix: offsetSuffix,
    isoWithOffset: isoWithOffset,
    parseIso: parseIso,
    detectUnit: detectUnit,
    toMs: toMs,
    toUnix: toUnix
  };
})();

  return ToolEngine;
  })();

  /* ---- timezone-converter ---- */
  engines["timezone-converter"] = (function () {

var ToolEngine = (function () {
  'use strict';

  // TOOL_ENGINE_START
  function isNum(n) {
    return typeof n === 'number' && isFinite(n);
  }

  function isStr(s) {
    return typeof s === 'string' && s.length > 0;
  }

  function fail(code) {
    return { ok: false, error: code };
  }

  function pad(n, width) {
    var s = String(Math.floor(n));
    while (s.length < width) s = '0' + s;
    return s;
  }

  function daysFromCivil(y, m, d) {
    var yy = y - (m <= 2 ? 1 : 0);
    var era = Math.floor(yy / 400);
    var yoe = yy - era * 400;
    var doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }

  function daysInMonth(y, m) {
    if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  function validZone(zone) {
    if (!isStr(zone)) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      return true;
    } catch (e) {
      return false;
    }
  }

  function zoneParts(ts, zone) {
    if (!isNum(ts) || !validZone(zone)) return fail('bad_value');
    try {
      var fmt = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
        timeZone: zone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23'
      });
      var list = fmt.formatToParts(ts);
      var out = {};
      for (var i = 0; i < list.length; i++) {
        var type = list[i].type;
        if (type === 'year' || type === 'month' || type === 'day' ||
            type === 'hour' || type === 'minute' || type === 'second') {
          out[type] = Number(list[i].value);
        }
      }
      if (!isFinite(out.year) || !isFinite(out.month) || !isFinite(out.day) ||
          !isFinite(out.hour) || !isFinite(out.minute) || !isFinite(out.second)) {
        return fail('bad_value');
      }
      return {
        ok: true,
        value: {
          y: out.year, m: out.month, d: out.day,
          hh: out.hour, mm: out.minute, ss: out.second
        }
      };
    } catch (e) {
      return fail('bad_value');
    }
  }

  function offsetMinutes(ts, zone) {
    var p = zoneParts(ts, zone);
    if (!p.ok) return p;
    var v = p.value;
    var wallAsUtc = Date.UTC(v.y, v.m - 1, v.d, v.hh, v.mm, v.ss);
    var base = Math.floor(ts / 1000) * 1000;
    return { ok: true, value: (wallAsUtc - base) / 60000 };
  }

  function formatOffset(minutes) {
    if (!isNum(minutes)) return fail('bad_value');
    var rounded = Math.round(minutes);
    var sign = rounded < 0 ? '-' : '+';
    var abs = Math.abs(rounded);
    return { ok: true, value: sign + pad(Math.floor(abs / 60), 2) + ':' + pad(abs % 60, 2) };
  }

  function parseLocal(text) {
    if (typeof text !== 'string') return fail('bad_value');
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
    if (!m) return fail('bad_value');
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    var hh = Number(m[4]);
    var mm = Number(m[5]);
    var ss = m[6] == null ? 0 : Number(m[6]);
    if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return fail('bad_value');
    if (hh > 23 || mm > 59 || ss > 59) return fail('bad_value');
    return { ok: true, value: { y: y, m: mo, d: d, hh: hh, mm: mm, ss: ss } };
  }

  function formatWall(parts) {
    if (!parts || !isNum(parts.y) || !isNum(parts.m) || !isNum(parts.d)) return fail('bad_value');
    return {
      ok: true,
      value: pad(parts.y, 4) + '-' + pad(parts.m, 2) + '-' + pad(parts.d, 2) +
        'T' + pad(parts.hh || 0, 2) + ':' + pad(parts.mm || 0, 2) + ':' + pad(parts.ss || 0, 2)
    };
  }

  function sameWall(a, b) {
    return a.y === b.y && a.m === b.m && a.d === b.d &&
      a.hh === b.hh && a.mm === b.mm && a.ss === b.ss;
  }

  // Wall time in a zone -> epoch milliseconds.
  // Ambiguous fall-back times use the earlier occurrence; nonexistent
  // spring-forward times move forward by one hour (documented in the page).
  function wallToEpoch(parts, zone) {
    if (!parts || !validZone(zone)) return fail('bad_value');
    if (!isNum(parts.y) || !isNum(parts.m) || !isNum(parts.d) ||
        !isNum(parts.hh) || !isNum(parts.mm) || !isNum(parts.ss)) return fail('bad_value');
    var base = Date.UTC(parts.y, parts.m - 1, parts.d, parts.hh, parts.mm, parts.ss);
    if (!isFinite(base)) return fail('bad_value');
    var before = offsetMinutes(base - 86400000, zone);
    var after = offsetMinutes(base + 86400000, zone);
    if (!before.ok || !after.ok) return fail('bad_value');
    var tsBefore = base - before.value * 60000;
    var tsAfter = base - after.value * 60000;
    var beforeParts = zoneParts(tsBefore, zone);
    var afterParts = zoneParts(tsAfter, zone);
    var beforeOk = beforeParts.ok && sameWall(beforeParts.value, parts);
    var afterOk = afterParts.ok && sameWall(afterParts.value, parts);
    if (beforeOk && afterOk) return { ok: true, value: Math.min(tsBefore, tsAfter) };
    if (beforeOk) return { ok: true, value: tsBefore };
    if (afterOk) return { ok: true, value: tsAfter };
    // Nonexistent local time: move forward to the later mapping.
    return { ok: true, value: Math.max(tsBefore, tsAfter) };
  }

  function dayDelta(ts, from, to) {
    var a = zoneParts(ts, from);
    if (!a.ok) return a;
    var b = zoneParts(ts, to);
    if (!b.ok) return b;
    return {
      ok: true,
      value: daysFromCivil(b.value.y, b.value.m, b.value.d) - daysFromCivil(a.value.y, a.value.m, a.value.d)
    };
  }

  // local may be "YYYY-MM-DDTHH:MM[:SS]" or a {y,m,d,hh,mm,ss} object.
  function convertZone(local, from, to) {
    var parts = typeof local === 'string' ? parseLocal(local) : local;
    if (!parts || !parts.ok) return parts && parts.ok ? fail('bad_value') : (parts || fail('bad_value'));
    if (!validZone(from) || !validZone(to)) return fail('bad_zone');
    var epoch = wallToEpoch(parts.value, from);
    if (!epoch.ok) return epoch;
    var fromParts = zoneParts(epoch.value, from);
    var toParts = zoneParts(epoch.value, to);
    var offFrom = offsetMinutes(epoch.value, from);
    var offTo = offsetMinutes(epoch.value, to);
    var delta = dayDelta(epoch.value, from, to);
    if (!fromParts.ok || !toParts.ok || !offFrom.ok || !offTo.ok || !delta.ok) return fail('bad_value');
    return {
      ok: true,
      value: {
        epoch: epoch.value,
        input: parts.value,
        from: fromParts.value,
        to: toParts.value,
        offsetFrom: offFrom.value,
        offsetTo: offTo.value,
        dayDelta: delta.value
      }
    };
  }
  // TOOL_ENGINE_END

  return {
    isNum: isNum,
    isStr: isStr,
    fail: fail,
    pad: pad,
    daysFromCivil: daysFromCivil,
    daysInMonth: daysInMonth,
    validZone: validZone,
    zoneParts: zoneParts,
    offsetMinutes: offsetMinutes,
    formatOffset: formatOffset,
    parseLocal: parseLocal,
    formatWall: formatWall,
    sameWall: sameWall,
    wallToEpoch: wallToEpoch,
    dayDelta: dayDelta,
    convertZone: convertZone
  };
})();

  return ToolEngine;
  })();

  /* ---- hash-generator ---- */
  engines["hash-generator"] = (function () {

var ToolEngine = (function () {
  'use strict';

  var ALGORITHMS = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function isAlgorithm(name) {
    return ALGORITHMS.indexOf(name) !== -1;
  }

  function utf8Bytes(text) {
    return new TextEncoder().encode(text);
  }

  function byteLength(text) {
    if (typeof text !== 'string') return 0;
    return utf8Bytes(text).length;
  }

  function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += (bytes[i] + 0x100).toString(16).slice(1);
    }
    return out;
  }

  function bytesToBase64(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < bytes.length ? bytes[i + 1] : -1;
      var b2 = i + 2 < bytes.length ? bytes[i + 2] : -1;
      out += B64.charAt(b0 >> 2);
      out += B64.charAt(((b0 & 3) << 4) | (b1 < 0 ? 0 : b1 >> 4));
      out += b1 < 0 ? '=' : B64.charAt(((b1 & 15) << 2) | (b2 < 0 ? 0 : b2 >> 6));
      out += b2 < 0 ? '=' : B64.charAt(b2 & 63);
    }
    return out;
  }

  function normalizeHex(hex, upper) {
    if (typeof hex !== 'string') return { ok: false, error: 'bad_hex' };
    var cleaned = hex.replace(/\s+/g, '').toLowerCase();
    if (!/^[0-9a-f]*$/.test(cleaned)) return { ok: false, error: 'bad_hex' };
    if (cleaned.length % 2 !== 0) return { ok: false, error: 'bad_hex' };
    return { ok: true, value: upper ? cleaned.toUpperCase() : cleaned };
  }

  function compareHashes(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return { ok: false, error: 'bad_input' };
    var left = a.replace(/\s+/g, '').toLowerCase();
    var right = b.replace(/\s+/g, '').toLowerCase();
    if (!left || !right) return { ok: false, error: 'empty' };
    return { ok: true, equal: left === right };
  }

  function hashText(text, algorithm, cryptoObject) {
    if (typeof text !== 'string') return Promise.resolve({ ok: false, error: 'bad_input' });
    if (!isAlgorithm(algorithm)) return Promise.resolve({ ok: false, error: 'bad_algo' });
    if (!cryptoObject || !cryptoObject.subtle || typeof cryptoObject.subtle.digest !== 'function') {
      return Promise.resolve({ ok: false, error: 'no_crypto' });
    }
    var bytes;
    try {
      bytes = utf8Bytes(text);
    } catch (e) {
      return Promise.resolve({ ok: false, error: 'no_textencoder' });
    }
    return Promise.resolve(cryptoObject.subtle.digest(algorithm, bytes)).then(function (buffer) {
      var array = new Uint8Array(buffer);
      return {
        ok: true,
        algorithm: algorithm,
        bytes: array.length,
        hex: bytesToHex(array),
        base64: bytesToBase64(array)
      };
    }, function () {
      return { ok: false, error: 'hash_failed' };
    });
  }

  return {
    ALGORITHMS: ALGORITHMS,
    isAlgorithm: isAlgorithm,
    byteLength: byteLength,
    utf8Bytes: utf8Bytes,
    bytesToHex: bytesToHex,
    bytesToBase64: bytesToBase64,
    normalizeHex: normalizeHex,
    compareHashes: compareHashes,
    hashText: hashText
  };
})();

  return ToolEngine;
  })();

  /* ---- uuid-generator ---- */
  engines["uuid-generator"] = (function () {

var ToolEngine = (function () {
  'use strict';

  var UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  function isRng(rng) {
    return typeof rng === 'function';
  }

  function isUuid(value) {
    if (typeof value !== 'string') return false;
    if (UUID_RE.test(value)) return true;
    return /^[0-9a-fA-F]{32}$/.test(value);
  }

  function formatUuid(value, opts) {
    opts = opts || {};
    if (typeof value !== 'string') return { ok: false, error: 'bad_uuid' };
    var normalized = value.toLowerCase();
    if (/^[0-9a-f]{32}$/.test(normalized)) {
      normalized = normalized.slice(0, 8) + '-' + normalized.slice(8, 12) + '-' +
        normalized.slice(12, 16) + '-' + normalized.slice(16, 20) + '-' + normalized.slice(20);
    }
    if (!UUID_RE.test(normalized)) return { ok: false, error: 'bad_uuid' };
    var out = opts.hyphens === false ? normalized.replace(/-/g, '') : normalized;
    if (opts.uppercase) out = out.toUpperCase();
    return { ok: true, value: out };
  }

  function uuidV4(rng) {
    if (!isRng(rng)) return { ok: false, error: 'bad_rng' };
    var bytes = new Array(16);
    for (var i = 0; i < 16; i++) {
      var v = rng();
      if (typeof v !== 'number' || !isFinite(v) || v < 0 || v >= 1) {
        return { ok: false, error: 'bad_rng' };
      }
      bytes[i] = Math.floor(v * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = '';
    for (var j = 0; j < 16; j++) {
      hex += (bytes[j] + 0x100).toString(16).slice(1);
    }
    var value = hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
      hex.slice(16, 20) + '-' + hex.slice(20);
    return { ok: true, value: value };
  }

  function batch(count, opts, rng) {
    if (typeof count !== 'number' || !isFinite(count) || Math.floor(count) !== count || count < 1 || count > 100) {
      return { ok: false, error: 'bad_count' };
    }
    if (!isRng(rng)) return { ok: false, error: 'bad_rng' };
    var values = [];
    for (var i = 0; i < count; i++) {
      var made = uuidV4(rng);
      if (!made.ok) return made;
      var formatted = formatUuid(made.value, opts);
      if (!formatted.ok) return formatted;
      values.push(formatted.value);
    }
    return { ok: true, values: values, count: values.length };
  }

  return {
    uuidV4: uuidV4,
    batch: batch,
    formatUuid: formatUuid,
    isUuid: isUuid
  };
})();

  return ToolEngine;
  })();

  /* ---- adapters ---- */
/* Adapters: plain input object -> plain output object. The page engines are
   already contractually pure (tools/tests/CONTRACT.md), so each adapter only
   validates and maps fields; the math stays in the engine. */

function __run_base64_encoder(input, E) {
  var action = input.action == null ? 'encode' : input.action;
  must(action === 'encode' || action === 'decode', 'invalid_input', 'action must be encode or decode');
  must(typeof input.text === 'string', 'invalid_input', 'text must be a string');
  if (action === 'encode') {
    var enc = okOf(E.encodeUtf8(input.text, { urlSafe: input.urlSafe === true }));
    return { text: enc.value, bytes: enc.bytes, urlSafe: input.urlSafe === true };
  }
  var dec = okOf(E.decodeUtf8(input.text));
  return { text: dec.value, bytes: dec.bytes, urlSafe: false };
}

function __run_case_converter(input, E) {
  must(typeof input.text === 'string', 'invalid_input', 'text must be a string');
  var mode = input.mode == null ? 'camel' : input.mode;
  var conv = okOf(E.convert(mode, input.text));
  var out = { text: conv.value, mode: mode };
  if (input.stats !== false) out.stats = E.stats(input.text);
  return out;
}

function __run_slug_generator(input, E) {
  must(typeof input.text === 'string', 'invalid_input', 'text must be a string');
  var res = okOf(E.slugify(input.text, {
    separator: input.separator == null ? '-' : input.separator,
    keepUnicode: input.keepUnicode !== false,
    stopWords: input.stopWords === true,
    maxLength: input.maxLength == null ? 0 : input.maxLength
  }));
  return { slug: res.value, tokens: res.tokens };
}

function __run_url_encoder(input, E) {
  var action = input.action == null ? 'encodeComponent' : input.action;
  if (action === 'parseQuery') {
    must(typeof input.value === 'string', 'invalid_input', 'value must be a string');
    var q = okOf(E.parseQuery(input.value));
    return { params: q.params };
  }
  if (action === 'buildQuery') {
    must(Array.isArray(input.pairs), 'invalid_input', 'pairs must be an array');
    var bq = okOf(E.buildQuery(input.pairs));
    return { value: bq.value, params: bq.params };
  }
  if (action === 'parse') {
    must(typeof input.value === 'string', 'invalid_input', 'value must be a string');
    var u = okOf(E.parseUrl(input.value));
    return {
      protocol: u.protocol, username: u.username, password: u.password,
      host: u.host, port: u.port, path: u.path, query: u.query, hash: u.hash,
      params: u.params, hasQuery: u.hasQuery
    };
  }
  must(typeof input.value === 'string', 'invalid_input', 'value must be a string');
  var fn = { encodeComponent: E.encodeComponent, encodeUri: E.encodeUri,
    decodeComponent: E.decodeComponent, decodeUri: E.decodeUri }[action];
  must(typeof fn === 'function', 'invalid_input', 'unknown action: ' + action);
  var r = okOf(fn(input.value));
  return { value: r.value, action: action };
}

function __run_html_entity_encoder(input, E) {
  must(typeof input.text === 'string', 'invalid_input', 'text must be a string');
  var action = input.action == null ? 'escape' : input.action;
  if (action === 'escape' || action === 'encode') {
    var r = okOf(E.escapeHtml(input.text, input.mode == null ? 'named' : input.mode, input.nonAscii === true));
    return { text: r.value, action: 'escape' };
  }
  if (action === 'unescape' || action === 'decode') {
    var d = okOf(E.unescapeHtml(input.text));
    return { text: d.value, action: 'unescape' };
  }
  if (action === 'numeric') {
    var n = okOf(E.toNumericEntities(input.text));
    return { text: n.value, action: 'numeric' };
  }
  must(false, 'invalid_input', 'action must be escape, unescape or numeric');
}

function __run_csv_to_json(input, E) {
  must(typeof input.csv === 'string', 'invalid_input', 'csv must be a string');
  var parsed = okOf(E.parseCsv(input.csv, { delimiter: input.delimiter == null ? ',' : input.delimiter }));
  var json = okOf(E.toJson(parsed.rows, {
    hasHeader: input.hasHeader !== false,
    inferTypes: input.inferTypes === true,
    nested: input.nested === true
  }));
  return { data: json.data, columns: json.columns, warnings: json.warnings, rowCount: json.data.length };
}

function __run_json_to_csv(input, E) {
  var parsed;
  if (typeof input.json === 'string') parsed = okOf(E.parseJson(input.json));
  else if (input.data !== undefined) parsed = { ok: true, value: input.data };
  else throw err('invalid_input', 'json (string) or data is required');
  var csv = okOf(E.toCsv(parsed.value, {
    delimiter: input.delimiter == null ? ',' : input.delimiter,
    header: input.header !== false,
    flatten: input.flatten !== false,
    bom: input.bom === true
  }));
  return { csv: csv.csv, columns: csv.columns, rowCount: csv.rowCount, warnings: csv.warnings };
}

function __run_json_formatter(input, E) {
  must(typeof input.text === 'string', 'invalid_input', 'text must be a string');
  var opts = { indent: input.indent == null ? 2 : input.indent, sortKeys: input.sortKeys === true };
  var res = input.minify === true ? okOf(E.minify(input.text)) : okOf(E.formatJson(input.text, opts));
  return { text: res.text, summary: E.summarize(res.value), minified: input.minify === true };
}

function __run_json_to_typescript(input, E) {
  must(typeof input.text === 'string', 'invalid_input', 'text must be a string');
  var parsed = okOf(E.parseJsonText(input.text));
  var ts = okOf(E.toTypeScript(parsed.value, {
    rootName: input.rootName == null ? 'Root' : input.rootName,
    mode: input.mode == null ? 'interface' : input.mode,
    indent: input.indent == null ? 2 : input.indent,
    export: input.export !== false
  }));
  return { typescript: ts.code, rootName: ts.rootName, interfaces: ts.interfaces, fields: ts.fields, rootKind: ts.rootKind };
}

function __run_jwt_decoder(input, E) {
  must(typeof input.token === 'string', 'invalid_input', 'token must be a string');
  var jwt = okOf(E.decodeJwt(input.token));
  var out = {
    header: jwt.header, payload: jwt.payload, signature: jwt.signature,
    signed: jwt.signed, headerText: jwt.headerText, payloadText: jwt.payloadText
  };
  if (input.nowSeconds != null) out.status = okOf(E.claimsStatus(jwt.payload, input.nowSeconds));
  return out;
}

function __run_text_diff(input, E) {
  must(typeof input.a === 'string' && typeof input.b === 'string', 'invalid_input', 'a and b must be strings');
  var opts = { ignoreCase: input.ignoreCase === true, ignoreWhitespace: input.ignoreWhitespace === true };
  var diff = okOf(E.diffLines(input.a, input.b, opts));
  var unified = okOf(E.unifiedText(diff.rows));
  return { rows: diff.rows, stats: diff.stats, unified: unified.value };
}

function __run_color_converter(input, E) {
  must(typeof input.value === 'string', 'invalid_input', 'value must be a color string');
  var rgb = okOf(E.parseColor(input.value));
  var hex = okOf(E.rgbToHex(rgb.r, rgb.g, rgb.b));
  var hsl = okOf(E.rgbToHsl(rgb.r, rgb.g, rgb.b));
  var hsv = okOf(E.rgbToHsv(rgb.r, rgb.g, rgb.b));
  var cmyk = okOf(E.rgbToCmyk(rgb.r, rgb.g, rgb.b));
  var name = E.colorName(rgb.r, rgb.g, rgb.b);
  var onBlack = okOf(E.contrastRatio(rgb, { r: 0, g: 0, b: 0 }));
  var onWhite = okOf(E.contrastRatio(rgb, { r: 255, g: 255, b: 255 }));
  return {
    hex: hex.value,
    rgb: { r: rgb.r, g: rgb.g, b: rgb.b },
    hsl: { h: roundTo(hsl.h, 4), s: roundTo(hsl.s, 4), l: roundTo(hsl.l, 4) },
    hsv: { h: roundTo(hsv.h, 4), s: roundTo(hsv.s, 4), v: roundTo(hsv.v, 4) },
    cmyk: { c: roundTo(cmyk.c, 4), m: roundTo(cmyk.m, 4), y: roundTo(cmyk.y, 4), k: roundTo(cmyk.k, 4) },
    name: name.exact ? name.name : null,
    nearestName: name.name,
    contrastBlack: onBlack.ratio,
    contrastWhite: onWhite.ratio
  };
}

function __run_number_base_converter(input, E) {
  must(typeof input.value === 'string', 'invalid_input', 'value must be a string');
  var res = okOf(E.convertBase(input.value, input.fromBase, input.toBase, input.precision == null ? 8 : input.precision));
  return {
    value: res.value, intText: res.intText, fracText: res.fracText,
    base: res.base, negative: res.negative, truncated: res.truncated
  };
}

function __run_roman_numeral_converter(input, E) {
  var res = okOf(E.validate(input.value));
  return { value: res.value, roman: res.roman, lower: res.lower, source: res.source };
}

function __run_fraction_calculator(input, E) {
  must(typeof input.a === 'string' && typeof input.b === 'string', 'invalid_input', 'a and b must be fraction strings');
  var res = okOf(E.compute(input.a, input.op == null ? '+' : input.op, input.b));
  return {
    num: res.num.toString(), den: res.den.toString(),
    fraction: E.formatFraction(res.num, res.den),
    mixed: { whole: res.mixed.whole.toString(), num: res.mixed.num.toString(), den: res.mixed.den.toString() },
    decimal: E.toDecimal(res.num, res.den, input.places == null ? 10 : input.places)
  };
}

function __run_percentage_calculator(input, E) {
  var mode = input.mode == null ? 'of' : input.mode;
  if (mode === 'of') return { mode: mode, value: okOf(E.percentOf(input.a, input.b)).value };
  if (mode === 'whatPercent') return { mode: mode, value: okOf(E.whatPercent(input.a, input.b)).value };
  if (mode === 'change') {
    var ch = okOf(E.percentChange(input.a, input.b));
    return { mode: mode, value: ch.value, direction: ch.direction };
  }
  if (mode === 'apply') {
    return { mode: mode, value: okOf(E.applyPercent(input.a, input.b, input.direction == null ? 'increase' : input.direction)).value };
  }
  must(false, 'invalid_input', 'mode must be of, whatPercent, change or apply');
}

function __run_statistics_calculator(input, E) {
  var values;
  if (Array.isArray(input.values)) {
    values = input.values;
    must(values.length > 0, 'invalid_input', 'values must not be empty');
  } else if (typeof input.text === 'string') {
    values = okOf(E.parseNumbers(input.text)).values;
  } else {
    throw err('invalid_input', 'values array or text is required');
  }
  var sample = input.sample === true;
  var res = okOf(E.summarize(values)).value;
  return {
    count: res.count, sum: res.sum, mean: res.mean, median: res.median,
    modes: res.modes, min: res.min, max: res.max, range: res.range,
    variance: sample ? res.varianceSample : res.variancePopulation,
    stdev: sample ? res.stdevSample : res.stdevPopulation,
    q1: res.q1, q2: res.q2, q3: res.q3, iqr: res.iqr, sorted: res.sorted
  };
}

function __run_unit_converter(input, E) {
  must(typeof input.category === 'string', 'invalid_input', 'category is required');
  must(typeof input.from === 'string', 'invalid_input', 'from unit is required');
  if (input.to == null || input.to === '') {
    var all = okOf(E.convertAll(input.category, input.value, input.from));
    return { category: input.category, from: input.from, units: all.value };
  }
  var one = okOf(E.convert(input.category, input.value, input.from, input.to));
  return { category: input.category, from: input.from, to: input.to, value: one.value };
}

function __run_cooking_converter(input, E) {
  var res = okOf(E.convertIngredient(input.amount, input.from, input.to, input.ingredient == null ? 'water' : input.ingredient));
  return {
    value: res.value, ml: res.ml, grams: res.grams, density: res.density,
    fromKind: res.fromKind, toKind: res.toKind
  };
}

function __run_paper_size_converter(input, E) {
  var mode = input.mode == null ? 'size' : input.mode;
  if (mode === 'size') {
    var s = okOf(E.paperSize(input.name));
    return { name: s.name, widthMm: s.widthMm, heightMm: s.heightMm, group: s.group };
  }
  if (mode === 'pixels') {
    var p = okOf(E.paperPixels(input.name, input.dpi == null ? 96 : input.dpi));
    return { name: p.name, widthMm: p.widthMm, heightMm: p.heightMm, widthPx: p.widthPx, heightPx: p.heightPx, dpi: p.dpi };
  }
  if (mode === 'scale') {
    var r = okOf(E.scaleRatio(input.source, input.target));
    return {
      source: r.source, target: r.target, widthRatio: r.widthRatio, heightRatio: r.heightRatio,
      fitScale: r.fitScale, areaRatio: r.areaRatio, fitsWithoutScaling: r.fitsWithoutScaling
    };
  }
  must(false, 'invalid_input', 'mode must be size, pixels or scale');
}

function __run_aspect_ratio_calculator(input, E) {
  if (input.mode === 'scale') {
    var sc = okOf(E.scale(input.width, input.height, input.target, input.which == null ? 'width' : input.which));
    return { mode: 'scale', width: sc.width, height: sc.height, scale: sc.scale, which: sc.which };
  }
  var mode = input.mode == null ? 'ratio' : input.mode;
  var req = { mode: mode };
  if (mode === 'ratio') { req.width = input.width; req.height = input.height; }
  else if (mode === 'height') { req.width = input.width; req.ratioW = input.ratioW; req.ratioH = input.ratioH; }
  else if (mode === 'width') { req.height = input.height; req.ratioW = input.ratioW; req.ratioH = input.ratioH; }
  else throw err('invalid_input', 'mode must be ratio, width, height or scale');
  var r = okOf(E.solve(req));
  return { mode: r.mode, width: r.width, height: r.height, ratioW: r.ratioW, ratioH: r.ratioH, decimal: r.decimal };
}

function __run_loan_calculator(input, E) {
  var opts = {
    principal: input.principal,
    annualRate: input.annualRate,
    months: input.months,
    extra: input.extra == null ? 0 : input.extra,
    method: input.method == null ? 'annuity' : input.method
  };
  var sum;
  try { sum = E.summarize(opts); } catch (e) { throw err('invalid_input', String(e && e.message || e)); }
  var monthly = opts.method === 'annuity'
    ? E.monthlyPayment(opts.principal, opts.annualRate, opts.months)
    : E.equalPrincipalFirstPayment(opts.principal, opts.annualRate, opts.months);
  return {
    monthlyPayment: roundTo(monthly, 2),
    firstPayment: fromCents(sum.firstPayment),
    totalInterest: fromCents(sum.totalInterest),
    totalPayment: fromCents(sum.totalPayment),
    totalPrincipal: fromCents(sum.totalPrincipal),
    totalExtra: fromCents(sum.totalExtra),
    actualMonths: sum.actualMonths,
    interestRatio: roundTo(sum.interestRatio, 6),
    extraInterestSaved: fromCents(sum.extraInterestSaved),
    extraMonthsSaved: sum.extraMonthsSaved,
    method: sum.method
  };
}

function __run_compound_interest_calculator(input, E) {
  var res = okOf(E.compound(
    input.principal, input.annualRatePct, input.years,
    input.freq == null ? 12 : input.freq,
    input.monthlyAdd == null ? 0 : input.monthlyAdd
  ));
  return {
    final: res.final, interest: res.interest, principalTotal: res.principalTotal,
    deposits: res.deposits, schedule: res.schedule
  };
}

function __run_savings_goal_calculator(input, E) {
  var mode = input.mode == null ? 'plan' : input.mode;
  var target = input.target, current = input.current == null ? 0 : input.current;
  var rate = input.annualRatePct == null ? 0 : input.annualRatePct;
  if (mode === 'plan') {
    var p = okOf(E.monthlyNeeded(target, current, rate, input.months));
    return {
      mode: mode, achieved: p.achieved, monthly: p.monthly, exactMonthly: p.exactMonthly,
      projected: p.projected, totalDeposits: p.totalDeposits, interest: p.interest
    };
  }
  if (mode === 'duration') {
    var d = okOf(E.monthsToGoal(target, current, rate, input.monthly));
    return {
      mode: mode, achieved: d.achieved, months: d.months, exactMonths: d.exactMonths,
      projected: d.projected, totalDeposits: d.totalDeposits, interest: d.interest
    };
  }
  must(false, 'invalid_input', 'mode must be plan or duration');
}

function __run_roi_calculator(input, E) {
  var costCents = toCents(input.cost), returnCents = toCents(input.return);
  var res = okOf(E.compute({ costCents: costCents, returnCents: returnCents, years: input.years }));
  return {
    netGain: fromCents(res.netGainCents),
    roiPct: res.roiPct,
    annualizedPct: res.annualizedPct,
    multiple: res.multiple,
    verdict: res.verdict
  };
}

function __run_vat_calculator(input, E) {
  var mode = input.mode == null ? 'add' : input.mode;
  var res = mode === 'add' ? E.addVat(input.amount, input.ratePct) : mode === 'extract'
    ? E.extractVat(input.amount, input.ratePct) : null;
  must(res !== null, 'invalid_input', 'mode must be add or extract');
  okOf(res);
  return { mode: res.mode, net: res.net, tax: res.tax, gross: res.gross };
}

function __run_profit_margin_calculator(input, E) {
  var mode = input.mode == null ? 'calc' : input.mode;
  var res;
  if (mode === 'calc') {
    res = okOf(E.compute({ mode: 'calc', costCents: toCents(input.cost), priceCents: toCents(input.price) }));
  } else if (mode === 'target') {
    res = okOf(E.compute({ mode: 'target', costCents: toCents(input.cost), targetMarginPct: input.targetMarginPct }));
  } else {
    throw err('invalid_input', 'mode must be calc or target');
  }
  return {
    grossProfit: fromCents(res.grossProfitCents),
    marginPct: res.marginPct,
    markupPct: res.markupPct,
    price: fromCents(res.priceCents),
    priceCents: res.priceCents
  };
}

function __run_bmi_calculator(input, E) {
  var height = input.heightCm, weight = input.weightKg;
  must(typeof height === 'number' && isFinite(height), 'invalid_input', 'heightCm must be a number');
  must(typeof weight === 'number' && isFinite(weight), 'invalid_input', 'weightKg must be a number');
  var bmi, category, range;
  try {
    bmi = E.bmi(weight, height);
    category = E.bmiCategory(bmi);
    range = E.healthyWeightRange(height);
  } catch (e) { throw err('invalid_input', String(e && e.message || e)); }
  var out = {
    bmi: roundTo(bmi, 4),
    category: category === 'under' ? 'underweight' : category === 'over' ? 'overweight' : category,
    healthyMinKg: roundTo(range.min, 4),
    healthyMaxKg: roundTo(range.max, 4)
  };
  if (input.sex != null && input.age != null) {
    try {
      var bmr = E.bmrMifflin(input.sex, weight, height, input.age);
      var tdee = E.tdee(bmr, input.activity == null ? 'sedentary' : input.activity);
      out.bmr = roundTo(bmr, 2);
      out.tdee = roundTo(tdee, 2);
      var targets = E.calorieTargets(tdee);
      out.calorieTargets = {
        maintain: roundTo(targets.maintain, 0), mildLoss: roundTo(targets.mildLoss, 0),
        loss: roundTo(targets.loss, 0), gain: roundTo(targets.gain, 0)
      };
    } catch (e) { throw err('invalid_input', String(e && e.message || e)); }
  }
  return out;
}

function __run_quadratic_solver(input, E) {
  ['a', 'b', 'c'].forEach(function (k) {
    must(typeof input[k] === 'number' && isFinite(input[k]), 'invalid_input', k + ' must be a number');
  });
  var r = okOf(E.solveQuadratic(input.a, input.b, input.c));
  return {
    mode: r.mode, discriminant: r.discriminant, roots: r.roots,
    vertex: r.vertex, factor: r.factor, radical: r.radical,
    sumRoots: r.sumRoots, productRoots: r.productRoots
  };
}

function __run_gcd_lcm_calculator(input, E) {
  var mode = input.mode == null ? 'gcd' : input.mode;
  var values;
  if (typeof input.values === 'string') values = okOf(E.parseList(input.values)).values;
  else if (Array.isArray(input.values)) values = input.values;
  else throw err('invalid_input', 'values must be an array or a string');
  if (mode === 'factorize') {
    must(values.length === 1, 'invalid_input', 'factorize needs exactly one value');
    var f = okOf(E.factorize(values[0]));
    return {
      mode: 'factorize', value: String(values[0]),
      factors: f.factors.map(function (x) { return { p: x.p.toString(), e: x.e }; }),
      formatted: E.formatFactors(f.factors), negative: f.negative, one: f.one
    };
  }
  var r = mode === 'gcd' ? okOf(E.gcdAll(values)) : mode === 'lcm' ? okOf(E.lcmAll(values)) : null;
  must(r !== null, 'invalid_input', 'mode must be gcd, lcm or factorize');
  return { mode: mode, value: r.value.toString(), steps: r.steps };
}

function __run_date_calculator(input, E) {
  var mode = input.mode == null ? 'diff' : input.mode;
  try {
    if (mode === 'diff') return { mode: mode, days: E.diffDays(input.from, input.to) };
    if (mode === 'calendar') return { mode: mode, diff: E.calendarDiff(input.from, input.to) };
    if (mode === 'business') {
      return { mode: mode, days: E.businessDays(input.from, input.to, input.inclusive === true) };
    }
    if (mode === 'add') {
      var d;
      if (input.days != null) d = E.addDays(input.from, input.days);
      else if (input.months != null) d = E.addMonths(input.from, input.months);
      else if (input.years != null) d = E.addYears(input.from, input.years);
      else throw err('invalid_input', 'days, months or years is required');
      return { mode: mode, date: formatDate(d), weekday: E.weekdayIndex(d) };
    }
    if (mode === 'age') {
      var a = E.ageOn(input.from, input.to);
      return {
        mode: mode, years: a.years, months: a.months, days: a.days,
        nextBirthday: formatDate(a.nextBirthday), daysToNextBirthday: a.daysToNextBirthday,
        isBirthdayToday: a.isBirthdayToday, isBirthdayTomorrow: a.isBirthdayTomorrow
      };
    }
  } catch (e) { throw err('invalid_input', String(e && e.message || e)); }
  throw err('invalid_input', 'mode must be diff, calendar, business, add or age');
}

function __run_unix_timestamp_converter(input, E) {
  var ms, unit;
  if (typeof input.value === 'string') {
    ms = okOf(E.parseIso(input.value)).value;
    unit = 'iso';
  } else {
    must(typeof input.value === 'number' && isFinite(input.value), 'invalid_input', 'value must be a number or ISO string');
    var conv = okOf(E.toMs(input.value, input.unit == null ? 'auto' : input.unit));
    ms = conv.value.ms;
    unit = conv.value.unit;
  }
  var out = {
    unixSeconds: Math.floor(ms / 1000),
    unixMillis: ms,
    isoUtc: okOf(E.isoUTC(ms)).value,
    unit: unit
  };
  if (input.offsetMinutes != null) out.isoWithOffset = okOf(E.isoWithOffset(ms, input.offsetMinutes)).value;
  return out;
}

function __run_timezone_converter(input, E) {
  must(typeof input.local === 'string', 'invalid_input', 'local must be YYYY-MM-DDTHH:MM');
  var res = okOf(E.convertZone(input.local, input.from, input.to));
  var v = res.value;
  return {
    epoch: v.epoch,
    from: okOf(E.formatWall(v.from)).value,
    to: okOf(E.formatWall(v.to)).value,
    offsetFrom: okOf(E.formatOffset(v.offsetFrom)).value,
    offsetTo: okOf(E.formatOffset(v.offsetTo)).value,
    dayDelta: v.dayDelta
  };
}

function __run_hash_generator(input, E) {
  must(typeof input.text === 'string', 'invalid_input', 'text must be a string');
  var algorithm = input.algorithm == null ? 'SHA-256' : input.algorithm;
  must(E.isAlgorithm(algorithm), 'invalid_input', 'algorithm must be one of ' + E.ALGORITHMS.join(', '));
  var cryptoObj = typeof globalThis !== 'undefined' && globalThis.crypto ? globalThis.crypto : null;
  return E.hashText(input.text, algorithm, cryptoObj).then(function (r) {
    if (!r.ok) throw err('invalid_input', 'hash: ' + r.error);
    return { algorithm: r.algorithm, bytes: r.bytes, hex: r.hex, base64: r.base64 };
  });
}

function __run_uuid_generator(input, E) {
  var count = input.count == null ? 1 : input.count;
  var rng = input.seed == null ? Math.random : seededRandom(input.seed);
  var res = okOf(E.batch(count, {
    uppercase: input.uppercase === true,
    hyphens: input.hyphens !== false
  }, rng));
  return { uuids: res.values, count: res.count };
}

  /* ---- registry ---- */
  def("base64-encoder", __run_base64_encoder, "base64-encoder");
  def("case-converter", __run_case_converter, "case-converter");
  def("slug-generator", __run_slug_generator, "slug-generator");
  def("url-encoder", __run_url_encoder, "url-encoder");
  def("html-entity-encoder", __run_html_entity_encoder, "html-entity-encoder");
  def("csv-to-json", __run_csv_to_json, "csv-to-json");
  def("json-to-csv", __run_json_to_csv, "json-to-csv");
  def("json-formatter", __run_json_formatter, "json-formatter");
  def("json-to-typescript", __run_json_to_typescript, "json-to-typescript");
  def("jwt-decoder", __run_jwt_decoder, "jwt-decoder");
  def("text-diff", __run_text_diff, "text-diff");
  def("color-converter", __run_color_converter, "color-converter");
  def("number-base-converter", __run_number_base_converter, "number-base-converter");
  def("roman-numeral-converter", __run_roman_numeral_converter, "roman-numeral-converter");
  def("fraction-calculator", __run_fraction_calculator, "fraction-calculator");
  def("percentage-calculator", __run_percentage_calculator, "percentage-calculator");
  def("statistics-calculator", __run_statistics_calculator, "statistics-calculator");
  def("unit-converter", __run_unit_converter, "unit-converter");
  def("cooking-converter", __run_cooking_converter, "cooking-converter");
  def("paper-size-converter", __run_paper_size_converter, "paper-size-converter");
  def("aspect-ratio-calculator", __run_aspect_ratio_calculator, "aspect-ratio-calculator");
  def("loan-calculator", __run_loan_calculator, "loan-calculator");
  def("compound-interest-calculator", __run_compound_interest_calculator, "compound-interest-calculator");
  def("savings-goal-calculator", __run_savings_goal_calculator, "savings-goal-calculator");
  def("roi-calculator", __run_roi_calculator, "roi-calculator");
  def("vat-calculator", __run_vat_calculator, "vat-calculator");
  def("profit-margin-calculator", __run_profit_margin_calculator, "profit-margin-calculator");
  def("bmi-calculator", __run_bmi_calculator, "bmi-calculator");
  def("quadratic-solver", __run_quadratic_solver, "quadratic-solver");
  def("gcd-lcm-calculator", __run_gcd_lcm_calculator, "gcd-lcm-calculator");
  def("date-calculator", __run_date_calculator, "date-calculator");
  def("unix-timestamp-converter", __run_unix_timestamp_converter, "unix-timestamp-converter");
  def("timezone-converter", __run_timezone_converter, "timezone-converter");
  def("hash-generator", __run_hash_generator, "hash-generator");
  def("uuid-generator", __run_uuid_generator, "uuid-generator");

  return {
    version: VERSION,
    ids: Object.keys(registry),
    has: function (id) { return Object.prototype.hasOwnProperty.call(registry, id); },
    run: run,
    errorResult: errorResult
  };
}));
