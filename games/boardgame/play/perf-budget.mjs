'use strict';

/*
 * Performance budgets for the boardgame E2E, driven through a CDP view from
 * play/e2e.mjs. No third-party tooling.
 *
 *   measureFps(view, durationMs)
 *     Samples requestAnimationFrame while the page is being interacted with
 *     (draw / select / scroll every 50ms). Returns frames, duration and fps.
 *
 *   measureMemory(view, loops)
 *     Forces GC, reads Performance.getMetrics JSHeapUsedSize, warms up and
 *     then samples 10-20 interaction loops. Returns first/last/growth and how
 *     many steps increased, so the caller can assert a non-monotonic trend.
 */

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/*
 * Decides whether a low FPS sample was taken on a host without headroom.
 * Returns null when the sample is fine, too short to judge, or when 1-minute
 * loadavg is at/below 80% of the CPU count. When it returns an object the
 * caller prints load/fps/frames as evidence and skips the budget for this run.
 * Pure (no process state) so the guard is testable without loading the host.
 */
export function fpsLoadLimited(sample, load1, coreCount, fpsBudget) {
  const budget = Number.isFinite(fpsBudget) ? fpsBudget : 30;
  if (!sample) return null;
  const frames = Number(sample.frames);
  const fps = Number(sample.fps);
  const load = Number(load1);
  const cores = Number(coreCount);
  if (!Number.isFinite(frames) || frames < 5) return null;
  if (!Number.isFinite(fps) || fps >= budget) return null;
  if (!Number.isFinite(load) || !Number.isFinite(cores) || cores <= 0) return null;
  const loadFactor = 0.8;
  const budgetLoad = cores * loadFactor;
  if (load <= budgetLoad) return null;
  return { load: load, cores: cores, loadFactor: loadFactor, budgetLoad: budgetLoad };
}

export async function measureFps(view, durationMs) {
  await view.send('Page.bringToFront');
  await view.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true
  });
  await sleep(200);

  let visibility = await view.evaluate('document.visibilityState');
  if (visibility !== 'visible') {
    try {
      const info = await view.send('Target.getTargetInfo');
      if (info && info.targetInfo) {
        await view.send('Target.activateTarget', { targetId: info.targetInfo.targetId });
      }
    } catch (err) { /* activation is best-effort */ }
    await sleep(250);
    visibility = await view.evaluate('document.visibilityState');
  }

  await view.evaluate('(function(){' +
    'if(window.__e2eFps){cancelAnimationFrame(window.__e2eFps.raf);clearInterval(window.__e2eFps.timer);}' +
    'var s={frames:0,start:performance.now(),end:0,raf:0,timer:0,active:true};' +
    'function tick(t){if(!s.active)return;s.frames+=1;s.end=performance.now();' +
    '  s.raf=requestAnimationFrame(tick);}' +
    's.raf=requestAnimationFrame(tick);' +
    'var i=0;' +
    's.timer=setInterval(function(){' +
    '  i+=1;' +
    '  var draw=document.getElementById("btn-draw");if(draw&&!draw.disabled)draw.click();' +
    '  var cards=document.querySelectorAll("#my-hand .card");' +
    '  if(cards.length)cards[i%cards.length].click();' +
    '  window.scrollTo(0,(i*37)%600);' +
    '},50);' +
    'window.__e2eFps=s;return true;})()');

  await sleep(durationMs);
  const sample = await view.evaluate('(function(){' +
    'var s=window.__e2eFps;if(!s)return null;' +
    's.active=false;cancelAnimationFrame(s.raf);clearInterval(s.timer);' +
    'var duration=performance.now()-s.start;' +
    'return {frames:s.frames,durationMs:duration,' +
    '  fps:duration>0?(s.frames-1)/(duration/1000):0,' +
    '  visibility:document.visibilityState};})()');
  return { sample: sample, visibility: visibility };
}

async function heapBytes(view) {
  try { await view.send('HeapProfiler.collectGarbage'); } catch (err) { /* best effort */ }
  await sleep(80);
  try { await view.send('HeapProfiler.collectGarbage'); } catch (err) { /* best effort */ }
  await sleep(40);
  const result = await view.send('Performance.getMetrics');
  const metrics = (result && result.metrics) || [];
  const row = metrics.find(function (metric) { return metric.name === 'JSHeapUsedSize'; });
  return row ? row.value : null;
}

export async function measureMemory(view, loops) {
  await view.send('Performance.enable');
  const total = loops || 15;

  async function interactionLoop() {
    await view.evaluate('(function(){' +
      'var draw=document.getElementById("btn-draw");if(draw&&!draw.disabled)draw.click();' +
      'var cards=document.querySelectorAll("#my-hand .card");' +
      'if(cards.length)cards[(Math.random()*cards.length)|0].click();' +
      'window.scrollTo(0,(window.scrollY+97)%600);return true;})()');
    await sleep(60);
  }

  // Warm up without sampling so first-touch allocations are not counted.
  for (let i = 0; i < 3; i += 1) await interactionLoop();

  const samples = [];
  for (let i = 0; i < total; i += 1) {
    await interactionLoop();
    const bytes = await heapBytes(view);
    if (bytes == null) return { samples: samples, error: 'JSHeapUsedSize metric missing' };
    samples.push(bytes);
    console.log('    heap[' + i + '] = ' + (bytes / 1048576).toFixed(3) + ' MB');
  }

  let increases = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i] > samples[i - 1]) increases += 1;
  }
  return {
    samples: samples,
    firstMb: samples[0] / 1048576,
    lastMb: samples[samples.length - 1] / 1048576,
    growthMb: (samples[samples.length - 1] - samples[0]) / 1048576,
    increases: increases,
    steps: samples.length - 1
  };
}
