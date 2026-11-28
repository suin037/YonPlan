import './style.css';
import { D, C, loadData, NOW_TERM, ST, badge, LINKED, CONVERGENCE, MICRO, SUPPORTED, SETUP_FIELDS, DEPTS, TRACK_TYPES, TRACK_DEPT_LABEL, needsDept, tracksOf, trackNames } from './data.js';
import { buildReq, assign, areaOf, areaById, groupOf, allAreas, ruleText, semesters, prereqs } from './model.js';
import { demoState } from './demo.js';
import { readImage } from './ocr.js';

// ?ut 를 주소에 붙이면 UT(사용성 테스트) 진행 도구가 보여요. 예: https://.../YonPlan/?ut
const UT_MODE = new URLSearchParams(location.search).has('ut');
if (UT_MODE) document.body.classList.add('ut-mode');

/* ---------- 상태와 저장 ----------
   로그인 없이 이 브라우저(localStorage)에만 저장해요.
   내 정보(real)와 체험 데이터(demo)는 따로 저장돼서 서로 덮어쓰지 않아요.
   taken: 등록한 과목 [{c: 학수번호, sem: '2025-1'}]. 이번 학기(2026-2) 과목은 '수강 중'이에요. */
const KEY = { mode: 'yonplan.v1.mode', real: 'yonplan.v1.real', demo: 'yonplan.v4.demo' }; // 예시 데이터를 바꾸면 demo 버전을 올려 새로 불러오게 함
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } }
};
const SAVED_FIELDS = ['onboarded', 'name', 'profile', 'taken', 'plan', 'extra', 'showPre', 'open', 'guideSeen'];
function blank() {
  return { onboarded: false, name: '', profile: { year: '', grade: '', major: '', tracks: [], grad: '' }, taken: [], plan: [], extra: {}, showPre: true, open: {}, guideSeen: false };
}
function withUi(data, mode) {
  const o = Object.assign(blank(), data || {}, { mode, rmFilter: 'all', stack: [{ s: 'home' }], flash: [] });
  // 예전 버전에서 시간표(tt)에 담았던 과목은 이번 학기 수강 중으로 옮겨요
  if (data && data.tt && !data.migratedTT) {
    const ids = (data.tt[data.main || 'A'] || []);
    ids.forEach(id => { const code = id.split('-')[0]; if (!o.taken.some(x => x.c === code)) o.taken.push({ c: code, sem: NOW_TERM }); });
    o.migratedTT = true;
  }
  return o;
}
function demoFresh() { const d = demoState(); return Object.assign(blank(), d, { onboarded: true, guideSeen: true, open: { [NOW_TERM]: true, '2027-1': true, '2027-2': true } }); }
let S = withUi(null, 'new');
function save() {
  if (S.mode !== 'real' && S.mode !== 'demo') return; // UT 진행 중이나 첫 선택 전에는 저장하지 않아요
  const o = {}; SAVED_FIELDS.forEach(k => { o[k] = S[k]; });
  store.set(KEY[S.mode], o); store.set(KEY.mode, S.mode);
}
function startMode(mode, opt = {}) {
  closeSheet();
  if (mode === 'demo') S = withUi(opt.reset ? demoFresh() : (store.get(KEY.demo) || demoFresh()), 'demo');
  else S = withUi(opt.reset ? null : store.get(KEY.real), 'real');
  if (opt.go) S.stack = [{ s: opt.go, p: {} }];
  save(); render(0);
}

/* ---------- 계산 도우미 ---------- */
let R = buildReq(null);
/* 과목 정보: 앱 데이터에 없는 과목은 사용자가 확인 화면에서 적은 이름·학점을 써요 */
const CC = code => { const x = C(code); const e = S.extra && S.extra[code]; return e && !D.courses[code] ? { ...x, n: e.n || code, cr: e.cr || 3 } : x; };
const pastCodes = () => S.taken.filter(x => x.sem < NOW_TERM).map(x => x.c);
const nowCodes = () => S.taken.filter(x => x.sem === NOW_TERM).map(x => x.c);
const allCodes = () => S.taken.map(x => x.c);
const semOf = code => { const x = S.taken.find(t => t.c === code); return x ? x.sem : ''; };
const isTaken = code => S.taken.some(t => t.c === code);
const isDone = code => S.taken.some(t => t.c === code && t.sem < NOW_TERM);
const sumCr = codes => codes.reduce((a, k) => a + CC(k).cr, 0);
const fmt = n => Math.round(n * 10) / 10;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const visiblePlan = () => S.plan.filter(p => !isTaken(p.c));
const planCredits = () => sumCr(visiblePlan().map(p => p.c));
const futureSems = () => semesters(S.profile).filter(s => s.k === 'future').map(s => s.id);
const semLabel = id => { const x = semesters(S.profile).find(s => s.id === id); return x ? `${id} · ${x.g}` : id; };
const areaLabel = code => { const a = areaOf(R, code); return a ? a.label : '일반선택'; };
const offered = code => D.secByCode[code] ? D.secByCode[code].length : 0;

/* 아직 계획하지 않은 지정 과목을 추천해요. 선수과목이 있으면 그 다음 학기에 놓아요. */
function recs() {
  if (!R.ok) return [];
  const fut = futureSems(); if (!fut.length) return [];
  const planned = S.plan.map(p => p.c);
  const out = [];
  const semFor = c => { const p = S.plan.find(x => x.c === c); if (p) return p.sem; const r = out.find(x => x.c === c); return r ? r.sem : null; };
  const must = [...new Set(allAreas(R).flatMap(a => a.must))].filter(c => !isTaken(c) && !planned.includes(c));
  for (let pass = 0; pass < 3; pass++) {
    must.forEach(c => {
      if (out.some(x => x.c === c)) return;
      let idx = 0;
      for (const [p] of prereqs(c)) {
        if (isTaken(p)) continue;
        const s = semFor(p); if (s === null) { if (must.includes(p)) return; else continue; }
        idx = Math.max(idx, fut.indexOf(s) + 1);
      }
      if (idx < fut.length) out.push({ c, sem: fut[idx], st: 'rec' });
    });
  }
  return out;
}
function statusOf(code) {
  if (isDone(code)) return 'done';
  if (nowCodes().includes(code)) return 'now';
  if (S.plan.some(x => x.c === code)) return 'plan';
  if (recs().some(x => x.c === code)) return 'rec';
  return null;
}
/* 선수과목 순서 확인: 필수(R)는 못 지키면 경고, 권장(S)은 안내만 */
function prereqInfo(code, sem) {
  const list = prereqs(code);
  if (!list.length) return { ok: true, soft: false, t: '등록된 선수과목이 없어요.' };
  const now = nowCodes();
  const miss = [], okList = [];
  list.forEach(([p, t]) => {
    const n = CC(p).n;
    if (isDone(p)) okList.push(`${n} 이수`);
    else if (now.includes(p) && sem > NOW_TERM) okList.push(`${n} ${NOW_TERM} 수강 중`);
    else { const pl = S.plan.find(x => x.c === p); if (pl && pl.sem < sem) okList.push(`${n} ${pl.sem} 계획`); else miss.push([n, t]); }
  });
  const hard = miss.filter(m => m[1] === 'R');
  if (!miss.length) return { ok: true, soft: false, t: `선수과목: ${okList.join(', ')}` };
  return {
    ok: !hard.length, soft: !hard.length,
    t: (hard.length ? `필수 선수과목 ${hard.map(m => m[0]).join(', ')}을(를) 먼저 들어야 해요.` : `${miss.map(m => m[0]).join(', ')}을(를) 먼저 들으면 좋아요(권장).`) + (okList.length ? ` (${okList.join(', ')})` : '')
  };
}

/* ---------- 내비게이션 ---------- */
const $screen = document.getElementById('screen'), $tabs = document.getElementById('tabs'), $layer = document.getElementById('layer');
const cur = () => S.stack[S.stack.length - 1];
function saveScroll() { const sc = $screen.querySelector('.scroll'); if (sc && cur()) cur().y = sc.scrollTop; }
function go(s, p, opt) { saveScroll(); opt = opt || {}; if (opt.replace) S.stack.pop(); S.stack.push({ s, p: p || {} }); render(opt.toY); }
function back() { saveScroll(); if (S.stack.length > 1) { S.stack.pop(); render(cur().y || 0); } }
function tab(t) { saveScroll(); S.stack = [{ s: t }]; render(0); }
const TAB_OF = { home: 'home', miss: 'home', req: 'home', area: 'home', roadmap: 'roadmap', course: 'roadmap', addplan: 'roadmap', me: 'me', setup: 'me', register: 'me', guide: 'me', ocr: 'me', source: 'me' };

let toastTimer;
function toast(msg, action) {
  clearTimeout(toastTimer);
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status');
  t.innerHTML = `<span class="grow">${msg}</span>${action ? `<button type="button">${action.t}</button>` : ''}`;
  document.querySelectorAll('.toast').forEach(x => x.remove());
  document.getElementById('phone').appendChild(t);
  if (action) t.querySelector('button').onclick = () => { t.remove(); action.fn(); };
  toastTimer = setTimeout(() => t.remove(), action ? 5000 : 3200);
}
function closeSheet() { $layer.innerHTML = ''; }

const ICONS = {
  home: '<path d="M4 11l8-7 8 7v9h-5v-6h-6v6H4z"/>',
  roadmap: '<rect x="4" y="12" width="4" height="8" rx="1"/><rect x="10" y="7" width="4" height="13" rx="1"/><rect x="16" y="4" width="4" height="16" rx="1"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6z"/>'
};
const TABS = [['roadmap', '로드맵'], ['home', '홈'], ['me', '내 정보']];
function renderTabs() {
  // 지금 보고 있는 화면이 속한 탭을 켜요(홈에서 로드맵으로 넘어가면 로드맵 탭)
  const active = TAB_OF[cur().s] || TAB_OF[S.stack[0].s];
  // Figma '연플랜/하단 탭바'(373:3294): 탭 109.667×64, 선택 배경 93.667×54 알약
  $tabs.innerHTML = TABS.map(([k, n]) => { const on = active === k; const ic = { roadmap: 'tab-roadmap', home: 'tab-home', me: 'tab-me' }[k] + (on ? '-on' : '');
    return `<button type="button" class="f-tab ${on ? 'bold' : ''}" data-tab="${k}" ${on ? 'aria-current="page"' : ''}>${on ? '<span class="f-tab-bg"></span>' : ''}<img src="${import.meta.env.BASE_URL}figma/${ic}.svg" alt="" width="24" height="24"><span class="f-tab-l">${n}</span></button>`; }).join('');
}

/* ---------- 공통 조각 ---------- */
const top = (title, opt) => { opt = opt || {}; return `<header class="top ${opt.big ? 'big' : ''}">${opt.big ? '' : `<button type="button" class="back" data-act="back" aria-label="뒤로 가기"><img src="${import.meta.env.BASE_URL}figma/back.svg" alt="" width="10" height="17"></button>`}<h1>${title}</h1>${opt.right || ''}</header>`; };
const demoBar = () => S.mode === 'demo' ? `<div class="demo-bar"><span>예시 학생 데이터로 체험 중이에요</span><button type="button" data-act="demoEnd">체험 끝내기</button></div>` : '';
const SETUP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3L1 9l11 6 9-4.9V17h2V9z"/><path d="M5 13.2V17c0 1.7 3.1 3 7 3s7-1.3 7-3v-3.8l-7 3.8z"/></svg>';
const needSetup = (title, what) => `${top(title, { big: true })}<div class="scroll"><div class="empty"><div class="ico" aria-hidden="true">${SETUP_ICON}</div><div class="h3">학적 정보를 먼저 입력해 주세요</div><p class="note">입학 연도, 전공, 이수과정을 입력하면 내 기준으로 ${what}을(를) 보여 드립니다.</p><button type="button" class="btn sm" data-go="setup">학적 정보 입력하기</button></div></div>`;
function barHtml(now, after, need) { if (!need) return ''; const a = Math.min(now, need) / need * 100, b = Math.max(0, Math.min(after, need) - Math.min(now, need)) / need * 100; return `<div class="bar" role="img" aria-label="${need}학점 중 ${fmt(now)}학점 이수, 수강 중·계획 반영 시 ${fmt(after)}학점"><i style="width:${a}%"></i><i class="plan" style="width:${b}%"></i></div>`; }
const CAT_NAME = { 전기: '전공기초', 전필: '전공필수', 전선: '전공선택', 대교: '대학교양', 공기: '교양기초', 계기: '계열기초', 일반: '일반선택', RC: 'RC교육' };
const checkPill = a => a && a.check ? '<span class="pill gray" title="학교 자료에서 확인 중인 항목">확인 중</span>' : '';
function pendingCard(r) {
  const list = Object.keys(SUPPORTED).join(' · ');
  const why = r.reason === 'cohort' ? `${S.profile.year}학번 졸업요건은 준비 중입니다. 현재 2020~2026학번을 지원합니다.`
    : `${esc(S.profile.major)} 졸업요건은 준비 중입니다. 현재 ${list} 전공을 지원합니다.`;
  return `<div class="card" style="display:flex;flex-direction:column;gap:8px"><div class="row"><span class="pill gray">준비 중</span><div class="h3">졸업요건 데이터를 준비하고 있습니다</div></div><p class="note" style="margin:0">${why} 이수 과목 등록과 로드맵은 그대로 사용할 수 있습니다.</p></div>`;
}

