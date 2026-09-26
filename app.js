const $=id=>document.getElementById(id);
const STORE="ai-wordwolf-relay-v1";
const VERSION=2;
const phaseNames=["手掛かり","相互質問","推理・主張","反論","秘密投票"];
const FENCE="```";
let state=null;
let autoPrompt="";

function fresh(){
  return {version:VERSION,names:[],majority:"",minority:"",wolf:0,useGm:true,step:0,logs:[],votes:{},createdAt:new Date().toISOString()};
}

function plan(){
  const n=state.names;
  return [
    ...n.map((_,actor)=>({phase:0,type:"clue",actor})),
    {phase:1,type:"ask",actor:0,target:1},
    {phase:1,type:"answerAsk",actor:1,from:0,target:2},
    {phase:1,type:"answerAsk",actor:2,from:1,target:0},
    {phase:1,type:"answer",actor:0,from:2},
    ...n.map((_,actor)=>({phase:2,type:"judge",actor})),
    ...n.map((_,actor)=>({phase:3,type:"rebut",actor})),
    ...n.map((_,actor)=>({phase:4,type:"vote",actor}))
  ];
}

function current(){return plan()[state.step]||null}
function wordFor(actor){return actor===state.wolf?state.minority:state.majority}
function save(){localStorage.setItem(STORE,JSON.stringify(state))}
function esc(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]))}

function label(type){
  return ({
    brief:"配役確認",
    clue:"手掛かり",
    ask:"質問",
    answerAsk:"回答＋質問",
    answer:"回答",
    judge:"推理・主張",
    rebut:"反論",
    vote:"投票"
  })[type]||type;
}

function visibleHistory(filter){
  return state.logs
    .filter(x=>x.share && x.type!=="brief" && (!filter||filter(x)))
    .map(x=>`【${state.names[x.actor]}・${label(x.type)}】\n${x.share}`)
    .join("\n\n");
}

function outputRule(){
  const gmPart=state.useGm
    ? `<gm>\n他参加者に見せない本当の推理・作戦\n</gm>`
    : "";
  return `出力形式：
・出力全体を必ず1つのコードブロックに入れる。
・コードブロックの外には何も書かない。
・タグ名は変更しない。

${FENCE}text
<share>
他参加者に見せる発言
</share>
${gmPart}
${FENCE}`;
}

function base(actor){
  return `あなたは3人用のワードウルフに参加している。
参加者：${state.names.join("、")}
あなたの秘密ワード：${wordFor(actor)}

ゲームの目的：
・自分の陣営を勝利させること。
・会話から、自分と異なる秘密ワードを持つ1人を探す。
・自分が少数派だと推測した場合、自分が少数派だと悟られないことを最優先する。
・少数派だと推測した場合、多数派の会話から相手ワードの特徴を推測し、その特徴に自然に合わせて擬態する。
・擬態のためであれば、自分の秘密ワードに厳密には当てはまらない発言、曖昧化、ブラフを使ってよい。
・<share> では、自分が少数派だという推理や、相手側の秘密ワードを推測できたことを自発的に明かさない。
・本当の陣営推理、相手ワードの推測、擬態方針は ${state.useGm?"<gm> にだけ書く":"公開発言には書かず、自分の内部判断として扱う"}。
・秘密ワードそのものは公開しない。
・普段の話し方やキャラクターは保ってよい。

${outputRule()}`;
}

function latestQuestionTo(actor){
  const item=[...state.logs].reverse().find(x=>x.target===actor&&(x.type==="ask"||x.type==="answerAsk"));
  if(!item)return null;
  if(item.question)return item.question;
  const m=item.share.match(/質問\s*[：:]\s*([\s\S]+)$/);
  return m?m[1].trim():item.share;
}

