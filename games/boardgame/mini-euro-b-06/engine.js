(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MiniEuroEngine=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
  var CFG={"name":"骰匠工坊","en":"DICEWRIGHT WORKSHOP","slug":"mini-euro-b-06","rounds":8,"dice":3,"slots":[{"name":"磨角","req":1,"pts":2},{"name":"刻面","req":2,"pts":3},{"name":"上色","req":3,"pts":4},{"name":"校准","req":4,"pts":5},{"name":"包铜","req":5,"pts":6},{"name":"大师签名","req":6,"pts":9}]};

  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  function shuffle(list,rng){var out=list.slice();for(var i=out.length-1;i>0;i--){var j=Math.floor(rng()*(i+1));var t=out[i];out[i]=out[j];out[j]=t;}return out;}
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function assertMove(ok,msg){if(!ok)throw new Error('非法动作: '+msg);}

  function rollPool(seed){var pool=[];for(var p=0;p<2;p++){pool[p]=[];for(var r=0;r<CFG.rounds;r++){var rng=mulberry32((seed+r*73+p*991)>>>0);var dice=[];for(var d=0;d<CFG.dice;d++)dice.push(1+Math.floor(rng()*6));pool[p][r]=dice;}}return pool;}
  function makePlayer(i){return{index:i,name:i===0?'你':'AI 工匠',points:0,placedRound:-1,used:[],slots:[]};}
  function createGame(seed){var sd=(seed==null?1:Number(seed))>>>0;return{seed:sd,round:0,current:0,turn:1,over:false,winner:null,pool:rollPool(sd),players:[makePlayer(0),makePlayer(1)],log:['新对局开始，你是先手。']};}
  function rollFor(s,p){var pl=s.players[p];pl.used=s.pool[p][s.round].map(function(){return false;});pl.slots=CFG.slots.map(function(){return false;});pl.placedRound=s.round;}
  function ensureRoll(s){s.players.forEach(function(pl){if(pl.placedRound!==s.round)rollFor(s,pl.index);});}
  function roundDone(s){return s.players.every(function(p){return p.used.every(Boolean);});}
  function advance(s){var p=s.players[s.current];if(p.used.every(Boolean)){var other=1-s.current;if(!s.players[other].used.every(Boolean)){s.current=other;}else{s.round++;if(s.round>=CFG.rounds){s.over=true;var a=s.players[0].points,b=s.players[1].points;s.winner=a>b?0:(b>a?1:null);s.log.unshift('终局：'+(s.winner==null?'平局':s.winner===0?'你获胜':'AI 获胜'));}else{ensureRoll(s);s.current=0;}}}}
  function applyMove(s,m){assertMove(s&&!s.over,'对局已结束');assertMove(m&&typeof m.type==='string','缺少动作类型');var n=clone(s);ensureRoll(n);var p=n.players[n.current];
    if(m.type==='place'){assertMove(Number.isInteger(m.die)&&m.die>=0&&m.die<p.used.length,'骰子索引无效');assertMove(Number.isInteger(m.slot)&&m.slot>=0&&m.slot<CFG.slots.length,'工位索引无效');assertMove(!p.used[m.die],'该骰子已使用');assertMove(!p.slots[m.slot],'该工位本轮已被占用');var v=n.pool[n.current][n.round][m.die];var slot=CFG.slots[m.slot];assertMove(v>=slot.req,'点数不满足工位要求');p.used[m.die]=true;p.slots[m.slot]=true;p.points+=slot.pts;n.turn=(n.turn||1)+1;n.log.unshift('你以点数 '+v+' 放置「'+slot.name+'」，得 '+slot.pts+' 分。');if(n.log.length>8)n.log.pop();advance(n);return n;}
    if(m.type==='pass'){n.turn=(n.turn||1)+1;p.used=p.used.map(function(){return true;});n.log.unshift('你放弃剩余骰子。');advance(n);return n;}
    throw new Error('非法动作: 未知动作 '+m.type);}
  function getLegalMoves(s){if(!s||s.over)return[];var n=clone(s);ensureRoll(n);var p=n.players[n.current];var out=[];p.used.forEach(function(used,d){if(used)return;for(var i=0;i<CFG.slots.length;i++){if(!p.slots[i]&&n.pool[n.current][n.round][d]>=CFG.slots[i].req)out.push({type:'place',die:d,slot:i});}});out.push({type:'pass'});return out;}
  function chooseAIMove(s){var moves=getLegalMoves(s).filter(function(m){return m.type==='place';});if(!moves.length)return{type:'pass'};var best=moves[0],bv=-1;moves.forEach(function(m){var slot=CFG.slots[m.slot];var v=slot.pts+slot.req*.01;if(v>bv){bv=v;best=m;}});return best;}
  return {CFG:CFG,createGame:createGame,applyMove:applyMove,getLegalMoves:getLegalMoves,chooseAIMove:chooseAIMove};
});