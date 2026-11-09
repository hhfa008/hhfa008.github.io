'use strict';

var E=require('./engine.js');

var passed=0;
var failed=0;
var failures=[];

function ok(cond,msg){
  if(cond){
    passed++;
  }else{
    failed++;
    failures.push(msg);
    console.log('FAIL: '+msg);
  }
}

function eq(actual,expected,msg){
  if(Object.is(actual,expected)){
    passed++;
  }else{
    failed++;
    var m=msg+' | expected: '+expected+' | actual: '+actual;
    failures.push(m);
    console.log('FAIL: '+m);
  }
}

function card(rank,suit){return E.makeCard(rank,suit);}

function craft(hand0,top,currentSuit,opts){
  opts=opts||{};
  var state={
    deck:(opts.deck||[]).slice(),
    discard:(opts.extraDiscard||[]).concat([top]),
    hands:[hand0.slice(),(opts.hand1||[]).slice()],
    turn:typeof opts.turn==='number'?opts.turn:0,
    currentSuit:currentSuit||top.suit,
    phase:'playing',
    winner:null,
    log:[],
    rng:E.mulberry32(typeof opts.seed==='number'?opts.seed:7),
    mustPlayDrawn:!!opts.mustPlayDrawn,
    drawnCardId:opts.drawnCardId||null
  };
  return state;
}

function idsOf(state){
  var all=[];
  state.deck.forEach(function(c){all.push(c);});
  state.hands[0].forEach(function(c){all.push(c);});
  state.hands[1].forEach(function(c){all.push(c);});
  state.discard.forEach(function(c){all.push(c);});
  return all;
}

function assertDeckIntegrity(state,msg){
  var cards=idsOf(state);
  var seen={};
  var dup=0;
  for(var i=0;i<cards.length;i++){
    if(seen[cards[i].id])dup++;
    seen[cards[i].id]=true;
  }
  eq(cards.length,52,msg+': 牌总数应为 52');
  eq(dup,0,msg+': 不应有重复牌');
}

/* ---------- 基础常量与显示辅助 ---------- */
eq(E.SUITS.join(','),'S,H,D,C','花色顺序固定');
eq(E.RANKS.length,13,'点数共 13 种');
eq(E.suitSymbol('S'),'♠','黑桃符号');
eq(E.suitSymbol('H'),'♥','红桃符号');
eq(E.suitSymbol('D'),'♦','方块符号');
eq(E.suitSymbol('C'),'♣','梅花符号');
eq(E.isRed(card('A','H')),true,'红桃为红色');
eq(E.isRed(card('A','D')),true,'方块为红色');
eq(E.isRed(card('A','S')),false,'黑桃为黑色');
eq(E.isRed(card('A','C')),false,'梅花为黑色');
eq(E.rankLabel('A'),'A','A 显示为 A');
eq(E.rankLabel('10'),'10','10 显示为 10');
eq(E.cardLabel(card('K','S')),'♠K','牌面文本正确');

/* ---------- 发牌与初始状态 ---------- */
var g1=E.createGame({seed:12345});
var g2=E.createGame({seed:12345});
assertDeckIntegrity(g1,'初始牌局');
eq(g1.hands[0].length,5,'玩家发 5 张');
eq(g1.hands[1].length,5,'电脑发 5 张');
eq(g1.discard.length,1,'弃牌堆只有起始牌');
eq(g1.deck.length,41,'发牌后牌堆剩 41 张');
eq(E.topCard(g1).id,g1.discard[0].id,'topCard 返回弃牌堆顶');
ok(E.topCard(g1).rank!=='8','起始牌不能是 8');
eq(g1.currentSuit,E.topCard(g1).suit,'当前花色等于起始牌花色');
eq(g1.turn,0,'玩家先手');
eq(g1.phase,'playing','初始阶段为 playing');
eq(g1.winner,null,'初始没有赢家');
ok(g1.log.length>=2,'初始有中文日志');
eq(typeof g1.rng,'function','state 暴露随机函数');
eq(g1.hands[0][0].id,g2.hands[0][0].id,'相同种子发牌相同');
eq(g1.deck[0].id,g2.deck[0].id,'相同种子牌堆相同');

