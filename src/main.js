import './style.css';
import {
  AREAS, GROUPS, AREA_LABEL, SHORT, C, DAYS, SLOTS, SEC, SEMS, FUTURE, semLabel, ST, badge, REG_LIST, DEPTS, LINKED, NOW_YEAR, SETUP_FIELDS, SECOND_LABEL, hasSecond
} from './data.js';

// ?ut 를 주소에 붙이면 UT(사용성 테스트) 진행 도구가 보여요. 예: https://.../YonPlan/?ut
const UT_MODE = new URLSearchParams(location.search).has('ut');
if (UT_MODE) document.body.classList.add('ut-mode');

/* ---------- 상태 ---------- */
let S;
function fresh(level){
  const full={
    onboarded:true,
    profile:{year:'2024',grade:'3',major:'경제학',track:'복수전공',second:'심리학',grad:'2027-2'},
    registered:Object.keys(C).filter(k=>C[k].sem),
    tt:{A:['PSY2201-01','ECO3140-01','UCC2101-01','ECO2101-01','PSY3104-01'],B:['PSY2201-01','ECO3160-01','UCC2101-01','ECO2101-03','PSY3104-02']},
    ttTab:'A',main:'A',
    plan:[{c:'ECO3170',sem:'2027-1',st:'plan'},{c:'PSY3107',sem:'2027-1',st:'plan'},{c:'PSY3105',sem:'2027-1',st:'rec'},{c:'ECO4101',sem:'2027-2',st:'plan'},{c:'PSY3108',sem:'2027-2',st:'rec'}],
    fav:[],showPre:true,rmFilter:'all',open:{'2026-2':true,'2027-1':true,'2027-2':true},
    stack:[{s:'home'}],flash:[]
  };
  if(level===1){full.onboarded=false;full.profile={year:'',grade:'',major:'',track:'',second:'',grad:''};full.registered=[];}
  if(level===2){full.onboarded=false;full.registered=[];full.stack=[{s:'register',p:{onboard:true}}];}
  return full;
}
S=fresh(1);

/* ---------- 계산 ---------- */
const doneCodes=()=>Object.keys(C).filter(k=>C[k].sem);
const ttCodes=key=>S.tt[key].map(id=>SEC[id].code);
function sumBy(codes,fn){return codes.reduce((a,k)=>a+(fn(C[k])?C[k].cr:0),0)}
function areaCr(codes,a){return a==='up'?sumBy(codes,x=>x.u):sumBy(codes,x=>x.a===a)}
function groupCr(codes,g){return g.k==='common'?areaCr(codes,'up'):g.areas.reduce((t,a)=>t+areaCr(codes,a),0)}
const DONE_TOTAL=()=>sumBy(doneCodes(),()=>1);
function conflicts(key){
  const occ={};const pairs=[];
  S.tt[key].forEach(id=>SEC[id].meets.forEach(([d,t])=>{const k=d+'-'+t;(occ[k]=occ[k]||[]).push(id)}));
  Object.values(occ).forEach(ids=>{if(ids.length>1){const p=ids.slice().sort().join('|');if(!pairs.includes(p))pairs.push(p)}});
  return pairs.map(p=>p.split('|'));
}
function clashWith(secId,key){
  const m=SEC[secId].meets.map(x=>x.join('-'));
  return S.tt[key].filter(id=>SEC[id].code!==SEC[secId].code&&SEC[id].meets.some(x=>m.includes(x.join('-'))));
}
const timeText=id=>{const sc=SEC[id];return sc.meets.map(([d,t])=>DAYS[d]+' '+SLOTS[t]).join(', ')};
function shortTime(id){const sc=SEC[id];const ds=[...new Set(sc.meets.map(m=>DAYS[m[0]]))].join('·');return ds+' '+SLOTS[sc.meets[0][1]]}
function visiblePlan(){const tc=ttCodes(S.main);return S.plan.filter(p=>!tc.includes(p.c))}
function planCredits(){return visiblePlan().filter(p=>p.st==='plan').reduce((a,p)=>a+C[p.c].cr,0)}
function ttCredits(key){return sumBy(ttCodes(key),()=>1)}
function prereqInfo(code,sem){
  const pre=C[code].pre;if(!pre)return {ok:true,t:'선수과목이 없어요.'};
  const p=C[pre];
  if(p.sem)return {ok:true,t:`선수과목 ${p.n}을(를) 이미 이수했어요.`};
  if(ttCodes(S.main).includes(pre))return {ok:sem!=='2026-2',t:`선수과목 ${p.n}을(를) 2026-2에 들을 예정이에요.`};
  const pl=S.plan.find(x=>x.c===pre&&x.st==='plan');
  if(pl&&pl.sem<sem)return {ok:true,t:`선수과목 ${p.n}을(를) ${pl.sem}에 들을 계획이에요.`};
  return {ok:false,t:`선수과목 ${p.n}을(를) 먼저 들어야 해요.`};
}
function statusOf(code){
  if(C[code].sem)return 'done';
  if(ttCodes(S.main).includes(code))return 'now';
  const p=S.plan.find(x=>x.c===code);return p?p.st:null;
}

/* ---------- 내비게이션 ---------- */
const $screen=document.getElementById('screen'),$tabs=document.getElementById('tabs'),$layer=document.getElementById('layer');
const cur=()=>S.stack[S.stack.length-1];
function saveScroll(){const sc=$screen.querySelector('.scroll');if(sc&&cur())cur().y=sc.scrollTop}
function go(s,p,opt){saveScroll();opt=opt||{};if(opt.replace)S.stack.pop();S.stack.push({s,p:p||{}});render(opt.toY)}
function back(){saveScroll();if(S.stack.length>1){S.stack.pop();render(cur().y||0)}}
function tab(t){saveScroll();S.stack=[{s:t}];render(0)}
const TAB_OF={home:'home',req:'req',area:'req',roadmap:'roadmap',course:'roadmap',addplan:'roadmap',tt:'tt',compare:'tt',alt:'tt',search:'tt',detail:'tt',me:'me',setup:'me',register:'me',source:'me'};

let toastTimer;
function toast(msg,action){
  clearTimeout(toastTimer);
  const t=document.createElement('div');t.className='toast';t.setAttribute('role','status');
  t.innerHTML=`<span class="grow">${msg}</span>${action?`<button type="button">${action.t}</button>`:''}`;
  document.querySelectorAll('.toast').forEach(x=>x.remove());
  document.getElementById('phone').appendChild(t);
  if(action)t.querySelector('button').onclick=()=>{t.remove();action.fn()};
  toastTimer=setTimeout(()=>t.remove(),action?5000:3200);
}
function closeSheet(){$layer.innerHTML=''}

const ICONS={
  home:'<path d="M4 11l8-7 8 7v9h-5v-6h-6v6H4z"/>',
  req:'<path d="M6 3h9l4 4v14H6z"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="2"/>',
  roadmap:'<rect x="4" y="12" width="4" height="8" rx="1"/><rect x="10" y="7" width="4" height="13" rx="1"/><rect x="16" y="4" width="4" height="16" rx="1"/>',
  tt:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18" stroke="var(--bg)" stroke-width="2"/>',
  me:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6z"/>'
};
const TABS=[['home','홈'],['req','졸업요건'],['roadmap','로드맵'],['tt','시간표'],['me','내 정보']];
function renderTabs(){
  const active=TAB_OF[cur().s];
  $tabs.innerHTML=TABS.map(([k,n])=>`<button type="button" data-tab="${k}" ${active===k?'aria-current="page"':''}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[k]}</svg>${n}</button>`).join('');
}

/* ---------- 공통 조각 ---------- */
const top=(title,opt)=>{opt=opt||{};return `<header class="top ${opt.big?'big':''}">${opt.big?'':'<button type="button" class="back" data-act="back" aria-label="뒤로 가기">‹</button>'}<h1>${title}</h1>${opt.right||''}</header>`};
const needSetup=title=>`${top(title,{big:true})}<div class="scroll"><div class="empty"><div class="ico" aria-hidden="true">🎓</div><div class="h3">학적 정보를 먼저 설정해 주세요</div><p class="note">학번, 전공, 이수과정을 입력하면 내 기준으로 ${title==='졸업요건'?'졸업요건을':title==='학사 로드맵'?'학기별 로드맵을':'시간표와 요건을'} 정리해 드려요.</p><button type="button" class="btn sm" data-go="setup">학적 설정하러 가기</button></div></div>`;
function barHtml(now,after,need){const a=Math.min(now,need)/need*100,b=Math.max(0,Math.min(after,need)-Math.min(now,need))/need*100;return `<div class="bar" role="img" aria-label="${need}학점 중 ${now}학점 이수, 계획 반영 시 ${after}학점"><i style="width:${a}%"></i><i class="plan" style="width:${b}%"></i></div>`}

