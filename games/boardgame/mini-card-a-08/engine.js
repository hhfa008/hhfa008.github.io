(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MiniCardEngine=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
var RANK_NAMES={1:'A',2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K'};
var SUIT_SYMBOLS=['\u2660','\u2665','\u2666','\u2663'];
function mulberry32(seed){var a=(seed>>>0)||1;return function(){a=(a+0x6D2B79F5)|0;var t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
function shuffle(arr,rng){for(var i=arr.length-1;i>0;i--){var j=Math.floor(rng()*(i+1));var t=arr[i];arr[i]=arr[j];arr[j]=t;}return arr;}
function buildDeck(suits,maxRank){var d=[],s,r;for(s=0;s<suits;s++){for(r=1;r<=maxRank;r++){d.push({r:r,s:s});}}return d;}
function cardStr(c){return SUIT_SYMBOLS[c.s]+RANK_NAMES[c.r];}
function handName(p){return p?'电脑':'你';}
var TITLE="黑桃王座";
var SLUG="mini-card-a-08";
var CFG={"suits":4,"maxRank":13,"handSize":6,"trump":0,"rule":"high","followSuit":false};
function createGame(opts){
  opts=opts||{};var rng=mulberry32(opts.seed||1);var deck=shuffle(buildDeck(CFG.suits,CFG.maxRank),rng);
  var h0=[],h1=[],i;
  for(i=0;i<CFG.handSize;i++){h0.push(deck.pop());h1.push(deck.pop());}
  return {phase:'playing',winner:null,turn:0,hands:[h0,h1],tricks:[0,0],trick:[],trickNo:0,log:['开始：你先领出']};
}
function legalIndexes(st,p){
  var out=[],i;
  if(st.trick.length===0){for(i=0;i<st.hands[p].length;i++)out.push(i);return out;}
  var lead=st.trick[0].card.s;
  if(CFG.followSuit){
    var has=false;
    for(i=0;i<st.hands[p].length;i++){if(st.hands[p][i].s===lead){has=true;break;}}
    if(has){for(i=0;i<st.hands[p].length;i++){if(st.hands[p][i].s===lead)out.push(i);}return out;}
  }
  for(i=0;i<st.hands[p].length;i++)out.push(i);
  return out;
}
function moves(st){
  if(st.phase!=='playing')return [];
  var idx=legalIndexes(st,st.turn),out=[],i;
  for(i=0;i<idx.length;i++)out.push({type:'play',card:idx[i]});
  return out;
}
function beats(a,b){
  if(CFG.trump>=0){var at=a.s===CFG.trump,bt=b.s===CFG.trump;if(at&&!bt)return true;if(bt&&!at)return false;}
  if(CFG.rule==='low')return a.r<b.r;
  if(CFG.rule==='odd'){var ao=a.r%2===1,bo=b.r%2===1;if(ao!==bo)return ao;if(ao)return a.r>b.r;return a.r<b.r;}
  return a.r>b.r;
}
function finish(st){st.phase='over';st.winner=st.tricks[0]>st.tricks[1]?0:(st.tricks[1]>st.tricks[0]?1:'tie');st.log.push('对局结束，赢墩数已结算');}
function play(st,mv){
  if(st.phase!=='playing')return {ok:false,error:'本局已结束'};
  var p=st.turn;
  if(mv.type!=='play')return {ok:false,error:'请选择一张牌'};
  var idx=legalIndexes(st,p);
  if(idx.indexOf(mv.card)<0)return {ok:false,error:'这张牌不能出'};
  var c=st.hands[p].splice(mv.card,1)[0];
  st.trick.push({p:p,card:c});
  st.log.push(handName(p)+' 出 '+cardStr(c));
  if(st.trick.length<2){st.turn=1-p;return {ok:true};}
  var t0=st.trick[0],t1=st.trick[1];
  var w=beats(t1.card,t0.card)?1:0;
  st.tricks[w]++;st.trickNo++;
  st.log.push(handName(w)+' 赢下第 '+st.trickNo+' 墩');
  st.trick=[];
  if(st.hands[0].length===0&&st.hands[1].length===0){finish(st);return {ok:true};}
  st.turn=w;
  return {ok:true};
}
function aiMove(st){
  if(st.phase!=='playing')return null;
  var ms=moves(st),legal=legalIndexes(st,st.turn),pick=legal[0],i,c,best=null;
  if(!ms.length)return null;
  if(st.trick.length===0){pick=legal[0];for(i=1;i<legal.length;i++){if(st.hands[st.turn][legal[i]].r<st.hands[st.turn][pick].r)pick=legal[i];}}
  else {pick=legal[0];for(i=1;i<legal.length;i++){if(st.hands[st.turn][legal[i]].r>st.hands[st.turn][pick].r)pick=legal[i];}}
  for(i=0;i<ms.length;i++){if(ms[i].card===pick)return ms[i];}
  return ms[0];
}
function view(st){
  var ms=moves(st),legal={},i;
  if(st.turn===0){for(i=0;i<ms.length;i++)legal[ms[i].card]=1;}
  var hand=st.hands[0].map(function(c,idx){return {label:cardStr(c),move:legal[idx]?{type:'play',card:idx}:null};});
  var status;
  if(st.phase==='over')status=st.winner==='tie'?'平局':(st.winner===0?'你赢了！':'电脑获胜');
  else status=st.turn===0?'轮到你出牌':'电脑思考中';
  var table=st.trick.map(function(t){return cardStr(t.card);});
  return {status:status,sub:'第 '+(st.trickNo+1)+' / '+CFG.handSize+' 墩 · '+(st.trick.length?'跟牌':'领出'),piles:[{label:'你的赢墩',cards:[String(st.tricks[0])]},{label:'电脑赢墩',cards:[String(st.tricks[1])]},{label:'本墩',cards:table.length?table:['—']},{label:'电脑手牌',cards:[st.hands[1].length+' 张']}],hand:hand,actions:[],over:st.phase==='over',log:st.log.slice(-4)};
}
return {title:TITLE,slug:SLUG,createGame:createGame,moves:moves,play:play,aiMove:aiMove,view:view,cardStr:cardStr};
});