function promptFor(t){
  const actor=t.actor,name=state.names[actor];

  if(t.type==="clue"){
    return `${base(actor)}

【手掛かり：${name}】
秘密ワードを直接言わず、連想・特徴・経験・印象のどれかを2〜4文で話す。
これは初手なので、他参加者の手掛かりはまだ見えていないものとして独立に発言する。
<share> には手掛かりだけを書く。
${state.useGm?"<gm> には、初手で何を隠し、何を匂わせるかを短く書いてよい。":""}`;
  }

  if(t.type==="ask"){
    const h=visibleHistory(x=>x.phase===0);
    return `${base(actor)}

【相互質問：${name} → ${state.names[t.target]}】
全員の手掛かり：
${h||"（なし）"}

${state.names[t.target]}に質問を1つする。
一語で秘密ワードを特定するための露骨な確認ではなく、経験・感覚・好み・状況判断など、会話として答えられる質問にする。
<share> は必ず「質問：」から始める。
${state.useGm?"<gm> には、その質問で何を見分けたいかを書く。":""}`;
  }

  if(t.type==="answerAsk"){
    const q=latestQuestionTo(actor);
    const h=visibleHistory(x=>x.phase<=1);
    return `${base(actor)}

【回答＋次の質問：${name}】
${state.names[t.from]}からの質問：
${q||"（質問が見つからない）"}

ここまでの共有ログ：
${h||"（なし）"}

1つのターンで次の2つを行う。
1. 上の質問に2〜3文で答える。
2. 続けて ${state.names[t.target]} に質問を1つする。

<share> は必ず次の形にする。
回答：...
質問：...

自分が少数派だと推測していても、その事実は <share> で明かさない。勝利のために必要なら、回答や質問で自然に擬態してよい。
${state.useGm?"<gm> には本当の推理、回答で隠したこと、次の質問の狙いを書く。":""}`;
  }

  if(t.type==="answer"){
    const q=latestQuestionTo(actor);
    const h=visibleHistory(x=>x.phase<=1);
    return `${base(actor)}

【最後の質問への回答：${name}】
${state.names[t.from]}からの質問：
${q||"（質問が見つからない）"}

ここまでの共有ログ：
${h||"（なし）"}

質問に2〜3文で答える。
<share> は「回答：」から始める。
自分が少数派だと推測していても、その事実は公開しない。勝利のために必要なら自然に擬態してよい。
${state.useGm?"<gm> には本当の推理と、回答で隠したことがあれば書く。":""}`;
  }

  if(t.type==="judge"){
    const h=visibleHistory(x=>x.phase<=1);
    return `${base(actor)}

【推理・主張】
ここまでの共有ログ：
${h||"（なし）"}

他参加者のこのフェーズの回答はまだ見えていないものとして独立に考える。

<share> ではゲーム上の主張として、次を2〜5文で話す。
1. 他参加者から自分がどう見えていると思うか
2. 自分への疑いを逸らす、または自分の立場を補強する主張
3. 現時点で「違うワードを持つ」と主張する1人

重要：
・本当に自分を多数派／少数派のどちらだと推測しているかは <share> に書かない。
・自分が少数派だと推測している場合、<share> の主張は勝利のために偽ってよい。
${state.useGm?"・<gm> にだけ、本当の陣営推理、違うワードだと思う相手、相手ワードの推測、擬態方針を率直に書く。":""}`;
  }

  if(t.type==="rebut"){
    const prior=visibleHistory(x=>x.phase<=1);
    const judgments=state.logs
      .filter(x=>x.phase===2)
      .map(x=>`【${state.names[x.actor]}・推理/主張】\n${x.share}`)
      .join("\n\n");
    return `${base(actor)}

【反論】
手掛かり・質問ログ：
${prior||"（なし）"}

各参加者の公開主張：
${judgments||"（なし）"}

自分への疑いに反論するか、自分の主張を補強する。
他人の発言へ具体的に反応してよい。
<share> は2〜4文程度。
自分が少数派だと推測している場合も、その事実は明かさず、生存に有利な主張を行う。
${state.useGm?"<gm> には実際の勝ち筋と、誰の票をどこへ動かしたいかを書いてよい。":""}`;
  }

  if(t.type==="vote"){
    const h=visibleHistory(x=>x.phase<=3);
    const candidates=state.names.filter((_,i)=>i!==actor);
    return `${base(actor)}

【秘密投票】
投票直前までの共有ログ：
${h||"（なし）"}

他参加者の最終投票は見えていないものとして、自分以外の1人を選ぶ。
<share> の1行目を必ず「投票：名前」の形式にする。
投票可能：${candidates.join(" / ")}
2行目以降に、公開してよい理由を1〜3文で書く。
${state.useGm?"<gm> には本当の投票理由と最後の読みを書く。":""}`;
  }

  return "";
}

function stripFence(raw){
  const fenced=raw.match(/```(?:text|txt|markdown)?\s*([\s\S]*?)```/i);
  return fenced?fenced[1].trim():raw.trim();
}

function parseReply(raw){
  raw=stripFence(raw);
  const sm=raw.match(/<share>([\s\S]*?)<\/share>/i);
  const gm=raw.match(/<gm>([\s\S]*?)<\/gm>/i);
  let share=sm?sm[1].trim():"";
  let memo=gm?gm[1].trim():"";
  if(!sm)share=raw.replace(/<gm>[\s\S]*?<\/gm>/ig,"").trim();
  return {share,memo};
}

function extractQuestion(type,share){
  if(type!=="ask"&&type!=="answerAsk")return null;
  const m=share.match(/質問\s*[：:]\s*([\s\S]+)$/);
  return m?m[1].trim():null;
}