/* ---------- 화면: 홈 ---------- */
function vHome(){
  if(!S.onboarded){
    return `${top('홈',{big:true})}<div class="scroll">
      <div class="card"><div class="row"><div class="empty" style="padding:0;flex-direction:row;gap:12px;text-align:left"><div class="ico" aria-hidden="true">👤</div><div><div class="h3">학적 정보가 아직 없어요</div><div class="muted small">이름과 학적은 설정 후 표시돼요</div></div></div></div></div>
      <div class="card soft" style="display:flex;flex-direction:column;gap:10px"><div class="h3">학적 정보를 먼저 설정해 주세요</div><p class="note" style="margin:0">학번 · 전공 · 이수과정을 입력하면 내 기준으로 졸업요건을 정리해 드려요.</p><button type="button" class="btn" data-go="setup">학적 설정하러 가기</button></div>
      <div class="between"><div class="h2">졸업요건 이수율</div></div>
      <div class="card" style="display:flex;flex-direction:column;gap:12px">${GROUPS.map(g=>`<div class="between"><span>${g.k==='common'?'3·4000단위':g.n}</span><span class="muted">— / ${g.need}학점</span></div>`).join('')}</div></div>`;
  }
  const d=doneCodes(),t=ttCodes(S.main),tot=DONE_TOTAL(),after=tot+ttCredits(S.main);
  const cf=conflicts(S.main).length;
  const pcLeft=!d.includes('PSY2201');
  const inTT=t.includes('PSY2201');
  return `<header class="top big"><h1>안녕하세요, 김연세님</h1></header><div class="scroll">
    <div class="muted small" style="margin-top:-8px">${profileText(S.profile)}</div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div class="between"><span class="muted small">전체 이수율</span><span class="muted small">목표 졸업 ${S.profile.grad}</span></div>
      <div class="between"><span style="font-size:30px;font-weight:800" class="num">${Math.round(tot/126*100)}%</span><span class="num"><b>${tot}</b> / 126학점</span></div>
      ${barHtml(tot,after,126)}
      <div class="legend"><span><i class="sw"></i>이수 ${tot}</span><span><i class="sw plan"></i>이번 학기 시간표 반영 시 ${after}</span></div>
    </div>
    <div class="between"><div class="h2">졸업요건 이수율</div><button type="button" class="link" data-tab="req">남은 졸업요건 보기 ›</button></div>
    <div class="card" style="display:flex;flex-direction:column;gap:14px">
      ${GROUPS.map(g=>{const n=groupCr(d,g),a=groupCr(d.concat(t),g);return `<div style="display:flex;flex-direction:column;gap:6px"><div class="between"><b>${g.k==='common'?'3·4000단위':g.n}</b><span class="muted small num">${n} → ${a} / ${g.need}학점</span></div>${barHtml(n,a,g.need)}</div>`}).join('')}
      <div class="legend"><span><i class="sw"></i>현재 이수</span><span><i class="sw plan"></i>2026-2 시간표 반영 후</span></div>
    </div>
    <div class="card" style="display:flex;flex-direction:column;gap:4px">
      <div class="between"><div class="h3">놓치기 쉬운 항목</div><button type="button" class="link" data-go="roadmap">로드맵에서 보기 ›</button></div>
      <button type="button" class="li" data-go="area" data-a="up"><span class="grow"><b>3·4000단위 45학점 중 ${areaCr(d,'up')}학점</b><br><span class="muted small">전공·교양 구분 없이 인정 · ${45-areaCr(d,'up')}학점 남음</span></span><span class="chev">›</span></button>
      ${pcLeft?`<button type="button" class="li" data-go="area" data-a="pc"><span class="grow"><b>심리학 전공필수 '심리학의실험연구방법' 미이수</b><br><span class="muted small">3학점 남음 · ${inTT?'이번 학기 시간표에 담겨 있어요':'이번 학기 수강 가능'}</span></span><span class="chev">›</span></button>`:''}
    </div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div class="between"><div class="h3">2026-2 시간표 계획</div><span class="pill gray">${S.main==='A'?'1안':'2안'}</span></div>
      <div class="between"><span class="muted">담은 과목</span><b>${S.tt[S.main].length}과목 · ${ttCredits(S.main)}학점</b></div>
      <div class="between"><span class="muted">시간 충돌</span>${cf?`<span class="pill bad">! ${cf}건</span>`:'<span class="pill ok">✓ 없음</span>'}</div>
      <button type="button" class="btn" data-tab="tt">시간표 이어서 짜기</button>
    </div>
  </div>`;
}

/* ---------- 화면: 졸업요건 ---------- */
function vReq(){
  if(!S.onboarded)return needSetup('졸업요건');
  const d=doneCodes();
  const unmet=Object.keys(AREAS).filter(a=>areaCr(d,a)<AREAS[a].need);
  const tot=DONE_TOTAL();
  const mustLeft=[];['ec','pc'].forEach(a=>AREAS[a].fixed.forEach(k=>{if(!C[k].sem)mustLeft.push([a,k])}));
  return `${top('졸업요건',{big:true})}<div class="scroll">
    <div class="card" style="display:flex;flex-direction:column;gap:12px">
      <div class="between"><span class="muted small">내 기준</span><button type="button" class="link" data-go="setup">학적 변경 ›</button></div>
      <div class="chips">${profileText(S.profile,'|').split('|').filter(x=>!/학년/.test(x)).map(x=>`<span class="chip">${x.replace('(복수전공)','')}</span>`).join('')}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;border-top:1px solid var(--line);padding-top:12px">
        <div><div class="muted tiny">졸업 학점</div><b class="num" style="font-size:17px">${tot} / 126</b></div>
        <div><div class="muted tiny">부족 학점</div><b class="num" style="font-size:17px">${126-tot}학점</b></div>
        <div><div class="muted tiny">미충족 영역</div><b class="num" style="font-size:17px">${unmet.length}개</b></div>
      </div>
    </div>
    <div class="card soft" style="display:flex;flex-direction:column;gap:2px">
      <div class="h3">아직 듣지 않은 필수 과목</div>
      ${mustLeft.map(([a,k])=>{const st=statusOf(k);return `<button type="button" class="li" data-go="area" data-a="${a}"><span class="grow"><b>${C[k].n}</b><br><span class="muted small">${AREA_LABEL[a]} · ${C[k].cr}학점</span></span>${st?badge(st):'<span class="pill gray">미계획</span>'}<span class="chev">›</span></button>`}).join('')}
    </div>
    ${GROUPS.map(g=>`<div class="between"><div class="h2">${g.n}</div><span class="muted small num">${groupCr(d,g)} / ${g.need}학점</span></div>
      <div class="card" style="padding:4px 16px">${g.areas.map(a=>{const n=areaCr(d,a),need=AREAS[a].need,ok=n>=need;return `<button type="button" class="li" data-go="area" data-a="${a}">
        <span class="grow" style="display:flex;flex-direction:column;gap:6px"><span class="between"><b>${AREAS[a].n}</b><span class="num small">${n} / ${need}</span></span>${barHtml(n,n,need)}</span>
        ${ok?'<span class="pill ok">✓ 충족</span>':`<span class="pill bad">${need-n}학점 남음</span>`}<span class="chev">›</span></button>`}).join('')}</div>`).join('')}
    <button type="button" class="link" data-go="source" style="align-self:flex-start">정보 출처 및 유의사항 ›</button>
  </div>`;
}
function vArea(p){
  const a=p.a,A=AREAS[a],d=doneCodes();
  const inArea=k=>a==='up'?C[k].u:C[k].a===a;
  const done=d.filter(inArea);
  const now=ttCodes(S.main).filter(inArea);
  const plans=visiblePlan().filter(x=>inArea(x.c));
  const n=areaCr(d,a),ok=n>=A.need;
  const left=A.fixed?A.fixed.filter(k=>!C[k].sem):[];
  const gname=GROUPS.find(g=>g.k===A.g).n;
  const secRows=code=>Object.values(SEC).filter(x=>x.code===code).map(x=>{const cl=clashWith(x.id,S.main);const mine=S.tt[S.main].includes(x.id);return `<div class="between small" style="padding:6px 0;border-top:1px dashed var(--line)"><span>${x.no}분반 · ${x.prof}</span><span class="muted">${shortTime(x.id)}</span>${mine?'<span class="pill info">● 담은 분반</span>':cl.length?'<span class="pill bad">겹침</span>':'<span class="pill ok">가능</span>'}</div>`}).join('');
  return `${top(gname+' · '+A.n)}<div class="scroll">
    <div class="card" style="display:flex;flex-direction:column;gap:8px">
      <div class="between"><span style="font-size:26px;font-weight:800" class="num">${n} / ${A.need}</span>${ok?'<span class="pill ok">✓ 모두 이수했어요</span>':`<span class="pill bad">${A.need-n}학점 남음</span>`}</div>
      ${barHtml(n,n,A.need)}
    </div>
    <div><div class="h3">영역 규칙</div><p class="note" style="margin:4px 0 0">${A.rule}</p></div>
    ${left.length?`<div class="card" style="display:flex;flex-direction:column;gap:8px;border-color:var(--bad)"><div class="between"><div class="h3">남은 과목</div><span class="muted small">${left.length}과목</span></div>
      ${left.map(k=>{const st=statusOf(k);return `<div style="display:flex;flex-direction:column;gap:4px"><div class="between"><b>${C[k].n}</b>${st?badge(st):'<span class="pill gray">미계획</span>'}</div><span class="muted small">${k} · ${C[k].cr}학점 · 2026-2 개설 ${Object.values(SEC).filter(x=>x.code===k).length}개 분반</span>${secRows(k)}</div>`}).join('')}</div>`:''}
    ${now.length?`<div class="card" style="display:flex;flex-direction:column;gap:2px"><div class="h3">이번 학기 시간표에 담은 과목</div>${now.map(k=>`<div class="li"><span class="grow"><b>${C[k].n}</b><br><span class="muted small">${C[k].cr}학점</span></span>${badge('now')}</div>`).join('')}</div>`:''}
    ${plans.length?`<div class="card" style="display:flex;flex-direction:column;gap:2px"><div class="h3">로드맵에 넣어 둔 과목</div>${plans.map(x=>`<button type="button" class="li" data-go="course" data-c="${x.c}"><span class="grow"><b>${C[x.c].n}</b><br><span class="muted small">${x.sem} · ${C[x.c].cr}학점</span></span>${badge(x.st)}<span class="chev">›</span></button>`).join('')}</div>`:''}
    <div class="card" style="display:flex;flex-direction:column;gap:2px"><div class="between"><div class="h3">이수한 과목</div><span class="muted small">${done.length}과목</span></div>${done.length?done.map(k=>`<div class="li"><span class="grow"><b>${C[k].n}</b><br><span class="muted small">${C[k].sem} · ${C[k].cr}학점</span></span>${badge('done')}</div>`).join(''):'<p class="note">아직 이수한 과목이 없어요.</p>'}</div>
    ${ok?'':`<button type="button" class="btn weak" data-go="search" data-req="${a}">이 요건 과목 찾기</button>`}
  </div>`;
}

