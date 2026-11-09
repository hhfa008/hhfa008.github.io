(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CrazyEightsEngine=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';

var SUITS=['S','H','D','C'];
var RANKS=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
var SUIT_NAMES={S:'黑桃',H:'红桃',D:'方块',C:'梅花'};
var SUIT_SYMBOLS={S:'♠',H:'♥',D:'♦',C:'♣'};
var RANK_VALUES={A:14,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13};
var PLAYER_NAMES=['你','电脑'];

function mulberry32(seed){
  var a=seed>>>0;
  return function(){
    a=(a+0x6D2B79F5)|0;
    var t=Math.imul(a^(a>>>15),1|a);
    t=(t+Math.imul(t^(t>>>7),61|t))^t;
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}

function makeCard(rank,suit){
  return {rank:rank,suit:suit,id:rank+suit};
}

function buildDeck(){
  var deck=[];
  for(var i=0;i<SUITS.length;i++){
    for(var j=0;j<RANKS.length;j++){
      deck.push(makeCard(RANKS[j],SUITS[i]));
    }
  }
  return deck;
}

function shuffle(arr,rng){
  for(var i=arr.length-1;i>0;i--){
    var j=Math.floor(rng()*(i+1));
    var tmp=arr[i];
    arr[i]=arr[j];
    arr[j]=tmp;
  }
  return arr;
}

function suitSymbol(suit){return SUIT_SYMBOLS[suit]||'';}
function rankLabel(rank){return rank==='A'?'A':rank;}
function isRed(card){
  if(!card)return false;
  return card.suit==='H'||card.suit==='D';
}
function rankValue(rank){return RANK_VALUES[rank]||0;}
function cardLabel(card){
  if(!card)return '';
  return suitSymbol(card.suit)+rankLabel(card.rank);
}
function suitName(suit){return SUIT_NAMES[suit]||'';}

function cat(){
  return Array.prototype.slice.call(arguments).join(' ');
}

function createGame(opts){
  opts=opts||{};
  var seed=typeof opts.seed==='number'?opts.seed:(Date.now()>>>0);
  var rng=typeof opts.rng==='function'?opts.rng:mulberry32(seed);
  var deck=shuffle(buildDeck(),rng);
  var hands=[[],[]];
  for(var i=0;i<5;i++){
    hands[0].push(deck.shift());
    hands[1].push(deck.shift());
  }
  var starterIndex=0;
  while(starterIndex<deck.length&&deck[starterIndex].rank==='8')starterIndex++;
  var starter=deck.splice(starterIndex,1)[0];
  var state={
    deck:deck,
    discard:[starter],
    hands:hands,
    turn:0,
    currentSuit:starter.suit,
    phase:'playing',
    winner:null,
    log:[],
    rng:rng,
    seed:seed,
    mustPlayDrawn:false,
    drawnCardId:null
  };
  state.log.push(cat('每人发 5 张牌，翻开起始牌',cardLabel(starter),'，当前花色为',suitName(state.currentSuit),'。'));
  state.log.push('轮到你出牌。');
  return state;
}

function topCard(state){
  if(!state||!state.discard||state.discard.length===0)return null;
  return state.discard[state.discard.length-1];
}

function canPlay(state,card){
  if(!state||state.phase!=='playing'||!card)return false;
  var top=topCard(state);
  if(!top)return false;
  return card.rank==='8'||card.suit===state.currentSuit||card.rank===top.rank;
}

function legalMoves(state){
  if(!state||state.phase!=='playing')return [];
  var hand=state.hands[state.turn]||[];
  var moves=[];
  for(var i=0;i<hand.length;i++){
    if(canPlay(state,hand[i]))moves.push(hand[i]);
  }
  if(state.mustPlayDrawn){
    moves=moves.filter(function(c){return c.id===state.drawnCardId;});
  }
  return moves;
}

function checkOver(state){
  if(!state)return false;
  if(state.phase==='over')return true;
  for(var i=0;i<2;i++){
    if(state.hands[i].length===0){
      state.phase='over';
      state.winner=i;
      state.log.push(PLAYER_NAMES[i]+' 打完了所有手牌，'+(i===0?'你赢了！':'电脑获胜。'));
      return true;
    }
  }
  return false;
}

function finishTurn(state){
  if(!state||state.phase!=='playing')return state;
  state.mustPlayDrawn=false;
  state.drawnCardId=null;
  state.turn=1-state.turn;
  return state;
}

function playCard(state,cardId,chosenSuit){
  if(!state||state.phase!=='playing')return {ok:false,error:'游戏已经结束'};
  var hand=state.hands[state.turn];
  var idx=-1;
  for(var i=0;i<hand.length;i++){
    if(hand[i].id===cardId){idx=i;break;}
  }
  if(idx<0)return {ok:false,error:'这张牌不在手中'};
  var card=hand[idx];
  if(!canPlay(state,card))return {ok:false,error:'这张牌不符合出牌规则'};
  if(state.mustPlayDrawn&&card.id!==state.drawnCardId)return {ok:false,error:'摸牌后只能打出刚摸到的牌'};
  if(card.rank==='8'&&SUITS.indexOf(chosenSuit)<0)return {ok:false,error:'打出 8 时必须选择花色'};

  hand.splice(idx,1);
  state.discard.push(card);
  if(card.rank==='8'){
    state.currentSuit=chosenSuit;
  }else{
    state.currentSuit=card.suit;
  }
  state.mustPlayDrawn=false;
  state.drawnCardId=null;
  state.log.push(PLAYER_NAMES[state.turn]+' 打出 '+cardLabel(card)+(card.rank==='8'?'，指定花色为'+suitName(state.currentSuit):'')+'。');

  var over=checkOver(state);
  if(!over){
    state.turn=1-state.turn;
    state.log.push(state.turn===0?'轮到你出牌。':'轮到电脑出牌。');
  }
  return {ok:true};
}

function recycleDeck(state){
  if(state.deck.length>0)return true;
  if(state.discard.length<=1)return false;
  var top=state.discard[state.discard.length-1];
  var rest=state.discard.slice(0,-1);
  state.discard=[top];
  state.deck=shuffle(rest,state.rng);
  state.log.push('牌堆用尽，将弃牌堆重新洗匀后继续。');
  return true;
}

function drawCard(state){
  if(!state||state.phase!=='playing')return {ok:false,error:'游戏已经结束'};
  if(state.mustPlayDrawn)return {ok:false,error:'已摸牌，请打出或跳过'};
  if(legalMoves(state).length>0)return {ok:false,error:'还有可出的牌，不能摸牌'};

  var name=PLAYER_NAMES[state.turn];
  if(!recycleDeck(state)){
    state.log.push('牌堆已空，'+name+' 无牌可摸，跳过本回合。');
    finishTurn(state);
    return {ok:false,error:'牌堆已空，本回合跳过',passed:true};
  }

  var card=state.deck.shift();
  state.hands[state.turn].push(card);
  if(canPlay(state,card)){
    state.mustPlayDrawn=true;
    state.drawnCardId=card.id;
    state.log.push(name+' 摸到一张牌，可以打出。');
    return {ok:true,card:card,mustPlay:true};
  }

  state.log.push(name+' 摸到一张牌，无法出牌，轮到对方。');
  state.mustPlayDrawn=false;
  state.drawnCardId=null;
  finishTurn(state);
  return {ok:true,card:card,passed:true};
}

function passAfterDraw(state){
  if(!state||state.phase!=='playing')return {ok:false,error:'游戏已经结束'};
  var moves=legalMoves(state);
  if(!state.mustPlayDrawn&&moves.length>0)return {ok:false,error:'还有可出的牌，不能跳过'};
  state.log.push(PLAYER_NAMES[state.turn]+(state.mustPlayDrawn?' 放弃打出刚摸到的牌，回合结束。':' 无牌可出，跳过本回合。'));
  finishTurn(state);
  return {ok:true};
}

function bestSuitFor(hand){
  var counts={S:0,H:0,D:0,C:0};
  for(var i=0;i<hand.length;i++){
    var c=hand[i];
    if(c.rank!=='8')counts[c.suit]++;
  }
  var best=SUITS[0];
  for(var j=1;j<SUITS.length;j++){
    if(counts[SUITS[j]]>counts[best])best=SUITS[j];
  }
  return best;
}

function aiChooseMove(state){
  if(!state||state.phase!=='playing')return {type:'draw'};
  var moves=legalMoves(state);
  if(moves.length===0)return {type:'draw'};

  var hand=state.hands[state.turn]||[];
  var counts={S:0,H:0,D:0,C:0};
  for(var i=0;i<hand.length;i++){
    var c=hand[i];
    if(c.rank!=='8')counts[c.suit]++;
  }

  var candidates=[];
  for(var m=0;m<moves.length;m++){
    if(moves[m].rank!=='8')candidates.push(moves[m]);
  }
  if(candidates.length){
    candidates.sort(function(a,b){
      var d=counts[b.suit]-counts[a.suit];
      if(d)return d;
      var r=rankValue(b.rank)-rankValue(a.rank);
      if(r)return r;
      return a.id<b.id?-1:(a.id>b.id?1:0);
    });
    var pick=candidates[0];
    return {type:'play',cardId:pick.id,suit:pick.suit};
  }

  var eight=moves[0];
  var rest=hand.filter(function(card){return card.id!==eight.id;});
  return {type:'play',cardId:eight.id,suit:bestSuitFor(rest)};
}

return {
  SUITS:SUITS,
  RANKS:RANKS,
  SUIT_NAMES:SUIT_NAMES,
  SUIT_SYMBOLS:SUIT_SYMBOLS,
  PLAYER_NAMES:PLAYER_NAMES,
  createGame:createGame,
  topCard:topCard,
  legalMoves:legalMoves,
  canPlay:canPlay,
  playCard:playCard,
  drawCard:drawCard,
  passAfterDraw:passAfterDraw,
  finishTurn:finishTurn,
  aiChooseMove:aiChooseMove,
  checkOver:checkOver,
  suitSymbol:suitSymbol,
  rankLabel:rankLabel,
  rankValue:rankValue,
  isRed:isRed,
  cardLabel:cardLabel,
  suitName:suitName,
  makeCard:makeCard,
  buildDeck:buildDeck,
  shuffle:shuffle,
  mulberry32:mulberry32
};

});
