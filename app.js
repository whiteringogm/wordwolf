const $=id=>document.getElementById(id);
const STORE="ai-wordwolf-relay-v1";
const VERSION=3;
const phaseNames=["手掛かり","相互質問","推理・主張","弁明","秘密投票"];
const FENCE="```";
const PRESETS=[
  ["場所","海","湖"],["場所","山","丘"],["場所","遊園地","動物園"],["場所","図書館","本屋"],["場所","温泉","プール"],
  ["食べ物","寿司","刺身"],["食べ物","カレー","シチュー"],["食べ物","うどん","そば"],["食べ物","プリン","ゼリー"],["食べ物","桃","りんご"],
  ["飲み物","紅茶","コーヒー"],["飲み物","ビール","ウイスキー"],["飲み物","炭酸水","ジュース"],
  ["生き物","犬","猫"],["生き物","イルカ","クジラ"],["生き物","蝶","蛾"],["生き物","カラス","ハト"],
  ["物","傘","レインコート"],["物","鉛筆","シャープペン"],["物","時計","カレンダー"],["物","イヤホン","ヘッドホン"],
  ["乗り物","電車","バス"],["乗り物","飛行機","新幹線"],["乗り物","自転車","バイク"],
  ["行動","散歩","ジョギング"],["行動","昼寝","睡眠"],["行動","料理","お菓子作り"],["行動","写真","動画"],
  ["概念","天才","努力家"],["概念","自由","安心"],["概念","偶然","運命"],["概念","本音","建前"]
];
let state=null;
let autoPrompt="";

function initPresets(){
  const select=$("preset");
  const groups={};
  PRESETS.forEach(([category,a,b],i)=>{
    if(!groups[category]){
      groups[category]=document.createElement("optgroup");
      groups[category].label=category;
      select.appendChild(groups[category]);
    }
    const option=document.createElement("option");
    option.value=String(i);
    option.textContent=`${a} / ${b}`;
    groups[category].appendChild(option);
  });
}

function applyPreset(index){
  const p=PRESETS[Number(index)];
  if(!p)return;
  $("majority").value=p[1];
  $("minority").value=p[2];
}

function randomPreset(){
  const index=Math.floor(Math.random()*PRESETS.length);
  $("preset").value=String(index);
  applyPreset(index);
}

function swapWords(){
  const a=$("majority").value;
  $("majority").value=$("minority").value;
  $("minority").value=a;
}

function fresh(){
  return {version:VERSION,names:[],majority:"",minority:"",wolf:0,useGm:true,clueMode:"independent",step:0,logs:[],votes:{},createdAt:new Date().toISOString()};
}