/* ---------- 화면: 로드맵 ---------- */
function courseCard(code,st,opt){
  opt=opt||{};const x=C[code];
  const pre=S.showPre&&x.pre?`<span class="pre">선수 ${C[x.pre].n} ${C[x.pre].sem||ttCodes(S.main).includes(x.pre)?'✓':'!'}</span>`:'';
  return `<button type="button" class="cc cc-${st} ${opt.flash?'flash':''}" data-go="course" data-c="${code}" aria-label="${x.n}, ${ST[st][1]}, ${SHORT[x.a]} ${x.cr}학점">${badge(st)}<span class="nm">${x.n}</span><span class="mt">${SHORT[x.a]} · ${x.cr}학점${x.u?' · 3000↑':''}</span>${pre}</button>`;
}
function vRoadmap(){
  if(!S.onboarded)return needSetup('학사 로드맵');
  const f=S.rmFilter;
  const pass=code=>f==='all'||(f==='econ'&&/^ECO/.test(code))||(f==='psy'&&/^PSY/.test(code))||(f==='gen'&&['gb','gu','rc','fr'].includes(C[code].a));
  const pc=planCredits(),tc=ttCredits(S.main),tot=DONE_TOTAL(),pred=tot+tc+pc;
  const vp=visiblePlan();
  const flash=S.flash;
  const semHtml=sem=>{
    let items=[];
    if(sem.k==='done')items=doneCodes().filter(k=>C[k].sem===sem.id).map(k=>[k,'done']);
    else if(sem.k==='now')items=ttCodes(S.main).map(k=>[k,'now']);
    else items=vp.filter(x=>x.sem===sem.id).map(x=>[x.c,x.st]);
    const shown=items.filter(([k])=>pass(k));
    const cr=items.filter(([,st])=>st!=='rec').reduce((a,[k])=>a+C[k].cr,0);
    const open=!!S.open[sem.id];
    const tag=sem.k==='now'?'<span class="pill info">이번 학기</span>':sem.k==='done'?'<span class="pill gray">이수 완료</span>':'';
    return `<section class="sem ${sem.k==='now'?'now':''}" id="sem-${sem.id}">
      <button type="button" class="sem-h" data-act="toggleSem" data-sem="${sem.id}" aria-expanded="${open}"><span style="flex:1;display:flex;flex-direction:column;gap:2px"><span class="row"><span class="yr num">${sem.id}</span><span class="gr">· ${sem.g}</span></span><span class="muted small">${sem.k==='future'?'계획 '+cr+'학점':'총 '+cr+'학점'} · ${items.length}과목</span></span>${tag}<span class="chev" aria-hidden="true">${open?'▴':'▾'}</span></button>
      ${open?`<div class="sem-b"><div class="grid3">${shown.map(([k,st])=>courseCard(k,st,{flash:flash.includes(k)})).join('')}
        ${sem.k==='future'?`<button type="button" class="addc" data-go="addplan" data-sem="${sem.id}"><b aria-hidden="true">+</b>과목 추가</button>`:''}</div>
        ${sem.k==='now'?'<button type="button" class="link" data-tab="tt" style="align-self:flex-start">2026-2 시간표에서 바꾸기 ›</button>':''}
        ${shown.length===0&&sem.k!=='future'?'<p class="note">이 필터에 해당하는 과목이 없어요.</p>':''}</div>`:''}
    </section>`;
  };
  return `${top('학사 로드맵',{big:true,right:`<select class="jump" id="jump" aria-label="학기 바로가기"><option value="">학기 바로가기</option>${SEMS.map(s=>`<option value="${s.id}">${s.id} · ${s.g}</option>`).join('')}</select>`})}
  <div class="scroll">
    <div class="card" style="display:flex;flex-direction:column;gap:8px">
      <div class="between"><span class="muted small">계획 포함 졸업 예상</span><span class="muted small">목표 ${S.profile.grad}</span></div>
      <div class="between"><b class="num" style="font-size:22px">${pred} / 126학점</b>${pred>=126?'<span class="pill ok">✓ 졸업 학점 충족</span>':`<span class="pill bad">${126-pred}학점 더 계획 필요</span>`}</div>
      ${barHtml(tot,pred,126)}
      <div class="legend"><span><i class="sw"></i>이수 ${tot}</span><span><i class="sw plan"></i>수강 중·계획 ${tc+pc}</span></div>
    </div>
    <div class="legend" aria-label="과목 상태 범례">${badge('done')}${badge('now')}${badge('plan')}${badge('rec')}</div>
    <div class="between" style="flex-wrap:wrap">
      <div class="chips">${[['all','전체'],['econ','경제'],['psy','심리'],['gen','교양·일반']].map(([k,n])=>`<button type="button" class="chip" data-act="rmFilter" data-f="${k}" aria-pressed="${f===k}">${n}</button>`).join('')}</div>
      <button type="button" class="switch" role="switch" aria-checked="${S.showPre}" data-act="togglePre"><span class="knob" aria-hidden="true"></span>선수과목</button>
    </div>
    ${SEMS.map(semHtml).join('')}
  </div>`;
}
function vCourse(p){
  const code=p.c,x=C[code],st=statusOf(code),pl=S.plan.find(y=>y.c===code);
  const sem=x.sem||(st==='now'?'2026-2':pl?pl.sem:'');
  const sel=p.sel||sem;
  const pre=prereqInfo(code,sel);
  const reqLine=`${AREA_LABEL[x.a]} +${x.cr}학점${x.u?' · 3·4000단위 +'+x.cr+'학점':''}`;
  let actions='';
  if(st==='plan'||st==='rec'){
    actions=`<div class="field"><label for="semSel">${st==='rec'?'담을 학기':'계획 학기'}</label><select id="semSel">${FUTURE.map(s=>`<option value="${s}" ${s===sel?'selected':''}>${semLabel(s)}</option>`).join('')}</select></div>
      <div class="banner ${pre.ok?'ok':'bad'}"><span aria-hidden="true">${pre.ok?'✓':'!'}</span><div><b>${pre.ok?'선수과목 순서 확인':'선수과목 순서 확인 필요'}</b><p>${pre.t}</p></div></div>`;
  }
  const footBtns=st==='plan'?`<button type="button" class="btn" data-act="savePlan" data-c="${code}" ${sel===sem?'disabled':''}>${sel===sem?'학기를 바꾸면 저장할 수 있어요':sel+'(으)로 옮기기'}</button><button type="button" class="btn weak" data-act="removePlan" data-c="${code}">계획에서 빼기</button>`
    :st==='rec'?`<button type="button" class="btn" data-act="adoptRec" data-c="${code}">${sel} 계획에 담기</button>`
    :st==='now'?`<button type="button" class="btn weak" data-tab="tt">시간표에서 보기</button>`:'';
  return `${top('과목 계획')}<div class="scroll">
    <div class="row">${badge(st||'rec')}<span class="muted small">${code}</span></div>
    <div><div style="font-size:24px;font-weight:800">${x.n}</div><div class="muted">${AREA_LABEL[x.a]} · ${x.cr}학점</div></div>
    <div class="card" style="padding:4px 16px">
      <div class="li"><span class="grow muted">${st==='done'?'이수 학기':'계획 학기'}</span><b>${sem?semLabel(sem):'-'}</b></div>
      <div class="li"><span class="grow muted">현재 상태</span>${badge(st||'rec')}</div>
      <div class="li"><span class="grow muted">선수과목</span><b>${x.pre?C[x.pre].n:'없음'}</b></div>
    </div>
    <div class="card soft"><div class="h3">이 과목을 이수하면</div><p style="margin:6px 0 0">${reqLine}</p></div>
    ${actions}
    ${st==='plan'||st==='rec'?'<p class="note">미래 학기의 개설 여부와 분반은 수강편람이 나온 뒤 확인할 수 있어요. 지금은 지난 학기 개설 이력을 바탕으로 한 잠정 계획이에요.</p>':''}
  </div>${footBtns?`<div class="foot">${footBtns}</div>`:''}`;
}
function vAddPlan(p){
  const sem=p.sem||'2027-1';
  const q=(p.q||'').trim(),f=p.f||'all',sel=p.sel||[];
  const taken=c=>C[c].sem||ttCodes(S.main).includes(c);
  const pool=['ECO3150','ECO3180','ECO3160','ECO3170','ECO4101','PSY3106','PSY3109','PSY3105','PSY3107','PSY3108','UCC2102','UCC2103','BUS2101'];
  const list=pool.filter(c=>!taken(c)).filter(c=>f==='all'||(f==='econ'&&/^ECO/.test(c))||(f==='psy'&&/^PSY/.test(c))||(f==='gen'&&/^(UCC|BUS)/.test(c))).filter(c=>!q||C[c].n.includes(q)||c.toLowerCase().includes(q.toLowerCase()));
  const cr=sel.reduce((a,c)=>a+C[c].cr,0);
  return `${top('계획 과목 추가')}<div class="scroll">
    <div class="field"><label for="addSem">추가할 학기</label><select id="addSem">${FUTURE.map(s=>`<option value="${s}" ${s===sem?'selected':''}>${semLabel(s)}</option>`).join('')}</select></div>
    <input class="search" id="addQ" type="search" placeholder="과목명 또는 학수번호 검색" value="${q.replace(/"/g,'&quot;')}" aria-label="과목 검색">
    <div class="chips">${[['all','전체'],['econ','경제학'],['psy','심리학'],['gen','교양·일반']].map(([k,n])=>`<button type="button" class="chip" data-act="addF" data-f="${k}" aria-pressed="${f===k}">${n}</button>`).join('')}</div>
    <div class="h3">내 졸업요건에 필요한 과목</div>
    <div style="display:flex;flex-direction:column;gap:8px">
    ${list.length?list.map(c=>{const pl=S.plan.find(x=>x.c===c);const already=pl&&pl.st==='plan';const on=sel.includes(c);const pre=prereqInfo(c,sem);
      return `<button type="button" class="opt" role="checkbox" aria-checked="${on}" data-act="addToggle" data-c="${c}" ${already?'disabled':''}><span class="check" aria-hidden="true">${on?'✓':''}</span><span class="grow"><span class="between"><b>${C[c].n}</b><span class="muted tiny">${c}</span></span><span class="muted small">${AREA_LABEL[C[c].a]} · ${C[c].cr}학점${C[c].u?' · 3000단위':''}</span>
      <span class="tags">${already?`<span class="pill gray">이미 ${pl.sem} 계획에 있어요</span>`:pl&&pl.st==='rec'?badge('rec'):''}${C[c].a==='fr'?'<span class="pill gray">전공 요건 미인정</span>':`<span class="pill ok">✓ ${SHORT[C[c].a]} 인정</span>`}${pre.ok?'':'<span class="pill bad">! 선수과목 필요</span>'}</span></span></button>`}).join(''):'<p class="note">검색 결과가 없어요. 다른 이름으로 찾아보세요.</p>'}
    </div>
  </div>
  <div class="foot"><div class="sum">${sel.length?`<b>${sel.map(c=>C[c].n).join(', ')}</b> · ${sel.length}과목 ${cr}학점을 <b>${sem}</b>에 추가해요`:'추가할 과목을 골라 주세요'}</div>
  <button type="button" class="btn" data-act="addPlan" ${sel.length?'':'disabled'}>${sel.length?`${sem}에 ${sel.length}과목 추가하기`:'과목을 선택해 주세요'}</button></div>`;
}

