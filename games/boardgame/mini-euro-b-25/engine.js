(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MiniEuroEngine=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
  var CFG={"name":"港口货单","en":"HARBOR MANIFEST","slug":"mini-euro-b-25","market":6,"copies":5,"setPoints":7,"suits":[{"name":"茶叶","color":"#6f9b5b"},{"name":"咖啡","color":"#7a5b45"},{"name":"可可","color":"#a56b45"},{"name":"糖","color":"#b58f6a"},{"name":"橡胶","color":"#6a7a8f"}]};

  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  function shuffle(list,rng){var out=list.slice();for(var i=out.length-1;i>0;i--){var j=Math.floor(rng()*(i+1));var t=out[i];out[i]=out[j];out[j]=t;}return out;}
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function assertMove(ok,msg){if(!ok)throw new Error('非法动作: '+msg);}

  function buildDeck(seed){var d=[];CFG.suits.forEach(function(s,si){for(var i=0;i<CFG.copies;i++)d.push({id:'c'+d.length,suit:si,name:s.name});});return shuffle(d,mulberry32(seed));}
  function makePlayer(i){return{index:i,name:i===0?'你':'AI 收藏家',hand:[],sets:0,score:0};}
  function createGame(seed){var sd=(seed==null?1:Number(seed))>>>0;var deck=buildDeck(sd);var market=[];while(market.length<CFG.market&&deck.length)market.push(deck.shift());return{seed:sd,deck:deck,market:market,players:[makePlayer(0),makePlayer(1)],current:0,turn:1,over:false,winner:null,log:['新对局开始，你是先手。']};}
  function countSuit(p,suit){return p.hand.filter(function(c){return c.suit===suit;}).length;}
  function scoreOf(s,i){var p=s.players[i];var base=p.score;CFG.suits.forEach(function(_,si){base+=Math.floor(countSuit(p,si)/2);});return base;}
  function refill(s){while(s.market.length<CFG.market&&s.deck.length)s.market.push(s.deck.shift());}
  function endCheck(s){if(s.market.length===0&&s.deck.length===0){s.over=true;var a=scoreOf(s,0),b=scoreOf(s,1);s.winner=a>b?0:(b>a?1:null);s.log.unshift('终局：'+(s.winner==null?'平局':s.winner===0?'你获胜':'AI 获胜'));}}
  function applyMove(s,m){assertMove(s&&!s.over,'对局已结束');assertMove(m&&typeof m.type==='string','缺少动作类型');var n=clone(s);var p=n.players[n.current];
    if(m.type==='take'){assertMove(Number.isInteger(m.index)&&m.index>=0&&m.index<n.market.length,'市集索引无效');var c=n.market.splice(m.index,1)[0];p.hand.push(c);refill(n);n.log.unshift('你收取「'+c.name+'」。');if(n.log.length>8)n.log.pop();n.current=1-n.current;n.turn++;endCheck(n);return n;}
    if(m.type==='set'){assertMove(Number.isInteger(m.suit)&&m.suit>=0&&m.suit<CFG.suits.length,'套系无效');assertMove(countSuit(p,m.suit)>=3,'该套系不足 3 张');var removed=0;p.hand=p.hand.filter(function(c){if(c.suit===m.suit&&removed<3){removed++;return false;}return true;});p.sets++;p.score+=CFG.setPoints;p.score+=p.sets>=3?2:0;n.log.unshift('你完成一套「'+CFG.suits[m.suit].name+'」，得 '+CFG.setPoints+' 分。');if(n.log.length>8)n.log.pop();n.turn++;endCheck(n);return n;}
    throw new Error('非法动作: 未知动作 '+m.type);}
  function getLegalMoves(s){if(!s||s.over)return[];var p=s.players[s.current];var out=[];s.market.forEach(function(c,i){out.push({type:'take',index:i});});CFG.suits.forEach(function(_,si){if(countSuit(p,si)>=3)out.push({type:'set',suit:si});});return out;}
  function chooseAIMove(s){var p=s.players[s.current];for(var si=0;si<CFG.suits.length;si++){if(countSuit(p,si)>=3)return{type:'set',suit:si};}var best=null,bv=-1;for(var i=0;i<s.market.length;i++){var c=s.market[i],cnt=countSuit(p,c.suit);var v=cnt>=3?7:cnt>=2?5:cnt>=1?2:1;if(v>bv){bv=v;best={type:'take',index:i};}}return best;}
  return {CFG:CFG,createGame:createGame,applyMove:applyMove,getLegalMoves:getLegalMoves,chooseAIMove:chooseAIMove,scoreOf:scoreOf,countSuit:countSuit};
});