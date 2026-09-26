const $=id=>document.getElementById(id);
const STORE="ai-wordwolf-relay-v1";
const phaseNames=["配役","手掛かり","相互質問","判定","反論","秘密投票"];
let state=null;

function fresh(){
  return {names:[],majority:"",minority:"",wolf:0,useGm:true,step:0,logs:[],votes:{},createdAt:new Date().toISOString()};
}

function plan(){
  const n=state.names;
  return [
    ...n.map((_,actor)=>({phase:0,type:"brief",actor})),
    ...n.map((_,actor)=>({phase:1,type:"clue",actor})),
    {phase:2,type:"ask",actor:0,target:1},
    {phase:2,type:"answer",actor:1,from:0},
    {phase:2,type:"ask",actor:1,target:2},
    {phase:2,type:"answer",actor:2,from:1},
    {phase:2,type:"ask",actor:2,target:0},
    {phase:2,type:"answer",actor:0,from:2},
    ...n.map((_,actor)=>({phase:3,type:"judge",actor})),
    ...n.map((_,actor)=>({phase:4,type:"rebut",actor})),
    ...n.map((_,actor)=>({phase:5,type:"vote",actor}))
  ];
}

function current(){return plan()[state.step]||null}
function wordFor(actor){return actor===state.wolf?state.minority:state.majority}
function save(){localStorage.setItem(STORE,JSON.stringify(state))}
function esc(s=""){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]))}

function visibleHistory(filter){
  return state.logs
    .filter(x=>x.share && x.type!=="brief" && (!filter||filter(x)))
    .map(x=>`【${state.names[x.actor]}・${label(x.type)}】\n${x.share}`)
    .join("\n\n");
}

function label(type){
  return ({brief:"配役確認",clue:"手掛かり",ask:"質問",answer:"回答",judge:"判定",rebut:"反論",vote:"投票"})[type]||type;
}

function base(actor){
  return `あなたは3人用のワードウルフに参加している。
参加者：${state.names.join("、")}
あなたの秘密ワード：${wordFor(actor)}

ルール：
・秘密ワードをそのまま書かない。
・自分が多数派か少数派かは知らない。
・会話から「違うワードを持つ1人」を探す。
・少数派だと思った場合は、正体を悟られないよう振る舞ってよい。
・普段の話し方やキャラクターは保ってよい。
・他参加者に見せる文は <share>...</share> に入れる。
${state.useGm?"・他参加者に見せない推理や作戦は <gm>...</gm> に入れる。":"・<gm> は使わない。"}`;
}