/* ---------- 화면: 홈 ---------- */
function vHome() {
  if (!S.onboarded) {
    return `${top('홈', { big: true })}<div class="scroll">
      <div class="empty" style="padding-top:56px"><div class="brand lg" aria-label="Yon-Plan"><img src="${import.meta.env.BASE_URL}logo.svg" alt="" class="brand-mark"><img src="${import.meta.env.BASE_URL}wordmark.svg" alt="Yon-Plan" class="brand-word"></div><div class="h3" style="margin-top:12px">학적 정보를 먼저 입력해 주세요</div>
      <p class="note" style="margin:0">입학 연도, 전공, 이수과정을 입력하고 들은 과목을 등록하면<br>졸업요건 이수율과 남은 과목을 정리해 드립니다.</p>
      <button type="button" class="btn sm" data-go="setup">학적 정보 입력하기</button></div></div>`;
  }
  // 연세포탈처럼 이미 이수한 과목만 셉니다(이번 학기 수강 중은 넣지 않음)
  const d = pastCodes();
  const A0 = assign(R, d);
  const need = R.ok ? R.total : 0, tot = A0.total;
  // Figma 'LF/홈'(81:414) 그대로: 프로필 헤더 → 전체 이수율 박스 → 졸업요건 이수율 → 범례 → 놓치기 쉬운 항목
  const fbar = (a, n) => n ? `<div class="f-bar"><i style="width:${Math.min(a, n) / n * 100}%"></i></div>` : '';
  const reqRow = (label, a, n, go) => `<button type="button" class="f-req-row" ${go}><span class="f-req-l"><b>${label}</b><span>${fmt(a)} / ${n}학점</span></span>${fbar(a, n)}</button>`;
  const reqBlock = !R.ok ? pendingCard(R) : `<section class="f-req">
      <div class="f-title"><h2>졸업요건 이수율</h2><button type="button" class="f-more" data-go="req">졸업요건 자세히 <span>›</span></button></div>
      ${R.groups.map(g => g.pending ? `<div class="f-req-row"><span class="f-req-l"><b>${esc(g.n)}</b><span>준비 중</span></span></div>` : reqRow(esc(g.n.includes(' · ') ? g.n.replace(' · ', ' (') + ')' : g.n), A0.groupCr[g.k] || 0, g.need, 'data-go="req"')).join('')}
      ${reqRow('3·4000단위', A0.u3, R.u3000, 'data-go="area" data-a="U3000"')}
    </section>`;
  const missAll = missList(), miss = missAll.slice(0, 3);
  const pct = need ? Math.round(tot / need * 100) : null;
  return `<div class="scroll f-home">
    <header class="f-profile"><img class="f-avatar" src="${import.meta.env.BASE_URL}figma/profile.svg" alt="" width="49" height="49">
      <div class="f-profile-t"><div class="f-name-row"><h1>${esc(S.name) || '나의 졸업 계획'}</h1><span class="f-grade">${S.profile.grade === '5' ? '5학년 이상' : S.profile.grade + '학년'}</span></div><p>${homeProfile(S.profile)}</p></div></header>
    <div class="f-total">
      <span class="f-total-l">전체 이수율</span>
      <span class="f-total-pct">${pct === null ? '—' : pct + '%'}</span>
      <span class="f-total-r"><b>${fmt(tot)} / ${need || '—'}학점</b><span>${gradDate(S.profile.grad)} 졸업 예정</span></span>
      ${need ? `<div class="f-total-bar"><i style="width:${Math.min(tot, need) / need * 100}%"></i></div>` : ''}
    </div>
    ${S.taken.length ? '' : '<button type="button" class="btn" data-go="register">런어스 캡처로 들은 과목 등록하기</button>'}
    ${reqBlock}
    ${miss.length ? `<div class="f-miss"><div class="f-title f-miss-title"><h2>놓치기 쉬운 항목</h2><button type="button" class="f-more" data-go="miss">더보기 <span>›</span></button></div>${miss.join('')}</div>` : ''}
  </div>`;
}

/* ---------- 화면: 졸업요건 ---------- */
function vReq(p = {}) {
  if (!S.onboarded) return needSetup('졸업요건', '졸업요건');
  const d = pastCodes(), A0 = assign(R, d);
  // 연세포탈처럼 이미 이수한 과목만 셉니다(이번 학기 수강 중은 넣지 않음)
  const dt = d, A1 = A0;
  const stPill = (n, n1, need, left) => (n >= need && !left) ? '<span class="pill ok">✓ 충족</span>'
    : `<span class="pill bad">${n < need ? fmt(need - n) + '학점 남음' : left + '과목 남음'}</span>`;
  const numTxt = (n, n1, need) => `${fmt(n)} / ${need}`;
  const lack = Math.max(0, R.total - A0.total);
  const unmetL = R.ok ? allAreas(R).filter(a => (A0.cr[a.id] || 0) < a.need || a.must.some(k => !d.includes(k))) : [], unmet = unmetL.length;
  const head = `<div class="card rq-head">
      <div class="rq-who"><span>${profileText(S.profile, '|').split('|').filter(x => !/학년/.test(x)).map(x => `<b>${esc(x.replace('(복수전공)', ''))}</b>`).join('<i>·</i>')}</span><button type="button" class="link" data-go="setup">학적 변경 ›</button></div>
      ${R.ok ? `<div class="rq-total"><div class="between"><span class="rq-l">졸업 학점</span><span class="rq-v num">${fmt(A0.total)}<small> / ${R.total}학점</small></span></div>${barHtml(A0.total, A1.total, R.total)}</div>
      <div class="rq-stats"><div><span class="rq-l">부족 학점</span><span class="rq-v num">${fmt(lack)}<small>학점</small></span></div><button type="button" class="rq-stat-btn" data-act="unmetInfo" aria-expanded="${!!p.unmet}"><span class="rq-l">미충족 요건 <span class="rq-i" aria-hidden="true">ⓘ</span></span><span class="rq-v num">${unmet}<small>개 영역</small></span></button></div>
      ${p.unmet ? `<div class="rq-explain"><p>졸업하려면 전공기초·전공필수·교양기초 등 <b>영역별로</b> 정해진 학점과 필수 과목을 모두 채워야 합니다. 지금까지 이수한 과목 기준으로 아직 채우지 못한 영역입니다.</p>${unmet ? `<div class="rq-tags">${unmetL.map(a => `<span>${esc(a.label)}</span>`).join('')}</div>` : ''}</div>` : ''}` : ''}
    </div>`;
  if (!R.ok) return `${top('졸업요건')}<div class="scroll">${head}${pendingCard(R)}<button type="button" class="link" data-go="source" style="align-self:flex-start">정보 출처 및 유의사항 ›</button></div>`;
  const mustLeft = [];
  allAreas(R).forEach(a => a.must.forEach(k => { if (!d.includes(k) && !mustLeft.some(m => m[1] === k)) mustLeft.push([a, k]); }));
  return `${top('졸업요건')}<div class="scroll">
    ${head}
    ${mustLeft.length ? `<div class="card soft" style="display:flex;flex-direction:column;gap:2px">
      <div class="h3">아직 듣지 않은 필수 과목</div>
      ${mustLeft.map(([a, k]) => { const st = statusOf(k); return `<button type="button" class="li" data-go="area" data-a="${a.id}"><span class="grow"><b>${esc(CC(k).n)}</b><br><span class="muted small">${esc(a.label)} · ${CC(k).cr}학점</span></span>${st ? badge(st) : '<span class="pill gray">미계획</span>'}<span class="chev">›</span></button>`; }).join('')}
    </div>` : ''}
    ${R.groups.map(g => g.pending ? `<div class="between gh"><div class="h2">${esc(g.n)}</div><span class="pill gray">준비 중</span></div><div class="card"><p class="note" style="margin:0">${esc(g.n)} 요건은 준비 중입니다. 현재 ${Object.keys(SUPPORTED).join(' · ')}을 지원합니다.</p></div>`
      : `<div class="between gh"><div class="h2">${esc(g.n)}</div><span class="muted small num">${numTxt(A0.groupCr[g.k] || 0, A1.groupCr[g.k] || 0, g.need)}학점</span></div>
      <div class="card" style="padding:4px 16px">${areaSlots(g).map(({ n: sn, a }) => { if (!a) return `<div class="li na-row"><span class="grow"><b>${sn}</b><br><span class="muted small">이 전공의 요람에는 없는 영역입니다.</span></span><span class="pill gray">해당 없음</span></div>`; const n = A0.cr[a.id] || 0, n1 = A1.cr[a.id] || 0, left = a.must.filter(k => !d.includes(k)).length, left1 = a.must.filter(k => !dt.includes(k)).length; return `<button type="button" class="li" data-go="area" data-a="${a.id}">
        <span class="grow" style="display:flex;flex-direction:column;gap:6px"><span class="between"><b>${esc(a.n)} ${checkPill(a)}</b><span class="num small">${numTxt(n, n1, a.need)}</span></span>${barHtml(n, n1, a.need)}</span>
        ${stPill(n, n1, a.need, left, left1)}<span class="chev">›</span></button>`; }).join('')}</div>`).join('')}
    <div class="between"><div class="h2">공통 조건</div></div>
    <div class="card" style="padding:4px 16px"><button type="button" class="li" data-go="area" data-a="U3000"><span class="grow" style="display:flex;flex-direction:column;gap:6px"><span class="between"><b>3·4000단위</b><span class="num small">${numTxt(A0.u3, A1.u3, R.u3000)}</span></span>${barHtml(A0.u3, A1.u3, R.u3000)}</span>${stPill(A0.u3, A1.u3, R.u3000, 0, 0)}<span class="chev">›</span></button></div>
    <button type="button" class="link" data-go="source" style="align-self:flex-start">정보 출처 및 유의사항 ›</button>
  </div>`;
}
const U3 = () => ({ id: 'U3000', g: 'common', label: '3·4000단위', n: '3·4000단위', need: R.u3000, must: [], cat: [] });
// 전공 영역은 항상 전공기초·전공필수·전공선택 세 칸을 기본으로 보여 주고, 학과 요람에 없는 칸은 '해당 없음'으로 둬요.
const MAJ_SLOTS = [['전공기초', '전기'], ['전공필수', '전필'], ['전공선택', '전선']];
function areaSlots(g) {
  if (!g || !g.code) return g ? g.areas.map(a => ({ n: a.n, a })) : [];
  const used = new Set();
  const slots = MAJ_SLOTS.map(([n, c]) => { const a = g.areas.find(x => x.cat.join() === c); if (a) used.add(a.id); return { n, a: a || null }; });
  if (!used.size) return g.areas.map(a => ({ n: a.n, a })); // 영역 구분 자체가 없는 학과는 그대로
  return slots.concat(g.areas.filter(a => !used.has(a.id)).map(a => ({ n: a.n, a })));
}
/* 놓치기 쉬운 항목: 3·4000단위 부족 + 이수·수강 중·로드맵 계획 어디에도 없는 지정 과목 */
const missItem = (go, t1, t2) => `<button type="button" class="f-miss-item" ${go}><img src="${import.meta.env.BASE_URL}figma/warn.svg" alt="" width="20" height="20"><span class="f-miss-t"><b>${t1}</b><span>${t2}</span></span><span class="f-chev">›</span></button>`;
function missList() {
  if (!R.ok) return [];
  const d = pastCodes(), t = nowCodes(), A0 = assign(R, d), out = [];
  if (A0.u3 < R.u3000) out.push(missItem('data-go="area" data-a="U3000"', `3·4000단위 과목 ${R.u3000}학점 중 ${fmt(A0.u3)}학점 이수`, '전공·교양 구분 없이 인정 가능합니다.'));
  allAreas(R).forEach(a => a.must.filter(k => !d.includes(k) && !t.includes(k) && !S.plan.some(x => x.c === k)).forEach(k => {
    const gName = (groupOf(R, a.g) || { n: '' }).n.split('(')[0];
    out.push(missItem(`data-go="area" data-a="${a.id}"`, `${esc(gName)} ${esc(a.n)} '${esc(CC(k).n)}' 미이수`, offered(k) ? '이번 학기 수강 가능합니다.' : '로드맵에 계획을 추가해야 합니다.'));
  }));
  return out;
}
function vMiss() {
  const list = missList();
  return `${top('놓치기 쉬운 항목')}<div class="scroll">
    <p class="note" style="margin:0">필수로 이수해야 하는 과목·학점 중 아직 이수하지 않았고, 이번 학기 수강이나 로드맵 계획에도 없는 항목입니다. 항목을 누르면 해당 요건으로 이동합니다.</p>
    ${list.length ? `<div class="f-miss f-miss-all">${list.join('')}</div>` : '<div class="card"><p class="note" style="margin:0">놓친 항목이 없습니다. 필요한 과목이 모두 이수·수강 중이거나 계획에 포함되어 있습니다.</p></div>'}
    <button type="button" class="btn weak" data-act="pushRoadmap">로드맵에서 계획 담기</button>
  </div>`;
}
/* 과목 상세(계획 과목 추가의 ⓘ): 아래에서 올라오는 패널에 항목별로 보여 줘요. 체크 상태는 건드리지 않아요. */
const LANG_NAME = { ko: '한국어', en: '영어', 기타외국어: '기타 외국어' };
function sectionMode(x) {
  const rooms = (x.room || '').split('/').map(r => r.trim()).filter(Boolean);
  const real = rooms.filter(r => !/동영상|온라인|원격/.test(r));
  if (!real.length && (x.online || rooms.length)) return '온라인';
  return x.online ? '대면 + 온라인 콘텐츠' : '대면';
}
function uniq(a) { return [...new Set(a.filter(Boolean))]; }
function courseInfoSheet(c, forSem) {
  const k = CC(c), secs = D.secByCode[c] || [], raw = D.courses[c] || [];
  const cat = raw[3], area = raw[4];
  const per = (vals, unit) => vals.length > 1 ? `${vals.join(' · ')} <span class="muted small">(분반마다 달라요)</span>` : (vals[0] || unit);
  const none = `${NOW_TERM} 미개설로 확인할 수 없습니다.`;
  const langs = uniq(secs.map(x => LANG_NAME[x.lang] || x.lang));
  const modes = uniq(secs.map(sectionMode));
  const grades = uniq(secs.map(x => ({ 절대: '절대평가', 상대: '상대평가', 'P/NP': 'P/NP' })[x.grading] || x.grading));
  const pres = prereqs(c);
  const rows = [
    ['수업 언어', secs.length ? per(langs.map(l => l === '영어' ? '영어 강의' : l), '-') : none],
    ['수업 방식', secs.length ? per(modes, '-') : none],
    ['이수구분', esc([CAT_NAME[cat] || cat || '', area].filter(Boolean).join(' · ') || '-')],
    ['내 요건', esc(areaOf(R, c) ? areaLabel(c) + ' 인정' : '일반선택')],
    ['평가 방식', secs.length ? per(grades, '-') : none],
    ['개설', secs.length ? `${NOW_TERM} ${secs.length}개 분반${uniq(secs.map(x => x.prof)).length ? ' · ' + esc(uniq(secs.map(x => x.prof)).slice(0, 3).join(', ')) + (uniq(secs.map(x => x.prof)).length > 3 ? ' 외' : '') : ''}` : `${NOW_TERM} 미개설`],
    ['선수과목', pres.length ? pres.map(([q, t]) => `${esc(CC(q).n)}${t === 'R' ? '' : ' (권장)'} <span class="muted small">${isDone(q) ? '이수' : nowCodes().includes(q) ? '수강 중' : '미이수'}</span>`).join('<br>') : '등록된 선수과목 없음'],
  ];
  $layer.innerHTML = `<div class="dim" data-act="closeSheet"><div class="sheet cinfo" role="dialog" aria-modal="true" aria-labelledby="ciTitle">
    <div class="cinfo-grab" aria-hidden="true"></div>
    <div><div class="h2" id="ciTitle" style="margin:0">${esc(k.n)}</div><div class="muted small">${c} · ${k.cr}학점${C(c).u ? ' · ' + C(c).u + '단위' : ''}</div></div>
    ${forSem && forSem !== NOW_TERM ? `<div class="cinfo-note">ⓘ ${NOW_TERM} 수강편람 기준이며, 다음 학기에는 달라질 수 있습니다.</div>` : ''}
    <dl class="cinfo-list">${rows.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>
    <button type="button" class="btn weak" data-act="closeSheet">닫기</button>
  </div></div>`;
}
function vArea(p) {
  const a = p.a === 'U3000' ? U3() : areaById(R, p.a);
  if (!a) return `${top('졸업요건')}<div class="scroll"><p class="note">해당 영역을 찾을 수 없습니다. 학적 정보가 변경되었을 수 있습니다.</p></div>`;
  const d = pastCodes(), A0 = assign(R, d);
  const inArea = k => a.id === 'U3000' ? C(k).u >= 3000 : (A0.of[k] ? A0.of[k].id === a.id : false);
  const inAreaNew = k => a.id === 'U3000' ? C(k).u >= 3000 : ((areaOf(R, k) || {}).id === a.id);
  const done = d.filter(inArea);
  const now = nowCodes().filter(inAreaNew);
  const plans = visiblePlan().filter(x => inAreaNew(x.c));
  const n = a.id === 'U3000' ? A0.u3 : (A0.cr[a.id] || 0);
  const left = a.must.filter(k => !d.includes(k));
  const ok = n >= a.need && !left.length;
  const g = groupOf(R, a.g);
  const rule = a.id === 'U3000' ? `3000·4000단위 과목을 전공·교양 구분 없이 ${a.need}학점 이상 이수해야 합니다.` : ruleText(a, R);
  return `${top((g ? g.n + ' · ' : '') + a.n)}<div class="scroll">
    <div class="card" style="display:flex;flex-direction:column;gap:8px">
      <div class="between"><span style="font-size:26px;font-weight:800" class="num bigval">${fmt(n)} / ${a.need}</span>${ok ? '<span class="pill ok">✓ 모두 이수했어요</span>' : `<span class="pill bad">${n < a.need ? fmt(a.need - n) + '학점 남음' : left.length + '과목 남음'}</span>`}</div>
      ${barHtml(n, n, a.need)}
    </div>
    <div><div class="h3">영역 규칙</div><p class="note" style="margin:4px 0 0">${esc(rule)}</p></div>
    ${a.check ? `<div class="card" style="display:flex;flex-direction:column;gap:4px"><div class="row"><span class="pill gray">확인 중</span><b class="small">학교 자료에서 확인하고 있는 내용입니다</b></div><p class="note" style="margin:0">${esc(a.check)}</p></div>` : ''}
    ${left.length ? `<div class="card" style="display:flex;flex-direction:column;gap:8px;box-shadow:inset 0 0 0 1.5px var(--g900)"><div class="between"><div class="h3">남은 지정 과목</div><span class="muted small">${left.length}과목</span></div>
      ${left.map(k => { const st = statusOf(k); return `<div style="display:flex;flex-direction:column;gap:4px"><div class="between"><b>${esc(CC(k).n)}</b>${st ? badge(st) : '<span class="pill gray">미계획</span>'}</div><span class="muted small">${k} · ${CC(k).cr}학점 · ${D.secByCode[k] ? `${NOW_TERM} 개설 ${D.secByCode[k].length}개 분반` : `${NOW_TERM} 미개설`}</span></div>`; }).join('')}</div>` : ''}
    ${now.length ? `<div class="card" style="display:flex;flex-direction:column;gap:2px"><div class="h3">이번 학기 수강 중인 과목</div>${now.map(k => `<div class="li"><span class="grow"><b>${esc(CC(k).n)}</b><br><span class="muted small">${CC(k).cr}학점</span></span>${badge('now')}</div>`).join('')}</div>` : ''}
    ${plans.length ? `<div class="card" style="display:flex;flex-direction:column;gap:2px"><div class="h3">로드맵에 넣어 둔 과목</div>${plans.map(x => `<div class="li"><span class="grow"><b>${esc(CC(x.c).n)}</b><br><span class="muted small">${x.sem} · ${CC(x.c).cr}학점</span></span>${badge('plan')}<button type="button" class="link" data-act="removePlan" data-c="${x.c}">빼기</button></div>`).join('')}</div>` : ''}
    <div class="card" style="display:flex;flex-direction:column;gap:2px"><div class="between"><div class="h3">이수한 과목</div><span class="muted small">${done.length}과목</span></div>${done.length ? done.map(k => `<div class="li"><span class="grow"><b>${esc(CC(k).n)}</b><br><span class="muted small">${semOf(k)} · ${CC(k).cr}학점</span></span>${badge('done')}</div>`).join('') : '<p class="note">아직 이수한 과목이 없어요.</p>'}</div>
    ${ok || !futureSems().length ? '' : `<button type="button" class="btn weak" data-go="addplan" data-req="${a.id}">이 요건을 채울 과목 찾아 계획에 담기</button>`}
  </div>`;
}

