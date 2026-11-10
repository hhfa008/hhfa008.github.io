(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MiniEuroEngine=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
  var CFG={"name":"苔原村落","en":"TUNDRA HAMLET","slug":"mini-euro-b-14","size":4,"market":3,"turns":12,"copiesPerTerrain":7,"terrains":[{"name":"木屋","color":"#b07a4f"},{"name":"兽栏","color":"#8d9b66"},{"name":"松林","color":"#4f7d5c"},{"name":"冰湖","color":"#8fc3d8"}]};

  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  function shuffle(list,rng){var out=list.slice();for(var i=out.length-1;i>0;i--){var j=Math.floor(rng()*(i+1));var t=out[i];out[i]=out[j];out[j]=t;}return out;}
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function assertMove(ok,msg){if(!ok)throw new Error('非法动作: '+msg);}

  function makeBag(seed){var bag=[];CFG.terrains.forEach(function(t,ti){for(var i=0;i<CFG.copiesPerTerrain;i++)bag.push(ti);});return shuffle(bag,mulberry32(seed));}
  function emptyBoard(){var a=[];for(var i=0;i<CFG.size*CFG.size;i++)a.push(null);return a;}
  function makePlayer(i){return{index:i,name:i===0?'你':'AI 园艺师',board:emptyBoard(),score:0,placed:0};}
  function createGame(seed){var sd=(seed==null?1:Number(seed))>>>0;var bag=makeBag(sd);var market=[];while(market.length<CFG.market&&bag.length)market.push(bag.shift());return{seed:sd,bag:bag,market:market,players:[makePlayer(0),makePlayer(1)],current:0,turn:1,over:false,winner:null,log:['新对局开始，你是先手。']};}
  function neighbors(i){var s=CFG.size,x=i%s,y=Math.floor(i/s),out=[];if(x>0)out.push(i-1);if(x<s-1)out.push(i+1);if(y>0)out.push(i-s);if(y<s-1)out.push(i+s);return out;}
  function placementScore(board,i,terrain){var sc=0;neighbors(i).forEach(function(j){if(board[j]===terrain)sc+=2;});return sc;}
  function refill(s){while(s.market.length<CFG.market&&s.bag.length)s.market.push(s.bag.shift());}
  function applyMove(s,m){assertMove(s&&!s.over,'对局已结束');assertMove(m&&m.type==='place','缺少放置动作');var n=clone(s);var p=n.players[n.current];assertMove(Number.isInteger(m.marketIndex)&&m.marketIndex>=0&&m.marketIndex<n.market.length,'板块索引无效');assertMove(Number.isInteger(m.cell)&&m.cell>=0&&m.cell<CFG.size*CFG.size,'格子索引无效');assertMove(p.board[m.cell]===null,'该格已有板块');var terr=n.market[m.marketIndex];assertMove(typeof terr==='number','板块不存在');var gain=placementScore(p.board,m.cell,terr);p.board[m.cell]=terr;p.score+=gain;p.placed++;n.market.splice(m.marketIndex,1);refill(n);n.log.unshift('你在第 '+p.placed+' 块地放置 '+CFG.terrains[terr].name+'，得 '+gain+' 分。');if(n.log.length>8)n.log.pop();n.current=1-n.current;n.turn++;var a=n.players[0],b=n.players[1];if((a.placed>=CFG.turns&&b.placed>=CFG.turns)||n.market.length===0){n.over=true;n.winner=a.score>b.score?0:(b.score>a.score?1:null);n.log.unshift('终局：'+(n.winner==null?'平局':n.winner===0?'你获胜':'AI 获胜'));}return n;}
  function getLegalMoves(s){if(!s||s.over)return[];var p=s.players[s.current];var out=[];s.market.forEach(function(t,mi){for(var c=0;c<CFG.size*CFG.size;c++)if(p.board[c]===null)out.push({type:'place',marketIndex:mi,cell:c});});return out;}
  function chooseAIMove(s){var p=s.players[s.current];var best=null,bv=-1;for(var mi=0;mi<s.market.length;mi++){for(var c=0;c<CFG.size*CFG.size;c++){if(p.board[c]!==null)continue;var v=placementScore(p.board,c,s.market[mi]);if(v>bv){bv=v;best={type:'place',marketIndex:mi,cell:c};}}}return best;}
  return {CFG:CFG,createGame:createGame,applyMove:applyMove,getLegalMoves:getLegalMoves,chooseAIMove:chooseAIMove,placementScore:placementScore,neighbors:neighbors};
});