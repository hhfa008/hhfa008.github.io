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
var TITLE="窄牌钓鱼";
var SLUG="mini-card-a-20";
var CFG={"suits":2,"maxRank":12,"handSize":6,"pairMode":"sameRank"};
function createGame(opts){
  opts=opts||{};var rng=mulberry32(opts.seed||1);var deck=Cards.shuffle(Cards.makeDeck(CFG.suits,CFG.maxRank),rng);
  var h0=[],h1=[],i;
  for(i=0;i<CFG.handSize;i++){h0.push(deck.pop());h1.push(deck.pop());}
  var st={phase:'playing',winner:null,turn:0,hands:[h0,h1],deck:deck,books:[0,0],log:['开始：选择一种自己持有的点数索要']};
  resolvePairs(st,0);resolvePairs(st,1);
  return st;
}
function resolvePairs(st,p){
  var h=st.hands[p],changed=true,guard=0,i,j,r;
  while(changed&&guard++<80){
    changed=false;
    if(CFG.pairMode==='triple'){
      for(i=0;i<h.length&&!changed;i++){
        var count=1;
        for(j=i+1;j<h.length;j++){if(h[j].r===h[i].r)count++;}
        if(count>=3){var rank=h[i].r,removed=0;for(j=h.length-1;j>=0&&removed<3;j--){if(h[j].r===rank){h.splice(j,1);removed++;}}st.books[p]++;st.log.push(handName(p)+' 凑成三条 '+RANK_NAMES[rank]);changed=true;}
      }
    } else {
      for(i=0;i<h.length&&!changed;i++){
        for(j=i+1;j<h.length;j++){
          var ok=false;
          if(CFG.pairMode==='sameRank')ok=h[i].r===h[j].r;
          else if(CFG.pairMode==='sum10')ok=h[i].r+h[j].r===10;
          else if(CFG.pairMode==='neighbor')ok=Math.abs(h[i].r-h[j].r)===1;
          if(ok){var pairRank=h[i].r;h.splice(j,1);h.splice(i,1);st.books[p]++;st.log.push(handName(p)+' 配对 '+RANK_NAMES[pairRank]);changed=true;break;}
        }
      }
    }
  }
}
function candidateRanks(st,p){
  var h=st.hands[p],seen={},out=[],i,r;
  for(i=0;i<h.length;i++){
    if(CFG.pairMode==='sum10')r=10-h[i].r;
    else if(CFG.pairMode==='neighbor')r=h[i].r+1;
    else r=h[i].r;
    if(r>=1&&r<=CFG.maxRank&&!seen[r]){seen[r]=1;out.push(r);}
  }
  return out;
}
function validAsk(st,p,r){
  var h=st.hands[p],i;
  for(i=0;i<h.length;i++){
    if(CFG.pairMode==='sum10'){if(h[i].r===10-r)return true;}
    else if(CFG.pairMode==='neighbor'){if(Math.abs(h[i].r-r)===1)return true;}
    else {if(h[i].r===r)return true;}
  }
  return false;
}
function finish(st){
  st.phase='over';
  st.winner=st.books[0]>st.books[1]?0:(st.books[1]>st.books[0]?1:'tie');
  st.log.push('摸牌堆耗尽，配对数量已结算');
}
function moves(st){
  if(st.phase!=='playing')return [];
  var p=st.turn;
  if(!st.hands[p].length)return st.deck.length?[{type:'refill'}]:[];
  var ranks=candidateRanks(st,p),out=[],i;
  for(i=0;i<ranks.length;i++){if(validAsk(st,p,ranks[i]))out.push({type:'ask',rank:ranks[i]});}
  if(!out.length)out.push({type:'pass'});
  return out;
}
function play(st,mv){
  if(st.phase!=='playing')return {ok:false,error:'本局已结束'};
  var p=st.turn,opp=1-p,i;
  if(mv.type==='refill'){
    if(st.hands[p].length)return {ok:false,error:'手牌不为空'};
    if(!st.deck.length){finish(st);return {ok:true};}
    st.hands[p].push(st.deck.pop());st.log.push(handName(p)+' 补摸一张');
    if(!st.deck.length){finish(st);return {ok:true};}
    st.turn=opp;return {ok:true};
  }
  if(mv.type==='pass'){
    if(st.deck.length){st.hands[p].push(st.deck.pop());resolvePairs(st,p);st.log.push(handName(p)+' 无牌可要，摸一张');}
    if(!st.deck.length){finish(st);return {ok:true};}
    st.turn=opp;return {ok:true};
  }
  if(mv.type!=='ask')return {ok:false,error:'未知动作'};
  if(!validAsk(st,p,mv.rank))return {ok:false,error:'只能索要与手牌互补的点数'};
  var taken=[];
  for(i=st.hands[opp].length-1;i>=0;i--){if(st.hands[opp][i].r===mv.rank){taken.push(st.hands[opp][i]);st.hands[opp].splice(i,1);}}
  if(taken.length){
    st.hands[p]=st.hands[p].concat(taken);
    st.log.push(handName(p)+' 向电脑索要 '+RANK_NAMES[mv.rank]+'，得到 '+taken.length+' 张');
    resolvePairs(st,p);
    if(!st.hands[opp].length&&st.deck.length)st.hands[opp].push(st.deck.pop());
  } else {
    st.log.push(handName(p)+' 索要 '+RANK_NAMES[mv.rank]+' 失败');
    if(st.deck.length){st.hands[p].push(st.deck.pop());resolvePairs(st,p);}
  }
  if(!st.deck.length){finish(st);return {ok:true};}
  if(!st.hands[0].length&&!st.hands[1].length){finish(st);return {ok:true};}
  st.turn=opp;
  return {ok:true};
}
function aiMove(st){
  if(st.phase!=='playing')return null;
  var ms=moves(st);
  if(!ms.length)return null;
  if(ms[0].type!=='ask')return ms[0];
  var p=st.turn,counts={},i,best=ms[0],br=-1;
  for(i=0;i<st.hands[p].length;i++){counts[st.hands[p][i].r]=(counts[st.hands[p][i].r]||0)+1;}
  for(i=0;i<ms.length;i++){
    var r=ms[i].rank;
    var score=CFG.pairMode==='sum10'?(counts[10-r]||0):(counts[r]||0);
    if(score>br){br=score;best=ms[i];}
  }
  return best;
}
function view(st){
  var ms=(st.turn===0&&st.phase==='playing')?moves(st):[],acts=[],seen={},i,label;
  for(i=0;i<ms.length;i++){
    if(ms[i].type==='ask'){if(seen[ms[i].rank])continue;seen[ms[i].rank]=1;label='索要 '+RANK_NAMES[ms[i].rank];}
    else if(ms[i].type==='refill')label='摸一张';
    else label='跳过并摸牌';
    acts.push({label:label,move:ms[i]});
  }
  var hand=st.hands[0].map(function(c){return {label:cardStr(c),move:null};});
  var status;
  if(st.phase==='over')status=st.winner==='tie'?'平局':(st.winner===0?'你赢了！':'电脑获胜');
  else status=st.turn===0?'轮到你索要':'电脑思考中';
  return {status:status,sub:'你配对 '+st.books[0]+' 组 · 电脑配对 '+st.books[1]+' 组 · 摸牌堆 '+st.deck.length+' 张',piles:[{label:'电脑手牌',cards:[st.hands[1].length+' 张']},{label:'电脑配对',cards:[st.books[1]+' 组']},{label:'摸牌堆',cards:[st.deck.length+' 张']}],hand:hand,actions:acts,over:st.phase==='over',log:st.log.slice(-4)};
}
return {title:TITLE,slug:SLUG,createGame:createGame,moves:moves,play:play,aiMove:aiMove,view:view,cardStr:cardStr};
});
