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
var TITLE="同花塔";
var SLUG="mini-card-a-23";
var CFG={"suits":4,"maxRank":13,"handSize":8,"piles":3,"rule":"sameSuitUp"};
function pileMatch(c,top){
  if(CFG.rule==='neighbor')return Math.abs(c.r-top.r)===1;
  if(CFG.rule==='up')return c.r===(top.r%13)+1;
  if(CFG.rule==='sameSuitUp')return c.s===top.s&&c.r>top.r;
  if(CFG.rule==='sum10')return c.s===top.s||(c.r+top.r===10);
  return false;
}
function createGame(opts){
  opts=opts||{};var rng=mulberry32(opts.seed||1);var deck=Cards.shuffle(Cards.makeDeck(CFG.suits,CFG.maxRank),rng);
  var h0=[],h1=[],piles=[],i;
  for(i=0;i<CFG.handSize;i++){h0.push(deck.pop());h1.push(deck.pop());}
  for(i=0;i<CFG.piles;i++)piles.push(deck.pop());
  return {phase:'playing',winner:null,turn:0,hands:[h0,h1],deck:deck,piles:piles,round:0,log:['开局：桌面有 '+CFG.piles+' 座塔']};
}
function findPile(st,c){
  for(var i=0;i<st.piles.length;i++){if(pileMatch(c,st.piles[i]))return i;}
  return -1;
}
function playableIndexes(st,p){
  var out=[],i;
  for(i=0;i<st.hands[p].length;i++){if(findPile(st,st.hands[p][i])>=0)out.push(i);}
  return out;
}
function moves(st){
  if(st.phase!=='playing')return [];
  var idx=playableIndexes(st,st.turn),out=[],i;
  for(i=0;i<idx.length;i++)out.push({type:'play',card:idx[i]});
  if(!out.length)out.push({type:'draw'});
  return out;
}
function endByCount(st){var a=st.hands[0].length,b=st.hands[1].length;st.phase='over';st.winner=a<b?0:(b<a?1:'tie');st.log.push('摸牌堆耗尽，按手牌数结算');}
function checkHands(st){if(st.hands[0].length===0){st.phase='over';st.winner=0;}else if(st.hands[1].length===0){st.phase='over';st.winner=1;}}
function play(st,mv){
  if(st.phase!=='playing')return {ok:false,error:'本局已结束'};
  var p=st.turn;
  if(mv.type==='play'){
    var c=st.hands[p][mv.card];
    if(!c)return {ok:false,error:'这张牌不在手中'};
    var pi=findPile(st,c);
    if(pi<0)return {ok:false,error:'没有能接上的塔'};
    st.hands[p].splice(mv.card,1);
    st.piles[pi]=c;st.round++;
    st.log.push(handName(p)+' 把 '+cardStr(c)+' 接到第 '+(pi+1)+' 座塔');
    checkHands(st);
    if(st.phase==='playing')st.turn=1-p;
    return {ok:true};
  }
  if(mv.type==='draw'){
    if(playableIndexes(st,p).length)return {ok:false,error:'还有可接的牌'};
    if(st.deck.length){var d=st.deck.pop();st.hands[p].push(d);st.turn=1-p;st.round++;st.log.push(handName(p)+' 摸了一张');return {ok:true};}
    endByCount(st);return {ok:true};
  }
  return {ok:false,error:'未知动作'};
}
function aiMove(st){
  if(st.phase!=='playing')return null;
  var ms=moves(st),best=ms[0],i,c,br=-1;
  if(ms[0]&&ms[0].type==='play'){
    for(i=0;i<ms.length;i++){c=st.hands[st.turn][ms[i].card];if(c.r>br){br=c.r;best=ms[i];}}
  }
  return best;
}
function view(st){
  var ms=moves(st),legal={},i;
  if(st.turn===0){for(i=0;i<ms.length;i++){if(ms[i].type==='play')legal[ms[i].card]=1;}}
  var hand=st.hands[0].map(function(c,idx){return {label:cardStr(c),move:legal[idx]?{type:'play',card:idx}:null};});
  var actions=[];
  if(st.turn===0){for(i=0;i<ms.length;i++){if(ms[i].type==='draw')actions.push({label:st.deck.length?'摸一张':'无牌可接',move:ms[i]});}}
  var piles=st.piles.map(function(c,idx){return {label:'塔 '+(idx+1),cards:[cardStr(c)]};});
  piles.push({label:'电脑手牌',cards:[st.hands[1].length+' 张']});
  piles.push({label:'摸牌堆',cards:[st.deck.length+' 张']});
  var status;
  if(st.phase==='over')status=st.winner==='tie'?'平局':(st.winner===0?'你赢了！':'电脑获胜');
  else status=st.turn===0?'轮到你接牌':'电脑思考中';
  return {status:status,sub:'手牌 '+st.hands[0].length+' 张 · 已进行 '+st.round+' 步',piles:piles,hand:hand,actions:actions,over:st.phase==='over',log:st.log.slice(-4)};
}
return {title:TITLE,slug:SLUG,createGame:createGame,moves:moves,play:play,aiMove:aiMove,view:view,cardStr:cardStr};
});