/* ---------- 화면: 시간표 ---------- */
function ttGrid(key,flash){
  const occ={};S.tt[key].forEach(id=>SEC[id].meets.forEach(([d,t])=>{(occ[d+'-'+t]=occ[d+'-'+t]||[]).push(id)}));
  let h='<div class="hd">시간</div>'+DAYS.map(d=>`<div class="hd">${d}</div>`).join('');
  SLOTS.forEach((tm,t)=>{h+=`<div class="tm">${tm}</div>`;DAYS.forEach((_,d)=>{const ids=occ[d+'-'+t]||[];
    if(!ids.length)h+='<div></div>';
    else if(ids.length===1)h+=`<div><button type="button" class="blk ${flash.includes(ids[0])?'flash':''}" data-go="detail" data-sec="${ids[0]}">${C[SEC[ids[0]].code].n}<small>${SEC[ids[0]].no}분반</small></button></div>`;
    else h+=`<div><button type="button" class="blk cf" data-go="alt">! 충돌<small style="color:inherit">${ids.map(i=>C[SEC[i].code].n).join(' · ')}</small></button></div>`;
  })});
  return `<div class="tt" role="grid" aria-label="2026-2 시간표 ${key==='A'?'1안':'2안'}">${h}</div>`;
}
function vTT(){
  if(!S.onboarded)return needSetup('2026-2 시간표');
  const key=S.ttTab,cf=conflicts(key);
  const isMain=S.main===key;
  return `${top('2026-2 시간표',{big:true})}<div class="scroll">
    <div class="seg" role="group" aria-label="시간표 안"><button type="button" data-act="ttTab" data-k="A" aria-pressed="${key==='A'}">1안${S.main==='A'?' ★':''}</button><button type="button" data-act="ttTab" data-k="B" aria-pressed="${key==='B'}">2안${S.main==='B'?' ★':''}</button><button type="button" data-go="compare">비교</button></div>
    ${cf.length?`<div class="banner bad"><span aria-hidden="true">!</span><div><b>시간 충돌 ${cf.length}건</b><p>${cf.map(pr=>pr.map(i=>C[SEC[i].code].n).join('과 ')+'이(가) 겹쳐요.').join(' ')}</p></div></div>`
      :'<div class="banner ok"><span aria-hidden="true">✓</span><div><b>시간 충돌이 없어요</b><p>담은 과목을 모두 들을 수 있어요.</p></div></div>'}
    ${ttGrid(key,S.flash)}
    <div class="between"><b class="num">총 ${ttCredits(key)}학점</b><span class="muted">${S.tt[key].length}과목${isMain?' · 내 시간표(★)':''}</span></div>
    <div class="card" style="padding:4px 16px">${S.tt[key].map(id=>`<button type="button" class="li" data-go="detail" data-sec="${id}"><span class="grow"><b>${C[SEC[id].code].n}</b> <span class="muted small">${SEC[id].no}분반</span><br><span class="muted small">${shortTime(id)} · ${SHORT[C[SEC[id].code].a]}</span></span>${clashWith(id,key).length?'<span class="pill bad">! 충돌</span>':''}<span class="chev">›</span></button>`).join('')}</div>
  </div>
  <div class="foot">${cf.length?`<button type="button" class="btn" data-go="alt">충돌 없는 대안 보기</button>`:''}<button type="button" class="btn ${cf.length?'weak':''}" data-go="search">과목 검색해서 담기</button></div>`;
}
function vCompare(){
  const col=k=>{const t=ttCodes(k),cf=conflicts(k).length;
    return `<div class="card" style="display:flex;flex-direction:column;gap:8px;${S.main===k?'border-color:var(--ink)':''}"><div class="between"><b style="font-size:17px">${k==='A'?'1안':'2안'}</b>${S.main===k?'<span class="pill info">★ 내 시간표</span>':''}</div>
    ${cf?`<span class="pill bad" style="align-self:flex-start">! 충돌 ${cf}건</span>`:'<span class="pill ok" style="align-self:flex-start">✓ 충돌 없음</span>'}
    <div class="small">${t.length}과목 · ${ttCredits(k)}학점</div>
    <div class="small muted">경제 ${t.filter(c=>C[c].g!=='x'&&/^ECO/.test(c)).reduce((a,c)=>a+C[c].cr,0)} · 심리 ${t.filter(c=>/^PSY/.test(c)).reduce((a,c)=>a+C[c].cr,0)} · 교양 ${t.filter(c=>/^UCC/.test(c)).reduce((a,c)=>a+C[c].cr,0)}</div>
    <div class="small muted">3·4000단위 +${areaCr(t,'up')}</div>
    <div class="small muted">공강: ${DAYS.filter((_,d)=>!S.tt[k].some(id=>SEC[id].meets.some(m=>m[0]===d))).join(', ')||'없음'}</div>
    ${S.main===k?'':`<button type="button" class="btn sm" data-act="setMain" data-k="${k}">${k==='A'?'1안':'2안'}을 내 시간표로</button>`}</div>`};
  return `${top('시간표 비교')}<div class="scroll"><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${col('A')}${col('B')}</div><p class="note">내 시간표(★)로 고른 안이 홈의 "계획 반영 후" 이수율과 로드맵 2026-2 학기에 반영돼요.</p></div>`;
}
function vAlt(p){
  const key=S.ttTab,cf=conflicts(key);
  if(!cf.length)return `${top('대안 과목')}<div class="scroll"><div class="banner ok"><span>✓</span><div><b>시간 충돌이 없어요</b><p>지금 시간표에는 바꿀 과목이 없어요.</p></div></div></div>`;
  const pair=cf[0];const target=p.t&&pair.includes(p.t)?p.t:pair[0];const other=pair.find(x=>x!==target);
  const tc=SEC[target].code,tx=C[tc];
  const without=S.tt[key].filter(i=>i!==target);
  const clash=sid=>{const m=SEC[sid].meets.map(x=>x.join('-'));return without.filter(i=>SEC[i].meets.some(x=>m.includes(x.join('-'))))};
  const sameSecs=Object.values(SEC).filter(x=>x.code===tc&&x.id!==target);
  const fixed=['ec','pc'].includes(tx.a);
  const others=fixed?[]:Object.values(SEC).filter(x=>x.code!==tc&&C[x.code].a===tx.a&&!S.tt[key].some(i=>SEC[i].code===x.code)&&!C[x.code].sem);
  const pick=p.pick||null;
  const optHtml=(sc,kind)=>{const cl=clash(sc.id),x=C[sc.code];const on=pick===sc.id;
    return `<button type="button" class="opt" role="radio" aria-checked="${on}" data-act="altPick" data-sec="${sc.id}"><span class="radio" aria-hidden="true"></span><span class="grow"><span class="between"><b>${x.n} ${sc.no}분반</b>${cl.length?'<span class="pill bad">! 충돌</span>':'<span class="pill ok">✓ 충돌 없음</span>'}</span>
      <span class="muted small">${shortTime(sc.id)} · ${sc.prof} · ${x.cr}학점</span>
      <span class="tags"><span class="pill ok">✓ ${AREA_LABEL[x.a]} 인정</span>${tx.u?(x.u?'<span class="pill ok">✓ 3·4000단위 유지</span>':'<span class="pill bad">3·4000단위 −3</span>'):''}${kind==='other'&&statusOf(sc.code)?badge(statusOf(sc.code)):''}</span>
      ${kind==='other'&&S.plan.find(y=>y.c===sc.code)?`<span class="muted tiny">로드맵 ${S.plan.find(y=>y.c===sc.code).sem}에 있던 과목을 이번 학기로 당겨 와요.</span>`:''}</span></button>`};
  const picked=pick?SEC[pick]:null;
  return `${top('대안 과목')}<div class="scroll">
    <div class="card soft"><b>${C[SEC[pair[0]].code].n}</b>과 <b>${C[SEC[pair[1]].code].n}</b>의 시간이 겹쳐요 <span class="muted small">(${shortTime(pair[0])})</span></div>
    <div><div class="h3" style="margin-bottom:8px">어느 과목을 바꿀까요?</div>
    <div class="seg" role="group">${pair.map(i=>`<button type="button" data-act="altTarget" data-t="${i}" aria-pressed="${i===target}">${C[SEC[i].code].n}</button>`).join('')}</div></div>
    <div class="h2">같은 과목의 다른 분반</div>
    <div style="display:flex;flex-direction:column;gap:8px">${sameSecs.length?sameSecs.map(x=>optHtml(x,'same')).join(''):'<p class="note">다른 분반이 개설되지 않았어요.</p>'}</div>
    <div class="h2">같은 요건을 채우는 다른 과목</div>
    ${fixed?`<p class="note" style="margin:0">${tx.n}은(는) ${AREA_LABEL[tx.a]} 지정 과목이라 다른 과목으로 대신할 수 없어요. 다른 과목으로 바꾸고 싶다면 위에서 <b>${C[SEC[other].code].n}</b>을(를) 골라 보세요.</p>`
      :`<div style="display:flex;flex-direction:column;gap:8px">${others.map(x=>optHtml(x,'other')).join('')}</div><p class="note" style="margin:0">개설 시간표와 내 졸업요건을 맞춰 보고, ${AREA_LABEL[tx.a]}으로 인정되는 과목만 골랐어요.</p>`}
  </div>
  <div class="foot"><div class="sum">${picked?`<b>${tx.n} ${SEC[target].no}분반</b> → <b>${C[picked.code].n} ${picked.no}분반</b>`:'바꿀 분반이나 과목을 골라 주세요'}</div>
  <button type="button" class="btn" data-act="altApply" data-t="${target}" ${pick?'':'disabled'}>${picked?'이 과목으로 교체하기':'대안을 선택해 주세요'}</button></div>`;
}
function vSearch(p){
  const key=S.ttTab;const q=(p.q||'').trim(),tb=p.tab||'all',req=p.req||null,mine=!!p.mine,noClash=!!p.noClash;
  let list=Object.values(SEC).filter(x=>!C[x.code].sem);
  if(tb==='major')list=list.filter(x=>/^(ECO|PSY)/.test(x.code));
  if(tb==='gen')list=list.filter(x=>/^(UCC|BUS)/.test(x.code));
  if(req)list=list.filter(x=>req==='up'?C[x.code].u:C[x.code].a===req);
  if(mine)list=list.filter(x=>C[x.code].a!=='fr');
  if(noClash)list=list.filter(x=>!clashWith(x.id,key).length);
  if(q)list=list.filter(x=>C[x.code].n.includes(q)||x.code.toLowerCase().includes(q.toLowerCase())||x.prof.includes(q));
  return `${top('과목 검색')}<div class="scroll">
    <input class="search" id="sQ" type="search" placeholder="과목명, 교수명, 학수번호" value="${q.replace(/"/g,'&quot;')}" aria-label="과목 검색">
    <div class="seg" role="group">${[['all','전체'],['major','전공'],['gen','교양·일반']].map(([k,n])=>`<button type="button" data-act="sTab" data-k="${k}" aria-pressed="${tb===k}">${n}</button>`).join('')}</div>
    <div class="chips">${req?`<button type="button" class="chip" aria-pressed="true" data-act="sReq">${AREA_LABEL[req]||'3·4000단위'} ✕</button>`:''}<button type="button" class="chip" data-act="sMine" aria-pressed="${mine}">내 요건 인정만</button><button type="button" class="chip" data-act="sClash" aria-pressed="${noClash}">${key==='A'?'1안':'2안'}과 안 겹치는 것만</button></div>
    <div class="muted small">검색 결과 ${list.length}개 · 2026-2 개설</div>
    <div class="card" style="padding:4px 16px">${list.map(x=>{const cl=clashWith(x.id,key).length;const inT=S.tt[key].includes(x.id);const fav=S.fav.includes(x.code);return `<button type="button" class="li" data-go="detail" data-sec="${x.id}"><span class="grow"><b>${C[x.code].n}</b> <span class="muted small">${x.no}분반 · ${x.prof}</span><br><span class="muted small">${shortTime(x.id)} · ${C[x.code].cr}학점</span><br><span class="tags" style="margin-top:4px">${C[x.code].a==='fr'?'<span class="pill gray">요건 미인정 (일반선택)</span>':`<span class="pill ok">✓ ${SHORT[C[x.code].a]} 인정</span>`}${inT?'<span class="pill info">● 담음</span>':cl?'<span class="pill bad">! 시간 겹침</span>':''}${fav?'<span class="pill gray">♥ 관심</span>':''}</span></span><span class="chev">›</span></button>`}).join('')||'<p class="note">조건에 맞는 과목이 없어요.</p>'}</div>
  </div>`;
}
function vDetail(p){
  const key=S.ttTab;const sc=SEC[p.sec],x=C[sc.code];
  const inT=S.tt[key].includes(sc.id);const sameCode=S.tt[key].find(i=>SEC[i].code===sc.code&&i!==sc.id);
  const cl=clashWith(sc.id,key).filter(i=>i!==sameCode);
  const st=statusOf(sc.code);const fav=S.fav.includes(sc.code);
  return `${top('과목 상세',{right:`<button type="button" class="act" data-act="fav" data-c="${sc.code}" aria-pressed="${fav}">${fav?'♥ 관심 과목':'♡ 관심 담기'}</button>`})}<div class="scroll">
    <div class="row">${st?badge(st):''}<span class="muted small">${sc.code} · ${x.cr}학점</span></div>
    <div><div style="font-size:24px;font-weight:800">${x.n}</div><div class="muted">${AREA_LABEL[x.a]}</div></div>
    <div class="card" style="padding:4px 16px">
      <div class="li"><span class="grow muted">교수</span><b>${sc.prof}</b></div>
      <div class="li"><span class="grow muted">분반</span><b>${sc.no}분반</b></div>
      <div class="li"><span class="grow muted">시간</span><b>${shortTime(sc.id)}</b></div>
      <div class="li"><span class="grow muted">강의실</span><b>${sc.room}</b></div>
    </div>
    <div class="card soft" style="display:flex;flex-direction:column;gap:6px"><div class="h3">${x.a==='fr'?'내 전공 요건에는 인정되지 않아요':'내 졸업요건에 인정돼요'}</div>
      <div class="tags">${x.a==='fr'?'<span class="pill gray">일반선택 +'+x.cr+'</span>':`<span class="pill ok">✓ ${AREA_LABEL[x.a]} +${x.cr}</span>`}${x.u?`<span class="pill ok">✓ 3·4000단위 +${x.cr}</span>`:''}${/^ECO/.test(sc.code)?'<span class="pill gray">심리학 전공 미인정</span>':/^PSY/.test(sc.code)?'<span class="pill gray">경제학 전공 미인정</span>':''}</div>
      ${x.pre?`<div class="small muted">${prereqInfo(sc.code,'2026-2').t}</div>`:''}</div>
    ${inT?`<div class="banner ok"><span>✓</span><div><b>${key==='A'?'1안':'2안'}에 담겨 있어요</b></div></div>`
      :cl.length?`<div class="banner bad"><span>!</span><div><b>${cl.map(i=>C[SEC[i].code].n).join(', ')}과(와) 시간이 겹쳐요</b><p>담으면 시간 충돌이 생겨요. 대안 보기에서 바꿀 수 있어요.</p></div></div>`
      :`<div class="banner ok"><span>✓</span><div><b>${key==='A'?'1안':'2안'} 시간표와 충돌이 없어요</b></div></div>`}
    ${sameCode?`<p class="note">지금 ${key==='A'?'1안':'2안'}에는 ${SEC[sameCode].no}분반이 담겨 있어요. 추가하면 이 분반으로 바뀌어요.</p>`:''}
  </div>
  <div class="foot">${inT?`<button type="button" class="btn weak" data-act="ttRemove" data-sec="${sc.id}">${key==='A'?'1안':'2안'}에서 빼기</button>`:`<button type="button" class="btn" data-act="ttAdd" data-sec="${sc.id}">${sameCode?'이 분반으로 바꾸기':(key==='A'?'1안':'2안')+' 시간표에 추가하기'}</button>`}
  ${st==='done'||st==='now'||(st==='plan')?'':`<button type="button" class="btn weak" data-act="planSheet" data-c="${sc.code}">로드맵 계획에 담기</button>`}</div>`;
}

