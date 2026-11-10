(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MiniEuroEngine=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
  var CFG={"name":"药草工坊","en":"HERB WORKSHOP","slug":"mini-euro-b-03","turns":11,"marketSize":4,"cards":[{"name":"晒药架","cost":2,"coins":2,"vp":0,"copies":3},{"name":"甘草束","cost":3,"coins":0,"vp":2,"copies":3},{"name":"月露瓶","cost":4,"coins":0,"vp":3,"copies":2},{"name":"铜药碾","cost":4,"coins":2,"vp":1,"copies":2},{"name":"祖传古方","cost":6,"coins":0,"vp":4,"copies":2},{"name":"大师药匣","cost":8,"coins":0,"vp":6,"copies":1}]};

  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  function shuffle(list,rng){var out=list.slice();for(var i=out.length-1;i>0;i--){var j=Math.floor(rng()*(i+1));var t=out[i];out[i]=out[j];out[j]=t;}return out;}
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function assertMove(ok,msg){if(!ok)throw new Error('非法动作: '+msg);}

  var STARTER=[{name:'铜币',cost:0,coins:1,vp:0,copies:7},{name:'木箱',cost:0,coins:0,vp:1,copies:3}];
  function makeCard(def,id){return{id:id,name:def.name,cost:def.cost,coins:def.coins,vp:def.vp};}
  function buildDeck(){var d=[];STARTER.forEach(function(c){for(var i=0;i<c.copies;i++)d.push(makeCard(c,'s'+d.length));});return d;}
  function buildMarketDeck(rng){var d=[];CFG.cards.forEach(function(c){for(var i=0;i<(c.copies||2);i++)d.push(makeCard(c,'m'+d.length));});return shuffle(d,rng);}
  function player(i,seed){var rng=mulberry32(seed+i*911);var p={index:i,name:i===0?'你':'AI 商队',deck:shuffle(buildDeck(),rng),hand:[],discard:[],coins:0};draw(p,seed,0);return p;}
  function draw(p,seed,turn){while(p.hand.length<5){if(!p.deck.length){if(!p.discard.length)break;var rng=mulberry32((seed+turn*97+p.index*131)>>>0);p.deck=shuffle(p.discard,rng);p.discard=[];}p.hand.push(p.deck.shift());}}
  function refill(s){while(s.market.length<CFG.marketSize&&s.marketDeck.length)s.market.push(s.marketDeck.shift());}
  function createGame(seed){var sd=(seed==null?1:Number(seed))>>>0;var rng=mulberry32(sd);var s={seed:sd,marketDeck:buildMarketDeck(rng),market:[],players:[player(0,sd),player(1,sd)],current:0,turn:1,over:false,winner:null,log:['新对局开始，你是先手。']};refill(s);return s;}
  function handCoins(p){return p.hand.reduce(function(n,c){return n+c.coins;},0);}
  function owned(p){return p.deck.concat(p.hand,p.discard);}
  function scoreOf(s,i){var p=s.players[i];var vp=owned(p).reduce(function(n,c){return n+c.vp;},0);return vp+Math.floor(owned(p).filter(function(c){return c.coins>0;}).length/4);}
  function finishTurn(s,msg){var p=s.players[s.current];p.hand.forEach(function(c){p.discard.push(c);});p.hand=[];p.coins=0;s.turn++;var other=s.players[1-s.current];draw(other,s.seed,s.turn);s.current=1-s.current;draw(s.players[s.current],s.seed,s.turn);s.log.unshift(msg);if(s.log.length>8)s.log.pop();if(s.players[0].turnCount==null)s.players[0].turnCount=0;if(s.players[1].turnCount==null)s.players[1].turnCount=0;s.players[1-s.current].turnCount=(s.players[1-s.current].turnCount||0)+1;if((s.players[0].turnCount||0)>=CFG.turns&&(s.players[1].turnCount||0)>=CFG.turns){s.over=true;var a=scoreOf(s,0),b=scoreOf(s,1);s.winner=a>b?0:(b>a?1:null);s.log.unshift('终局：'+(s.winner==null?'平局':s.winner===0?'你获胜':'AI 获胜'));}return s;}
  function applyMove(s,m){assertMove(s&&!s.over,'对局已结束');assertMove(m&&typeof m.type==='string','缺少动作类型');var p=s.players[s.current];var n=clone(s);
    if(m.type==='buy'){assertMove(Number.isInteger(m.index)&&m.index>=0&&m.index<n.market.length,'市场索引无效');var c=n.market[m.index];var coins=handCoins(n.players[n.current]);assertMove(coins>=c.cost,'金币不足');n.players[n.current].discard.push(c);n.market.splice(m.index,1);refill(n);return finishTurn(n,'你买入「'+c.name+'」，花费 '+c.cost+' 金币。');}
    if(m.type==='pass'){return finishTurn(n,'你跳过购买，保留手牌循环。');}
    throw new Error('非法动作: 未知动作 '+m.type);}
  function getLegalMoves(s){if(!s||s.over)return[];var out=[{type:'pass'}];var coins=handCoins(s.players[s.current]);s.market.forEach(function(c,i){if(c.cost<=coins)out.push({type:'buy',index:i});});return out;}
  function chooseAIMove(s){var moves=getLegalMoves(s);if(!moves.length)return null;var best=moves[0],bv=-1;moves.forEach(function(m){if(m.type!=='buy')return;var c=s.market[m.index];var v=c.vp*4+c.coins*1.2;if(v>bv){bv=v;best=m;}});return best;}
  return {CFG:CFG,createGame:createGame,applyMove:applyMove,getLegalMoves:getLegalMoves,chooseAIMove:chooseAIMove,scoreOf:scoreOf,handCoins:handCoins};
});