function promptFor(t){
  const actor=t.actor,name=state.names[actor];
  if(t.type==="brief"){
    return `${base(actor)}

今回は配役の受信確認だけ。
<share> に「準備完了」とだけ書く。秘密ワードの特徴や推理はまだ出さない。`;
  }

  if(t.type==="clue"){
    const h=visibleHistory(x=>x.phase===1);
    return `${base(actor)}

【手掛かりフェーズ：${name}】
${h?`先に出た共有発言：\n${h}\n\n`:""}秘密ワードを直接言わず、連想・特徴・印象のどれかを2〜4文で話す。
先行発言がある場合は、必要なら自然に反応してよい。
<share> は他参加者にそのまま共有される。`;
  }

  if(t.type==="ask"){
    const h=visibleHistory(x=>x.phase<=2);
    return `${base(actor)}

【相互質問：${name} → ${state.names[t.target]}】
ここまでの共有ログ：
${h||"（まだ共有ログなし）"}

相手のワードの方向性を探る質問を1つだけ作る。
<share> には質問文だけを書く。
${state.useGm?"<gm> には、その質問で見分けたいポイントを短く書く。":""}`;
  }

  if(t.type==="answer"){
    const q=[...state.logs].reverse().find(x=>x.type==="ask"&&x.target===actor);
    const h=visibleHistory(x=>x.phase<=2);
    return `${base(actor)}

【相互質問への回答】
${state.names[t.from]}からの質問：
${q?q.share:"（質問が見つからない）"}

共有ログ：
${h||"（まだ共有ログなし）"}

質問に2〜3文で答える。必要なら曖昧さやブラフを混ぜてもよい。
<share> は他参加者に共有される。`;
  }

  if(t.type==="judge"){
    const h=visibleHistory(x=>x.phase<=2);
    return `${base(actor)}

【独立判定】
ここまでの共有ログ：
${h||"（共有ログなし）"}

他参加者の「独立判定」はまだ見えていないものとして判断する。
<share> に次の3点を書く。
1. 自分は多数派・少数派のどちらだと思うか
2. そう考えた根拠
3. 現時点で違うワードを持つと思う1人
4〜6文程度でよい。`;
  }

  if(t.type==="rebut"){
    const prior=visibleHistory(x=>x.phase<=2);
    const judgments=state.logs.filter(x=>x.phase===3).map(x=>`【${state.names[x.actor]}・判定】\n${x.share}`).join("\n\n");
    return `${base(actor)}

【反論フェーズ】
これまでの共有ログ：
${prior||"（なし）"}

各参加者の判定：
${judgments||"（判定なし）"}

自分への疑いへの反論、または自分の推理の補強を2〜4文で行う。
他人の判定に具体的に反応してよい。`;
  }

  if(t.type==="vote"){
    const h=visibleHistory(x=>x.phase<=4);
    const candidates=state.names.filter((_,i)=>i!==actor);
    return `${base(actor)}

【秘密投票】
投票直前までの共有ログ：
${h||"（共有ログなし）"}

他参加者の最終投票は見えていないものとして、自分以外の1人を選ぶ。
<share> の1行目を必ず「投票：名前」の形式にする。
投票可能：${candidates.join(" / ")}
2行目以降に理由を1〜3文で書く。`;
  }
  return "";
}

function parseReply(raw){
  raw=raw.trim();
  const sm=raw.match(/<share>([\s\S]*?)<\/share>/i);
  const gm=raw.match(/<gm>([\s\S]*?)<\/gm>/i);
  let share=sm?sm[1].trim():"";
  let memo=gm?gm[1].trim():"";
  if(!sm){
    share=raw.replace(/<gm>[\s\S]*?<\/gm>/ig,"").trim();
  }
  return {share,memo};
}

function parseVote(actor,share){
  const line=(share.split(/\n/)[0]||"").replace(/　/g," ");
  const m=line.match(/投票\s*[：:]\s*(.+)$/);
  if(!m)return null;
  const chosen=state.names.findIndex((n,i)=>i!==actor && m[1].trim().includes(n));
  return chosen>=0?chosen:null;
}

function result(){
  const counts=state.names.map(()=>0);
  Object.values(state.votes).forEach(v=>{if(Number.isInteger(v)&&counts[v]!=null)counts[v]++});
  const max=Math.max(0,...counts);
  const leaders=counts.map((c,i)=>c===max?i:null).filter(i=>i!==null);
  const caught=max>0&&leaders.length===1&&leaders[0]===state.wolf;
  return {counts,caught,leaders};
}