/* ---------- 화면: 내 정보 / 온보딩 ---------- */
function vMe(){
  const pf=S.profile;
  return `${top('내 정보',{big:true})}<div class="scroll">
    ${S.onboarded?`<div class="card row" style="gap:14px"><div class="empty" style="padding:0"><div class="ico" aria-hidden="true">👤</div></div><div><div class="h3">김연세</div><div class="muted small">${profileText(pf)}</div></div></div>
    <div class="card" style="padding:4px 16px">
      ${[['입학 연도',pf.year+'년'],['현재 학년',pf.grade==='5'?'5학년 이상':pf.grade+'학년'],['본전공',pf.major],['추가 이수과정',pf.track==='없음'?'없음 (단일전공)':pf.track],...(hasSecond(pf.track)?[[SECOND_LABEL[pf.track],pf.second||'-']]:[]),['목표 졸업 학기',pf.grad.replace('-','년 ')+'학기']].map(([a,b])=>`<div class="li"><span class="grow muted">${a}</span><b>${b}</b></div>`).join('')}
    </div>
    <button type="button" class="btn weak" data-go="setup">학적 정보 수정</button>
    <button type="button" class="card li" style="border:1px solid var(--line);padding:14px 16px" data-go="register"><span class="grow"><b>이수 내역 관리</b><br><span class="muted small">등록한 과목 ${S.registered.length}개 확인 및 수정</span></span><span class="chev">›</span></button>`
    :`<div class="card soft" style="display:flex;flex-direction:column;gap:10px"><div class="h3">학적 정보가 아직 없어요</div><button type="button" class="btn" data-go="setup">학적 설정하러 가기</button></div>`}
    <button type="button" class="card li" style="border:1px solid var(--line);padding:14px 16px" data-go="source"><span class="grow"><b>정보 출처 및 유의사항</b></span><span class="chev">›</span></button>
    ${UT_MODE?`<div class="card soft" style="display:flex;flex-direction:column;gap:8px"><div class="h3">UT 진행 도구</div><p class="note" style="margin:0">과제 시작 상태로 바로 맞춰요. 휴대폰에서 진행할 때 쓰세요.</p>
      <div class="chips">${[1,2,3,4,5].map(n=>`<button type="button" class="chip" data-ut="${n}">T${n} 시작</button>`).join('')}</div></div>`:''}
  </div>`;
}
function vSource(){
  return `${top('정보 출처 및 유의사항')}<div class="scroll"><div class="card" style="display:flex;flex-direction:column;gap:8px">
    <div class="h3">이 화면은 프로토타입이에요</div>
    <p class="note" style="margin:0">과목, 분반, 교수, 강의실, 학점은 UT를 위한 예시 데이터예요. 실제 서비스에서는 학과 졸업요건 안내, 대학요람, 수강편람을 출처로 표시하고 최종 갱신일을 함께 보여 줘요.</p>
    <p class="note" style="margin:0">미래 학기 계획은 과거 개설 이력을 참고한 잠정 계획이며, 실제 졸업 가능 여부를 보장하지 않아요.</p></div></div>`;
}
function profileText(pf,sep=' · '){
  const a=[`${pf.year.slice(2)}학번`,`${pf.grade==='5'?'5학년 이상':pf.grade+'학년'}`];
  if(hasSecond(pf.track)&&pf.second){a.push(`${pf.major} 1전공`,pf.track==='복수전공'?`${pf.second} 2전공(복수전공)`:`${pf.second} ${pf.track}`)}else a.push(pf.major);
  return a.join(sep);
}
function setupOptions(k,d){
  const sel=v=>d[k]===v?'selected':'';
  let opts=SETUP_FIELDS.find(f=>f[0]===k)[2];
  if(k==='second'&&d.track==='연계전공')opts=LINKED.map(v=>[v,v]);
  if(k==='major'||(k==='second'&&d.track!=='연계전공'))
    return opts.map(([g,list])=>`<optgroup label="${g}">${list.filter(v=>k!=='second'||v!==d.major).map(v=>`<option value="${v}" ${sel(v)}>${v}</option>`).join('')}</optgroup>`).join('');
  return opts.map(([v,t])=>`<option value="${v}" ${sel(v)}>${t}</option>`).join('');
}
function vSetup(p){
  const d=p.draft||Object.assign({},S.profile);
  const fields=SETUP_FIELDS.filter(f=>f[0]!=='second'||hasSecond(d.track));
  const missing=fields.filter(f=>!d[f[0]]).length;
  const onboarding=!S.onboarded;
  return `${top(onboarding?'학적 설정':'학적 정보 수정')}<div class="scroll">
    ${onboarding?'<div class="steps"><i class="on"></i><i></i><span>1 / 2</span></div>':''}
    <div><div style="font-size:21px;font-weight:800">학적 정보를 설정해 주세요</div><div class="muted small">맞춤형 졸업 계획을 위한 기본 정보예요.</div></div>
    ${fields.map(([k,n])=>`<div class="field"><label for="f-${k}">${k==='second'?SECOND_LABEL[d.track]:n}</label><select id="f-${k}" data-field="${k}" class="${d[k]?'':'unset'}"><option value="" ${d[k]?'':'selected'} disabled>선택해 주세요</option>${setupOptions(k,d)}</select></div>`).join('')}
  </div>
  <div class="foot"><div class="sum">${missing?`${missing}개 항목을 더 골라 주세요`:'모두 입력했어요'}</div><button type="button" class="btn" data-act="setupNext" ${missing?'disabled':''}>${onboarding?'다음':'저장하기'}</button></div>`;
}
function vRegister(p){
  const q=(p.q||'').trim(),f=p.f||'all';
  const sel=p.sel||(p.onboard?[]:S.registered.filter(k=>REG_LIST.includes(k)));
  const list=REG_LIST.filter(k=>f==='all'||(f==='econ'&&/^ECO/.test(k))||(f==='psy'&&/^PSY/.test(k))||(f==='gen'&&!/^(ECO|PSY)/.test(k))).filter(k=>!q||C[k].n.includes(q)||k.toLowerCase().includes(q.toLowerCase()));
  const cr=sel.reduce((a,k)=>a+C[k].cr,0);
  return `${top(p.onboard?'이수 과목 등록':'이수 내역 관리')}<div class="scroll">
    ${p.onboard?'<div class="steps"><i class="on"></i><i class="on"></i><span>2 / 2</span></div>':''}
    <div><div style="font-size:21px;font-weight:800">들은 과목을 등록해 주세요</div><div class="muted small">남은 졸업요건 계산에 쓰여요.</div></div>
    <input class="search" id="rQ" type="search" placeholder="과목명 또는 학수번호 검색" value="${q.replace(/"/g,'&quot;')}" aria-label="과목 검색">
    <div class="chips">${[['all','전체'],['econ','경제학'],['psy','심리학'],['gen','교양·기타']].map(([k,n])=>`<button type="button" class="chip" data-act="regF" data-f="${k}" aria-pressed="${f===k}">${n}</button>`).join('')}</div>
    <div style="display:flex;flex-direction:column;gap:8px">${list.map(k=>{const on=sel.includes(k);return `<button type="button" class="opt" role="checkbox" aria-checked="${on}" data-act="regToggle" data-c="${k}"><span class="check" aria-hidden="true">${on?'✓':''}</span><span class="grow"><b>${C[k].n}</b><span class="muted small">${k} · ${C[k].cr}학점 · ${AREA_LABEL[C[k].a]}</span></span></button>`}).join('')||'<p class="note">검색 결과가 없어요.</p>'}</div>
  </div>
  <div class="foot"><div class="sum">${sel.length?`선택한 과목 <b>${sel.length}개 · ${cr}학점</b>: ${sel.map(k=>C[k].n).join(', ')}`:'아직 선택한 과목이 없어요'}</div>
  <button type="button" class="btn" data-act="regDone" ${sel.length?'':'disabled'}>${sel.length?`${sel.length}과목 등록하기`:'과목을 선택해 주세요'}</button>
  ${p.onboard?'<button type="button" class="link" data-act="regLater" style="align-self:center">나중에 등록하기</button>':''}</div>`;
}