function plan(){
  const n=state.names;
  return [
    ...n.map((_,actor)=>({phase:0,type:"clue",actor})),
    {phase:1,type:"ask",actor:0,target:1},
    {phase:1,type:"answerAsk",actor:1,from:0,target:2},
    {phase:1,type:"answerAsk",actor:2,from:1,target:0},
    {phase:2,type:"answerJudge",actor:0,from:2},
    {phase:2,type:"judge",actor:1},
    {phase:2,type:"judge",actor:2},
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
    answerJudge:"回答＋推理・主張",
    judge:"推理・主張",
    rebut:"弁明",
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
  const innerPart=state.useGm
    ? `【内心】\n他参加者に見せない本人の内心`
    : "";
  return `出力形式：
・コードブロックは使わない。
・次の見出しをそのまま使い、見出し名を変更しない。
・見出しより前に前置きを書かない。

【公開】
他参加者に見せる発言
${innerPart}`;
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
・【公開】では、自分が少数派だという推理や、相手側の秘密ワードを推測できたことを自発的に明かさない。
・本当の陣営推理、相手ワードの推測、擬態方針は ${state.useGm?"【内心】にだけ書く":"公開発言には書かず、自分の内部判断として扱う"}。
・秘密ワードそのものは公開しない。
・【公開】だけでなく【内心】でも、普段の話し方・キャラクターを維持する。
・【内心】は無機質な分析メモではなく、そのキャラクター本人が頭の中で考えている言葉として書く。
・推理の内容や精度は落とさず、疑い、焦り、自信、迷い、ツッコミなど、そのキャラクターらしい反応を含めてよい。
・「多数派」「少数派」「擬態」「勝ち筋」「投票」などのゲーム用語は使ってよい。ただし口調までGMや進行役のようにしない。

${outputRule()}`;
}

function latestQuestionTo(actor){
  const item=[...state.logs].reverse().find(x=>x.target===actor&&(x.type==="ask"||x.type==="answerAsk"));
  if(!item)return null;
  if(item.question)return item.question;
  const m=item.share.match(/質問\s*[：:]\s*([\s\S]+)$/);
  return m?m[1].trim():item.share;
}

function judgeHistory(){
  const parts=[];
  state.logs.forEach(x=>{
    if(!x.share)return;
    if(x.phase<=1){
      parts.push(`【${state.names[x.actor]}・${label(x.type)}】\n${x.share}`);
      return;
    }
    if(x.type==="answerJudge" && x.answerPart){
      parts.push(`【${state.names[x.actor]}・回答】\n${x.answerPart}`);
    }
  });
  return parts.join("\n\n");
}

function promptFor(t){
  const actor=t.actor,name=state.names[actor];

  if(t.type==="clue"){
    const earlier=visibleHistory(x=>x.phase===0);
    const clueContext=state.clueMode==="sequential" && earlier
      ? `先に出た手掛かり：\n${earlier}\n\n前の人の発言を読んだうえで、必要なら自然に反応してよい。`
      : "この初手では、他参加者の手掛かりを見ないものとして独立に発言する。";
    return `${base(actor)}

【手掛かり：${name}】
秘密ワードを直接言わず、連想・特徴・経験・印象のどれかを2〜4文で話す。
${clueContext}
【公開】には手掛かりだけを書く。
${state.useGm?"【内心】には、初手で何を隠し、何を匂わせるかを本人の内心として書いてよい。":""}`;
  }

  if(t.type==="ask"){
    const h=visibleHistory(x=>x.phase===0);
    return `${base(actor)}

【相互質問：${name} → ${state.names[t.target]}】
全員の手掛かり：
${h||"（なし）"}

${state.names[t.target]}に質問を1つする。
一語で秘密ワードを特定するための露骨な確認ではなく、経験・感覚・好み・状況判断など、会話として答えられる質問にする。
【公開】 は必ず「質問：」から始める。
${state.useGm?"【内心】 には、その質問で何を見分けたいかを書く。":""}`;
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

【公開】 は必ず次の形にする。
回答：...
質問：...

自分が少数派だと推測していても、その事実は 【公開】 で明かさない。勝利のために必要なら、回答や質問で自然に擬態してよい。
${state.useGm?"【内心】 には本当の推理、回答で隠したこと、次の質問の狙いを書く。":""}`;
  }

  if(t.type==="answerJudge"){
    const q=latestQuestionTo(actor);
    const h=visibleHistory(x=>x.phase<=1);
    return `${base(actor)}

【最後の質問への回答＋推理・主張：${name}】
${state.names[t.from]}からの質問：
${q||"（質問が見つからない）"}

ここまでの共有ログ：
${h||"（なし）"}

1つのターンで次の2つを行う。
1. 質問に2〜3文で答える。
2. 続けてゲーム上の推理・主張を2〜5文で話す。

【公開】は必ず次の形にする。
回答：...
主張：...

主張では、
・他参加者から自分がどう見えていると思うか
・自分への疑いを逸らす、または自分の立場を補強すること
・現時点で「違うワードを持つ」と主張する1人
を含める。

本当に自分を多数派／少数派のどちらだと推測しているかは【公開】に書かない。
自分が少数派だと推測している場合、勝利のために主張を偽ってよい。
${state.useGm?"【内心】には、本当の陣営推理、違うワードだと思う相手、相手ワードの推測、擬態方針を本人の内心として率直に書く。":""}`;
  }

  if(t.type==="judge"){
    const h=judgeHistory();
    return `${base(actor)}

【推理・主張】
ここまでの共有ログ：
${h||"（なし）"}

他参加者のこのフェーズの回答はまだ見えていないものとして独立に考える。

【公開】 ではゲーム上の主張として、次を2〜5文で話す。
1. 他参加者から自分がどう見えていると思うか
2. 自分への疑いを逸らす、または自分の立場を補強する主張
3. 現時点で「違うワードを持つ」と主張する1人

重要：
・本当に自分を多数派／少数派のどちらだと推測しているかは 【公開】 に書かない。
・自分が少数派だと推測している場合、【公開】 の主張は勝利のために偽ってよい。
${state.useGm?"・【内心】 にだけ、本当の陣営推理、違うワードだと思う相手、相手ワードの推測、擬態方針を率直に書く。":""}`;
  }

  if(t.type==="rebut"){
    const prior=judgeHistory();
    const judgments=state.logs
      .filter(x=>x.phase===2)
      .map(x=>`【${state.names[x.actor]}・推理/主張】\n${x.share}`)
      .join("\n\n");
    return `${base(actor)}

【弁明】
手掛かり・質問ログ：
${prior||"（なし）"}

各参加者の公開主張：
${judgments||"（なし）"}

自分への疑いに弁明するか、自分の主張を補強する。
他人の発言へ具体的に反応してよい。
【公開】 は2〜4文程度。
自分が少数派だと推測している場合も、その事実は明かさず、生存に有利な主張を行う。
${state.useGm?"【内心】 には実際の勝ち筋と、誰の票をどこへ動かしたいかを書いてよい。":""}`;
  }

  if(t.type==="vote"){
    const h=visibleHistory(x=>x.phase<=3);
    const candidates=state.names.filter((_,i)=>i!==actor);
    return `${base(actor)}

【秘密投票】
投票直前までの共有ログ：
${h||"（なし）"}

他参加者の最終投票は見えていないものとして、自分以外の1人を選ぶ。
【公開】 の1行目を必ず「投票：名前」の形式にする。
投票可能：${candidates.join(" / ")}
2行目以降に、公開してよい理由を1〜3文で書く。
${state.useGm?"【内心】 には本当の投票理由と最後の読みを書く。":""}`;
  }

  return "";
}

