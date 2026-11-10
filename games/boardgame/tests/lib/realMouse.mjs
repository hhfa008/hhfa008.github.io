/**
 * Real mouse driver for the play-to-end harness.
 *
 * Why: a DOM element existing is NOT the same as it being clickable. Buttons can
 * be below the visual viewport, hidden by a prerequisite step, or covered by an
 * overlay. This helper always walks the same checklist:
 *
 *   exists -> in viewport -> visible (not hidden/display:none/opacity:0)
 *   -> scrollIntoView -> recompute rect -> real Input.dispatchMouseEvent
 *      (mouseMoved / mousePressed / mouseReleased at the center)
 *   -> did anything change? (feedback) -> otherwise fail loud
 *
 * A hidden prerequisite is an explicit failure, never a silent skip.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => { try { return JSON.stringify(v); } catch (_) { return String(v); } };

export function createRealMouse({ cdp, sessionId, evalIn, defaultTimeout = 4000, settleMs = 220 }) {
  const describe = async (selector, index = 0) => evalIn(`(function(){
    var list=document.querySelectorAll(${JSON.stringify(selector)});
    var e=list[${index}];
    if(!e)return {exists:false,count:list.length,selector:${JSON.stringify(selector)},index:${index}};
    var r=e.getBoundingClientRect();
    var cs=getComputedStyle(e);
    var hiddenAncestor=false;
    for(var n=e;n;n=n.parentElement){if(n.hidden){hiddenAncestor=true;break;}}
    var visible=!hiddenAncestor&&!e.hidden&&r.width>0&&r.height>0&&cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity)!==0;
    var x=r.left+r.width/2,y=r.top+r.height/2;
    var top=(x>=0&&y>=0&&x<innerWidth&&y<innerHeight)?document.elementFromPoint(x,y):null;
    return {
      exists:true,count:list.length,selector:${JSON.stringify(selector)},index:${index},
      visible:visible,hidden:!!e.hidden,hiddenAncestor:hiddenAncestor,
      display:cs.display,visibility:cs.visibility,opacity:cs.opacity,pointerEvents:cs.pointerEvents,
      disabled:!!e.disabled,text:(e.innerText||e.textContent||'').trim().slice(0,120),
      rect:{left:r.left,top:r.top,width:r.width,height:r.height,right:r.right,bottom:r.bottom},
      point:{x:x,y:y},
      hit:top?{tag:top.tagName,id:top.id||null,cls:String(top.className||'').slice(0,60)}:null,
      containsHit:!!(top&&(e===top||e.contains(top)))
    };
  })()`);

  async function waitVisible(selector, { index = 0, timeout = defaultTimeout } = {}) {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeout) {
      last = await describe(selector, index);
      if (last && last.visible) return last;
      await sleep(50);
    }
    throw new Error(`WAIT_VISIBLE_TIMEOUT: ${selector}[${index}] after ${timeout}ms diagnostics=${J(last)}`);
  }

  async function isVisible(selector, { index = 0 } = {}) {
    try { const d = await describe(selector, index); return !!(d && d.visible); } catch (_) { return false; }
  }

  async function scrollIntoView(selector, { index = 0, timeout = defaultTimeout } = {}) {
    const before = await describe(selector, index);
    if (!before.exists) throw new Error(`ELEMENT_NOT_FOUND: ${selector}[${index}]`);
    await evalIn(`(function(){var e=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(e)e.scrollIntoView({block:'center',inline:'center'});})()`);
    await sleep(120);
    let d = await waitVisible(selector, { index, timeout });
    // Smooth scrolling can keep moving the element after scrollIntoView. Wait
    // until the rect is stable for two consecutive probes before clicking.
    let prevKey = '', stable = 0;
    for (let i = 0; i < 12; i += 1) {
      d = await waitVisible(selector, { index, timeout });
      const key = J(d.rect);
      if (key === prevKey) stable += 1; else { prevKey = key; stable = 0; }
      if (stable >= 2) return d;
      await sleep(60);
    }
    return d;
  }

  async function click(selector, opts = {}) {
    const {
      index = 0, at = null, feedback = null, desc = null, timeout = defaultTimeout,
      requireFeedback = !!feedback, feedbackTimeout = 800, allowHitOther = false,
    } = opts;
    const d = await scrollIntoView(selector, { index, timeout });
    if (d.disabled) throw new Error(`ELEMENT_DISABLED: ${desc || selector} diagnostics=${J(d)}`);
    if (d.pointerEvents === 'none') throw new Error(`POINTER_EVENTS_NONE: ${desc || selector} diagnostics=${J(d)}`);
    let x = d.point.x, y = d.point.y;
    if (at) {
      x = d.rect.left + d.rect.width * at.fx;
      y = d.rect.top + d.rect.height * at.fy;
    }
    if (x < 0 || y < 0 || x >= 5000 || y >= 5000) throw new Error(`BAD_POINT: ${desc || selector} (${x},${y})`);
    const hit = await evalIn(`(function(){var e=document.elementFromPoint(${x},${y});return e?{tag:e.tagName,id:e.id||null,cls:String(e.className||'').slice(0,60),text:(e.innerText||e.textContent||'').trim().slice(0,40)}:null;})()`);
    if (!allowHitOther && hit && !d.containsHit) {
      throw new Error(`CLICK_INTERCEPTED: ${desc || selector} target=${selector} point=(${x},${y}) hit=${J(hit)} rect=${J(d.rect)}`);
    }
    if (!hit) throw new Error(`CLICK_OUTSIDE_VIEWPORT: ${desc || selector} point=(${x},${y}) viewport=${await evalIn('innerWidth+"x"+innerHeight')}`);

    const before = feedback ? J(await feedback()) : null;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }, sessionId);

    let after = null, changed = false;
    if (feedback) {
      const t0 = Date.now();
      while (Date.now() - t0 < feedbackTimeout) {
        await sleep(60);
        after = J(await feedback());
        if (after !== before) { changed = true; break; }
      }
    } else {
      await sleep(settleMs);
    }
    if (requireFeedback && !changed) {
      throw new Error(`NO_FEEDBACK: ${desc || selector} point=(${x},${y}) hit=${J(hit)} before=${before} after=${after} rect=${J(d.rect)}`);
    }
    return { selector, index, point: { x, y }, rect: d.rect, hit, before, after, changed, desc: desc || selector };
  }

  async function clickSequence(steps, opts = {}) {
    const out = [];
    for (const step of steps) {
      if (typeof step === 'string') out.push(await click(step, opts));
      else out.push(await click(step.selector, { ...opts, ...step }));
    }
    return out;
  }

  async function assertFeedback(fn, desc, { timeout = 800, interval = 60 } = {}) {
    const before = J(await fn());
    const t0 = Date.now();
    let after = before;
    while (Date.now() - t0 < timeout) {
      await sleep(interval);
      after = J(await fn());
      if (after !== before) return { desc, before, after };
    }
    throw new Error(`ASSERT_FEEDBACK_FAILED: ${desc} before=${before} after=${after} after ${timeout}ms`);
  }

  async function clickCanvas(selector, at = { fx: 0.5, fy: 0.5 }, opts = {}) {
    return click(selector, { ...opts, at });
  }

  async function count(selector) {
    return evalIn(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  }

  return { describe, waitVisible, isVisible, scrollIntoView, click, clickSequence, assertFeedback, clickCanvas, count };
}
