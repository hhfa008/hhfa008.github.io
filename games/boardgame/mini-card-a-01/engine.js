(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MiniCardEngine=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
var RANK_NAMES={1:'A',2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K'};
var SUIT_SYMBOLS=['\u2660','\u2665','\u2666','\u2663'];
function mulberry32(seed){var a=(seed>>>0)||1;return function(){a=(a+0x6D2B79F5)|0;var t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
function shuffle(arr,rng){for(var i=arr.length-1;i>0;i--){var j=Math.floor(rng()*(i+1));var t=arr[i];arr[i]=arr[j];arr[j]=t;}return arr;}
function buildDeck(suits,maxRank){var d=[],s,r;for(s=0;s<suits;s++){for(r=1;r<=maxRank;r++){d.push({r:r,s:s});}}return d;}
function cardStr(c){return SUIT_SYMBOLS[c.s]+RANK_NAMES[c.r];}
function handName(p){return p?'电脑':'你';}
var TITLE="彩虹接龙";
var SLUG="mini-card-a-01";
var CFG={"suits":4,"maxRank":13,"handSize":8,"rule":"suitRank"};
function matchCard(c,top){
  if(CFG.rule==='suitRank')return c.s===top.s||c.r===top.r;
  if(CFG.rule==='neighbor')return c.s===top.s&&Math.abs(c.r-top.r)===1;
  if(CFG.rule==='parity')return (c.r%2)===(top.r%2);
  if(CFG.rule==='sum10')return c.s===top.s||(c.r+top.r===10);
  if(CFG.rule==='wild')return c.r===CFG.wildRank||c.s===top.s||c.r===top.r;
  return false;
}
function createGame(opts){
  opts=opts||{};var rng=mulberry32(opts.seed||1);var deck=shuffle(buildDeck(CFG.suits,CFG.maxRank),rng);
  var h0=[],h1=[],i;
  for(i=0;i<CFG.handSize;i++){h0.push(deck.pop());h1.push(deck.pop());}
  var top=deck.pop();
  return {phase:'playing',winner:null,turn:0,hands:[h0,h1],deck:deck,top:top,round:0,log:['开局：弃牌堆顶 '+cardStr(top)]};
}
function playableIndexes(st,p){var out=[],i;for(i=0;i<st.hands[p].length;i++){if(matchCard(st.hands[p][i],st.top))out.push(i);}return out;}
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
    if(!matchCard(c,st.top))return {ok:false,error:'这张牌接不上'};
    st.hands[p].splice(mv.card,1);st.top=c;st.round++;
    st.log.push(handName(p)+' 出 '+cardStr(c));
    checkHands(st);
    if(st.phase==='playing')st.turn=1-p;
    return {ok:true};
  }
  if(mv.type==='draw'){
    if(playableIndexes(st,p).length)return {ok:false,error:'还有可出的牌'};
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
  if(st.turn===0){for(i=0;i<ms.length;i++){if(ms[i].type==='draw')actions.push({label:st.deck.length?'摸一张':'无牌可出',move:ms[i]});}}
  var status;
  if(st.phase==='over')status=st.winner==='tie'?'平局':(st.winner===0?'你赢了！':'电脑获胜');
  else status=st.turn===0?'轮到你出牌':'电脑思考中';
  return {status:status,sub:'弃牌堆顶 '+cardStr(st.top)+' · 摸牌堆 '+st.deck.length+' 张',piles:[{label:'电脑手牌',cards:[st.hands[1].length+' 张']},{label:'弃牌堆顶',cards:[cardStr(st.top)]},{label:'摸牌堆',cards:[st.deck.length+' 张']}],hand:hand,actions:actions,over:st.phase==='over',log:st.log.slice(-4)};
}
return {title:TITLE,slug:SLUG,createGame:createGame,moves:moves,play:play,aiMove:aiMove,view:view,cardStr:cardStr};
});
