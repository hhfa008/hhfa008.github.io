(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MiniCardEngine=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
var RANK_NAMES={1:'A',2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K'};
var SUIT_SYMBOLS=['\u2660','\u2665','\u2666','\u2663'];
function mulberry32(seed){var a=(seed>>>0)||1;return function(){a=(a+0x6D2B79F5)|0;var t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
function shuffle(arr,rng){for(var i=arr.length-1;i>0;i--){var j=Math.floor(rng()*(i+1));var t=arr[i];arr[i]=arr[j];arr[j]=t;}return arr;}
function buildDeck(suits,maxRank){var d=[],s,r;for(s=0;s<suits;s++){for(r=1;r<=maxRank;r++){d.push({r:r,s:s});}}return d;}
function cardStr(c){return SUIT_SYMBOLS[c.s]+RANK_NAMES[c.r];}
function handName(p){return p?'电脑':'你';}
var TITLE="单升塔";
var SLUG="mini-card-a-22";
var CFG={"suits":4,"maxRank":13,"handSize":8,"piles":3,"rule":"up"};
function pileMatch(c,top){
  if(CFG.rule==='neighbor')return Math.abs(c.r-top.r)===1;
  if(CFG.rule==='up')return c.r===(top.r%13)+1;
  if(CFG.rule==='sameSuitUp')return c.s===top.s&&c.r>top.r;
  if(CFG.rule==='sum10')return c.s===top.s||(c.r+top.r===10);
  return false;
}
function createGame(opts){
  opts=opts||{};var rng=mulberry32(opts.seed||1);var deck=shuffle(buildDeck(CFG.suits,CFG.maxRank),rng);
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