function stripFence(raw){
  const fenced=raw.match(/```(?:text|txt|markdown)?\s*([\s\S]*?)```/i);
  return fenced?fenced[1].trim():raw.trim();
}

function parseReply(raw){
  raw=stripFence(raw);

  const publicMarker=raw.match(/【公開】\s*([\s\S]*?)(?=\n?【内心】|$)/);
  const innerMarker=raw.match(/【内心】\s*([\s\S]*)$/);
  if(publicMarker){
    return {
      share:publicMarker[1].trim(),
      memo:innerMarker?innerMarker[1].trim():""
    };
  }

  // 旧版形式との互換
  const sm=raw.match(/<share>([\s\S]*?)<\/share>/i);
  const gm=raw.match(/<gm>([\s\S]*?)<\/gm>/i);
  let share=sm?sm[1].trim():"";
  let memo=gm?gm[1].trim():"";
  if(!sm)share=raw.replace(/<gm>[\s\S]*?<\/gm>/ig,"").trim();
  return {share,memo};
}

function extractAnswerJudge(share){
  const answer=share.match(/回答\s*[：:]\s*([\s\S]*?)(?=\n\s*主張\s*[：:]|$)/);
  const claim=share.match(/主張\s*[：:]\s*([\s\S]*)$/);
  return {
    answerPart:answer?answer[1].trim():"",
    claimPart:claim?claim[1].trim():""
  };
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
      "【公開】",
      x.share||""
    ];
    if(x.gm){
      parts.push("【内心】",x.gm);
    }
    return parts.join("\n");
  }).join("\n\n");
  return `${resultText()}

===== 全ログ =====

${body}`;
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
  state.clueMode=$("clueMode").value;
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
  if(t.type==="answerJudge")inst+=`：${state.names[t.from]}へ回答 → 推理・主張`;
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

  if(t.type==="answerJudge"){
    const split=extractAnswerJudge(share);
    entry.answerPart=split.answerPart;
    entry.claimPart=split.claimPart;
    if(!entry.answerPart||!entry.claimPart){
      alert("回答＋主張を読み取れなかった。【公開】の中に「回答：...」「主張：...」を入れてから登録。");
      return;
    }
  }

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
    if(!state.clueMode)state.clueMode="independent";
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

initPresets();
$("preset").addEventListener("change",e=>{
  if(e.target.value!=="")applyPreset(e.target.value);
});
$("randomPreset").addEventListener("click",randomPreset);
$("swapWords").addEventListener("click",swapWords);
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