var suitCount={S:0,H:0,D:0,C:0};
var rankCount={};
idsOf(g1).forEach(function(c){
  suitCount[c.suit]++;
  rankCount[c.rank]=(rankCount[c.rank]||0)+1;
});
eq(suitCount.S,13,'每种花色 13 张');
eq(suitCount.H,13,'红桃 13 张');
eq(suitCount.D,13,'方块 13 张');
eq(suitCount.C,13,'梅花 13 张');
eq(Object.keys(rankCount).length,13,'所有点数齐全');
eq(rankCount.A,4,'A 共 4 张');

/* ---------- 出牌合法性 ---------- */
var legalState=craft([card('5','H'),card('7','S'),card('8','D'),card('9','C'),card('2','D')],card('2','S'),'S');
eq(E.canPlay(legalState,legalState.hands[0][0]),false,'不同花色不同点数不可出');
eq(E.canPlay(legalState,legalState.hands[0][1]),true,'同花色可出');
eq(E.canPlay(legalState,legalState.hands[0][2]),true,'8 是万能牌');
eq(E.canPlay(legalState,legalState.hands[0][3]),false,'不匹配的第三张不可出');
eq(E.canPlay(legalState,legalState.hands[0][4]),true,'同点数可出');
eq(E.legalMoves(legalState).length,3,'合法出牌列表数量正确');
eq(E.canPlay(legalState,null),false,'空牌不可出');

var chosenSuitState=craft([card('5','H'),card('5','D')],card('8','C'),'H');
eq(E.canPlay(chosenSuitState,chosenSuitState.hands[0][0]),true,'8 指定红桃后红桃可出');
eq(E.canPlay(chosenSuitState,chosenSuitState.hands[0][1]),false,'8 指定红桃后方块不可出');

/* ---------- 出牌与回合推进 ---------- */
var playState=craft([card('4','H'),card('9','S'),card('8','D'),card('2','C')],card('4','C'),'C',{hand1:[card('2','S')]});
var beforeHand=playState.hands[0].length;
var r=E.playCard(playState,'4H');
eq(r.ok,true,'按点数出牌成功');
eq(playState.hands[0].length,beforeHand-1,'出牌后手牌减少');
eq(E.topCard(playState).id,'4H','弃牌堆顶更新');
eq(playState.currentSuit,'H','非 8 牌更新当前花色');
eq(playState.turn,1,'出牌后轮到电脑');
eq(playState.phase,'playing','未打完继续游戏');

var illegalState=craft([card('9','S'),card('2','C')],card('4','C'),'C');
var illegalRes=E.playCard(illegalState,'9S');
eq(illegalRes.ok,false,'非法出牌被拒绝');
ok(typeof illegalRes.error==='string'&&illegalRes.error.length>0,'非法出牌返回中文错误');
eq(illegalState.hands[0].length,2,'非法出牌不改变手牌');
eq(illegalState.turn,0,'非法出牌不换回合');

var eightState=craft([card('8','D'),card('2','C')],card('4','C'),'C',{hand1:[card('3','C')]});
var e1=E.playCard(eightState,'8D');
eq(e1.ok,false,'打出 8 未选花色被拒绝');
var e2=E.playCard(eightState,'8D','X');
eq(e2.ok,false,'打出 8 选非法花色被拒绝');
eq(eightState.hands[0].length,2,'失败的 8 不消耗手牌');
var e3=E.playCard(eightState,'8D','H');
eq(e3.ok,true,'打出 8 并指定花色成功');
eq(eightState.currentSuit,'H','8 设置新的当前花色');
eq(eightState.turn,1,'打出 8 后换回合');
eq(E.topCard(eightState).id,'8D','8 进入弃牌堆顶');

