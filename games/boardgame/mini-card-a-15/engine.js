(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MiniCardEngine=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
var RANK_NAMES={1:'A',2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K'};
var SUIT_SYMBOLS=['\u2660','\u2665','\u2666','\u2663'];
function mulberry32(seed){var a=(seed>>>0)||1;return function(){a=(a+0x6D2B79F5)|0;var t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
var Cards = (function(){var module={exports:{}};var exports=module.exports;
/* 卡牌游戏公共原语（UMD，零依赖）。
 *
 *   Cards.shuffle(arr, rng)               // Fisher–Yates；rng 需可复现（mulberry32 等）
 *   Cards.makeDeck(suits, maxRank)        // [{r,s}]，r=1..maxRank，s=0..suits-1
 *   Cards.draw(deck)                      // 从牌堆顶取一张（不可变：返回 {card, deck}）
 *   Cards.nextTurn(current, players)      // 0..players-1 轮转
 *   Cards.winnerByEmptyHand(hands)        // 谁先清空；平局返回 'tie'，未结束 null
 *   Cards.winnerByScore(scores)           // 最高分；并列 'tie'
 *
 * 目标：洗牌/牌堆/回合/胜负判定只写一份，卡牌类页面与引擎共用，
 * 随机性由种子驱动，复盘可复现。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Cards = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function shuffle(arr, rng) {
    var a = arr.slice();
    var random = typeof rng === 'function' ? rng : Math.random;
    for (var i = a.length - 1; i > 0; i -= 1) {
      var j = Math.floor(random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 原地洗牌：仅用于内部状态（如单机引擎的牌池），不入存档、不跨座位共享。
  function shuffleInPlace(arr, rng) {
    var random = typeof rng === 'function' ? rng : Math.random;
    for (var i = arr.length - 1; i > 0; i -= 1) {
      var j = Math.floor(random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function makeDeck(suits, maxRank) {
    if (!(suits >= 1) || !(maxRank >= 1)) throw new Error('makeDeck: suits/maxRank must be >= 1');
    var deck = [];
    for (var s = 0; s < suits; s += 1) {
      for (var r = 1; r <= maxRank; r += 1) deck.push({ r: r, s: s });
    }
    return deck;
  }

  // 牌堆顶 = 数组末尾；不修改入参，返回新牌堆，便于存档/复盘。
  function draw(deck) {
    if (!deck.length) return { card: null, deck: deck.slice() };
    var next = deck.slice();
    var card = next.pop();
    return { card: card, deck: next };
  }

  function nextTurn(current, players) {
    if (!(players >= 1)) return 0;
    return ((Number(current) || 0) + 1) % players;
  }

  function winnerByEmptyHand(hands) {
    var empty = [];
    for (var i = 0; i < hands.length; i += 1) {
      if (Array.isArray(hands[i]) && hands[i].length === 0) empty.push(i);
    }
    if (!empty.length) return null;
    return empty.length === 1 ? empty[0] : 'tie';
  }

  function winnerByScore(scores) {
    if (!scores || !scores.length) return null;
    var best = -Infinity;
    var winners = [];
    scores.forEach(function (v, i) {
      var n = Number(v) || 0;
      if (n > best) { best = n; winners = [i]; }
      else if (n === best) winners.push(i);
    });
    return winners.length === 1 ? winners[0] : 'tie';
  }

  return {
    shuffle: shuffle,
    shuffleInPlace: shuffleInPlace,
    makeDeck: makeDeck,
    draw: draw,
    nextTurn: nextTurn,
    winnerByEmptyHand: winnerByEmptyHand,
    winnerByScore: winnerByScore,
    version: '1.0.0'
  };
});

return module.exports;})();
function cardStr(c){return SUIT_SYMBOLS[c.s]+RANK_NAMES[c.r];}
function handName(p){return p?'电脑':'你';}
var TITLE="突袭翻牌";
var SLUG="mini-card-a-15";
var CFG={"suits":4,"maxRank":13,"tieMode":"sudden","compare":"high","roundCap":400};
function value(c){
  if(CFG.compare==='nearest7')return 7-Math.abs(c.r-7);
  if(CFG.compare==='low')return -c.r;
  return c.r;
}
function createGame(opts){
  opts=opts||{};var rng=mulberry32(opts.seed||1);var deck=Cards.shuffle(Cards.makeDeck(CFG.suits,CFG.maxRank),rng);
  var half=Math.floor(deck.length/2);
  var d1=deck.slice(0,half),d0=deck.slice(half);
  return {phase:'playing',winner:null,turn:0,d0:d0,d1:d1,table0:[],table1:[],round:0,discard:0,log:['开始：点击翻牌与电脑比大小']};
}
function finish(st,reason){
  st.phase='over';
  if(st.d0.length===st.d1.length)st.winner='tie';
  else st.winner=st.d0.length>st.d1.length?0:1;
  st.log.push(reason||'回合上限，按牌堆张数结算');
}
function moves(st){
  if(st.phase!=='playing')return [];
  if(st.round>=CFG.roundCap)return [];
  return [{type:'flip'}];
}
function play(st,mv){
  if(st.phase!=='playing')return {ok:false,error:'本局已结束'};
  if(mv.type!=='flip')return {ok:false,error:'只能翻牌'};
  if(st.round>=CFG.roundCap){finish(st);return {ok:true};}
  var w=null,guard=0;
  while(w===null&&guard++<120){
    if(st.d0.length===0||st.d1.length===0){w=st.d0.length?0:(st.d1.length?1:'tie');break;}
    var a=st.d0.shift(),b=st.d1.shift();
    st.table0.push(a);st.table1.push(b);
    var va=value(a),vb=value(b);
    if(va!==vb){w=va>vb?0:1;break;}
    st.log.push('同点：'+cardStr(a)+' 对 '+cardStr(b));
    if(CFG.tieMode==='suit'){w=a.s>b.s?0:1;break;}
    if(CFG.tieMode==='sudden'){st.table0.pop();st.table1.pop();st.discard+=2;continue;}
    for(var k=0;k<3&&st.d0.length&&st.d1.length;k++){st.table0.push(st.d0.shift());st.table1.push(st.d1.shift());}
    if(st.d0.length===0||st.d1.length===0){w=st.d0.length?0:(st.d1.length?1:'tie');break;}
  }
  if(w===null){w=st.d0.length>st.d1.length?0:(st.d1.length>st.d0.length?1:'tie');}
  if(w===0||w===1){
    var cards=st.table0.concat(st.table1);
    st.table0=[];st.table1=[];
    var key='d'+w;
    st[key]=st[key].concat(cards);
    st.log.push(handName(w)+' 收走 '+cards.length+' 张');
  } else {
    st.table0=[];st.table1=[];
    st.log.push('本回合作废，双方都不收牌');
  }
  st.round++;
  if(st.d0.length===0&&st.d1.length===0)finish(st,'双方牌堆同时耗尽，平局');
  else if(st.d0.length===0)finish(st,'电脑牌堆耗尽，你获胜');
  else if(st.d1.length===0)finish(st,'你的牌堆耗尽，电脑获胜');
  else if(st.round>=CFG.roundCap)finish(st,'达到回合上限，按牌堆张数结算');
  return {ok:true};
}
function aiMove(st){
  if(st.phase!=='playing')return null;
  return moves(st)[0]||null;
}
function topCards(arr){return arr.slice(-4).map(cardStr);}
function view(st){
  var status;
  if(st.phase==='over')status=st.winner==='tie'?'平局':(st.winner===0?'你赢了！':'电脑获胜');
  else status='点击「翻牌」与电脑比大小';
  return {status:status,sub:'已进行 '+st.round+' 回合 · 作废 '+st.discard+' 张',piles:[{label:'你的牌堆',cards:[st.d0.length+' 张']},{label:'你的桌面',cards:topCards(st.table0).length?topCards(st.table0):['—']},{label:'电脑桌面',cards:topCards(st.table1).length?topCards(st.table1):['—']},{label:'电脑牌堆',cards:[st.d1.length+' 张']}],hand:[],actions:st.phase==='playing'?[{label:'翻牌',move:{type:'flip'}}]:[],over:st.phase==='over',log:st.log.slice(-4)};
}
return {title:TITLE,slug:SLUG,createGame:createGame,moves:moves,play:play,aiMove:aiMove,view:view,cardStr:cardStr};
});