const VIEWS={home:vHome,req:vReq,area:vArea,roadmap:vRoadmap,course:vCourse,addplan:vAddPlan,tt:vTT,compare:vCompare,alt:vAlt,search:vSearch,detail:vDetail,me:vMe,setup:vSetup,register:vRegister,source:vSource};

function render(y,focusSel){
  const c=cur();
  const active=document.activeElement&&document.activeElement.id;
  const caret=document.activeElement&&document.activeElement.selectionStart;
  $screen.innerHTML=VIEWS[c.s](c.p||{});
  renderTabs();
  const sc=$screen.querySelector('.scroll');
  if(sc&&typeof y==='number')sc.scrollTop=y;
  if(active&&/^(addQ|sQ|rQ)$/.test(active)){const el=document.getElementById(active);if(el){el.focus();try{el.setSelectionRange(caret,caret)}catch(e){}}}
  if(c.s==='roadmap'&&c.p&&c.p.scrollTo){const el=document.getElementById('sem-'+c.p.scrollTo);if(el&&sc){sc.scrollTop=el.offsetTop-sc.offsetTop-8}delete c.p.scrollTo}
  if(S.flash.length){setTimeout(()=>{S.flash=[]},3500)}
}
function rerender(){saveScroll();render(cur().y)}

/* ---------- 동작 ---------- */
function semSheet(code){
  let pick=null;
  const draw=()=>{$layer.innerHTML=`<div class="dim" data-act="closeSheet"><div class="sheet" role="dialog" aria-label="로드맵 계획에 담기">
    <div class="h3">${C[code].n}을(를) 어느 학기에 담을까요?</div>
    ${FUTURE.map(s=>`<button type="button" class="opt" role="radio" aria-checked="${pick===s}" data-pick="${s}"><span class="radio" aria-hidden="true"></span><span class="grow"><b>${semLabel(s)}</b><span class="muted small">${prereqInfo(code,s).t}</span></span></button>`).join('')}
    <button type="button" class="btn" id="sheetOk" ${pick?'':'disabled'}>${pick?pick+' 계획에 담기':'학기를 골라 주세요'}</button>
    <button type="button" class="btn weak" data-act="closeSheet">취소</button></div></div>`;
    $layer.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{pick=b.dataset.pick;draw()});
    const ok=document.getElementById('sheetOk');ok.onclick=()=>{if(!pick)return;addPlans([code],pick,true)};
  };
  draw();
}
function addPlans(codes,sem,fromDetail){
  codes.forEach(c=>{const ex=S.plan.find(x=>x.c===c);if(ex){ex.st='plan';ex.sem=sem}else S.plan.push({c,sem,st:'plan'})});
  closeSheet();
  S.open[sem]=true;S.flash=codes.slice();
  S.stack=[{s:'roadmap',p:{scrollTo:sem}}];
  render(0);
  toast(`${codes.map(c=>C[c].n).join(', ')}을(를) ${sem} 계획에 추가했어요`,{t:'되돌리기',fn:()=>{S.plan=S.plan.filter(x=>!(codes.includes(x.c)&&x.sem===sem&&x.st==='plan'));rerender()}});
}
function startUT(n){
  closeSheet();
  if(n===1)S=fresh(1);
  else if(n===2)S=fresh(2);
  else S=fresh(3);
  render(0);
  toast(`T${n} 시작 상태로 맞췄어요`);
}