/* ---------- 화면: 로드맵 ---------- */
/* 학기 라벨: "1-1"(학년-학기) + 연도 */
const shortSem = sem => { const m = /^(\d+)학년 (\d)학기$/.exec(sem.g); return m ? `${m[1]}-${m[2]}` : sem.id; };
const semShortById = id => { const x = semesters(S.profile).find(s => s.id === id); return x ? shortSem(x) : id; };
/* 선수과목 말풍선: 과목 행을 누르면 위에 떠요 */
/* Figma '로드맵/선수과목 안내/탭'(353:3394): 반투명 메인 말풍선 + 상태 알약 */
function preTip(code) {
  // 미이수 → 계획 → 수강 중 → 이수 완료 순으로, 챙겨야 할 과목이 맨 위에 오게
  const rank = q => { const st = statusOf(q); return st === 'done' ? 3 : st === 'now' ? 2 : S.plan.some(x => x.c === q) ? 1 : 0; };
  const pres = prereqs(code).slice().sort((a, b) => rank(a[0]) - rank(b[0]));
  const row = ([q, t]) => {
    const st = statusOf(q), sem = semOf(q), pl = S.plan.find(x => x.c === q);
    const tag = st === 'done' ? `<span class="f-tag">${semShortById(sem)} 이수 완료</span>`
      : st === 'now' ? `<span class="f-tag">${semShortById(sem)} 수강 중</span>`
        : pl ? `<span class="f-tag">${semShortById(pl.sem)} 계획</span>` : '<span class="f-tag warn">미이수</span>';
    return `<div class="f-tip-row"><span>${esc(CC(q).n)}</span>${tag}</div>`;
  };
  return `<div class="f-tip" role="tooltip"><div class="f-tip-h">선수과목</div>${pres.length ? pres.map(row).join('') : '<div class="f-tip-row"><span class="f-tip-none">등록된 선수과목이 없어요</span></div>'}</div>`;
}
/* Figma 과목 행(353:3424): 345×54, 흰 바탕 + 테두리, 오른쪽 42×42 ⓘ */
function courseRow(code, st, opt) {
  opt = opt || {}; const x = CC(code); const on = S.rmSel === code;
  return `<div class="cr-wrap f-course-wrap ${on ? 'pinned' : ''}">${preTip(code)}<div class="f-course ${st === 'rec' ? 'rec' : ''} ${opt.flash ? 'flash' : ''}">
    <button type="button" class="f-course-main" data-act="rmSel" data-c="${code}" aria-expanded="${on}" aria-label="${esc(x.n)}, 누르면 선수과목 보기"><b>${esc(x.n)}${st === 'rec' ? ' <small>추천</small>' : ''}</b><span>${x.cr}학점 (${code})</span></button>
    <button type="button" class="cr-info f-info" data-act="rmSel" data-c="${code}" aria-expanded="${on}" aria-label="${esc(x.n)} 선수과목 보기">ⓘ</button>
  </div></div>`;
}
/* Figma '전체 이수율' 원(98:1080): 72px, 두께 20%, 3시 방향부터 시계 방향 */
function ring(pct) {
  const v = Math.max(0, Math.min(1, pct)), r = 32.4, c = 2 * Math.PI * r;
  return `<div class="f-ring" role="img" aria-label="전체 이수율 ${Math.round(v * 100)}%"><svg width="72" height="72" viewBox="0 0 72 72"><circle cx="36" cy="36" r="${r}" fill="none" stroke="rgba(133,170,238,.6)" stroke-width="7.2"/><circle cx="36" cy="36" r="${r}" fill="none" stroke="#fff" stroke-width="7.2" stroke-dasharray="${c * v} ${c}"/></svg><span>${Math.round(v * 100)}%</span></div>`;
}
function vRoadmap() {
  if (!S.onboarded) return needSetup('학사 로드맵', '학기별 로드맵');
  const SEMS = semesters(S.profile);
  const vp = visiblePlan().map(x => ({ ...x, st: 'plan' })).concat(recs());
  const past = pastCodes(), now = nowCodes();
  const A0 = assign(R, past);
  const flash = S.flash;
  // Figma '이수 현황'(98:1079): 원형 + 전공·교양 막대
  let summary;
  if (R.ok) {
    const majors = R.groups.filter(g => g.k !== 'gen' && !g.pending), gen = groupOf(R, 'gen');
    const mNeed = majors.reduce((t, g) => t + g.need, 0);
    const m0 = majors.reduce((t, g) => t + A0.groupCr[g.k], 0);
    const line = (n, a, need) => `<div class="f-sum-line"><div class="f-sum-l"><b>${n}</b><span>${fmt(a)} / ${need}학점</span></div><div class="f-sum-bar"><i style="width:${need ? Math.min(a, need) / need * 100 : 0}%"></i></div></div>`;
    summary = `<div class="f-sum">${ring(A0.total / R.total)}<div class="f-sum-lines">${line('전공', m0, mNeed)}${line('교양', A0.groupCr.gen, gen.need)}</div></div>`;
  } else summary = `<div class="f-sum"><div class="f-sum-lines"><div class="f-sum-l"><b>이수 학점</b><span>${fmt(A0.total)}학점</span></div><div class="f-sum-l"><span>졸업요건은 준비 중이에요</span></div></div></div>`;
  const semHtml = sem => {
    let items = [];
    if (sem.k === 'done') items = S.taken.filter(x => x.sem === sem.id).map(x => [x.c, 'done']);
    else if (sem.k === 'now') items = now.map(k => [k, 'now']);
    else items = vp.filter(x => x.sem === sem.id).map(x => [x.c, x.st]);
    const cr = items.filter(([, st]) => st !== 'rec').reduce((a, [k]) => a + CC(k).cr, 0);
    const open = S.open[sem.id] !== undefined ? !!S.open[sem.id] : sem.k !== 'done';
    // Figma '학기 접기/펼치기'(361:3172): 345×60 헤더, 펼치면 8px 아래로 과목 행(간격 8)
    return `<section class="f-sem ${open ? 'open' : ''}" id="sem-${sem.id}">
      <button type="button" class="f-sem-h" data-act="toggleSem" data-sem="${sem.id}" data-open="${open}" aria-expanded="${open}" aria-label="${shortSem(sem)} (${sem.id}) ${fmt(cr)}학점">
        <span class="f-sem-t">${shortSem(sem)}<span class="f-sem-y">${sem.id.replace('-', '년 ')}학기</span>${sem.k === 'now' ? '<span class="f-sem-now">현재 학기</span>' : ''}</span><span class="f-sem-cr">${fmt(cr)}학점</span><img src="${import.meta.env.BASE_URL}figma/${open ? 'chev-up' : 'chev-down'}.svg" alt="" width="16" height="16"></button>
      ${open ? `<div class="f-sem-b">${items.map(([k, st]) => courseRow(k, st, { flash: flash.includes(k) })).join('')}
        ${sem.k === 'future' ? `<button type="button" class="f-add" data-go="addplan" data-sem="${sem.id}">+ 과목 추가</button>` : `<button type="button" class="f-add" data-go="register" data-sem="${sem.id}">+ ${sem.k === 'now' ? '수강 중 과목' : '들은 과목'} 등록</button>`}</div>` : ''}
    </section>`;
  };
  return `<div class="scroll f-rm">
    ${S.stack.length > 1 ? `<div class="f-me-top"><button type="button" class="f-me-back" data-act="back" aria-label="뒤로 가기"><img src="${import.meta.env.BASE_URL}figma/back.svg" alt="" width="10" height="17"></button><h1>학사 로드맵</h1></div>` : '<h1 class="f-rm-title">학사 로드맵</h1>'}
    ${summary}
    <div class="f-sems">${SEMS.map(semHtml).join('')}</div>
  </div>`;
}
/* 과목 목록 검색: 이름·학수번호 */
function searchCatalog(q, filter, limit) {
  const ql = q.toLowerCase();
  const out = [];
  for (const code in D.courses) {
    const x = D.courses[code];
    if (q && !(x[0].toLowerCase().includes(ql) || code.toLowerCase().includes(ql))) continue;
    if (!filter(code)) continue;
    out.push(code); if (!q && out.length >= limit) break;
  }
  if (!q) return out;
  // 이름이 정확히 같거나 검색어로 시작하는 과목, 이번 학기 개설 과목, 짧은 이름 순
  const score = c => { const n = D.courses[c][0].toLowerCase(); return (n === ql || c.toLowerCase() === ql ? 0 : n.startsWith(ql) ? 1 : 2) * 1000 + (D.secByCode[c] ? 0 : 500) + n.length; };
  return out.sort((a, b) => score(a) - score(b)).slice(0, limit);
}
function groupFilter(f) {
  if (f === 'all') return () => true;
  if (f === 'gen') return code => { const k = C(code).k; return ['대교', '계기', '공기', 'RC'].includes(k) || code.startsWith('UCR'); };
  const g = groupOf(R, f); if (!g) return () => true;
  return code => code.startsWith(g.prefix) || g.areas.some(a => a.must.includes(code));
}
function vAddPlan(p) {
  const fut = futureSems();
  if (!fut.length) return `${top('계획 과목 추가')}<div class="scroll"><p class="note">이번 학기에 졸업 예정이어서 계획할 다음 학기가 없습니다. 내 정보에서 졸업 예정 시기를 변경할 수 있습니다.</p></div>`;
  const sem = p.sem && fut.includes(p.sem) ? p.sem : fut[0];
  const q = (p.q || '').trim(), sel = p.sel || [];
  const blocked = c => isTaken(c);
  const req = p.req || null; const reqA = req ? (req === 'U3000' ? U3() : areaById(R, req)) : null;
  const f = p.f || (reqA && groupOf(R, reqA.g) ? reqA.g : 'all');
  const inReq = c => !req || (req === 'U3000' ? C(c).u >= 3000 : (areaOf(R, c) || {}).id === req);
  const majorGroups = R.groups.filter(g => g.k !== 'gen' && !g.pending);
  let list;
  if (q) list = searchCatalog(q, c => !blocked(c) && inReq(c) && groupFilter(f)(c), 60);
  else if (req) list = recs().map(r => r.c).filter(inReq).concat(searchCatalog('', c => !blocked(c) && inReq(c) && !recs().some(r => r.c === c) && (req === 'U3000' || D.courses[c][3]), 60).sort((x, y) => offered(y) - offered(x)));
  else {
    const first = recs().map(r => r.c);
    const rest = searchCatalog('', c => !blocked(c) && !first.includes(c) && groupFilter(f === 'all' && majorGroups.length ? majorGroups[0].k : f)(c) && (f === 'gen' || C(c).u >= 2000), 40);
    list = first.filter(groupFilter(f)).concat(rest);
  }
  // 고른 학기(1·2학기)에 열릴 가능성이 높은 과목을 위로: 개설 이력이 그 학기와 맞음 → 모름 → 다른 학기에만 열림 (UT 피드백)
  const smT = +String(sem).split('-')[1];
  const fit = c => { const t = C(c).t; return t === 3 || t === smT ? 0 : t === 0 ? 1 : 2; };
  list = list.map((c, i) => [c, i]).sort((a, b) => fit(a[0]) - fit(b[0]) || a[1] - b[1]).map(x => x[0]);
  const termTxt = c => { const t = C(c).t; return t === 3 ? '매 학기 개설' : t ? `${t}학기 개설` : ''; };
  // 2단 필터: 고른 전공(또는 교양)의 요건 영역 — 전공기초·전공필수·전공선택 등
  const fg = f !== 'all' ? groupOf(R, f) : null;
  const A1 = assign(R, pastCodes()); // 이미 이수한 과목만으로 ✓ 표시(연세포탈 기준)
  const areaChip = (id, n, done) => `<button type="button" class="chip" data-act="addReq" data-req="${id}" aria-pressed="${req === id}">${esc(n)}${done ? ' ✓' : ''}</button>`;
  const subChips = fg ? areaSlots(fg).map(({ n, a }) => a ? areaChip(a.id, n, (A1.cr[a.id] || 0) >= a.need && !a.must.some(k => !isDone(k)))
      : `<button type="button" class="chip na" disabled title="이 전공은 요람에 ${n} 요건이 없어요">${n} 해당 없음</button>`).join('')
    : R.u3000 ? areaChip('U3000', '3·4000단위', false) : '';
  const cr = sel.reduce((a, c) => a + CC(c).cr, 0);
  return `${top('계획 과목 추가')}<div class="scroll">
    <div class="field"><label for="addSem">추가할 학기</label><select id="addSem">${fut.map(s => `<option value="${s}" ${s === sem ? 'selected' : ''}>${semLabel(s)}</option>`).join('')}</select></div>
    <input class="search" id="addQ" type="search" placeholder="과목명 또는 학수번호 검색" value="${esc(q)}" aria-label="과목 검색">
    <div class="chips">${[['all', '전체'], ...majorGroups.map(g => [g.k, g.short]), ['gen', '교양']].map(([k, n]) => `<button type="button" class="chip" data-act="addF" data-f="${k}" aria-pressed="${f === k}">${n}</button>`).join('')}</div>
    ${subChips ? `<div class="chips sub" role="group" aria-label="요건 영역으로 거르기">${subChips}</div>` : ''}
    <div class="h3">${q ? `"${esc(q)}" 검색 결과` : reqA ? `${esc(reqA.label)}에 인정되는 과목` : '내 졸업요건에 필요한 과목'}</div>
    <div style="display:flex;flex-direction:column;gap:8px">
    ${list.length ? list.map(c => {
      const pl = S.plan.find(x => x.c === c); const on = sel.includes(c); const pre = prereqInfo(c, sem); const a = areaOf(R, c); const isRec = recs().some(r => r.c === c);
      return `<div class="opt-wrap"><button type="button" class="opt" role="checkbox" aria-checked="${on}" data-act="addToggle" data-c="${c}" ${pl ? 'disabled' : ''}><span class="check" aria-hidden="true">${on ? '✓' : ''}</span><span class="grow"><span class="between"><b>${esc(CC(c).n)}</b><span class="muted tiny opt-code">${c}</span></span><span class="muted small">${CC(c).cr}학점${C(c).u >= 3000 ? ' · 3000단위' : ''}${termTxt(c) ? ` · ${termTxt(c)}` : ''}</span>${fit(c) === 2 ? `<span class="small" style="color:var(--warn)">${smT}학기에는 개설되지 않을 수 있습니다.</span>` : ''}
      <span class="tags">${pl ? `<span class="pill gray">이미 ${pl.sem} 계획에 있어요</span>` : isRec ? badge('rec') : ''}${a ? `<span class="pill ok">✓ ${esc(a.label)} 인정</span>` : '<span class="pill gray">일반선택</span>'}${pre.ok ? '' : '<span class="pill bad">! 선수과목 필요</span>'}</span></span></button><button type="button" class="opt-info" data-act="courseInfo" data-c="${c}" aria-label="${esc(CC(c).n)} 자세히 보기">ⓘ</button></div>`;
    }).join('') : `<p class="note">${q ? '검색 결과가 없습니다. 다른 이름으로 검색해 보세요.' : reqA ? `${esc(reqA.label)}에 더 추가할 과목이 없습니다. 남은 과목은 이미 이수했거나 이번 학기에 수강 중입니다.` : '추가할 수 있는 과목이 없습니다.'}</p>`}
    </div>
  </div>
  <div class="foot"><div class="sum">${sel.length ? `<b>${sel.map(c => esc(CC(c).n)).join(', ')}</b> · ${sel.length}과목 ${fmt(cr)}학점을 <b>${sem}</b>에 추가해요` : '추가할 과목을 골라 주세요'}</div>
  <button type="button" class="btn" data-act="addPlan" ${sel.length ? '' : 'disabled'}>${sel.length ? `${sem}에 ${sel.length}과목 추가하기` : '과목을 선택해 주세요'}</button></div>`;
}