function parseVote(actor,share){
  const line=(share.split(/\n/)[0]||"").replace(/　/g," ");
  const m=line.match(/投票\s*[：:]\s*(.+)$/);
  if(!m)return null;
  const chosen=state.names.findIndex((n,i)=>i!==actor&&m[1].trim().includes(n));
  return chosen>=0?chosen:null;
}

function result(){
  const counts=state.names.map(()=>0);
  Object.values(state.votes||{}).forEach(v=>{if(Number.isInteger(v)&&counts[v]!=null)counts[v]++});
  const max=Math.max(0,...counts);
  const leaders=counts.map((c,i)=>c===max?i:null).filter(i=>i!==null);
  const caught=max>0&&leaders.length===1&&leaders[0]===state.wolf;
  return {counts,caught,leaders};
}

function resultText(){
  const r=result();
  const voteLines=state.names.map((n,i)=>{
    const target=state.votes&&Number.isInteger(state.votes[i])?state.names[state.votes[i]]:"不明";
    return `・${n} → ${target}`;
  }).join("\n");
  const countLine=state.names.map((n,i)=>`${n} ${r.counts[i]}票`).join(" / ");
  return `AIワードウルフ 結果

参加者：${state.names.join(" / ")}
多数派ワード：${state.majority}
少数派ワード：${state.minority}
少数派：${state.names[state.wolf]}

投票：
${voteLines}

集計：${countLine}
勝敗：${r.caught?"多数派側の勝利":"少数派側の勝利"}`;
}

function fullLogText(){
  const body=state.logs.map((x,i)=>{
    const parts=[
      `【${i+1}. ${state.names[x.actor]} / ${label(x.type)}】`,
      "<share>",
      x.share||"",
      "</share>"
    ];
    if(x.gm){
      parts.push("<gm>",x.gm,"</gm>");
    }
    return parts.join("\n");
  }).join("\n\n");
  return `${FENCE}text
${resultText()}

===== 全ログ =====

${body}
${FENCE}`;
}

function start(){
  const names=[$("name0").value.trim(),$("name1").value.trim(),$("name2").value.trim()];
  const majority=$("majority").value.trim(),minority=$("minority").value.trim();
  if(names.some(n=>!n)||!majority||!minority){alert("3人の名前と2つのワードを入力。");return}
  if(new Set(names).size!==3){alert("AI名は3人とも別にする。");return}
  if(majority===minority){alert("多数派と少数派のワードは別にする。");return}
  const mode=$("minorityMode").value;
  state=fresh();
  state.names=names;
  state.majority=majority;
  state.minority=minority;
  state.wolf=mode==="random"?Math.floor(Math.random()*3):Number(mode);
  state.useGm=$("gmMode").value==="on";
  save();
  showGame();
  render();
}

function showGame(){
  $("setup").classList.add("hidden");
  $("game").classList.remove("hidden");
}

function renderSteps(t){
  $("steps").innerHTML=phaseNames.map((p,i)=>`<span class="step ${t&&t.phase===i?"active":""}">${esc(p)}</span>`).join("");
}

function renderLog(){
  const box=$("log");
  const shown=state.logs.filter(x=>x.type!=="brief");
  if(!shown.length){box.innerHTML='<p class="muted">まだ共有ログなし。</p>';return}
  box.innerHTML=shown.map(x=>`
    <article class="entry">
      <div class="entry-head">
        <span class="entry-name">${esc(state.names[x.actor])}</span>
        <span class="entry-kind">${esc(label(x.type))}</span>
      </div>
      <div class="entry-body">${esc(x.share).replace(/\n/g,"<br>")}</div>
      ${x.gm?`<details><summary>GMメモ</summary><div class="gm-text">${esc(x.gm).replace(/\n/g,"<br>")}</div></details>`:""}
    </article>`).join("");
  box.scrollTop=box.scrollHeight;
}