document.addEventListener('click',e=>{
  const ut=e.target.closest('[data-ut]');if(ut){startUT(+ut.dataset.ut);return}
  const t=e.target.closest('[data-tab],[data-go],[data-act]');if(!t||!t.closest('#phone'))return;
  if(t.disabled)return;
  const c=cur(),p=c.p||(c.p={});
  if(t.dataset.tab){tab(t.dataset.tab);return}
  if(t.dataset.go){
    const g=t.dataset.go;
    if(g==='area')return go('area',{a:t.dataset.a});
    if(g==='course')return go('course',{c:t.dataset.c});
    if(g==='addplan')return go('addplan',{sem:t.dataset.sem,sel:[]});
    if(g==='detail')return go('detail',{sec:t.dataset.sec});
    if(g==='search')return go('search',{req:t.dataset.req||null});
    if(g==='setup')return go('setup',{});
    if(g==='register')return go('register',{onboard:false});
    if(['roadmap','home','req','tt','me'].includes(g))return tab(g);
    return go(g,{});
  }
  const a=t.dataset.act;
  switch(a){
    case 'back':back();break;
    case 'closeSheet':if(e.target===t||t.tagName==='BUTTON')closeSheet();break;
    case 'toggleSem':S.open[t.dataset.sem]=!S.open[t.dataset.sem];rerender();break;
    case 'rmFilter':S.rmFilter=t.dataset.f;rerender();break;
    case 'togglePre':S.showPre=!S.showPre;rerender();break;
    case 'addF':p.f=t.dataset.f;rerender();break;
    case 'addToggle':{const k=t.dataset.c;p.sel=p.sel||[];p.sel=p.sel.includes(k)?p.sel.filter(x=>x!==k):p.sel.concat(k);rerender();break}
    case 'addPlan':if(p.sel&&p.sel.length)addPlans(p.sel,p.sem||'2027-1');break;
    case 'savePlan':{const pl=S.plan.find(x=>x.c===t.dataset.c);const from=pl.sem;pl.sem=p.sel;S.open[p.sel]=true;S.flash=[pl.c];S.stack=[{s:'roadmap',p:{scrollTo:p.sel}}];render(0);
      toast(`${C[pl.c].n}을(를) ${from}에서 ${pl.sem}(으)로 옮겼어요`,{t:'되돌리기',fn:()=>{pl.sem=from;rerender()}});break}
    case 'removePlan':{const k=t.dataset.c;const old=S.plan.find(x=>x.c===k);S.plan=S.plan.filter(x=>x.c!==k);back();toast(`${C[k].n}을(를) 계획에서 뺐어요`,{t:'되돌리기',fn:()=>{S.plan.push(old);rerender()}});break}
    case 'adoptRec':addPlans([t.dataset.c],p.sel||S.plan.find(x=>x.c===t.dataset.c).sem);break;
    case 'ttTab':S.ttTab=t.dataset.k;rerender();break;
    case 'setMain':S.main=t.dataset.k;S.ttTab=t.dataset.k;rerender();toast(`${S.main==='A'?'1안':'2안'}을 내 시간표로 정했어요. 홈과 로드맵에 반영돼요.`);break;
    case 'altTarget':p.t=t.dataset.t;p.pick=null;rerender();break;
    case 'altPick':p.pick=t.dataset.sec;rerender();break;
    case 'altApply':{const key=S.ttTab,from=t.dataset.t,to=p.pick;const before=S.tt[key].slice();
      S.tt[key]=S.tt[key].map(i=>i===from?to:i);
      const sameCourse=SEC[from].code===SEC[to].code;
      // 로드맵에서 당겨 온 과목은 계획에서 정리
      S.flash=[to];const left=conflicts(key).length;
      S.stack=[{s:'tt'}];render(0);
      toast(sameCourse?`${C[SEC[from].code].n}을(를) ${SEC[to].no}분반으로 교체했어요. ${left?'아직 충돌 '+left+'건이 있어요.':'시간 충돌이 없어요.'}`:`${C[SEC[from].code].n} 대신 ${C[SEC[to].code].n}을(를) 담았어요. ${left?'아직 충돌 '+left+'건이 있어요.':'시간 충돌이 없어요.'}`,{t:'되돌리기',fn:()=>{S.tt[key]=before;rerender()}});break}
    case 'sTab':p.tab=t.dataset.k;rerender();break;
    case 'sReq':p.req=null;rerender();break;
    case 'sMine':p.mine=!p.mine;rerender();break;
    case 'sClash':p.noClash=!p.noClash;rerender();break;
    case 'fav':{const k=t.dataset.c;const on=S.fav.includes(k);S.fav=on?S.fav.filter(x=>x!==k):S.fav.concat(k);rerender();toast(on?'관심 과목에서 뺐어요':`${C[k].n}을(를) 관심 과목에 담았어요`);break}
    case 'ttAdd':{const key=S.ttTab,id=t.dataset.sec,code=SEC[id].code;const before=S.tt[key].slice();
      const same=S.tt[key].find(i=>SEC[i].code===code);
      S.tt[key]=same?S.tt[key].map(i=>i===same?id:i):S.tt[key].concat(id);
      const cf=clashWith(id,key);S.flash=[id];S.stack=[{s:'tt'}];render(0);
      const nm=key==='A'?'1안':'2안';
      toast(`${C[code].n}${same?'을(를) '+SEC[id].no+'분반으로 바꿨어요':'을(를) 2026-2 시간표 '+nm+'에 추가했어요'}. ${cf.length?'시간 충돌 '+conflicts(key).length+'건이 있어요.':'시간 충돌이 없어요.'}`,{t:'되돌리기',fn:()=>{S.tt[key]=before;rerender()}});break}
    case 'ttRemove':{const key=S.ttTab,id=t.dataset.sec;const before=S.tt[key].slice();S.tt[key]=S.tt[key].filter(i=>i!==id);S.stack=[{s:'tt'}];render(0);toast(`${C[SEC[id].code].n}을(를) 시간표에서 뺐어요`,{t:'되돌리기',fn:()=>{S.tt[key]=before;rerender()}});break}
    case 'planSheet':semSheet(t.dataset.c);break;
    case 'setupNext':{const d=p.draft||Object.assign({},S.profile);if(!hasSecond(d.track))d.second='';S.profile=d;
      if(!S.onboarded){go('register',{onboard:true,sel:[]})}else{back();toast('학적 정보를 저장했어요')}break}
    case 'regF':p.f=t.dataset.f;rerender();break;
    case 'regToggle':{const k=t.dataset.c;p.sel=p.sel||(p.onboard?[]:S.registered.filter(x=>REG_LIST.includes(x)));p.sel=p.sel.includes(k)?p.sel.filter(x=>x!==k):p.sel.concat(k);rerender();break}
    case 'regDone':{const sel=p.sel||[];const wasOn=S.onboarded;S.onboarded=true;S.registered=Array.from(new Set(S.registered.concat(sel)));
      if(!wasOn||p.onboard){S.stack=[{s:'home'}];render(0)}else back();toast(`${sel.map(k=>C[k].n).join(', ')} ${sel.length}과목을 이수 내역에 등록했어요`);break}
    case 'regLater':S.onboarded=true;S.stack=[{s:'home'}];render(0);toast('이수 과목은 내 정보에서 언제든 등록할 수 있어요');break;
  }
});
document.addEventListener('change',e=>{
  const el=e.target;if(!el.closest||!el.closest('#phone'))return;const c=cur(),p=c.p||(c.p={});
  if(el.id==='jump'&&el.value){S.open[el.value]=true;c.p={scrollTo:el.value};render(0);return}
  if(el.id==='addSem'){p.sem=el.value;rerender();return}
  if(el.id==='semSel'){p.sel=el.value;rerender();return}
  if(el.dataset.field){const f=el.dataset.field;p.draft=p.draft||Object.assign({},S.profile);const prevTrack=p.draft.track;p.draft[f]=el.value;
    if(f==='track'&&(!hasSecond(el.value)||(prevTrack==='연계전공')!==(el.value==='연계전공')))p.draft.second='';
    if(f==='major'&&p.draft.second===el.value)p.draft.second='';
    rerender();return}
});
document.addEventListener('input',e=>{
  const el=e.target;const c=cur(),p=c.p||(c.p={});
  if(['addQ','sQ','rQ'].includes(el.id)){p.q=el.value;if(!e.isComposing)rerender()}
});
document.addEventListener('compositionend',e=>{const el=e.target;if(['addQ','sQ','rQ'].includes(el.id)){cur().p.q=el.value;rerender()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$layer.innerHTML)closeSheet()});

render(0);