/* ---------- 화면: 내 정보 / 온보딩 ---------- */
function vMe() {
  const pf = S.profile;
  const modeCard = S.mode === 'demo'
    ? `<div class="card soft" style="display:flex;flex-direction:column;gap:10px"><div class="h3">예시 데이터로 체험 중입니다</div><p class="note" style="margin:0">체험 데이터는 내 정보와 따로 저장되며, 체험을 끝내면 내 정보 화면으로 돌아갑니다.</p><button type="button" class="btn" data-act="demoEnd">체험 끝내기</button><button type="button" class="btn weak" data-act="demoReset">예시 데이터 처음 상태로 되돌리기</button></div>`
    : S.mode === 'real' ? `<div class="card" style="display:flex;flex-direction:column;gap:10px"><div class="h3">먼저 둘러보고 싶다면</div><p class="note" style="margin:0">24학번 경제학 · 심리학 복수전공 학생의 예시 데이터로 모든 기능을 사용할 수 있습니다. 내 정보는 그대로 유지됩니다.</p><button type="button" class="btn weak" data-act="demo">예시 데이터로 체험하기</button></div>` : '';
  const B = import.meta.env.BASE_URL;
  const head = `<div class="f-me-top"><button type="button" class="f-me-back" data-tab="home" aria-label="홈으로"><img src="${B}figma/back.svg" alt="" width="10" height="17"></button><h1>내 정보</h1></div>`;
  if (!S.onboarded) return `<div class="scroll f-me">${head}
    <div class="empty" style="padding:32px 12px"><div class="ico" aria-hidden="true">${SETUP_ICON}</div><div class="h3">학적 정보를 먼저 입력해 주세요</div><button type="button" class="btn sm" data-go="setup">학적 정보 입력하기</button></div>
    <div class="f-me-extra">${modeCard}</div>
    <button type="button" class="f-me-link one" data-go="source"><span class="f-me-link-t"><b>정보 출처 및 유의사항</b></span><span class="f-me-chev" aria-hidden="true">›</span></button>
  </div>`;
  const gp = gradParts(pf);
  const rows = [['입학 연도', pf.year + '년'], ['현재 학년', pf.grade === '5' ? '5학년 이상' : pf.grade + '학년'], ['본전공', pf.major], ['추가 이수과정', tracksOf(pf).length ? tracksOf(pf).map(x => x.t).join(', ') : '없음 (단일전공)'], ...tracksOf(pf).filter(x => needsDept(x.t)).map(x => [TRACK_DEPT_LABEL[x.t], x.d || '-']), ['졸업 예정', gradDate(pf.grad)]];
  return `<div class="scroll f-me">${head}
    <div class="f-me-profile"><img class="f-me-avatar" src="${B}figma/profile.svg" alt="" width="49" height="49"><div class="f-me-pt"><div class="f-me-name"><b>${esc(S.name) || '내 학적'}</b><span class="f-me-grade">${pf.grade === '5' ? '5학년+' : pf.grade + '학년'}</span></div><p>${majorLine(pf, ' / ')}</p></div></div>
    <div class="f-me-sec"><h2>나의 학적 정보</h2><button type="button" class="f-me-edit" data-go="setup">정보 수정</button></div>
    <div class="f-me-card" aria-label="${gp.g}학년 ${gp.sm}학기 졸업 목표">${rows.map(([k, v]) => `<div class="f-me-row"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>
    ${R.ok ? '' : `<div class="f-me-extra">${pendingCard(R)}</div>`}
    <button type="button" class="f-me-link" data-go="register"><span class="f-me-link-t"><b>이수 내역 관리</b><span>등록한 과목 확인 및 수정</span></span><span class="f-me-chev" aria-hidden="true">›</span></button>
    <button type="button" class="f-me-link one" data-go="source"><span class="f-me-link-t"><b>정보 출처 및 유의사항</b></span><span class="f-me-chev" aria-hidden="true">›</span></button>
    ${modeCard ? `<div class="f-me-extra">${modeCard}</div>` : ''}
    ${S.mode === 'real' ? '<button type="button" class="link f-me-wipe" data-act="wipe">이 기기에 저장된 내 정보 모두 지우기</button>' : ''}
    ${UT_MODE ? `<div class="f-me-extra"><div class="card soft" style="display:flex;flex-direction:column;gap:8px"><div class="h3">UT 진행 도구</div><p class="note" style="margin:0">과제 시작 상태로 바로 맞춰요. 휴대폰에서 진행할 때 쓰세요.</p>
      <div class="chips">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="chip" data-ut="${n}">T${n} 시작</button>`).join('')}</div></div></div>` : ''}
  </div>`;
}
function vSource() {
  const src = [
    ['졸업요건', '연세대학교 대학요람 2020~2026학년도 (경제학, 응용통계학, 심리학)'],
    ['과목 정보', `${NOW_TERM} 신촌캠퍼스 수강편람과 최근 개설 이력 (과목명, 학점, 이수구분)`],
    ['선수과목', '대학요람과 강의계획서에 적힌 선수·권장 과목'],
    ['기준일', esc(D.meta.built || '')],
  ];
  const notes = [
    '연플랜은 학교 공식 서비스가 아닙니다. 최종 졸업 판정은 학사지원팀과 학과 사무실 기준을 따릅니다.',
    '‘확인 중’이 표시된 영역은 요람 원문만으로 확정하지 못한 부분입니다. 대학교양의 영역별 조건(필수 영역 등)은 현재 학점 합계로만 계산합니다.',
    '입력한 정보는 로그인 없이 이 기기의 브라우저에만 저장됩니다. 런어스 캡처 사진도 이 기기 안에서만 읽으며, 서버로 보내지 않습니다.',
    '런어스 과거강좌조회에는 수강철회·F 과목도 함께 표시됩니다. 등록 전 확인 화면에서 제외해 주세요.',
  ];
  return `${top('정보 출처 및 유의사항')}<div class="scroll">
    ${S.mode === 'demo' ? `<div class="card soft" style="display:flex;flex-direction:column;gap:8px"><div class="h3">예시 데이터로 체험 중입니다</div><p class="note" style="margin:0">예시 학생(24학번, 경제학 1전공 · 심리학 2전공)의 학적과 이수 내역이 미리 입력되어 있습니다. 본인 학적과 이수 과목으로 사용하려면 체험을 끝내고 내 정보를 입력해 주세요.</p></div>` : ''}
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div class="h3">데이터 출처</div>
      <dl class="src-list">${src.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl></div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div class="h3">유의사항</div>
      <ul class="note-list">${notes.map(t => `<li>${t}</li>`).join('')}</ul></div>
  </div>`;
}
function profileText(pf, sep = ' · ') {
  if (!pf || !pf.year) return '';
  const a = [`${pf.year.slice(2)}학번`, `${pf.grade === '5' ? '5학년 이상' : pf.grade + '학년'}`];
  const tn = trackNames(pf);
  if (tn.some(x => x.d)) a.push(`${pf.major}(1전공)`, ...tn.map(x => x.short)); else a.push(pf.major, ...tn.map(x => x.short));
  return a.map(esc).join(sep);
}
/* 추가 이수과정: 여러 개 고를 수 있어요. 고른 과정마다 학과(분야)를 골라요. */
function trackDeptOptions(t, cur, major) {
  const sel = v => cur === v ? 'selected' : '';
  if (t === '융복합·연계전공') return [['연계전공', LINKED], ['융합전공', CONVERGENCE]].map(([g, l]) => `<optgroup label="${g}">${l.map(v => `<option value="${v}" ${sel(v)}>${v} (준비 중)</option>`).join('')}</optgroup>`).join('');
  // 마이크로전공: 학과가 아니라 과정 이름이 따로 있어요. 소속 학과가 여는 마이크로전공은 신청할 수 없어 빼요.
  if (t === '마이크로전공') return MICRO.filter(([, dep]) => !(major && dep.split('·').some(x => x.replace(/과$|학부$/, '') === major.replace(/과$/, '')))).map(([v, dep]) => `<option value="${v}" ${sel(v)}>${v} · ${dep} (준비 중)</option>`).join('');
  return DEPTS.map(([g, list]) => `<optgroup label="${g}">${list.filter(v => v !== major).map(v => `<option value="${v}" ${sel(v)}>${v}${t === '마이크로전공' || !SUPPORTED[v] ? ' (준비 중)' : ''}</option>`).join('')}</optgroup>`).join('');
}
function tracksField(d) {
  const tr = tracksOf(d);
  const on = t => tr.some(x => x.t === t);
  return `<div class="field"><label>추가 이수과정 <span class="muted small" style="font-weight:400">여러 개 고를 수 있어요</span></label>
    <div class="chips track-chips" role="group" aria-label="추가 이수과정">${TRACK_TYPES.map(t => `<button type="button" class="chip" data-act="trackToggle" data-t="${t}" aria-pressed="${on(t)}">${t}</button>`).join('')}</div>
    ${tr.length ? '' : '<span class="muted small">선택하지 않으면 단일전공으로 계산합니다.</span>'}</div>
    ${tr.map((x, i) => needsDept(x.t) ? `<div class="field"><label for="f-td${i}">${TRACK_DEPT_LABEL[x.t]}</label><select id="f-td${i}" data-tdept="${i}" class="${x.d ? '' : 'unset'}"><option value="" ${x.d ? '' : 'selected'} disabled>선택해 주세요</option>${trackDeptOptions(x.t, x.d, d.major)}</select></div>` : '').join('')}`;
}
function setupOptions(k, d) {
  const sel = v => d[k] === v ? 'selected' : '';
  let opts = SETUP_FIELDS.find(f => f[0] === k)[2];
  if (k === 'major')
    return opts.map(([g, list]) => `<optgroup label="${g}">${list.map(v => `<option value="${v}" ${sel(v)}>${v}${SUPPORTED[v] ? '' : ' (준비 중)'}</option>`).join('')}</optgroup>`).join('');
  return opts.map(([v, t]) => `<option value="${v}" ${sel(v)}>${t}</option>`).join('');
}
/* 목표 졸업: 학년과 학기를 따로 고르면 입학 연도로 '2027년 2학기'를 계산해요 */
/* 마지막 수강 학기 → 졸업 시기: 1학기까지면 그해 8월, 2학기까지면 다음 해 2월 */
const gradDate = id => { if (!id) return ''; const [y, sm] = id.split('-'); return sm === '1' ? `${y}년 8월` : `${+y + 1}년 2월`; };
const gradOf = (year, g, sm) => year && g && sm ? `${+year + +g - 1}-${sm}` : '';
function gradParts(d) {
  if (!d.grad || !d.year) return { g: d.gradG || '', sm: d.gradS || '' };
  const [gy, gs] = d.grad.split('-');
  return { g: d.gradG || String(+gy - +d.year + 1), sm: d.gradS || gs };
}
/* 졸업 연도·월 ↔ 마지막 수강 학기: 2월 졸업 = 전년도 2학기까지, 8월 졸업 = 그해 1학기까지 */
const gradYM = id => { if (!id) return { y: '', m: '' }; const [y, sm] = id.split('-'); return sm === '1' ? { y, m: '8' } : { y: String(+y + 1), m: '2' }; };
const gradFromYM = (y, m) => y && m ? (m === '8' ? `${y}-1` : `${+y - 1}-2`) : '';
function gradField(d) {
  const cur = gradYM(d.grad), y = d.gradY || cur.y, m = d.gradM || cur.m;
  const [ny] = NOW_TERM.split('-').map(Number);
  const years = []; for (let x = ny; x <= ny + 7; x++) if (gradFromYM(String(x), '2') >= NOW_TERM || gradFromYM(String(x), '8') >= NOW_TERM) years.push(String(x));
  const okM = mm => !y || gradFromYM(y, mm) >= NOW_TERM;
  const res = gradFromYM(y, m), bad = res && res < NOW_TERM;
  const gl = res && d.year ? `(${+res.split('-')[0] - +d.year + 1}학년 ${res.split('-')[1]}학기)` : '';
  return `<div class="field"><label>졸업 예정</label>
    <div class="row" style="gap:8px"><select id="f-gradY" data-field="gradY" class="${y ? '' : 'unset'}" style="flex:1" aria-label="졸업 연도"><option value="" ${y ? '' : 'selected'} disabled>연도</option>${years.map(x => `<option value="${x}" ${x === y ? 'selected' : ''}>${x}년</option>`).join('')}</select>
    <select id="f-gradM" data-field="gradM" class="${m ? '' : 'unset'}" style="flex:1" aria-label="졸업 월"><option value="" ${m ? '' : 'selected'} disabled>월</option>${['2', '8'].map(mm => `<option value="${mm}" ${mm === m ? 'selected' : ''} ${okM(mm) ? '' : 'disabled'}>${mm}월</option>`).join('')}</select></div>
    <span class="muted small">${bad ? '이미 지난 시기입니다. 다시 선택해 주세요.' : res ? `${res.replace('-', '년 ')}학기${gl}까지 수강하고 ${gradDate(res)}에 졸업합니다.` : '2월 졸업은 2학기, 8월 졸업은 1학기까지 수강합니다.'}</span></div>`;
}
/* 홈 머리말용: "24학번 / 경제학 1전공 · 심리학 2전공(복수전공)" */
function homeProfile(pf) {
  if (!pf || !pf.year) return '';
  return `${pf.year.slice(2)}학번 / ${majorLine(pf, ' · ')}`;
}
// 내 정보(Figma 113:1090): "경제학 1전공 / 심리학 2전공(복수전공)"
function majorLine(pf, sep) {
  const tn = trackNames(pf);
  const m = tn.some(x => x.d) ? [`${pf.major} 1전공`, ...tn.map(x => x.long)] : [pf.major, ...tn.map(x => x.long)];
  return esc(m.join(sep));
}
function vSetup(p) {
  const d = p.draft || Object.assign({}, S.profile);
  const fields = SETUP_FIELDS;
  const tr = tracksOf(d);
  const missing = fields.filter(f => f[0] === 'grad' ? !(d.grad && d.grad >= NOW_TERM) : f[0] === 'tracks' ? false : !d[f[0]]).length + tr.filter(x => needsDept(x.t) && !x.d).length;
  const onboarding = !S.onboarded;
  const unsupported = [d.major, ...tr.filter(x => ['복수전공', '부전공'].includes(x.t)).map(x => x.d)].filter(v => v && !SUPPORTED[v]);
  return `${top(onboarding ? '학적 정보 입력' : '학적 정보 수정')}<div class="scroll">
    ${onboarding ? '<div class="steps"><i class="on"></i><i></i><span>1 / 2</span></div>' : ''}
    <div><div style="font-size:21px;font-weight:800">학적 정보를 입력해 주세요</div><div class="muted small">졸업요건은 입학 연도와 전공을 기준으로 계산합니다.</div></div>
    <div class="field"><label for="f-name">이름 (선택)</label><input class="search" id="f-name" type="text" maxlength="12" placeholder="홈에서 부를 이름" value="${esc(p.name !== undefined ? p.name : S.name)}"></div>
    ${fields.map(([k, n]) => k === 'grad' ? gradField(d) : k === 'tracks' ? tracksField(d) : `<div class="field"><label for="f-${k}">${n}</label><select id="f-${k}" data-field="${k}" class="${d[k] ? '' : 'unset'}"><option value="" ${d[k] ? '' : 'selected'} disabled>선택해 주세요</option>${setupOptions(k, d)}</select></div>`).join('')}
    ${unsupported.length ? `<div class="card" style="display:flex;flex-direction:column;gap:4px"><div class="row"><span class="pill gray">준비 중</span><b class="small">${unsupported.map(esc).join(', ')} 졸업요건은 준비 중입니다</b></div><p class="note" style="margin:0">학적은 그대로 저장됩니다. 졸업요건은 현재 ${Object.keys(SUPPORTED).join(' · ')}만 계산하며, 이수 과목 등록과 로드맵은 모두 사용할 수 있습니다.</p></div>` : ''}
  </div>
  <div class="foot"><div class="sum">${missing ? `${missing}개 항목을 더 골라 주세요` : '모두 입력했어요'}</div><button type="button" class="btn" data-act="setupNext" ${missing ? 'disabled' : ''}>${onboarding ? '다음' : '저장하기'}</button></div>`;
}
/* 이수 내역: 런어스 캡처로 등록(기본) + 직접 찾아 추가(보조) */
function vRegister(p) {
  const sems = semesters(S.profile).filter(s => s.k !== 'future');
  const bySem = sems.map(s => [s, S.taken.filter(x => x.sem === s.id)]).filter(([, l]) => l.length);
  const other = S.taken.filter(x => !sems.some(s => s.id === x.sem));
  const manual = !!p.manual;
  return `${top(p.onboard ? '이수 과목 등록' : '이수 내역 관리')}<div class="scroll">
    ${p.onboard ? '<div class="steps"><i class="on"></i><i class="on"></i><span>2 / 2</span></div>' : ''}
    <div><div style="font-size:21px;font-weight:800">${p.onboard ? '들은 과목을 등록해 주세요' : '등록한 과목'}</div><div class="muted small">런어스 '과거강좌조회' 화면을 캡처해 올리면 학기별로 한 번에 등록됩니다. ${NOW_TERM} 과목은 수강 중으로 등록됩니다.</div></div>
    <div class="card soft" style="display:flex;flex-direction:column;gap:10px">
      <div class="h3">런어스 캡처로 등록하기</div>
      <p class="note" style="margin:0">학기마다 한 장씩, 여러 장을 한 번에 올릴 수 있습니다. 사진은 서버로 보내지 않고 이 기기 안에서만 읽습니다.</p>
      <button type="button" class="btn" data-act="openGuide">캡처 방법 보고 사진 올리기</button>
    </div>
    ${bySem.length || other.length ? bySem.map(([s, l]) => `<div class="between"><div class="h3">${s.id} · ${s.g}</div><span class="muted small">${s.k === 'now' ? badge('now') : ''} ${l.length}과목 · ${fmt(sumCr(l.map(x => x.c)))}학점</span></div>
      <div class="card" style="padding:4px 16px">${l.map(x => `<div class="li"><span class="grow"><b>${esc(CC(x.c).n)}</b><br><span class="muted small">${x.c} · ${CC(x.c).cr}학점 · ${esc(areaLabel(x.c))}</span></span><button type="button" class="pill gray" data-act="regRemove" data-c="${x.c}" aria-label="${esc(CC(x.c).n)} 빼기">빼기</button></div>`).join('')}</div>`).join('')
      + (other.length ? `<div class="h3">입학 전·졸업 목표 밖 학기</div><div class="card" style="padding:4px 16px">${other.map(x => `<div class="li"><span class="grow"><b>${esc(CC(x.c).n)}</b><br><span class="muted small">${x.sem} · ${x.c}</span></span><button type="button" class="pill gray" data-act="regRemove" data-c="${x.c}">빼기</button></div>`).join('')}</div>` : '')
      : '<p class="note" style="margin:0">아직 등록한 과목이 없어요.</p>'}
    <button type="button" class="cr-add" data-act="manualToggle">${manual ? '직접 추가 닫기 ▴' : '+ 과목 직접 추가'}</button>
    ${manual ? manualAdd(p, sems) : ''}
  </div>
  <div class="foot">${p.sel && p.sel.length ? `<button type="button" class="btn" data-act="regDone" data-sem="${manualSem(p, sems)}">${manualSem(p, sems)}에 ${p.sel.length}과목 추가하기</button>` : ''}
  <button type="button" class="btn ${p.sel && p.sel.length ? 'weak' : p.onboard ? '' : 'weak'}" data-act="regFinish">${p.onboard ? (S.taken.length ? '완료' : '나중에 등록하기') : '완료'}</button></div>`;
}
const manualSem = (p, sems) => p.sem && sems.some(s => s.id === p.sem) ? p.sem : (sems.length ? sems[sems.length - 1].id : NOW_TERM);
function manualAdd(p, sems) {
  const sem = manualSem(p, sems);
  const q = (p.q || '').trim(), f = p.f || 'all', sel = p.sel || [];
  const majorGroups = R.groups.filter(g => g.k !== 'gen' && !g.pending);
  let list;
  if (q) list = searchCatalog(q, c => !isTaken(c) && groupFilter(f)(c), 50);
  else {
    const must = [...new Set(allAreas(R).flatMap(a => a.must))].filter(c => !isTaken(c) && groupFilter(f)(c));
    list = must.concat(searchCatalog('', c => !isTaken(c) && !must.includes(c) && groupFilter(f === 'all' ? (majorGroups[0] ? majorGroups[0].k : 'all') : f)(c), 30));
  }
  return `<div class="card" style="display:flex;flex-direction:column;gap:10px">
    <div class="field"><label for="regSem">들은 학기</label><select id="regSem">${sems.map(s => `<option value="${s.id}" ${s.id === sem ? 'selected' : ''}>${s.id} · ${s.g}${s.k === 'now' ? ' (수강 중)' : ''}</option>`).join('')}</select></div>
    <input class="search" id="rQ" type="search" placeholder="과목명 또는 학수번호 검색" value="${esc(q)}" aria-label="과목 검색">
    <div class="chips">${[['all', '전체'], ...majorGroups.map(g => [g.k, g.short]), ['gen', '교양']].map(([k, n]) => `<button type="button" class="chip" data-act="regF" data-f="${k}" aria-pressed="${f === k}">${n}</button>`).join('')}</div>
    <div style="display:flex;flex-direction:column;gap:8px">${list.map(k => { const on = sel.includes(k); return `<button type="button" class="opt" role="checkbox" aria-checked="${on}" data-act="regToggle" data-c="${k}"><span class="check" aria-hidden="true">${on ? '✓' : ''}</span><span class="grow"><b>${esc(CC(k).n)}</b><span class="muted small">${k} · ${CC(k).cr}학점 · ${esc(areaLabel(k))}</span></span></button>`; }).join('') || '<p class="note">검색 결과가 없어요. 학수번호로도 찾아보세요.</p>'}</div>
  </div>`;
}

