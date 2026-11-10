(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MiniCardEngine=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
var RANK_NAMES={1:'A',2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K'};
var SUIT_SYMBOLS=['\u2660','\u2665','\u2666','\u2663'];
function mulberry32(seed){var a=(seed>>>0)||1;return function(){a=(a+0x6D2B79F5)|0;var t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
function shuffle(arr,rng){for(var i=arr.length-1;i>0;i--){var j=Math.floor(rng()*(i+1));var t=arr[i];arr[i]=arr[j];arr[j]=t;}return arr;}
function buildDeck(suits,maxRank){var d=[],s,r;for(s=0;s<suits;s++){for(r=1;r<=maxRank;r++){d.push({r:r,s:s});}}return d;}
function cardStr(c){return SUIT_SYMBOLS[c.s]+RANK_NAMES[c.r];}
function handName(p){return p?'电脑':'你';}
var TITLE="三条钓鱼";
var SLUG="mini-card-a-19";
var CFG={"suits":4,"maxRank":13,"handSize":7,"pairMode":"triple"};
function createGame(opts){
  opts=opts||{};var rng=mulberry32(opts.seed||1);var deck=shuffle(buildDeck(CFG.suits,CFG.maxRank),rng);
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
