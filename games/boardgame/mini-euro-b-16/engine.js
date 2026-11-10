(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MiniEuroEngine=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
  var CFG={"name":"驿路争锋","en":"COURIER ROADS","slug":"mini-euro-b-16","turns":12,"income":2,"startCoins":4,"networkBonus":2,"nodes":[{"name":"北门","x":50,"y":20},{"name":"山口","x":150,"y":40},{"name":"渡口","x":250,"y":25},{"name":"西市","x":40,"y":120},{"name":"中庭","x":150,"y":115},{"name":"东港","x":265,"y":110},{"name":"南仓","x":150,"y":195}],"edges":[{"a":0,"b":1,"cost":2,"pts":3},{"a":1,"b":2,"cost":3,"pts":4},{"a":0,"b":3,"cost":2,"pts":2},{"a":1,"b":4,"cost":3,"pts":5},{"a":2,"b":5,"cost":3,"pts":4},{"a":3,"b":4,"cost":2,"pts":3},{"a":4,"b":5,"cost":4,"pts":6},{"a":3,"b":6,"cost":3,"pts":4},{"a":4,"b":6,"cost":2,"pts":3},{"a":5,"b":6,"cost":4,"pts":5}]};

  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  function shuffle(list,rng){var out=list.slice();for(var i=out.length-1;i>0;i--){var j=Math.floor(rng()*(i+1));var t=out[i];out[i]=out[j];out[j]=t;}return out;}
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function assertMove(ok,msg){if(!ok)throw new Error('非法动作: '+msg);}

  function makePlayer(i){return{index:i,name:i===0?'你':'AI 领队',coins:CFG.startCoins,score:0,claimed:[]};}
  function createGame(seed){var sd=(seed==null?1:Number(seed))>>>0;return{seed:sd,players:[makePlayer(0),makePlayer(1)],current:0,turn:1,over:false,winner:null,log:['新对局开始，你是先手。']};}
  function edgeOpen(s,i){return s.players.every(function(p){return p.claimed.indexOf(i)<0;});}
  function compSize(p){var adj={},seen={},best=0;CFG.edges.forEach(function(e,ei){if(p.claimed.indexOf(ei)<0)return;(adj[e.a]=adj[e.a]||[]).push(e.b);(adj[e.b]=adj[e.b]||[]).push(e.a);});CFG.nodes.forEach(function(_,n){if(seen[n])return;var q=[n],size=0;seen[n]=true;while(q.length){var x=q.pop();size++;(adj[x]||[]).forEach(function(y){if(!seen[y]){seen[y]=true;q.push(y);}});}if(size>best)best=size;});return best;}
  function scoreOf(s,i){var p=s.players[i];return p.score+Math.max(0,compSize(p)-1)*CFG.networkBonus;}
  function endCheck(s){var a=s.players[0],b=s.players[1];if(a.turns>=CFG.turns&&b.turns>=CFG.turns){s.over=true;var sa=scoreOf(s,0),sb=scoreOf(s,1);s.winner=sa>sb?0:(sb>sa?1:null);s.log.unshift('终局：'+(s.winner==null?'平局':s.winner===0?'你获胜':'AI 获胜'));}}
  function applyMove(s,m){assertMove(s&&!s.over,'对局已结束');assertMove(m&&typeof m.type==='string','缺少动作类型');var n=clone(s);var p=n.players[n.current];if(p.turns==null)p.turns=0;
    if(m.type==='claim'){assertMove(Number.isInteger(m.edge)&&m.edge>=0&&m.edge<CFG.edges.length,'路线索引无效');assertMove(edgeOpen(n,m.edge),'该路线已被占用');var e=CFG.edges[m.edge];assertMove(p.coins>=e.cost,'金币不足');p.coins-=e.cost;p.claimed.push(m.edge);p.score+=e.pts;p.turns++;n.log.unshift('你花费 '+e.cost+' 金币修筑路线，得 '+e.pts+' 分。');if(n.log.length>8)n.log.pop();n.current=1-n.current;n.players[n.current].coins+=CFG.income;n.turn++;endCheck(n);return n;}
    if(m.type==='pass'){p.coins+=CFG.income;p.turns++;n.log.unshift('你积蓄 1 金币，跳过修筑。');if(n.log.length>8)n.log.pop();n.current=1-n.current;n.players[n.current].coins+=CFG.income;n.turn++;endCheck(n);return n;}
    throw new Error('非法动作: 未知动作 '+m.type);}
  function getLegalMoves(s){if(!s||s.over)return[];var p=s.players[s.current];var out=[{type:'pass'}];CFG.edges.forEach(function(e,i){if(edgeOpen(s,i)&&p.coins>=e.cost)out.push({type:'claim',edge:i});});return out;}
  function chooseAIMove(s){var p=s.players[s.current];var best={type:'pass'},bv=-1;CFG.edges.forEach(function(e,i){if(!edgeOpen(s,i)||p.coins<e.cost)return;var v=e.pts/e.cost+compSize(p)*.1;if(v>bv){bv=v;best={type:'claim',edge:i};}});return best;}
  return {CFG:CFG,createGame:createGame,applyMove:applyMove,getLegalMoves:getLegalMoves,chooseAIMove:chooseAIMove,scoreOf:scoreOf,compSize:compSize};
});