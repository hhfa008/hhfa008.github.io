/*
 * 《深入绝境》shuffle 适配器（浏览器 / Node 双端）
 *
 * games/shared/shuffle.js 是 UMD：
 *   · 浏览器 classic script 执行后挂在 window.Shuffle；
 *   · Node 下 module.exports 是 API 对象。
 *
 * 浏览器 ESM 无法直接默认导入 UMD（会报 does not provide an export named
 * 'default'），所以：
 *   · 页面先加载 <script src="../../shared/shuffle.js"></script>，这里读 window；
 *   · Node 走动态 import，取 CJS 的 default。
 *
 * 本文件只负责模块装载，不改变任何洗牌/随机规则。
 */
let Shuffle = null;

if (typeof window !== 'undefined' && window.Shuffle) {
  Shuffle = window.Shuffle;
} else {
  const mod = await import('../../shared/shuffle.js');
  Shuffle = mod && mod.default ? mod.default : mod;
}

if (!Shuffle || typeof Shuffle.createRng !== 'function') {
  throw new Error('Descent 引擎无法加载 shared/shuffle.js');
}

export default Shuffle;