/* ---------- 摸牌后限制 ---------- */
var mustState=craft([card('5','H'),card('2','C')],card('4','C'),'C',{mustPlayDrawn:true,drawnCardId:'2C',hand1:[card('3','C')]});
var wrongPlay=E.playCard(mustState,'5H');
eq(wrongPlay.ok,false,'摸牌后不能改出其他牌');
var rightPlay=E.playCard(mustState,'2C');
eq(rightPlay.ok,true,'摸牌后可以打出刚摸的牌');
eq(mustState.turn,1,'打出刚摸的牌后换回合');

/* ---------- 摸牌 ---------- */
var drawBlocked=craft([card('2','C')],card('4','C'),'C',{deck:[card('9','D')]});
var db=E.drawCard(drawBlocked);
eq(db.ok,false,'有牌可出时不能摸牌');
eq(drawBlocked.hands[0].length,1,'被拒绝的摸牌不增加手牌');

var drawBad=craft([card('9','S')],card('4','C'),'C',{deck:[card('7','D')]});
var bad=E.drawCard(drawBad);
eq(bad.ok,true,'无牌可出时可以摸牌');
eq(drawBad.hands[0].length,2,'摸牌后手牌增加');
eq(drawBad.deck.length,0,'摸牌后牌堆减少');
eq(drawBad.turn,1,'摸到不能出的牌后换回合');
eq(drawBad.mustPlayDrawn,false,'摸到不能出的牌不设 mustPlayDrawn');

var drawGood=craft([card('9','S')],card('4','C'),'C',{deck:[card('7','C')]});
var good=E.drawCard(drawGood);
eq(good.ok,true,'摸到合法牌成功');
eq(good.mustPlay,true,'摸到合法牌标记必须出牌');
eq(drawGood.mustPlayDrawn,true,'state.mustPlayDrawn 为 true');
eq(drawGood.turn,0,'摸到合法牌暂不换回合');
eq(drawGood.drawnCardId,'7C','记录刚摸到的牌');
var again=E.drawCard(drawGood);
eq(again.ok,false,'摸牌后不能连续摸牌');
var passRes=E.passAfterDraw(drawGood);
eq(passRes.ok,true,'摸牌后可以跳过');
eq(drawGood.turn,1,'跳过后换回合');
eq(drawGood.mustPlayDrawn,false,'跳过清除摸牌限制');

var passBad=craft([card('2','C')],card('4','C'),'C');
var pb=E.passAfterDraw(passBad);
eq(pb.ok,false,'有牌可出时不能跳过');
eq(passBad.turn,0,'被拒绝的跳过不换回合');
var passNoMoves=craft([card('9','S')],card('4','C'),'C');
var pn=E.passAfterDraw(passNoMoves);
eq(pn.ok,true,'无牌可出时允许直接跳过');

/* ---------- 牌堆回收 ---------- */
var recycleState=craft([card('9','S')],card('2','C'),'C',{
  deck:[],
  extraDiscard:[card('3','D'),card('4','H')]
});
var totalBefore=idsOf(recycleState).length;
var rec=E.drawCard(recycleState);
eq(rec.ok,true,'牌堆空时可以摸牌');
eq(recycleState.deck.length,1,'弃牌堆洗回牌堆');
eq(recycleState.discard.length,1,'弃牌堆只保留顶牌');
eq(idsOf(recycleState).length,totalBefore,'回收后牌总数不变');
eq(recycleState.turn,1,'回收后摸到非法牌则换回合');
ok(recycleState.log.join('').indexOf('洗匀')>=0,'回收有中文日志');

var emptyState=craft([card('9','S')],card('2','C'),'C',{deck:[]});
var empty=E.drawCard(emptyState);
eq(empty.ok,false,'无牌可回收时摸牌失败');
eq(empty.passed,true,'无牌可摸时自动跳过');
eq(emptyState.turn,1,'无牌可摸时换回合');

/* ---------- 胜负检测 ---------- */
var winState=craft([card('4','H')],card('4','C'),'C');
var winRes=E.playCard(winState,'4H');
eq(winRes.ok,true,'打出最后一张牌成功');
eq(winState.phase,'over','手牌清空后游戏结束');
eq(winState.winner,0,'玩家获胜');
eq(E.checkOver(winState),true,'checkOver 返回结束');
eq(E.legalMoves(winState).length,0,'结束后没有合法出牌');
var afterOver=E.playCard(winState,'4H');
eq(afterOver.ok,false,'结束后不能再出牌');