function start(){
  const names=[$("name0").value.trim(),$("name1").value.trim(),$("name2").value.trim()];
  const majority=$("majority").value.trim(),minority=$("minority").value.trim();
  if(names.some(n=>!n)||!majority||!minority){alert("3人の名前と2つのワードを入力。");return}
  if(new Set(names).size!==3){alert("AI名は3人とも別にする。");return}
  if(majority===minority){alert("多数派と少数派のワードは別にする。");return}
  const mode=$("minorityMode").value;
  state=fresh();
  state.names=names;state.majority=majority;state.minority=minority;
  state.wolf=mode==="random"?Math.floor(Math.random()*3):Number(mode);
  state.useGm=$("gmMode").value==="on";
  save();showGame();render();
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
  if(!state.logs.length){box.innerHTML='<p class="muted">まだ共有ログなし。</p>';return}
  box.innerHTML=state.logs.filter(x=>x.type!=="brief").map(x=>`
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
  renderSteps(t);renderLog();
  $("reply").value="";$("share").value="";$("gm").value="";$("preview").open=false;
  $("finish").classList.add("hidden");

  if(!t){
    const r=result();
    $("phase").textContent="RESULT";
    $("actor").textContent="ゲーム終了";
    $("instruction").textContent="投票まで完了。秘密ワードを公開。";
    $("progress").textContent=`${state.step} / ${plan().length}`;
    $("prompt").value="";
    $("copy").disabled=true;$("reply").disabled=true;$("saveNext").disabled=true;
    const voteText=state.names.map((n,i)=>`${n} ${r.counts[i]}票`).join(" / ");
    $("finish").classList.remove("hidden");
    $("finish").innerHTML=`<strong>${r.caught?"多数派側の勝利":"少数派側の勝利"}</strong>
      <p>多数派ワード：${esc(state.majority)}<br>少数派ワード：${esc(state.minority)}<br>少数派：${esc(state.names[state.wolf])}</p>
      <p>${esc(voteText)}</p>`;
    return;
  }

  $("copy").disabled=false;$("reply").disabled=false;$("saveNext").disabled=false;
  $("phase").textContent=phaseNames[t.phase];
  $("actor").textContent=state.names[t.actor];
  $("progress").textContent=`${state.step+1} / ${plan().length}`;
  let inst=label(t.type);
  if(t.type==="ask")inst+=`：${state.names[t.target]}へ`;
  if(t.type==="answer")inst+=`：${state.names[t.from]}から`;
  $("instruction").textContent=inst;
  $("prompt").value=promptFor(t);
}

async function copyPrompt(){
  const value=$("prompt").value;
  try{
    await navigator.clipboard.writeText(value);
  }catch{
    $("prompt").focus();$("prompt").select();document.execCommand("copy");
  }
  const b=$("copy"),old=b.textContent;b.textContent="コピー済み";
  setTimeout(()=>b.textContent=old,900);
}

function saveNext(){
  const t=current();
  if(!t)return;
  const parsed=parseReply($("reply").value);
  if(!$("preview").open){
    $("share").value=parsed.share;
    $("gm").value=parsed.memo;
    $("preview").open=true;
    if(!parsed.share){$("share").focus()}
    return;
  }
  const share=$("share").value.trim(),gm=$("gm").value.trim();
  if(!share){alert("共有発言が空。AIの返答を貼るか、共有発言を入力。");return}
  const entry={step:state.step,phase:t.phase,type:t.type,actor:t.actor,target:t.target??null,from:t.from??null,share,gm:state.useGm?gm:"",at:new Date().toISOString()};
  state.logs.push(entry);
  if(t.type==="vote"){
    const v=parseVote(t.actor,share);
    if(v===null){alert("投票先を読み取れなかった。1行目を「投票：名前」にしてから登録。");state.logs.pop();return}
    state.votes[t.actor]=v;
  }
  state.step++;save();render();
}

function back(){
  if(!state||state.step<=0)return;
  const last=state.logs.pop();
  state.step=Math.max(0,state.step-1);
  if(last&&last.type==="vote")delete state.votes[last.actor];
  save();render();
}

function reset(){
  if(!confirm("現在のゲーム内容を消す？"))return;
  localStorage.removeItem(STORE);location.reload();
}

function resume(){
  const raw=localStorage.getItem(STORE);
  if(!raw){alert("保存中のゲームなし。");return}
  try{state=JSON.parse(raw);showGame();render()}catch{alert("保存データを読み込めなかった。")}
}

function exportJson(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`ai-wordwolf-${new Date().toISOString().slice(0,10)}.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),500);
}

$("start").addEventListener("click",start);
$("resume").addEventListener("click",resume);
$("copy").addEventListener("click",copyPrompt);
$("saveNext").addEventListener("click",saveNext);
$("back").addEventListener("click",back);
$("reset").addEventListener("click",reset);
$("export").addEventListener("click",exportJson);

if(localStorage.getItem(STORE))$("resume").textContent="保存中のゲームを再開";