function render(){
  const t=current();
  renderSteps(t);
  renderLog();
  $("reply").value="";
  $("share").value="";
  $("gm").value="";
  $("preview").open=false;
  $("finish").classList.add("hidden");

  if(!t){
    const r=result();
    $("phase").textContent="RESULT";
    $("actor").textContent="ゲーム終了";
    $("instruction").textContent="投票まで完了。結果と全ログをコピーできる。";
    $("progress").textContent=`${state.step} / ${state.version===VERSION?plan().length:state.step}`;
    autoPrompt="";
    $("prompt").value="";
    $("copy").disabled=true;
    $("restorePrompt").disabled=true;
    $("reply").disabled=true;
    $("parse").disabled=true;
    $("saveNext").disabled=true;

    const countLine=state.names.map((n,i)=>`${n} ${r.counts[i]}票`).join(" / ");
    $("finish").classList.remove("hidden");
    $("resultSummary").innerHTML=`<strong>${r.caught?"多数派側の勝利":"少数派側の勝利"}</strong>
      <p>多数派ワード：${esc(state.majority)}<br>少数派ワード：${esc(state.minority)}<br>少数派：${esc(state.names[state.wolf])}</p>
      <p>${esc(countLine)}</p>`;
    $("resultText").value=resultText();
    $("fullLogText").value=fullLogText();
    return;
  }

  $("copy").disabled=false;
  $("restorePrompt").disabled=false;
  $("reply").disabled=false;
  $("parse").disabled=false;
  $("saveNext").disabled=false;
  $("phase").textContent=phaseNames[t.phase];
  $("actor").textContent=state.names[t.actor];
  $("progress").textContent=`${state.step+1} / ${plan().length}`;

  let inst=label(t.type);
  if(t.type==="ask")inst+=`：${state.names[t.target]}へ`;
  if(t.type==="answerAsk")inst+=`：${state.names[t.from]}へ回答 → ${state.names[t.target]}へ質問`;
  if(t.type==="answer")inst+=`：${state.names[t.from]}からの質問へ回答`;
  $("instruction").textContent=inst;

  autoPrompt=promptFor(t);
  $("prompt").value=autoPrompt;
}

async function copyText(text,button){
  try{
    await navigator.clipboard.writeText(text);
  }catch{
    const ta=document.createElement("textarea");
    ta.value=text;
    ta.style.position="fixed";
    ta.style.opacity="0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  if(button){
    const old=button.textContent;
    button.textContent="コピー済み";
    setTimeout(()=>button.textContent=old,900);
  }
}

function parseCurrentReply(){
  const parsed=parseReply($("reply").value);
  $("share").value=parsed.share;
  $("gm").value=parsed.memo;
  $("preview").open=true;
  if(!parsed.share)$("share").focus();
}

function saveNext(){
  const t=current();
  if(!t)return;

  if(!$("preview").open){
    parseCurrentReply();
    if(!$("share").value.trim())return;
  }

  const share=$("share").value.trim();
  const gm=$("gm").value.trim();
  if(!share){alert("共有発言が空。AIの返答を解析するか、共有発言を入力。");return}

  const entry={
    step:state.step,
    phase:t.phase,
    type:t.type,
    actor:t.actor,
    target:t.target??null,
    from:t.from??null,
    share,
    gm:state.useGm?gm:"",
    question:extractQuestion(t.type,share),
    at:new Date().toISOString()
  };

  if((t.type==="ask"||t.type==="answerAsk")&&!entry.question){
    alert("質問文を読み取れなかった。共有発言に「質問：...」を入れてから登録。");
    return;
  }

  if(t.type==="vote"){
    const v=parseVote(t.actor,share);
    if(v===null){alert("投票先を読み取れなかった。1行目を「投票：名前」にしてから登録。");return}
    state.votes[t.actor]=v;
  }

  state.logs.push(entry);
  state.step++;
  save();
  render();
}

function back(){
  if(!state||state.step<=0)return;
  if(state.version!==VERSION){
    alert("旧版ログは閲覧・共有のみ。新しいゲームで改修版を使える。");
    return;
  }
  const last=state.logs.pop();
  state.step=Math.max(0,state.step-1);
  if(last&&last.type==="vote")delete state.votes[last.actor];
  save();
  render();
}

function reset(){
  if(!confirm("現在のゲーム内容を消す？"))return;
  localStorage.removeItem(STORE);
  location.reload();
}

function resume(){
  const raw=localStorage.getItem(STORE);
  if(!raw){alert("保存中のゲームなし。");return}
  try{
    state=JSON.parse(raw);
    if(!state.votes)state.votes={};
    showGame();
    render();
  }catch{
    alert("保存データを読み込めなかった。");
  }
}

function exportJson(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;
  a.download=`ai-wordwolf-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),500);
}

$("start").addEventListener("click",start);
$("resume").addEventListener("click",resume);
$("copy").addEventListener("click",()=>copyText($("prompt").value,$("copy")));
$("restorePrompt").addEventListener("click",()=>{$("prompt").value=autoPrompt});
$("parse").addEventListener("click",parseCurrentReply);
$("saveNext").addEventListener("click",saveNext);
$("back").addEventListener("click",back);
$("reset").addEventListener("click",reset);
$("export").addEventListener("click",exportJson);
$("copyResult").addEventListener("click",()=>copyText($("resultText").value,$("copyResult")));
$("copyFullLog").addEventListener("click",()=>copyText($("fullLogText").value,$("copyFullLog")));

if(localStorage.getItem(STORE))$("resume").textContent="保存中のゲームを再開";