'use strict';
var fs=require('fs'),path=require('path');
var E=require('./engine.js');
var passed=0,failed=0,errors=[];
function ok(name,cond,detail){if(cond){passed++;}else{failed++;errors.push(name+(detail?' ['+detail+']':''));}}
function eq(name,a,b){ok(name,JSON.stringify(a)===JSON.stringify(b),'得到 '+JSON.stringify(a)+'，期望 '+JSON.stringify(b));}
function throws(name,fn,re){var msg='';try{fn();}catch(e){msg=String(e&&e.message||e);}ok(name,!!msg&&(!re||re.test(msg)),msg||'未抛错');}
function clean(s){return JSON.parse(JSON.stringify(s));}

ok('引擎导出核心 API',['createGame','applyMove','getLegalMoves','chooseAIMove'].every(function(k){return typeof E[k]==='function';}));
ok('配置含名称与主题参数',!!E.CFG&&Object.keys(E.CFG).length>0);
var a=E.createGame(7),b=E.createGame(7),c=E.createGame(8);
eq('同 seed 开局一致',JSON.stringify(a),JSON.stringify(b));
ok('不同 seed 有差异',JSON.stringify(a)!==JSON.stringify(c));
eq('双人局',a.players.length,2);
eq('初始无胜者',a.winner,null);
ok('开局未结束',a.over===false);
ok('提供合法动作',E.getLegalMoves(a).length>0);
var before=JSON.stringify(a);
var mv=E.chooseAIMove(a);
ok('AI 给出动作',!!mv&&typeof mv.type==='string');
var next=E.applyMove(a,mv);
ok('动作推进回合',next.turn>=a.turn);
eq('applyMove 不修改入参',JSON.stringify(a),before);
throws('结束后禁止再行动',function(){var g=E.createGame(3);g.over=true;E.applyMove(g,{type:'pass'});},/非法|结束/);
throws('非法动作被拒绝',function(){E.applyMove(E.createGame(4),{type:'bogus'});},/非法|未知/);

var bad=0,unfinished=0,badScore=0,maxTurn=0,seeds=[];
for(var k=1;k<=20;k++){
  try{
    var s=E.createGame(k*19+3),guard=0;
    while(!s.over&&guard<1200){var m=E.chooseAIMove(s);if(!m)break;s=E.applyMove(s,m);guard++;}
    if(!s.over)unfinished++;
    if(guard>=1200)badScore++;
    maxTurn=Math.max(maxTurn,s.turn);
    var scores=[0,1].map(function(i){return typeof E.scoreOf==='function'?E.scoreOf(s,i):(s.players[i].points||s.players[i].score||0);});
    if(!scores.every(function(x){return typeof x==='number'&&isFinite(x)&&x>=0;}))badScore++;
    seeds.push(JSON.stringify(s));
  }catch(e){bad++;errors.push('自对弈异常: '+e.message);}
}
eq('20 局 AI 自对弈无异常',bad,0);
eq('20 局全部自然结束',unfinished,0);
eq('20 局终局数据合法',badScore,0);
ok('回合数有上限',maxTurn<1200,String(maxTurn));
var sA=E.createGame(77),sB=E.createGame(77);
while(!sA.over)sA=E.applyMove(sA,E.chooseAIMove(sA));
while(!sB.over)sB=E.applyMove(sB,E.chooseAIMove(sB));
eq('同 seed 自对弈可复现',JSON.stringify(sA),JSON.stringify(sB));
ok('终局有胜者或平局',sA.winner===0||sA.winner===1||sA.winner===null);

var html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
ok('页面 viewport 与中文',/name="viewport"/.test(html)&&/lang="zh-CN"/.test(html));
ok('页面无外部脚本',!/<script[^>]+src="https?:/i.test(html));
ok('页面无外部样式/字体',!/<link(?![^>]*rel=["']canonical["'])[^>]+(?:rel="stylesheet"|href="https?:)/i.test(html));
ok('页面无网络请求',!/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(html));
ok('页面有 390px 媒体查询',/@media\s*\(max-width:\s*430px\)/.test(html));
ok('页面有 aria-label 与 44px 触控',/aria-label=/.test(html)&&/min-height:\s*44px/.test(html));
ok('页面内联 CSS/JS 同源',/<style>/.test(html)&&/<script>/.test(html));
ok('页面写入渲染内容',/c\.innerHTML=h/.test(html));
ok('页面含 AI 自动行动',/S\.current===1/.test(html)&&/chooseAIMove/.test(html));
var rules=fs.readFileSync(path.join(__dirname,'rules.html'),'utf8');
var blocks=rules.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)||[];
var parsed=[],valid=true;blocks.forEach(function(bb){try{parsed.push(JSON.parse(bb.replace(/^[\s\S]*?>/,'').replace(/<\/script>$/i,'')));}catch(e){valid=false;}});
ok('规则页 JSON-LD 可解析',valid&&parsed.length>0);
ok('规则页含 FAQPage',parsed.some(function(x){return x&&(x['@type']==='FAQPage'||(Array.isArray(x['@graph'])&&x['@graph'].some(function(g){return g['@type']==='FAQPage';})));}));
ok('规则页回链游戏',/href="index\.html"/.test(rules));
var text=rules.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,'').replace(/\s+/g,'');
ok('规则正文不少于 300 字',text.length>=300,String(text.length));

if(errors.length)console.log(errors.join('\n'));
console.log('RESULT: '+passed+' passed, '+failed+' failed');
process.exit(failed?1:0);