/* ---------- 캡처 방법 안내 (다음 → 다음) ---------- */
/* 각 단계: 화면 전체(img)를 먼저 보여 주고 focus 영역으로 확대한 뒤 hi 영역을 강조해요.
   좌표는 그림 크기에 대한 비율 [x, y, 너비, 높이]예요. */
const GUIDE = [
  { t: '런어스에 로그인해요', d: '휴대폰 브라우저에서 런어스(ys.learnus.org)에 로그인하면 첫 화면에 "나의강좌"와 이번 학기 강좌가 표시됩니다.', img: 'learnus-main-m.jpg', focus: [0, 0, 1, 0.62], hi: [0.03, 0.245, 0.27, 0.085] },
  { t: '"과거강좌조회"를 눌러요', d: '"나의강좌" 제목 아래 버튼 중 두 번째인 "과거강좌조회"를 누릅니다.', img: 'learnus-main-m.jpg', focus: [0.02, 0.2, 0.8, 0.32], hi: [0.258, 0.33, 0.245, 0.083] },
  { t: '연도와 학기를 골라 검색해요', d: '"학위과정 조회" 화면에서 연도와 학기를 선택하고 "검색"을 누르면 해당 학기의 강좌명과 학수번호가 표로 나옵니다. 1학년 1학기부터 이번 학기까지 차례로 진행합니다.', img: 'learnus-past-m.jpg', focus: [0.03, 0.13, 0.94, 0.3], hi: [0.08, 0.24, 0.61, 0.085] },
  { t: '표가 보이게 화면을 캡처해요', d: '강조한 표 전체가 화면에 보이게 한 뒤 스크린샷을 찍습니다. 아이폰은 측면 버튼과 음량 높이기 버튼, 갤럭시는 측면 버튼과 음량 낮추기 버튼을 함께 누릅니다. 학기마다 한 장씩 찍습니다.', img: 'learnus-past-m.jpg', focus: [0.03, 0.38, 0.94, 0.6], hi: [0.08, 0.4, 0.82, 0.56], keys: true, tips: ['강좌명 옆 학수번호(예: ABC1234.01-00)가 잘리지 않아야 합니다.', '카메라로 다른 화면을 찍은 사진은 잘 인식되지 않습니다.', '표가 한 화면에 다 들어가지 않으면 화면을 가로로 돌리거나 나눠서 찍습니다.'] },
  { t: '캡처를 올리고 확인해요', d: '사진 앨범에서 스크린샷을 여러 장 한 번에 고를 수 있습니다. 인식한 과목이 학기별로 표시되면, 수강철회했거나 F를 받은 과목은 체크를 해제하고 등록합니다.', img: 'app-check.jpg', focus: [0, 0.4, 1, 0.33], hi: [0.04, 0.527, 0.92, 0.104], tips: ['사진은 서버로 보내지 않고 이 기기 안에서만 읽습니다.', '처음 한 번 인식 엔진(약 7MB)을 내려받습니다.'] }
];
function guideArt(i) {
  const g = GUIDE[i], src = import.meta.env.BASE_URL + 'guide/' + g.img;
  const [x, y, w, h] = g.hi;
  return `<div class="gz" id="gz" data-i="${i}"><div class="gz-layer"><img src="${src}" alt="${g.t} 화면 예시">
    <div class="gz-hi" style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%"><svg preserveAspectRatio="none"><rect x="0" y="0" width="100%" height="100%" rx="8" ry="8"/></svg></div></div>
    ${g.keys ? '<div class="gz-keys"><kbd>측면 버튼</kbd>+<kbd>음량 버튼</kbd></div>' : ''}
    <button type="button" class="gz-replay" data-act="guideReplay" aria-label="다시 보기">↻ 다시 보기</button></div>`;
}
/* 전체 화면 → 강조 영역으로 확대하는 움직임 */
function animateGuide() {
  const box = document.getElementById('gz'); if (!box) return;
  const g = GUIDE[+box.dataset.i]; const layer = box.querySelector('.gz-layer'); const img = layer.querySelector('img');
  const run = () => {
    const W = box.clientWidth, H = box.clientHeight, iw = img.naturalWidth, ih = img.naturalHeight;
    const s0 = Math.min(W / iw, H / ih), dw = iw * s0, dh = ih * s0, x0 = (W - dw) / 2, y0 = (H - dh) / 2;
    Object.assign(layer.style, { left: x0 + 'px', top: y0 + 'px', width: dw + 'px', height: dh + 'px' });
    const [fx, fy, fw, fh] = g.focus;
    const z = Math.min(W / (fw * dw), H / (fh * dh)) * 0.92;
    const tx = W / 2 - x0 - (fx + fw / 2) * dw * z, ty = H / 2 - y0 - (fy + fh / 2) * dh * z;
    box.style.setProperty('--z', z);
    const end = `translate(${tx}px, ${ty}px) scale(${z})`;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.classList.remove('zoomed');
    if (reduce || !layer.animate) { layer.style.transform = end; box.classList.add('zoomed'); return; }
    layer.style.transform = '';
    const an = layer.animate([{ transform: 'translate(0px, 0px) scale(1)' }, { transform: end }], { duration: 1300, delay: 900, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' });
    an.onfinish = () => box.classList.add('zoomed');
  };
  if (img.complete && img.naturalWidth) run(); else img.onload = run;
}
function vGuide(p) {
  const i = Math.max(0, Math.min(GUIDE.length - 1, p.i || 0)); const g = GUIDE[i]; const last = i === GUIDE.length - 1;
  return `${top('캡처하는 방법', { right: '<button type="button" class="act" data-act="pickImages">바로 사진 고르기</button>' })}<div class="scroll">
    <div class="steps">${GUIDE.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}<span>${i + 1} / ${GUIDE.length}</span></div>
    ${guideArt(i)}
    <div><div style="font-size:21px;font-weight:800">${i + 1}. ${g.t}</div><p class="note" style="margin:6px 0 0;font-size:14.5px">${g.d}</p></div>
    ${g.tips ? `<ul class="tips">${g.tips.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}
  </div>
  <div class="foot"><div class="row" style="gap:8px">${i ? '<button type="button" class="btn weak" data-act="guidePrev" style="flex:1">이전</button>' : ''}
  <button type="button" class="btn" data-act="${last ? 'pickImages' : 'guideNext'}" style="flex:2">${last ? '캡처 사진 고르기' : '다음'}</button></div></div>`;
}

/* ---------- 캡처 읽기 결과 확인 ---------- */
/* 캡처에서 빠진 과목을 직접 찾아 넣기 */
function ocrAddBlock(p, sems, order) {
  if (!p.adding) return `<button type="button" class="cr-add" data-act="ocrAddOpen">+ 빠진 과목 직접 추가</button>`;
  const def = p.osem || order.find(x => x !== '?') || sems[sems.length - 1];
  const q = (p.oq || '').trim();
  const inList = c => (p.items || []).some(im => im.rows.some(r => r.code === c));
  const list = q ? searchCatalog(q, c => !inList(c), 8) : [];
  return `<div class="card" style="display:flex;flex-direction:column;gap:10px">
    <div class="between"><b>빠진 과목 추가</b><button type="button" class="link" data-act="ocrAddClose">닫기</button></div>
    <div class="field"><label for="oSem">들은 학기</label><select id="oSem">${sems.map(s => `<option value="${s}" ${s === def ? 'selected' : ''}>${semLabel(s)}${s === NOW_TERM ? ' (수강 중)' : ''}</option>`).join('')}</select></div>
    <input class="search" id="oQ" type="search" placeholder="과목명 또는 학수번호 (예: 기독교와세계문화, YCA1101)" value="${esc(q)}" aria-label="빠진 과목 검색">
    ${q ? (list.length ? `<div style="display:flex;flex-direction:column;gap:6px">${list.map(c => `<button type="button" class="opt" data-act="ocrAddPick" data-c="${c}" data-sem="${def}"><span class="grow"><span class="between"><b>${esc(CC(c).n)}</b><span class="muted tiny">${c}</span></span><span class="muted small">${CC(c).cr}학점 · ${esc(areaLabel(c))}</span></span><span class="pill info">+ 추가</span></button>`).join('')}</div>`
      : /^[A-Za-z]{3}\d{4}$/.test(q) ? `<button type="button" class="opt" data-act="ocrAddPick" data-c="${q.toUpperCase()}" data-sem="${def}"><span class="grow"><b>${esc(q.toUpperCase())}</b><span class="muted small">데이터에 없는 학수번호입니다. 추가한 뒤 과목명과 학점을 입력해 주세요.</span></span><span class="pill info">+ 추가</span></button>` : '<p class="note" style="margin:0">검색 결과가 없습니다. 학수번호 7자리(예: YCA1101)로도 검색할 수 있습니다.</p>') : ''}
  </div>`;
}

function vOcr(p) {
  const items = p.items || [];
  const busy = items.some(x => x.state === 'wait' || x.state === 'run');
  const rows = items.flatMap((im, ii) => (im.rows || []).map((r, ri) => ({ ...r, ii, ri })));
  const sems = semesters(S.profile).filter(s => s.k !== 'future').map(s => s.id);
  const known = r => !!D.courses[r.code];
  const picked = rows.filter(r => r.on && r.sem);
  const groups = {}; rows.forEach(r => { (groups[r.sem || '?'] = groups[r.sem || '?'] || []).push(r); });
  const order = Object.keys(groups).sort();
  return `${top('캡처 읽기')}<div class="scroll">
    <div class="ocr-thumbs">${items.filter(im => !im.manual).map((im, i) => `<div class="ocr-thumb"><img src="${im.url}" alt="올린 캡처 ${i + 1}"><span>${im.state === 'done' ? `✓ ${im.rows.length}과목` : im.state === 'err' ? '! 읽지 못함' : im.state === 'run' ? `읽는 중 ${Math.round((im.prog || 0) * 100)}%` : '대기'}</span></div>`).join('')}</div>
    ${busy ? `<div class="banner ok"><span aria-hidden="true">…</span><div><b>캡처를 읽고 있어요</b><p>${p.status || '처음에는 인식 엔진을 내려받느라 시간이 걸립니다.'}</p></div></div>` : ''}
    ${!busy && !rows.length && items.some(im => !im.manual) ? `<div class="banner bad"><span>!</span><div><b>학수번호를 찾지 못했습니다</b><p>표의 "강좌명 (ABC1234.01-00)" 부분이 잘리지 않게 다시 캡처해 주세요. 직접 검색해서 추가할 수도 있습니다.</p></div></div>` : ''}
    ${rows.length ? `<div class="card soft"><b>인식한 과목을 확인해 주세요</b><p class="note" style="margin:4px 0 0">과거강좌조회에는 수강철회했거나 F를 받은 과목도 표시되므로 해당 과목은 체크를 해제해 주세요. 학기가 다르면 학기를 변경해 주세요.</p></div>` : ''}
    ${order.map(sem => `<div class="between"><div class="field" style="flex:1"><label>${sem === '?' ? '학기를 인식하지 못했습니다. 학기를 선택해 주세요.' : '학기'}</label>
      <select data-ocrsem="${sem}"><option value="" ${sem === '?' ? 'selected' : ''} disabled>학기 선택</option>${sems.map(s => `<option value="${s}" ${s === sem ? 'selected' : ''}>${semLabel(s)}${s === NOW_TERM ? ' (수강 중)' : ''}</option>`).join('')}${sem !== '?' && !sems.includes(sem) ? `<option value="${sem}" selected>${sem} (입학 연도 밖)</option>` : ''}</select></div></div>
      <div style="display:flex;flex-direction:column;gap:8px">${groups[sem].map(r => {
        const dup = isTaken(r.code);
        return `<div class="opt ocr-row" role="checkbox" aria-checked="${r.on}" data-act="ocrToggle" data-ii="${r.ii}" data-ri="${r.ri}" tabindex="0"><span class="check" aria-hidden="true">${r.on ? '✓' : ''}</span><span class="grow">
          ${known(r) ? `<span class="between"><b>${esc(C(r.code).n)}</b><span class="muted tiny">${r.code}</span></span><span class="muted small">${C(r.code).cr}학점 · ${esc(areaLabel(r.code))}</span>`
            : `<span class="between"><b>${r.code}</b><span class="pill gray">데이터에 없는 과목</span></span><span class="ocr-edit"><input type="text" data-ocrname="${r.ii}-${r.ri}" placeholder="과목명" value="${esc(r.name || '')}" aria-label="과목명"><input type="number" min="0" max="12" step="0.5" data-ocrcr="${r.ii}-${r.ri}" value="${r.cr || 3}" aria-label="학점"><span class="muted small">학점</span></span><span class="muted tiny">학수번호를 잘못 인식했다면 체크를 해제하고 직접 추가해 주세요.</span>`}
          ${dup ? `<span class="muted tiny">이미 ${semOf(r.code)}에 등록된 과목입니다. 등록하면 학기가 변경됩니다.</span>` : ''}</span></div>`;
      }).join('')}</div>`).join('')}
    ${busy ? '' : ocrAddBlock(p, sems, order)}
  </div>
  <div class="foot">${rows.length ? `<div class="sum">${picked.length ? `<b>${picked.length}과목</b>을 등록해요${rows.some(r => r.on && !r.sem) ? ' · 학기를 선택하지 않은 과목은 제외됩니다.' : ''}` : '등록할 과목을 골라 주세요'}</div>` : ''}
    ${rows.length ? `<button type="button" class="btn" data-act="ocrSave" ${picked.length && !busy ? '' : 'disabled'}>${picked.length}과목 등록하기</button>` : ''}
    <button type="button" class="btn weak" data-act="pickImages">${items.length ? '캡처 더 올리기' : '캡처 사진 고르기'}</button></div>`;
}

const VIEWS = { home: vHome, miss: vMiss, req: vReq, area: vArea, roadmap: vRoadmap, addplan: vAddPlan, me: vMe, setup: vSetup, register: vRegister, guide: vGuide, ocr: vOcr, source: vSource };

function render(y) {
  R = buildReq(S.onboarded ? S.profile : null);
  const c = cur();
  if (!VIEWS[c.s]) S.stack = [{ s: 'home' }];
  const active = document.activeElement && document.activeElement.id;
  const caret = document.activeElement && document.activeElement.selectionStart;
  $screen.innerHTML = VIEWS[cur().s](cur().p || {});
  renderTabs();
  const sc = $screen.querySelector('.scroll');
  if (sc && typeof y === 'number') sc.scrollTop = y;
  if (active && /^(addQ|rQ|oQ)$/.test(active)) { const el = document.getElementById(active); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch (e) { /* noop */ } } }
  if (c.s === 'roadmap' && c.p && c.p.scrollTo) { const el = document.getElementById('sem-' + c.p.scrollTo); if (el && sc) { sc.scrollTop = el.offsetTop - sc.offsetTop - 8; } delete c.p.scrollTo; }
  if (S.flash.length) { setTimeout(() => { S.flash = []; }, 3500); }
  if (cur().s === 'guide') requestAnimationFrame(animateGuide);
  save();
}
function rerender() { saveScroll(); render(cur().y); }

/* ---------- 처음 방문 안내 ---------- */
function welcome() {
  $layer.innerHTML = `<div class="dim center"><div class="sheet modal" role="dialog" aria-modal="true" aria-labelledby="wTitle">
    <div class="brand wbrand" aria-label="Yon-Plan"><img src="${import.meta.env.BASE_URL}logo.svg" alt="" class="brand-mark"><img src="${import.meta.env.BASE_URL}wordmark.svg" alt="Yon-Plan" class="brand-word"></div>
    <div class="h2" id="wTitle" style="margin:0">연플랜에 오신 걸 환영해요</div>
    <p class="note" style="margin:0">졸업요건과 학기별 로드맵을 한 곳에서 관리합니다. 시작 방법을 선택해 주세요.</p>
    <button type="button" class="opt" data-act="startReal"><span class="grow"><b>처음부터 시작하기</b><span class="muted small">학적을 입력하고, 런어스 캡처로 들은 과목을 등록합니다.</span></span><span class="chev">›</span></button>
    <button type="button" class="opt" data-act="demo"><span class="grow"><b>예시 데이터로 체험하기</b><span class="muted small">24학번 경제학 · 심리학 복수전공 학생의 데이터로 둘러봅니다. 체험 데이터는 따로 저장됩니다.</span></span><span class="chev">›</span></button>
    <p class="note" style="margin:0">로그인 없이 이 기기의 브라우저에만 저장됩니다.</p>
  </div></div>`;
}

/* ---------- 캡처 읽기 ---------- */
const $file = document.createElement('input');
$file.type = 'file'; $file.accept = 'image/*'; $file.multiple = true; $file.hidden = true;
document.body.appendChild($file);
function pickImages() { $file.value = ''; $file.click(); }
$file.addEventListener('change', async () => {
  const files = [...$file.files]; if (!files.length) return;
  let c = cur();
  if (c.s !== 'ocr') { go('ocr', { items: [] }); c = cur(); }
  const p = c.p; p.items = p.items || [];
  const mine = files.map(f => ({ url: URL.createObjectURL(f), file: f, state: 'wait', rows: [] }));
  p.items.push(...mine); rerender();
  const sems = semesters(S.profile).map(s => s.id);
  for (const im of mine) {
    im.state = 'run'; if (cur().p === p) rerender();
    try {
      const res = await readImage(im.file, (status, prog) => {
        im.prog = status === 'recognizing text' ? prog : 0;
        p.status = status === 'recognizing text' ? '글자를 읽고 있습니다.' : '인식 엔진을 준비하고 있습니다. 처음 한 번만 시간이 걸립니다.';
        const el = document.querySelector(`.ocr-thumb img[src="${im.url}"] + span`); if (el) el.textContent = `읽는 중 ${Math.round((im.prog || 0) * 100)}%`;
      });
      im.rows = res.rows.map(r => {
        r.code = fuzzyCode(r.code);
        const sem = r.year && r.sem ? `${r.year}-${r.sem}` : '';
        return { code: r.code, sem: sem, on: true, name: '', cr: 3, known: !!D.courses[r.code], inRange: sems.includes(sem) };
      });
      im.state = 'done';
    } catch (err) {
      im.state = 'err'; im.err = String(err && err.message || err);
    }
    if (cur().p === p) rerender();
  }
  if (cur().p === p) { const n = p.items.reduce((a, x) => a + x.rows.length, 0); toast(n ? `캡처에서 ${n}과목을 인식했습니다. 확인해 주세요.` : '학수번호를 찾지 못했어요'); }
});

/* 데이터에 없는 학수번호는 헷갈리기 쉬운 글자를 한 자씩 바꿔 보고, 딱 하나 맞으면 그걸로 고쳐요 */
const LOOKALIKE = { O: 'DQC', D: 'O', Q: 'O', C: 'GO', G: 'C', I: 'LT', L: 'I', T: 'I', '0': '86', '1': '7', '7': '1', '8': '03', '3': '8', '6': '058', '5': '6' };
function fuzzyCode(code) {
  if (D.courses[code]) return code;
  const hits = new Set();
  for (let i = 0; i < code.length; i++) for (const ch of (LOOKALIKE[code[i]] || '')) { const c = code.slice(0, i) + ch + code.slice(i + 1); if (D.courses[c]) hits.add(c); }
  return hits.size === 1 ? [...hits][0] : code;
}

/* 데스크톱: ⓘ에 마우스를 올리면 선수과목 말풍선 */
document.addEventListener('mouseover', e => { const b = e.target.closest && e.target.closest('.cr-info'); if (b) b.closest('.cr-wrap').classList.add('hover'); });
document.addEventListener('mouseout', e => { const b = e.target.closest && e.target.closest('.cr-info'); if (b && !b.contains(e.relatedTarget)) b.closest('.cr-wrap').classList.remove('hover'); });

/* ---------- 동작 ---------- */
function addPlans(codes, sem) {
  codes.forEach(c => { const ex = S.plan.find(x => x.c === c); if (ex) ex.sem = sem; else S.plan.push({ c, sem }); });
  S.open[sem] = true; S.flash = codes.slice();
  S.stack = [{ s: 'roadmap', p: { scrollTo: sem } }];
  render(0);
  toast(`${codes.map(c => esc(CC(c).n)).join(', ')}을(를) ${sem} 계획에 추가했어요`, { t: '되돌리기', fn: () => { S.plan = S.plan.filter(x => !(codes.includes(x.c) && x.sem === sem)); rerender(); } });
}
function startUT(n) {
  closeSheet();
  // 2차 UT: 모든 태스크를 같은 예시 데이터(경제학 1전공 + 심리학 복수전공)에서 시작
  S = withUi(demoFresh(), 'ut');
  render(0);
  toast(`T${n} 시작 상태로 맞췄습니다.`);
}
const ocrRow = t => { const p = cur().p; return p.items[+t.dataset.ii].rows[+t.dataset.ri]; };

document.addEventListener('click', e => {
  const ut = e.target.closest('[data-ut]'); if (ut) { startUT(+ut.dataset.ut); return; }
  if (e.target.closest('.ocr-edit')) return;
  const t = e.target.closest('[data-tab],[data-go],[data-act]');
  if (S.rmSel && (!t || t.dataset.act !== 'rmSel')) { S.rmSel = null; if (!t) { rerender(); return; } }
  if (!t || !t.closest('#phone')) return;
  if (t.disabled) return;
  const c = cur(), p = c.p || (c.p = {});
  if (t.dataset.tab) { tab(t.dataset.tab); return; }
  if (t.dataset.go) {
    const g = t.dataset.go;
    if (g === 'area') return go('area', { a: t.dataset.a });
    if (g === 'addplan') return go('addplan', { sem: t.dataset.sem, req: t.dataset.req || null, sel: [] });
    if (g === 'setup') return go('setup', {});
    if (g === 'register') return go('register', { onboard: false, sem: t.dataset.sem });
    if (g === 'guide') return go('guide', { i: 0 });
    if (['roadmap', 'home', 'me'].includes(g)) return tab(g);
    return go(g, {});
  }
  const a = t.dataset.act;
  switch (a) {
    case 'back': back(); break;
    case 'closeSheet': if (e.target === t || t.tagName === 'BUTTON') closeSheet(); break;
    case 'startReal': startMode('real', { go: store.get(KEY.real) && store.get(KEY.real).onboarded ? 'home' : 'setup' }); break;
    case 'demo': startMode('demo'); toast('예시 데이터로 체험을 시작합니다.'); break;
    case 'demoReset': startMode('demo', { reset: true, go: 'me' }); toast('예시 데이터를 처음 상태로 되돌렸습니다.'); break;
    case 'demoEnd': startMode('real', { go: 'me' }); toast('체험을 종료했습니다.'); break;
    case 'wipe': if (window.confirm('이 기기에 저장된 학적, 이수 과목, 계획을 모두 삭제하시겠습니까? 되돌릴 수 없습니다.')) { store.del(KEY.real); startMode('real', { reset: true }); toast('저장된 내 정보를 삭제했습니다.'); } break;
    case 'toggleSem': S.open[t.dataset.sem] = t.dataset.open !== 'true'; rerender(); break;
    case 'rmFilter': S.rmFilter = t.dataset.f; rerender(); break;
    case 'togglePre': S.showPre = !S.showPre; rerender(); break;
    case 'rmSel': // 누르면 선수과목 말풍선, 한 번 더 누르면 닫기
      S.rmSel = S.rmSel === t.dataset.c ? null : t.dataset.c; rerender();
      break;
    case 'addF': p.f = t.dataset.f; p.req = null; rerender(); break;
    case 'addReq': p.req = p.req === t.dataset.req ? null : t.dataset.req; rerender(); break;
    case 'addReqOff': p.req = null; rerender(); break;
    case 'trackToggle': {
      p.draft = p.draft || Object.assign({}, S.profile); const nm = document.getElementById('f-name'); if (nm) p.name = nm.value;
      const tr = tracksOf(p.draft).slice(), tt = t.dataset.t;
      p.draft.tracks = tr.some(x => x.t === tt) ? tr.filter(x => x.t !== tt) : tr.concat({ t: tt, d: '' }).sort((a, b) => TRACK_TYPES.indexOf(a.t) - TRACK_TYPES.indexOf(b.t));
      delete p.draft.track; delete p.draft.second; rerender(); break;
    }
    case 'pushRoadmap': go('roadmap'); break;
    case 'unmetInfo': p.unmet = !p.unmet; rerender(); break;
    case 'courseInfo': courseInfoSheet(t.dataset.c, p.sem && futureSems().includes(p.sem) ? p.sem : futureSems()[0]); break;
    case 'addToggle': { const k = t.dataset.c; p.sel = p.sel || []; p.sel = p.sel.includes(k) ? p.sel.filter(x => x !== k) : p.sel.concat(k); rerender(); break; }
    case 'addPlan': if (p.sel && p.sel.length) addPlans(p.sel, p.sem && futureSems().includes(p.sem) ? p.sem : futureSems()[0]); break;
    case 'removePlan': { const k = t.dataset.c; const old = S.plan.find(x => x.c === k); S.plan = S.plan.filter(x => x.c !== k); rerender(); toast(`${esc(CC(k).n)}을(를) 계획에서 제외했습니다.`, { t: '되돌리기', fn: () => { S.plan.push(old); rerender(); } }); break; }
    case 'setupNext': {
      const d = Object.assign({}, p.draft || S.profile); d.tracks = tracksOf(d).filter(x => !needsDept(x.t) || x.d); delete d.track; delete d.second; delete d.gradG; delete d.gradS; delete d.gradY; delete d.gradM;
      const nm = document.getElementById('f-name'); S.name = nm ? nm.value.trim() : S.name;
      S.profile = d;
      if (!S.onboarded) { S.onboarded = true; S.stack = [{ s: 'register', p: { onboard: true } }, { s: 'guide', p: { i: 0 } }]; render(0); } else { back(); toast('학적 정보를 저장했습니다.'); }
      break;
    }
    case 'manualToggle': p.manual = !p.manual; rerender(); break;
    case 'regF': p.f = t.dataset.f; rerender(); break;
    case 'regToggle': { const k = t.dataset.c; p.sel = p.sel || []; p.sel = p.sel.includes(k) ? p.sel.filter(x => x !== k) : p.sel.concat(k); rerender(); break; }
    case 'regDone': {
      const sel = p.sel || []; const sem = t.dataset.sem;
      sel.forEach(code => { const ex = S.taken.find(x => x.c === code); if (ex) ex.sem = sem; else S.taken.push({ c: code, sem }); });
      S.plan = S.plan.filter(x => !sel.includes(x.c));
      p.sel = []; p.q = ''; rerender();
      toast(`${sem}에 ${sel.length}과목을 등록했어요`, { t: '되돌리기', fn: () => { S.taken = S.taken.filter(x => !(sel.includes(x.c) && x.sem === sem)); rerender(); } }); break;
    }
    case 'regRemove': { const k = t.dataset.c; const old = S.taken.find(x => x.c === k); S.taken = S.taken.filter(x => x.c !== k); rerender(); toast(`${esc(CC(k).n)}을(를) 이수 내역에서 뺐어요`, { t: '되돌리기', fn: () => { S.taken.push(old); rerender(); } }); break; }
    case 'regFinish': if (p.onboard) { S.stack = [{ s: 'home' }]; render(0); toast(S.taken.length ? `${S.taken.length}과목을 기준으로 졸업요건을 정리했습니다.` : '들은 과목은 내 정보에서 언제든 등록할 수 있습니다.'); } else back(); break;
    case 'openGuide': go('guide', { i: 0 }); break;
    case 'guideReplay': animateGuide(); break;
    case 'guideNext': p.i = (p.i || 0) + 1; render(0); break;
    case 'guidePrev': p.i = Math.max(0, (p.i || 0) - 1); render(0); break;
    case 'pickImages': S.guideSeen = true; save(); pickImages(); break;
    case 'ocrAddOpen': p.adding = true; p.oq = ''; rerender(); setTimeout(() => { const el = document.getElementById('oQ'); if (el) el.focus(); }, 0); break;
    case 'ocrAddClose': p.adding = false; rerender(); break;
    case 'ocrAddPick': {
      let m = p.items.find(x => x.manual); if (!m) { m = { manual: true, state: 'done', rows: [], url: '' }; p.items.push(m); }
      const code = t.dataset.c; m.rows.push({ code, sem: t.dataset.sem, on: true, name: '', cr: 3 });
      p.oq = ''; p.osem = t.dataset.sem; rerender(); toast(`${esc(CC(code).n)}을(를) ${t.dataset.sem}에 추가했어요`); break;
    }
    case 'ocrToggle': { const r = ocrRow(t); r.on = !r.on; rerender(); break; }
    case 'ocrSave': {
      const rows = p.items.flatMap(im => im.rows).filter(r => r.on && r.sem);
      const before = S.taken.map(x => ({ ...x }));
      rows.forEach(r => {
        if (!D.courses[r.code]) S.extra[r.code] = { n: r.name || r.code, cr: +r.cr || 3 };
        const ex = S.taken.find(x => x.c === r.code); if (ex) ex.sem = r.sem; else S.taken.push({ c: r.code, sem: r.sem });
      });
      S.plan = S.plan.filter(x => !rows.some(r => r.code === x.c));
      const nNow = rows.filter(r => r.sem === NOW_TERM).length;
      p.items.forEach(im => URL.revokeObjectURL(im.url));
      while (S.stack.length && ['ocr', 'guide'].includes(cur().s)) S.stack.pop();
      if (!S.stack.length) S.stack = [{ s: 'register', p: {} }];
      render(0);
      toast(`${rows.length}과목을 등록했어요${nNow ? ` (수강 중 ${nNow}과목)` : ''}`, { t: '되돌리기', fn: () => { S.taken = before; rerender(); } });
      break;
    }
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $layer.innerHTML && !$layer.querySelector('.modal')) closeSheet();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ocr-row')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('change', e => {
  const el = e.target; if (!el.closest || !el.closest('#phone')) return; const c = cur(), p = c.p || (c.p = {});
  if (el.id === 'jump' && el.value) { S.open[el.value] = true; c.p = { scrollTo: el.value }; render(0); return; }
  if (el.id === 'addSem') { p.sem = el.value; rerender(); return; }
  if (el.id === 'regSem') { p.sem = el.value; p.sel = []; rerender(); return; }
  if (el.id === 'oSem') { p.osem = el.value; rerender(); return; }
  if (el.id === 'f-name') { p.name = el.value; return; }
  if (el.dataset.ocrsem !== undefined) { const from = el.dataset.ocrsem; p.items.forEach(im => im.rows.forEach(r => { if ((r.sem || '?') === from) r.sem = el.value; })); rerender(); return; }
  if (el.dataset.ocrname) { const [i, j] = el.dataset.ocrname.split('-'); p.items[+i].rows[+j].name = el.value.trim(); return; }
  if (el.dataset.ocrcr) { const [i, j] = el.dataset.ocrcr.split('-'); p.items[+i].rows[+j].cr = +el.value || 3; return; }
  if (el.dataset.tdept !== undefined) {
    p.draft = p.draft || Object.assign({}, S.profile); const nm = document.getElementById('f-name'); if (nm) p.name = nm.value;
    p.draft.tracks = tracksOf(p.draft).map((x, i) => i === +el.dataset.tdept ? { ...x, d: el.value } : x); delete p.draft.track; delete p.draft.second;
    rerender(); return;
  }
  if (el.dataset.field) {
    const f = el.dataset.field; p.draft = p.draft || Object.assign({}, S.profile); p.draft[f] = el.value;
    const nm = document.getElementById('f-name'); if (nm) p.name = nm.value;
    if (f === 'major') { p.draft.tracks = tracksOf(p.draft).map(x => x.d === el.value ? { ...x, d: '' } : x); delete p.draft.track; delete p.draft.second; }
    if (f === 'gradY' || f === 'gradM') { const cy = gradYM(p.draft.grad); const y = p.draft.gradY || cy.y, m = p.draft.gradM || cy.m; const g = gradFromYM(y, m); p.draft.grad = g && g >= NOW_TERM ? g : ''; }
    rerender(); return;
  }
});
document.addEventListener('input', e => {
  const el = e.target; const c = cur(), p = c.p || (c.p = {});
  if (['addQ', 'rQ'].includes(el.id)) { p.q = el.value; if (!e.isComposing) rerender(); }
  if (el.id === 'oQ') { p.oq = el.value; if (!e.isComposing) rerender(); }
});
document.addEventListener('compositionend', e => { const el = e.target; if (['addQ', 'rQ'].includes(el.id)) { cur().p.q = el.value; rerender(); } if (el.id === 'oQ') { cur().p.oq = el.value; rerender(); } });

/* ---------- 시작 ---------- */
$screen.innerHTML = `<div class="empty" style="padding-top:160px"><div class="brand lg" aria-label="Yon-Plan"><img src="${import.meta.env.BASE_URL}logo.svg" alt="" class="brand-mark"><img src="${import.meta.env.BASE_URL}wordmark.svg" alt="Yon-Plan" class="brand-word"></div><p class="note">과목과 졸업요건 데이터를 불러오고 있습니다…</p></div>`;
loadData().then(() => {
  const mode = store.get(KEY.mode);
  if (UT_MODE) { S = withUi(null, 'ut'); render(0); return; }
  if (mode === 'demo' || mode === 'real') { S = withUi(store.get(KEY[mode]), mode); render(0); return; }
  S = withUi(null, 'new'); render(0); welcome();
}).catch(err => {
  $screen.innerHTML = `<div class="empty" style="padding-top:120px"><div class="h3">데이터를 불러오지 못했습니다</div><p class="note">네트워크를 확인하고 새로고침해 주세요. (${esc(err.message)})</p></div>`;
});