var aiWinState=craft([card('2','D')],card('4','C'),'C',{hand1:[card('4','S')],turn:1});
var aiWin=E.playCard(aiWinState,'4S');
eq(aiWin.ok,true,'电脑打出最后一张牌成功');
eq(aiWinState.winner,1,'电脑获胜');

/* ---------- AI 决策 ---------- */
var aiState=craft([card('2','D')],card('4','C'),'C',{turn:1,hand1:[card('3','S'),card('7','C'),card('9','C'),card('8','D'),card('2','H')]});
var aiMove=E.aiChooseMove(aiState);
eq(aiMove.type,'play','AI 有合法牌时选择出牌');
ok(aiMove.cardId==='7C'||aiMove.cardId==='9C','AI 优先同花色非 8 牌');
eq(E.legalMoves(aiState).map(function(c){return c.id;}).indexOf(aiMove.cardId)>=0,true,'AI 选择合法牌');

var aiEightState=craft([card('2','D')],card('4','C'),'C',{turn:1,hand1:[card('3','S'),card('8','D'),card('8','H')]});
var aiEight=E.aiChooseMove(aiEightState);
eq(aiEight.type,'play','AI 只剩 8 时仍能出牌');
eq(aiEight.suit&&E.SUITS.indexOf(aiEight.suit)>=0,true,'AI 出 8 时选择合法花色');

var aiDrawState=craft([card('2','D')],card('4','C'),'C',{turn:1,hand1:[card('3','S'),card('6','D')]});
eq(E.aiChooseMove(aiDrawState).type,'draw','AI 无牌可出时选择摸牌');

/* ---------- 30 局自我对弈 ---------- */
var CAP=3000;
var totalSteps=0;
for(var gameIndex=0;gameIndex<30;gameIndex++){
  var st=E.createGame({seed:1000+gameIndex});
  var steps=0;
  var illegal=false;
  while(st.phase==='playing'&&steps<CAP){
    steps++;
    var actor=st.turn;
    var move=E.aiChooseMove(st);
    if(move.type==='play'){
      var legalIds=E.legalMoves(st).map(function(c){return c.id;});
      if(legalIds.indexOf(move.cardId)<0)illegal=true;
      var playRes=E.playCard(st,move.cardId,move.suit);
      if(!playRes.ok)illegal=true;
      if(st.phase==='playing'&&st.turn===actor)illegal=true;
    }else{
      if(E.legalMoves(st).length!==0)illegal=true;
      var drawRes=E.drawCard(st);
      if(!drawRes.ok&&!drawRes.passed)illegal=true;
      if(!drawRes.ok&&drawRes.passed&&st.phase==='playing'&&st.turn===actor)illegal=true;
    }
    if(idsOf(st).length!==52)illegal=true;
  }
  totalSteps+=steps;
  ok(!illegal,'自我对弈第 '+(gameIndex+1)+' 局没有非法操作');
  ok(st.phase==='over','自我对弈第 '+(gameIndex+1)+' 局正常结束');
  ok(st.winner===0||st.winner===1,'自我对弈第 '+(gameIndex+1)+' 局赢家合法');
  ok(steps<CAP,'自我对弈第 '+(gameIndex+1)+' 局在步数上限内结束');
  var finalIds=idsOf(st);
  var finalSet={};
  var finalDup=0;
  finalIds.forEach(function(c){if(finalSet[c.id])finalDup++;finalSet[c.id]=true;});
  eq(finalIds.length,52,'自我对弈第 '+(gameIndex+1)+' 局牌总数保持 52');
  eq(finalDup,0,'自我对弈第 '+(gameIndex+1)+' 局没有重复牌');
}

ok(totalSteps<30*CAP,'30 局总步数在合理范围');
console.log('自对弈 30 局完成，总步数 '+totalSteps+'。');

console.log('RESULT: '+passed+' passed, '+failed+' failed');
process.exit(failed?1:0);
