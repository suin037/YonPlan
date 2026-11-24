import './style.css';
import { D, C, SEC, loadData, NOW_TERM, DAYS, ST, badge, DEPTS, LINKED, SUPPORTED, SETUP_FIELDS, SECOND_LABEL, hasSecond } from './data.js';
import { buildReq, assign, areaOf, areaById, groupOf, allAreas, ruleText, semesters, prereqs } from './model.js';
import { demoState } from './demo.js';

// ?ut 를 주소에 붙이면 UT(사용성 테스트) 진행 도구가 보여요. 예: https://.../YonPlan/?ut
const UT_MODE = new URLSearchParams(location.search).has('ut');
if (UT_MODE) document.body.classList.add('ut-mode');

/* ---------- 상태와 저장 ----------
   로그인 없이 이 브라우저(localStorage)에만 저장해요.
   내 정보(real)와 체험 데이터(demo)는 따로 저장돼서 서로 덮어쓰지 않아요. */
const KEY = { mode: 'yonplan.v1.mode', real: 'yonplan.v1.real', demo: 'yonplan.v1.demo' };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } }
};
const SAVED_FIELDS = ['onboarded', 'name', 'profile', 'taken', 'tt', 'ttTab', 'main', 'plan', 'fav', 'showPre', 'open'];
function blank() {
  return {
    onboarded: false, name: '', profile: { year: '', grade: '', major: '', track: '', second: '', grad: '' },
    taken: [], tt: { A: [], B: [] }, ttTab: 'A', main: 'A', plan: [], fav: [], showPre: true, open: {}
  };
}
function withUi(data, mode) {
  return Object.assign(blank(), data || {}, { mode, rmFilter: 'all', stack: [{ s: 'home' }], flash: [] });
}
function demoFresh() { const d = demoState(); return Object.assign(blank(), d, { onboarded: true, open: { [NOW_TERM]: true, '2027-1': true, '2027-2': true } }); }
let S = withUi(null, 'real');
function save() {
  if (S.mode !== 'real' && S.mode !== 'demo') return; // UT 진행 중에는 저장하지 않아요
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
const takenCodes = () => S.taken.map(x => x.c);
const semOf = code => { const x = S.taken.find(t => t.c === code); return x ? x.sem : ''; };
const isTaken = code => S.taken.some(t => t.c === code);
const ttCodes = key => S.tt[key].map(id => SEC(id)).filter(Boolean).map(s => s.code);
const sumCr = codes => codes.reduce((a, k) => a + C(k).cr, 0);
const ttCredits = key => sumCr(ttCodes(key));
const fmt = n => Math.round(n * 10) / 10;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const tabName = k => (k === 'A' ? '1안' : '2안');
const visiblePlan = () => { const tc = ttCodes(S.main); return S.plan.filter(p => !tc.includes(p.c) && !isTaken(p.c)); };
const planCredits = () => sumCr(visiblePlan().map(p => p.c));
const futureSems = () => semesters(S.profile).filter(s => s.k === 'future').map(s => s.id);
const semLabel = id => { const x = semesters(S.profile).find(s => s.id === id); return x ? `${id} · ${x.g}` : id; };
const areaLabel = code => { const a = areaOf(R, code); return a ? a.label : '일반선택'; };

/* 아직 계획하지 않은 지정 과목을 추천해요. 선수과목이 있으면 그 다음 학기에 놓아요. */
function recs() {
  if (!R.ok) return [];
  const fut = futureSems(); if (!fut.length) return [];
  const now = ttCodes(S.main), planned = S.plan.map(p => p.c);
  const out = [];
  const semFor = c => { const p = S.plan.find(x => x.c === c); if (p) return p.sem; const r = out.find(x => x.c === c); return r ? r.sem : null; };
  const must = [...new Set(allAreas(R).flatMap(a => a.must))].filter(c => !isTaken(c) && !now.includes(c) && !planned.includes(c));
  // 선수과목이 먼저 놓이도록 몇 번 돌려요
  for (let pass = 0; pass < 3; pass++) {
    must.forEach(c => {
      if (out.some(x => x.c === c)) return;
      let idx = 0;
      for (const [p] of prereqs(c)) {
        if (isTaken(p) || now.includes(p)) continue;
        const s = semFor(p); if (s === null) { if (must.includes(p)) return; else continue; }
        idx = Math.max(idx, fut.indexOf(s) + 1);
      }
      if (idx < fut.length) out.push({ c, sem: fut[idx], st: 'rec' });
    });
  }
  return out;
}
function statusOf(code) {
  if (isTaken(code)) return 'done';
  if (ttCodes(S.main).includes(code)) return 'now';
  if (S.plan.some(x => x.c === code)) return 'plan';
  if (recs().some(x => x.c === code)) return 'rec';
  return null;
}
/* 선수과목 순서 확인: 필수(R)는 못 지키면 경고, 권장(S)은 안내만 */
function prereqInfo(code, sem) {
  const list = prereqs(code);
  if (!list.length) return { ok: true, soft: false, t: '등록된 선수과목이 없어요.' };
  const now = ttCodes(S.main);
  const miss = [], okList = [];
  list.forEach(([p, t]) => {
    const n = C(p).n;
    if (isTaken(p)) okList.push(`${n} 이수`);
    else if (now.includes(p) && sem > NOW_TERM) okList.push(`${n} ${NOW_TERM} 수강 예정`);
    else { const pl = S.plan.find(x => x.c === p); if (pl && pl.sem < sem) okList.push(`${n} ${pl.sem} 계획`); else miss.push([n, t]); }
  });
  const hard = miss.filter(m => m[1] === 'R');
  if (!miss.length) return { ok: true, soft: false, t: `선수과목: ${okList.join(', ')}` };
  return {
    ok: !hard.length, soft: !hard.length,
    t: (hard.length ? `필수 선수과목 ${hard.map(m => m[0]).join(', ')}을(를) 먼저 들어야 해요.` : `${miss.map(m => m[0]).join(', ')}을(를) 먼저 들으면 좋아요(권장).`) + (okList.length ? ` (${okList.join(', ')})` : '')
  };
}
function conflicts(key) {
  const occ = {}; const pairs = [];
  S.tt[key].forEach(id => { const s = SEC(id); if (s) s.meets.forEach(([d, t]) => { const k = d + '-' + t; (occ[k] = occ[k] || []).push(id); }); });
  Object.values(occ).forEach(ids => { if (ids.length > 1) { const p = ids.slice().sort().join('|'); if (!pairs.includes(p)) pairs.push(p); } });
  return pairs.map(p => p.split('|'));
}
function clashWith(secId, key) {
  const m = SEC(secId).meets.map(x => x.join('-'));
  return S.tt[key].filter(id => SEC(id) && SEC(id).code !== SEC(secId).code && SEC(id).meets.some(x => m.includes(x.join('-'))));
}
const PT = p => (D.meta.periods.find(x => x[0] === p) || [p, '', ''])
/* 요일별로 이어진 교시를 묶어 "월 11:00–12:50" 처럼 보여 줘요 */
function timeText(id) {
  const s = SEC(id); if (!s.meets.length) return s.online ? '동영상 강의(시간 없음)' : '시간 미정';
  const by = {}; s.meets.forEach(([d, p]) => { (by[d] = by[d] || []).push(p); });
  return Object.keys(by).sort().map(d => {
    const ps = by[d].sort((a, b) => a - b); const runs = []; let st = ps[0], prev = ps[0];
    for (const p of ps.slice(1).concat([null])) { if (p === prev + 1) { prev = p; continue; } runs.push([st, prev]); st = p; prev = p; }
    return runs.map(([a, b]) => `${DAYS[d]} ${PT(a)[1]}–${PT(b)[2]}`).join(', ');
  }).join(', ');
}
function shortTime(id) {
  const s = SEC(id); if (!s.meets.length) return s.online ? '동영상' : '시간 미정';
  const ds = [...new Set(s.meets.map(m => DAYS[m[0]]))].join('·');
  return ds + ' ' + PT(Math.min(...s.meets.map(m => m[1])))[1];
}

/* ---------- 내비게이션 ---------- */
const $screen = document.getElementById('screen'), $tabs = document.getElementById('tabs'), $layer = document.getElementById('layer');
const cur = () => S.stack[S.stack.length - 1];
function saveScroll() { const sc = $screen.querySelector('.scroll'); if (sc && cur()) cur().y = sc.scrollTop; }
function go(s, p, opt) { saveScroll(); opt = opt || {}; if (opt.replace) S.stack.pop(); S.stack.push({ s, p: p || {} }); render(opt.toY); }
function back() { saveScroll(); if (S.stack.length > 1) { S.stack.pop(); render(cur().y || 0); } }
function tab(t) { saveScroll(); S.stack = [{ s: t }]; render(0); }
const TAB_OF = { home: 'home', req: 'home', area: 'home', roadmap: 'roadmap', course: 'roadmap', addplan: 'roadmap', tt: 'tt', compare: 'tt', alt: 'tt', search: 'tt', detail: 'tt', me: 'me', setup: 'me', register: 'me', source: 'me' };

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
  tt: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18" stroke="var(--bg)" stroke-width="2"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6z"/>'
};
const TABS = [['home', '홈'], ['roadmap', '로드맵'], ['tt', '시간표'], ['me', '내 정보']];
function renderTabs() {
  const active = TAB_OF[cur().s];
  $tabs.innerHTML = TABS.map(([k, n]) => `<button type="button" data-tab="${k}" ${active === k ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[k]}</svg>${n}</button>`).join('');
}

/* ---------- 공통 조각 ---------- */
const top = (title, opt) => { opt = opt || {}; return `<header class="top ${opt.big ? 'big' : ''}">${opt.big ? '' : '<button type="button" class="back" data-act="back" aria-label="뒤로 가기">‹</button>'}<h1>${title}</h1>${opt.right || ''}</header>`; };
const demoBar = () => S.mode === 'demo' ? `<div class="demo-bar"><span>예시 학생 데이터로 체험 중이에요</span><button type="button" data-act="demoEnd">체험 끝내기</button></div>` : '';
const SETUP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3L1 9l11 6 9-4.9V17h2V9z"/><path d="M5 13.2V17c0 1.7 3.1 3 7 3s7-1.3 7-3v-3.8l-7 3.8z"/></svg>';
const needSetup = (title, what) => `${top(title, { big: true })}<div class="scroll"><div class="empty"><div class="ico" aria-hidden="true">${SETUP_ICON}</div><div class="h3">학적 정보를 먼저 입력해 주세요</div><p class="note">입학 연도, 전공, 이수과정을 입력하면 내 기준으로 ${what}을(를) 보여 드려요.</p><button type="button" class="btn sm" data-go="setup">학적 정보 입력하기</button></div></div>`;
function barHtml(now, after, need) { if (!need) return ''; const a = Math.min(now, need) / need * 100, b = Math.max(0, Math.min(after, need) - Math.min(now, need)) / need * 100; return `<div class="bar" role="img" aria-label="${need}학점 중 ${fmt(now)}학점 이수, 계획 반영 시 ${fmt(after)}학점"><i style="width:${a}%"></i><i class="plan" style="width:${b}%"></i></div>`; }
const CAT_NAME = { 전기: '전공기초', 전필: '전공필수', 전선: '전공선택', 대교: '대학교양', 공기: '교양기초', 계기: '계열기초', 일반: '일반선택', RC: 'RC교육' };
const checkPill = a => a && a.check ? '<span class="pill gray" title="학교 자료에서 확인 중인 항목">확인 중</span>' : '';
function pendingCard(r) {
  const list = Object.keys(SUPPORTED).join(' · ');
  const why = r.reason === 'cohort' ? `${S.profile.year}학번 졸업요건은 준비 중이에요. 지금은 2020~2026학번을 지원해요.`
    : `${esc(S.profile.major)} 졸업요건은 준비 중이에요. 지금은 ${list} 전공을 지원해요.`;
  return `<div class="card" style="display:flex;flex-direction:column;gap:8px"><div class="row"><span class="pill gray">준비 중</span><div class="h3">졸업요건 데이터를 준비하고 있어요</div></div><p class="note" style="margin:0">${why} 시간표 짜기와 과목 찾기, 로드맵은 그대로 쓸 수 있어요.</p></div>`;
}

/* ---------- 화면: 홈 ---------- */
function vHome() {
  if (!S.onboarded) {
    return `${top('홈', { big: true })}<div class="scroll">
      <div class="empty" style="padding-top:56px"><div class="ico" aria-hidden="true">${SETUP_ICON}</div><div class="h3">학적 정보를 먼저 입력해 주세요</div>
      <p class="note" style="margin:0">입학 연도, 전공, 이수과정을 입력하고 들은 과목을 등록하면<br>졸업요건 이수율과 남은 과목을 정리해 드려요.</p>
      <button type="button" class="btn sm" data-go="setup">학적 정보 입력하기</button></div></div>`;
  }
  const d = takenCodes(), t = ttCodes(S.main);
  const A0 = assign(R, d), A1 = assign(R, d.concat(t));
  const need = R.ok ? R.total : 0, tot = A0.total, after = A1.total;
  const cf = conflicts(S.main).length;
  const hi = S.name ? `안녕하세요, ${esc(S.name)}님` : '안녕하세요';
  let reqCard = '';
  if (!R.ok) reqCard = pendingCard(R);
  else {
    const unmet = allAreas(R).filter(a => (A0.cr[a.id] || 0) < a.need || a.must.some(k => !d.includes(k)));
    reqCard = `<div class="between"><div class="h2">졸업요건 이수율</div></div>
    <div class="card" style="display:flex;flex-direction:column;gap:14px">
      ${R.groups.map(g => g.pending ? `<div class="between"><b>${esc(g.n)}</b><span class="pill gray">준비 중</span></div>` : `<div style="display:flex;flex-direction:column;gap:6px"><div class="between"><b>${esc(g.n)}</b><span class="muted small num">${fmt(A0.groupCr[g.k])} → ${fmt(A1.groupCr[g.k])} / ${g.need}학점</span></div>${barHtml(A0.groupCr[g.k], A1.groupCr[g.k], g.need)}</div>`).join('')}
      <div style="display:flex;flex-direction:column;gap:6px"><div class="between"><b>3·4000단위</b><span class="muted small num">${fmt(A0.u3)} → ${fmt(A1.u3)} / ${R.u3000}학점</span></div>${barHtml(A0.u3, A1.u3, R.u3000)}</div>
      <div class="legend"><span><i class="sw"></i>현재 이수</span><span><i class="sw plan"></i>${NOW_TERM} 시간표 반영 후</span></div>
      <button type="button" class="btn cta" data-go="req"><span>남은 졸업요건 보기</span><span class="cta-sub">${unmet.length}개 영역 · ${fmt(Math.max(0, need - tot))}학점 남음</span></button>
    </div>`;
  }
  // 놓치기 쉬운 항목
  const miss = [];
  if (R.ok) {
    miss.push(`<button type="button" class="li" data-go="area" data-a="U3000"><span class="grow"><b>3·4000단위 ${R.u3000}학점 중 ${fmt(A0.u3)}학점</b><br><span class="muted small">전공·교양 구분 없이 인정 · ${fmt(Math.max(0, R.u3000 - A0.u3))}학점 남음</span></span><span class="chev">›</span></button>`);
    allAreas(R).forEach(a => a.must.filter(k => !d.includes(k)).forEach(k => {
      if (miss.length >= 4) return;
      const inTT = t.includes(k), pl = S.plan.find(x => x.c === k);
      miss.push(`<button type="button" class="li" data-go="area" data-a="${a.id}"><span class="grow"><b>${esc(a.label)} '${esc(C(k).n)}' 미이수</b><br><span class="muted small">${C(k).cr}학점 · ${inTT ? '이번 학기 시간표에 담겨 있어요' : pl ? pl.sem + ' 계획에 있어요' : (D.secByCode[k] ? `${NOW_TERM} 개설 ${D.secByCode[k].length}개 분반` : `${NOW_TERM} 미개설`)}</span></span><span class="chev">›</span></button>`);
    }));
  }
  return `${top(hi, { big: true })}<div class="scroll">
    ${demoBar()}
    <div class="muted small" style="margin-top:-8px">${profileText(S.profile)}</div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div class="between"><span class="muted small">전체 이수율</span><span class="muted small">목표 졸업 ${S.profile.grad}</span></div>
      <div class="between"><span style="font-size:30px;font-weight:800" class="num">${need ? Math.round(tot / need * 100) + '%' : '—'}</span><span class="num"><b>${fmt(tot)}</b> / ${need || '—'}학점</span></div>
      ${barHtml(tot, after, need)}
      <div class="legend"><span><i class="sw"></i>이수 ${fmt(tot)}</span><span><i class="sw plan"></i>이번 학기 시간표 반영 시 ${fmt(after)}</span></div>
      ${S.taken.length ? '' : '<button type="button" class="btn weak sm" data-go="register" style="align-self:flex-start">들은 과목 등록하기</button>'}
    </div>
    ${reqCard}
    ${miss.length ? `<div class="card" style="display:flex;flex-direction:column;gap:4px">
      <div class="between"><div class="h3">놓치기 쉬운 항목</div><button type="button" class="link" data-go="roadmap">로드맵에서 보기 ›</button></div>${miss.join('')}</div>` : ''}
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div class="between"><div class="h3">${NOW_TERM} 시간표 계획</div><span class="pill gray">${tabName(S.main)}</span></div>
      ${S.tt[S.main].length ? `<div class="between"><span class="muted">담은 과목</span><b>${S.tt[S.main].length}과목 · ${fmt(ttCredits(S.main))}학점</b></div>
      <div class="between"><span class="muted">시간 충돌</span>${cf ? `<span class="pill bad">! ${cf}건</span>` : '<span class="pill ok">✓ 없음</span>'}</div>` : '<p class="note" style="margin:0">아직 담은 과목이 없어요.</p>'}
      <button type="button" class="btn" data-tab="tt">${S.tt[S.main].length ? '시간표 이어서 짜기' : '시간표 짜기'}</button>
    </div>
  </div>`;
}

/* ---------- 화면: 졸업요건 ---------- */
function vReq() {
  if (!S.onboarded) return needSetup('졸업요건', '졸업요건');
  const d = takenCodes(), A0 = assign(R, d);
  const head = `<div class="card" style="display:flex;flex-direction:column;gap:12px">
      <div class="between"><span class="muted small">내 기준</span><button type="button" class="link" data-go="setup">학적 변경 ›</button></div>
      <div class="chips">${profileText(S.profile, '|').split('|').filter(x => !/학년/.test(x)).map(x => `<span class="chip">${esc(x.replace('(복수전공)', ''))}</span>`).join('')}</div>
      ${R.ok ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;border-top:1px solid var(--line);padding-top:12px">
        <div><div class="muted tiny">졸업 학점</div><b class="num" style="font-size:17px">${fmt(A0.total)} / ${R.total}</b></div>
        <div><div class="muted tiny">부족 학점</div><b class="num" style="font-size:17px">${fmt(Math.max(0, R.total - A0.total))}학점</b></div>
        <div><div class="muted tiny">미충족 영역</div><b class="num" style="font-size:17px">${allAreas(R).filter(a => (A0.cr[a.id] || 0) < a.need || a.must.some(k => !d.includes(k))).length}개</b></div>
      </div>` : ''}
    </div>`;
  if (!R.ok) return `${top('졸업요건')}<div class="scroll">${head}${pendingCard(R)}<button type="button" class="link" data-go="source" style="align-self:flex-start">정보 출처 및 유의사항 ›</button></div>`;
  const mustLeft = [];
  allAreas(R).forEach(a => a.must.forEach(k => { if (!d.includes(k) && !mustLeft.some(m => m[1] === k)) mustLeft.push([a, k]); }));
  return `${top('졸업요건')}<div class="scroll">
    ${head}
    ${mustLeft.length ? `<div class="card soft" style="display:flex;flex-direction:column;gap:2px">
      <div class="h3">아직 듣지 않은 필수 과목</div>
      ${mustLeft.map(([a, k]) => { const st = statusOf(k); return `<button type="button" class="li" data-go="area" data-a="${a.id}"><span class="grow"><b>${esc(C(k).n)}</b><br><span class="muted small">${esc(a.label)} · ${C(k).cr}학점</span></span>${st ? badge(st) : '<span class="pill gray">미계획</span>'}<span class="chev">›</span></button>`; }).join('')}
    </div>` : ''}
    ${R.groups.map(g => g.pending ? `<div class="between"><div class="h2">${esc(g.n)}</div><span class="pill gray">준비 중</span></div><div class="card"><p class="note" style="margin:0">${esc(g.n.split(' · ')[0])} ${S.profile.track === '연계전공' ? '연계전공' : ''} 요건은 준비 중이에요. 지금은 ${Object.keys(SUPPORTED).join(' · ')}을 지원해요.</p></div>`
      : `<div class="between"><div class="h2">${esc(g.n)}</div><span class="muted small num">${fmt(A0.groupCr[g.k])} / ${g.need}학점</span></div>
      <div class="card" style="padding:4px 16px">${g.areas.map(a => { const n = A0.cr[a.id] || 0, left = a.must.filter(k => !d.includes(k)).length, ok = n >= a.need && !left; return `<button type="button" class="li" data-go="area" data-a="${a.id}">
        <span class="grow" style="display:flex;flex-direction:column;gap:6px"><span class="between"><b>${esc(a.n)} ${checkPill(a)}</b><span class="num small">${fmt(n)} / ${a.need}</span></span>${barHtml(n, n, a.need)}</span>
        ${ok ? '<span class="pill ok">✓ 충족</span>' : `<span class="pill bad">${n < a.need ? fmt(a.need - n) + '학점 남음' : left + '과목 남음'}</span>`}<span class="chev">›</span></button>`; }).join('')}</div>`).join('')}
    <div class="between"><div class="h2">공통 조건</div></div>
    <div class="card" style="padding:4px 16px"><button type="button" class="li" data-go="area" data-a="U3000"><span class="grow" style="display:flex;flex-direction:column;gap:6px"><span class="between"><b>3·4000단위</b><span class="num small">${fmt(A0.u3)} / ${R.u3000}</span></span>${barHtml(A0.u3, A0.u3, R.u3000)}</span>${A0.u3 >= R.u3000 ? '<span class="pill ok">✓ 충족</span>' : `<span class="pill bad">${fmt(R.u3000 - A0.u3)}학점 남음</span>`}<span class="chev">›</span></button></div>
    <button type="button" class="link" data-go="source" style="align-self:flex-start">정보 출처 및 유의사항 ›</button>
  </div>`;
}
const U3 = () => ({ id: 'U3000', g: 'common', label: '3·4000단위', n: '3·4000단위', need: R.u3000, must: [], cat: [] });
function vArea(p) {
  const a = p.a === 'U3000' ? U3() : areaById(R, p.a);
  if (!a) return `${top('졸업요건')}<div class="scroll"><p class="note">이 영역을 찾을 수 없어요. 학적이 바뀌었을 수 있어요.</p></div>`;
  const d = takenCodes(), A0 = assign(R, d);
  const inArea = k => a.id === 'U3000' ? C(k).u >= 3000 : (A0.of[k] ? A0.of[k].id === a.id : false);
  const inAreaNew = k => a.id === 'U3000' ? C(k).u >= 3000 : ((areaOf(R, k) || {}).id === a.id);
  const done = d.filter(inArea);
  const now = ttCodes(S.main).filter(inAreaNew);
  const plans = visiblePlan().filter(x => inAreaNew(x.c));
  const n = a.id === 'U3000' ? A0.u3 : (A0.cr[a.id] || 0);
  const left = a.must.filter(k => !d.includes(k));
  const ok = n >= a.need && !left.length;
  const g = groupOf(R, a.g);
  const secRows = code => (D.secByCode[code] || []).map(x => { const cl = clashWith(x.id, S.main); const mine = S.tt[S.main].includes(x.id); return `<button type="button" class="between small secrow" data-go="detail" data-sec="${x.id}"><span>${x.no}분반 · ${esc(x.prof)}</span><span class="muted">${shortTime(x.id)}</span>${mine ? '<span class="pill info">● 담은 분반</span>' : cl.length ? '<span class="pill bad">겹침</span>' : '<span class="pill ok">가능</span>'}</button>`; }).join('');
  const rule = a.id === 'U3000' ? `3000·4000단위 과목을 전공·교양 구분 없이 ${a.need}학점 이상 이수해요.` : ruleText(a, R);
  return `${top((g ? g.n + ' · ' : '') + a.n)}<div class="scroll">
    <div class="card" style="display:flex;flex-direction:column;gap:8px">
      <div class="between"><span style="font-size:26px;font-weight:800" class="num">${fmt(n)} / ${a.need}</span>${ok ? '<span class="pill ok">✓ 모두 이수했어요</span>' : `<span class="pill bad">${n < a.need ? fmt(a.need - n) + '학점 남음' : left.length + '과목 남음'}</span>`}</div>
      ${barHtml(n, n, a.need)}
    </div>
    <div><div class="h3">영역 규칙</div><p class="note" style="margin:4px 0 0">${esc(rule)}</p></div>
    ${a.check ? `<div class="card" style="display:flex;flex-direction:column;gap:4px"><div class="row"><span class="pill gray">확인 중</span><b class="small">학교 자료에서 확인하고 있는 내용이에요</b></div><p class="note" style="margin:0">${esc(a.check)}</p></div>` : ''}
    ${left.length ? `<div class="card" style="display:flex;flex-direction:column;gap:8px;box-shadow:inset 0 0 0 1.5px var(--g900)"><div class="between"><div class="h3">남은 지정 과목</div><span class="muted small">${left.length}과목</span></div>
      ${left.map(k => { const st = statusOf(k); return `<div style="display:flex;flex-direction:column;gap:4px"><div class="between"><b>${esc(C(k).n)}</b>${st ? badge(st) : '<span class="pill gray">미계획</span>'}</div><span class="muted small">${k} · ${C(k).cr}학점 · ${D.secByCode[k] ? `${NOW_TERM} 개설 ${D.secByCode[k].length}개 분반` : `${NOW_TERM} 미개설`}</span>${secRows(k)}${D.secByCode[k] ? '' : `<button type="button" class="link" data-go="course" data-c="${k}" style="align-self:flex-start">로드맵 계획에 담기 ›</button>`}</div>`; }).join('')}</div>` : ''}
    ${now.length ? `<div class="card" style="display:flex;flex-direction:column;gap:2px"><div class="h3">이번 학기 시간표에 담은 과목</div>${now.map(k => `<div class="li"><span class="grow"><b>${esc(C(k).n)}</b><br><span class="muted small">${C(k).cr}학점</span></span>${badge('now')}</div>`).join('')}</div>` : ''}
    ${plans.length ? `<div class="card" style="display:flex;flex-direction:column;gap:2px"><div class="h3">로드맵에 넣어 둔 과목</div>${plans.map(x => `<button type="button" class="li" data-go="course" data-c="${x.c}"><span class="grow"><b>${esc(C(x.c).n)}</b><br><span class="muted small">${x.sem} · ${C(x.c).cr}학점</span></span>${badge('plan')}<span class="chev">›</span></button>`).join('')}</div>` : ''}
    <div class="card" style="display:flex;flex-direction:column;gap:2px"><div class="between"><div class="h3">이수한 과목</div><span class="muted small">${done.length}과목</span></div>${done.length ? done.map(k => `<div class="li"><span class="grow"><b>${esc(C(k).n)}</b><br><span class="muted small">${semOf(k)} · ${C(k).cr}학점</span></span>${badge('done')}</div>`).join('') : '<p class="note">아직 이수한 과목이 없어요.</p>'}</div>
    ${ok ? '' : `<button type="button" class="btn weak" data-go="search" data-req="${a.id}">${NOW_TERM} 개설 과목에서 찾기</button>`}
  </div>`;
}

/* ---------- 화면: 로드맵 ---------- */
function courseCard(code, st, opt) {
  opt = opt || {}; const x = C(code);
  const pr = prereqs(code)[0];
  const pre = S.showPre && pr ? `<span class="pre">선수 ${esc(C(pr[0]).n)}${pr[1] === 'R' ? '' : '(권장)'} ${isTaken(pr[0]) || ttCodes(S.main).includes(pr[0]) ? '✓' : '!'}</span>` : '';
  return `<button type="button" class="cc cc-${st} ${opt.flash ? 'flash' : ''}" data-go="course" data-c="${code}" aria-label="${esc(x.n)}, ${ST[st][1]}, ${esc(areaLabel(code))} ${x.cr}학점">${badge(st)}<span class="nm">${esc(x.n)}</span><span class="mt">${esc(areaLabel(code))} · ${x.cr}학점${x.u >= 3000 ? ' · 3000↑' : ''}</span>${pre}</button>`;
}
function vRoadmap() {
  if (!S.onboarded) return needSetup('학사 로드맵', '학기별 로드맵');
  const f = S.rmFilter;
  const majorGroups = R.groups.filter(g => g.k !== 'gen' && !g.pending);
  const pass = code => { if (f === 'all') return true; const a = areaOf(R, code); if (f === 'gen') return !a || a.g === 'gen'; return a && a.g === f; };
  const pc = planCredits(), tc = ttCredits(S.main), tot = sumCr(takenCodes()), pred = tot + tc + pc;
  const vp = visiblePlan().map(x => ({ ...x, st: 'plan' })).concat(recs());
  const SEMS = semesters(S.profile);
  const flash = S.flash, need = R.ok ? R.total : 0;
  const semHtml = sem => {
    let items = [];
    if (sem.k === 'done') items = S.taken.filter(x => x.sem === sem.id).map(x => [x.c, 'done']);
    else if (sem.k === 'now') items = ttCodes(S.main).map(k => [k, 'now']);
    else items = vp.filter(x => x.sem === sem.id).map(x => [x.c, x.st]);
    const shown = items.filter(([k]) => pass(k));
    const cr = items.filter(([, st]) => st !== 'rec').reduce((a, [k]) => a + C(k).cr, 0);
    const open = S.open[sem.id] !== undefined ? !!S.open[sem.id] : sem.k !== 'done';
    const tag = sem.k === 'now' ? '<span class="pill info">이번 학기</span>' : sem.k === 'done' ? '<span class="pill gray">이수 완료</span>' : '';
    return `<section class="sem ${sem.k === 'now' ? 'now' : ''}" id="sem-${sem.id}">
      <button type="button" class="sem-h" data-act="toggleSem" data-sem="${sem.id}" data-open="${open}" aria-expanded="${open}"><span style="flex:1;display:flex;flex-direction:column;gap:2px"><span class="row"><span class="yr num">${sem.id}</span><span class="gr">· ${sem.g}</span></span><span class="muted small">${sem.k === 'future' ? '계획 ' + fmt(cr) + '학점' : '총 ' + fmt(cr) + '학점'} · ${items.length}과목</span></span>${tag}<span class="chev" aria-hidden="true">${open ? '▴' : '▾'}</span></button>
      ${open ? `<div class="sem-b"><div class="grid3">${shown.map(([k, st]) => courseCard(k, st, { flash: flash.includes(k) })).join('')}
        ${sem.k === 'future' ? `<button type="button" class="addc" data-go="addplan" data-sem="${sem.id}"><b aria-hidden="true">+</b>과목 추가</button>` : ''}
        ${sem.k === 'done' ? `<button type="button" class="addc" data-go="register" data-sem="${sem.id}"><b aria-hidden="true">+</b>들은 과목 등록</button>` : ''}</div>
        ${sem.k === 'now' ? `<button type="button" class="link" data-tab="tt" style="align-self:flex-start">${NOW_TERM} 시간표에서 ${items.length ? '바꾸기' : '과목 담기'} ›</button>` : ''}
        ${shown.length === 0 && items.length ? '<p class="note">이 필터에 해당하는 과목이 없어요.</p>' : ''}</div>` : ''}
    </section>`;
  };
  return `${top('학사 로드맵', { big: true, right: `<select class="jump" id="jump" aria-label="학기 바로가기"><option value="">학기 바로가기</option>${SEMS.map(s => `<option value="${s.id}">${s.id} · ${s.g}</option>`).join('')}</select>` })}
  <div class="scroll">
    ${demoBar()}
    <div class="card" style="display:flex;flex-direction:column;gap:8px">
      <div class="between"><span class="muted small">계획 포함 졸업 예상</span><span class="muted small">목표 ${S.profile.grad}</span></div>
      <div class="between"><b class="num" style="font-size:22px">${fmt(pred)} / ${need || '—'}학점</b>${!need ? '' : pred >= need ? '<span class="pill ok">✓ 졸업 학점 충족</span>' : `<span class="pill bad">${fmt(need - pred)}학점 더 계획 필요</span>`}</div>
      ${barHtml(tot, pred, need)}
      <div class="legend"><span><i class="sw"></i>이수 ${fmt(tot)}</span><span><i class="sw plan"></i>수강 중·계획 ${fmt(tc + pc)}</span></div>
    </div>
    <div class="legend" aria-label="과목 상태 범례">${badge('done')}${badge('now')}${badge('plan')}${badge('rec')}</div>
    <div class="between" style="flex-wrap:wrap">
      <div class="chips">${[['all', '전체'], ...majorGroups.map(g => [g.k, g.short]), ['gen', '교양·일반']].map(([k, n]) => `<button type="button" class="chip" data-act="rmFilter" data-f="${k}" aria-pressed="${f === k}">${n}</button>`).join('')}</div>
      <button type="button" class="switch" role="switch" aria-checked="${S.showPre}" data-act="togglePre"><span class="knob" aria-hidden="true"></span>선수과목</button>
    </div>
    ${S.showPre ? '<p class="note" style="margin:-4px 0 0">카드 아래 "선수"는 먼저 들으면 좋은 과목이에요. ✓는 이미 들었거나 이번 학기에 듣는 과목, !는 아직 안 들은 과목이에요. 과목을 누르면 순서를 확인할 수 있어요.</p>' : ''}
    ${SEMS.map(semHtml).join('')}
  </div>`;
}
function vCourse(p) {
  const code = p.c, x = C(code), st = statusOf(code), pl = S.plan.find(y => y.c === code), rc = recs().find(y => y.c === code);
  const sem = semOf(code) || (st === 'now' ? NOW_TERM : pl ? pl.sem : rc ? rc.sem : '');
  const fut = futureSems();
  const sel = p.sel || (fut.includes(sem) ? sem : fut[0] || '');
  const pre = prereqInfo(code, sel);
  const a = areaOf(R, code);
  const reqLine = `${a ? a.label : '일반선택'} +${x.cr}학점${x.u >= 3000 ? ' · 3·4000단위 +' + x.cr + '학점' : ''}`;
  const canPlan = st !== 'done' && st !== 'now' && fut.length;
  const actions = canPlan ? `<div class="field"><label for="semSel">${st === 'plan' ? '계획 학기' : '담을 학기'}</label><select id="semSel">${fut.map(s => `<option value="${s}" ${s === sel ? 'selected' : ''}>${semLabel(s)}</option>`).join('')}</select></div>
      <div class="banner ${pre.ok ? 'ok' : 'bad'}"><span aria-hidden="true">${pre.ok ? '✓' : '!'}</span><div><b>${pre.ok ? (pre.soft ? '선수과목 순서 참고' : '선수과목 순서 확인') : '선수과목 순서 확인 필요'}</b><p>${esc(pre.t)}</p></div></div>` : '';
  const footBtns = st === 'plan' ? `<button type="button" class="btn" data-act="savePlan" data-c="${code}" ${sel === sem ? 'disabled' : ''}>${sel === sem ? '학기를 바꾸면 저장할 수 있어요' : sel + '(으)로 옮기기'}</button><button type="button" class="btn weak" data-act="removePlan" data-c="${code}">계획에서 빼기</button>`
    : canPlan ? `<button type="button" class="btn" data-act="adoptRec" data-c="${code}">${sel} 계획에 담기</button>`
      : st === 'now' ? `<button type="button" class="btn weak" data-tab="tt">시간표에서 보기</button>` : '';
  const pres = prereqs(code), nexts = Object.keys(D.pre).filter(k => D.pre[k].some(q => q[0] === code)).slice(0, 8);
  return `${top('과목 계획')}<div class="scroll">
    <div class="row">${st ? badge(st) : '<span class="pill gray">미계획</span>'}<span class="muted small">${code}</span></div>
    <div><div style="font-size:24px;font-weight:800">${esc(x.n)}</div><div class="muted">${esc(a ? a.label : '일반선택')} · ${x.cr}학점</div></div>
    <div class="card" style="padding:4px 16px">
      <div class="li"><span class="grow muted">${st === 'done' ? '이수 학기' : '계획 학기'}</span><b>${sem ? semLabel(sem) : '-'}</b></div>
      <div class="li"><span class="grow muted">${NOW_TERM} 개설</span><b>${D.secByCode[code] ? D.secByCode[code].length + '개 분반' : '없음'}</b></div>
    </div>
    ${pres.length || nexts.length ? `<div class="card" style="display:flex;flex-direction:column;gap:8px"><div class="h3">선수과목 관계</div>
      ${pres.length ? `<div class="small"><span class="muted">먼저 들으면 좋은 과목</span><div class="tags" style="margin-top:6px">${pres.map(([q, t]) => `<button type="button" class="pill ${isTaken(q) ? 'ok' : 'gray'}" data-go="course" data-c="${q}">${isTaken(q) ? '✓ ' : ''}${esc(C(q).n)}${t === 'R' ? ' (필수)' : ''}</button>`).join('')}</div></div>` : ''}
      ${nexts.length ? `<div class="small"><span class="muted">이 과목 다음에 듣는 과목</span><div class="tags" style="margin-top:6px">${nexts.map(q => `<button type="button" class="pill gray" data-go="course" data-c="${q}">${esc(C(q).n)}</button>`).join('')}</div></div>` : ''}
      <p class="note" style="margin:0">강의계획서와 요람에 적힌 선수과목이에요. (필수)가 없으면 권장 과목이에요.</p></div>` : ''}
    <div class="card soft"><div class="h3">이 과목을 이수하면</div><p style="margin:6px 0 0">${esc(reqLine)}</p></div>
    ${actions}
    ${canPlan ? '<p class="note">미래 학기의 개설 여부와 분반은 수강편람이 나온 뒤 확인할 수 있어요. 지금은 지난 학기 개설 이력을 바탕으로 한 잠정 계획이에요.</p>' : ''}
  </div>${footBtns ? `<div class="foot">${footBtns}</div>` : ''}`;
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
  if (!fut.length) return `${top('계획 과목 추가')}<div class="scroll"><p class="note">목표 졸업 학기가 이번 학기라 계획할 다음 학기가 없어요. 내 정보에서 목표 졸업 학기를 바꿀 수 있어요.</p></div>`;
  const sem = p.sem && fut.includes(p.sem) ? p.sem : fut[0];
  const q = (p.q || '').trim(), f = p.f || 'all', sel = p.sel || [];
  const blocked = c => isTaken(c) || ttCodes(S.main).includes(c);
  const majorGroups = R.groups.filter(g => g.k !== 'gen' && !g.pending);
  let list;
  if (q) list = searchCatalog(q, c => !blocked(c) && groupFilter(f)(c), 60);
  else {
    const first = recs().map(r => r.c);
    const rest = searchCatalog('', c => !blocked(c) && !first.includes(c) && groupFilter(f === 'all' && majorGroups.length ? majorGroups[0].k : f)(c) && (f === 'gen' || C(c).u >= 2000), 40);
    list = first.filter(groupFilter(f)).concat(rest);
  }
  const cr = sel.reduce((a, c) => a + C(c).cr, 0);
  return `${top('계획 과목 추가')}<div class="scroll">
    <div class="field"><label for="addSem">추가할 학기</label><select id="addSem">${fut.map(s => `<option value="${s}" ${s === sem ? 'selected' : ''}>${semLabel(s)}</option>`).join('')}</select></div>
    <input class="search" id="addQ" type="search" placeholder="과목명 또는 학수번호 검색" value="${esc(q)}" aria-label="과목 검색">
    <div class="chips">${[['all', '전체'], ...majorGroups.map(g => [g.k, g.short]), ['gen', '교양']].map(([k, n]) => `<button type="button" class="chip" data-act="addF" data-f="${k}" aria-pressed="${f === k}">${n}</button>`).join('')}</div>
    <div class="h3">${q ? `"${esc(q)}" 검색 결과` : '내 졸업요건에 필요한 과목'}</div>
    <div style="display:flex;flex-direction:column;gap:8px">
    ${list.length ? list.map(c => {
      const pl = S.plan.find(x => x.c === c); const on = sel.includes(c); const pre = prereqInfo(c, sem); const a = areaOf(R, c); const isRec = recs().some(r => r.c === c);
      return `<button type="button" class="opt" role="checkbox" aria-checked="${on}" data-act="addToggle" data-c="${c}" ${pl ? 'disabled' : ''}><span class="check" aria-hidden="true">${on ? '✓' : ''}</span><span class="grow"><span class="between"><b>${esc(C(c).n)}</b><span class="muted tiny">${c}</span></span><span class="muted small">${C(c).cr}학점${C(c).u >= 3000 ? ' · 3000단위' : ''}${D.secByCode[c] ? ` · ${NOW_TERM} 개설` : ''}</span>
      <span class="tags">${pl ? `<span class="pill gray">이미 ${pl.sem} 계획에 있어요</span>` : isRec ? badge('rec') : ''}${a ? `<span class="pill ok">✓ ${esc(a.label)} 인정</span>` : '<span class="pill gray">일반선택</span>'}${pre.ok ? '' : '<span class="pill bad">! 선수과목 필요</span>'}</span></span></button>`;
    }).join('') : '<p class="note">검색 결과가 없어요. 다른 이름으로 찾아보세요.</p>'}
    </div>
  </div>
  <div class="foot"><div class="sum">${sel.length ? `<b>${sel.map(c => esc(C(c).n)).join(', ')}</b> · ${sel.length}과목 ${fmt(cr)}학점을 <b>${sem}</b>에 추가해요` : '추가할 과목을 골라 주세요'}</div>
  <button type="button" class="btn" data-act="addPlan" ${sel.length ? '' : 'disabled'}>${sel.length ? `${sem}에 ${sel.length}과목 추가하기` : '과목을 선택해 주세요'}</button></div>`;
}

/* ---------- 화면: 시간표 ---------- */
function ttGrid(key, flash) {
  const occ = {}; let pMin = 1, pMax = 9, sat = false;
  S.tt[key].forEach(id => { const s = SEC(id); if (!s) return; s.meets.forEach(([d, t]) => { (occ[d + '-' + t] = occ[d + '-' + t] || []).push(id); pMin = Math.min(pMin, t); pMax = Math.max(pMax, t); if (d === 5) sat = true; }); });
  const days = DAYS.slice(0, sat ? 6 : 5);
  let h = '<div class="hd">교시</div>' + days.map(d => `<div class="hd">${d}</div>`).join('');
  for (let t = pMin; t <= pMax; t++) {
    h += `<div class="tm"><b>${t}</b>${PT(t)[1]}</div>`;
    days.forEach((_, d) => {
      const ids = occ[d + '-' + t] || [];
      if (!ids.length) h += '<div></div>';
      else if (ids.length === 1) h += `<div><button type="button" class="blk ${flash.includes(ids[0]) ? 'flash' : ''}" data-go="detail" data-sec="${ids[0]}">${esc(C(SEC(ids[0]).code).n)}<small>${SEC(ids[0]).no}분반</small></button></div>`;
      else h += `<div><button type="button" class="blk cf" data-go="alt">! 충돌<small style="color:inherit">${ids.map(i => esc(C(SEC(i).code).n)).join(' · ')}</small></button></div>`;
    });
  }
  const online = S.tt[key].filter(id => SEC(id) && !SEC(id).meets.length);
  return `<div class="tt" style="grid-template-columns:44px repeat(${days.length},minmax(0,1fr))" role="grid" aria-label="${NOW_TERM} 시간표 ${tabName(key)}">${h}</div>${online.length ? `<p class="note" style="margin:0">시간이 없는 동영상 강의: ${online.map(i => esc(C(SEC(i).code).n)).join(', ')}</p>` : ''}`;
}
function vTT() {
  if (!S.onboarded) return needSetup(`${NOW_TERM} 시간표`, '시간표와 요건');
  const key = S.ttTab, cf = conflicts(key);
  const isMain = S.main === key, empty = !S.tt[key].length;
  return `${top(`${NOW_TERM} 시간표`, { big: true })}<div class="scroll">
    ${demoBar()}
    <div class="seg" role="group" aria-label="시간표 안"><button type="button" data-act="ttTab" data-k="A" aria-pressed="${key === 'A'}">1안${S.main === 'A' ? ' ★' : ''}</button><button type="button" data-act="ttTab" data-k="B" aria-pressed="${key === 'B'}">2안${S.main === 'B' ? ' ★' : ''}</button><button type="button" data-go="compare">비교</button></div>
    ${empty ? `<div class="empty" style="padding:28px 12px"><div class="h3">${tabName(key)}이 비어 있어요</div><p class="note" style="margin:0">${NOW_TERM} 수강편람의 신촌 분반 ${D.sections.length.toLocaleString()}개에서 과목을 찾아 담을 수 있어요.</p></div>`
      : cf.length ? `<div class="banner bad"><span aria-hidden="true">!</span><div><b>시간 충돌 ${cf.length}건</b><p>${cf.map(pr => pr.map(i => esc(C(SEC(i).code).n)).join('과(와) ') + '의 시간이 겹쳐요.').join(' ')}</p></div></div>`
        : '<div class="banner ok"><span aria-hidden="true">✓</span><div><b>시간 충돌이 없어요</b><p>담은 과목을 모두 들을 수 있어요.</p></div></div>'}
    ${empty ? '' : ttGrid(key, S.flash)}
    ${empty ? '' : `<div class="between"><b class="num">총 ${fmt(ttCredits(key))}학점</b><span class="muted">${S.tt[key].length}과목${isMain ? ' · 내 시간표(★)' : ''}</span></div>
    <div class="card" style="padding:4px 16px">${S.tt[key].filter(id => SEC(id)).map(id => `<button type="button" class="li" data-go="detail" data-sec="${id}"><span class="grow"><b>${esc(C(SEC(id).code).n)}</b> <span class="muted small">${SEC(id).no}분반</span><br><span class="muted small">${shortTime(id)} · ${esc(areaLabel(SEC(id).code))}</span></span>${clashWith(id, key).length ? '<span class="pill bad">! 충돌</span>' : ''}<span class="chev">›</span></button>`).join('')}</div>`}
  </div>
  <div class="foot">${cf.length ? `<button type="button" class="btn" data-go="alt">충돌 없는 대안 보기</button>` : ''}<button type="button" class="btn ${cf.length ? 'weak' : ''}" data-go="search">과목 검색해서 담기</button></div>`;
}
function vCompare() {
  const col = k => {
    const t = ttCodes(k), cf = conflicts(k).length;
    const by = {}; t.forEach(c => { const a = areaOf(R, c); const g = a ? groupOf(R, a.g) : null; const n = g ? (g.short || '교양') : '일반'; by[n] = (by[n] || 0) + C(c).cr; });
    return `<div class="card" style="display:flex;flex-direction:column;gap:8px;${S.main === k ? 'box-shadow:inset 0 0 0 1.5px var(--yb)' : ''}"><div class="between"><b style="font-size:17px">${tabName(k)}</b>${S.main === k ? '<span class="pill info">★ 내 시간표</span>' : ''}</div>
    ${cf ? `<span class="pill bad" style="align-self:flex-start">! 충돌 ${cf}건</span>` : '<span class="pill ok" style="align-self:flex-start">✓ 충돌 없음</span>'}
    <div class="small">${t.length}과목 · ${fmt(ttCredits(k))}학점</div>
    <div class="small muted">${Object.entries(by).map(([n, v]) => `${n} ${fmt(v)}`).join(' · ') || '담은 과목 없음'}</div>
    <div class="small muted">3·4000단위 +${fmt(sumCr(t.filter(c => C(c).u >= 3000)))}</div>
    <div class="small muted">공강: ${DAYS.slice(0, 5).filter((_, d) => !S.tt[k].some(id => SEC(id) && SEC(id).meets.some(m => m[0] === d))).join(', ') || '없음'}</div>
    ${S.main === k ? '' : `<button type="button" class="btn sm" data-act="setMain" data-k="${k}">${tabName(k)}을 내 시간표로</button>`}</div>`;
  };
  return `${top('시간표 비교')}<div class="scroll"><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${col('A')}${col('B')}</div><p class="note">내 시간표(★)로 고른 안이 홈의 "시간표 반영 후" 이수율과 로드맵 ${NOW_TERM} 학기에 반영돼요.</p></div>`;
}
function vAlt(p) {
  const key = S.ttTab, cf = conflicts(key);
  if (!cf.length) return `${top('대안 과목')}<div class="scroll"><div class="banner ok"><span>✓</span><div><b>시간 충돌이 없어요</b><p>지금 시간표에는 바꿀 과목이 없어요.</p></div></div></div>`;
  const pair = cf[0]; const target = p.t && pair.includes(p.t) ? p.t : pair[0]; const other = pair.find(x => x !== target);
  const tc = SEC(target).code, tx = C(tc), ta = areaOf(R, tc);
  const without = S.tt[key].filter(i => i !== target);
  const clash = sid => { const m = SEC(sid).meets.map(x => x.join('-')); return without.filter(i => SEC(i) && SEC(i).meets.some(x => m.includes(x.join('-')))); };
  const sameSecs = (D.secByCode[tc] || []).filter(x => x.id !== target);
  const fixed = ta && ta.must.includes(tc);
  const inTT = c => S.tt[key].some(i => SEC(i) && SEC(i).code === c);
  let others = [];
  if (!fixed) {
    others = D.sections.filter(x => x.code !== tc && !inTT(x.code) && !isTaken(x.code) && x.meets.length && !clash(x.id).length && (ta ? (areaOf(R, x.code) || {}).id === ta.id : C(x.code).k === tx.k && x.code.slice(0, 3) === tc.slice(0, 3)));
    // 로드맵에 계획한 과목을 앞에
    others.sort((a, b) => (S.plan.some(y => y.c === b.code) ? 1 : 0) - (S.plan.some(y => y.c === a.code) ? 1 : 0));
    others = others.slice(0, 8);
  }
  const pick = p.pick || null;
  const optHtml = (sc, kind) => {
    const cl = clash(sc.id), x = C(sc.code); const on = pick === sc.id; const st = statusOf(sc.code);
    return `<button type="button" class="opt" role="radio" aria-checked="${on}" data-act="altPick" data-sec="${sc.id}"><span class="radio" aria-hidden="true"></span><span class="grow"><span class="between"><b>${esc(x.n)} ${sc.no}분반</b>${cl.length ? '<span class="pill bad">! 충돌</span>' : '<span class="pill ok">✓ 충돌 없음</span>'}</span>
      <span class="muted small">${shortTime(sc.id)} · ${esc(sc.prof)} · ${x.cr}학점</span>
      <span class="tags"><span class="pill ok">✓ ${esc(areaLabel(sc.code))} 인정</span>${tx.u >= 3000 ? (x.u >= 3000 ? '<span class="pill ok">✓ 3·4000단위 유지</span>' : `<span class="pill bad">3·4000단위 −${tx.cr}</span>`) : ''}${kind === 'other' && st ? badge(st) : ''}</span>
      ${kind === 'other' && S.plan.find(y => y.c === sc.code) ? `<span class="muted tiny">로드맵 ${S.plan.find(y => y.c === sc.code).sem}에 있던 과목을 이번 학기로 당겨 와요.</span>` : ''}</span></button>`;
  };
  const picked = pick ? SEC(pick) : null;
  return `${top('대안 과목')}<div class="scroll">
    <div class="card soft"><b>${esc(C(SEC(pair[0]).code).n)}</b>과 <b>${esc(C(SEC(pair[1]).code).n)}</b>의 시간이 겹쳐요 <span class="muted small">(${shortTime(pair[0])})</span></div>
    <div><div class="h3" style="margin-bottom:8px">어느 과목을 바꿀까요?</div>
    <div class="seg" role="group">${pair.map(i => `<button type="button" data-act="altTarget" data-t="${i}" aria-pressed="${i === target}">${esc(C(SEC(i).code).n)}</button>`).join('')}</div></div>
    <div class="h2">같은 과목의 다른 분반</div>
    <div style="display:flex;flex-direction:column;gap:8px">${sameSecs.length ? sameSecs.map(x => optHtml(x, 'same')).join('') : '<p class="note">다른 분반이 개설되지 않았어요.</p>'}</div>
    <div class="h2">같은 요건을 채우는 다른 과목</div>
    ${fixed ? `<p class="note" style="margin:0">${esc(tx.n)}은(는) ${esc(ta.label)} 지정 과목이라 다른 과목으로 대신할 수 없어요. 다른 과목으로 바꾸고 싶다면 위에서 <b>${esc(C(SEC(other).code).n)}</b>을(를) 골라 보세요.</p>`
      : others.length ? `<div style="display:flex;flex-direction:column;gap:8px">${others.map(x => optHtml(x, 'other')).join('')}</div><p class="note" style="margin:0">${NOW_TERM} 개설 분반 중 지금 시간표와 겹치지 않고 ${esc(ta ? ta.label : '같은 분류')}(으)로 인정되는 과목이에요.</p>` : '<p class="note">조건에 맞는 다른 과목이 없어요.</p>'}
  </div>
  <div class="foot"><div class="sum">${picked ? `<b>${esc(tx.n)} ${SEC(target).no}분반</b> → <b>${esc(C(picked.code).n)} ${picked.no}분반</b>` : '바꿀 분반이나 과목을 골라 주세요'}</div>
  <button type="button" class="btn" data-act="altApply" data-t="${target}" ${pick ? '' : 'disabled'}>${picked ? '이 과목으로 교체하기' : '대안을 선택해 주세요'}</button></div>`;
}
function vSearch(p) {
  const key = S.ttTab; const q = (p.q || '').trim(), tb = p.tab || 'all', req = p.req || null, mine = !!p.mine, noClash = !!p.noClash, limit = p.limit || 40;
  const majors = R.groups.filter(g => g.k !== 'gen' && !g.pending);
  const ql = q.toLowerCase();
  let list = D.sections.filter(x => !isTaken(x.code));
  if (tb === 'major') list = list.filter(x => majors.some(g => x.code.startsWith(g.prefix) || g.areas.some(a => a.must.includes(x.code))));
  if (tb === 'gen') list = list.filter(x => groupFilter('gen')(x.code));
  if (req) list = list.filter(x => req === 'U3000' ? C(x.code).u >= 3000 : (areaOf(R, x.code) || {}).id === req);
  if (mine) list = list.filter(x => areaOf(R, x.code));
  if (noClash) list = list.filter(x => !clashWith(x.id, key).length);
  if (q) list = list.filter(x => C(x.code).n.toLowerCase().includes(ql) || x.code.toLowerCase().includes(ql) || x.prof.includes(q));
  const reqA = req ? (req === 'U3000' ? U3() : areaById(R, req)) : null;
  return `${top('과목 검색')}<div class="scroll">
    <input class="search" id="sQ" type="search" placeholder="과목명, 교수명, 학수번호" value="${esc(q)}" aria-label="과목 검색">
    <div class="seg" role="group">${[['all', '전체'], ['major', '내 전공'], ['gen', '교양']].map(([k, n]) => `<button type="button" data-act="sTab" data-k="${k}" aria-pressed="${tb === k}">${n}</button>`).join('')}</div>
    <div class="chips">${reqA ? `<button type="button" class="chip" aria-pressed="true" data-act="sReq">${esc(reqA.label)} ✕</button>` : ''}${R.ok ? `<button type="button" class="chip" data-act="sMine" aria-pressed="${mine}">내 요건 인정만</button>` : ''}<button type="button" class="chip" data-act="sClash" aria-pressed="${noClash}">${tabName(key)}과 안 겹치는 것만</button></div>
    <div class="muted small">검색 결과 ${list.length.toLocaleString()}개 · ${NOW_TERM} 신촌 개설</div>
    <div class="card" style="padding:4px 16px">${list.slice(0, limit).map(x => { const cl = clashWith(x.id, key).length; const inT = S.tt[key].includes(x.id); const fav = S.fav.includes(x.code); const a = areaOf(R, x.code); return `<button type="button" class="li" data-go="detail" data-sec="${x.id}"><span class="grow"><b>${esc(C(x.code).n)}</b> <span class="muted small">${x.no}분반 · ${esc(x.prof)}</span><br><span class="muted small">${shortTime(x.id)} · ${C(x.code).cr}학점 · ${x.code}</span><br><span class="tags" style="margin-top:4px">${!R.ok ? '' : a ? `<span class="pill ok">✓ ${esc(a.label)} 인정</span>` : '<span class="pill gray">일반선택</span>'}${inT ? '<span class="pill info">● 담음</span>' : cl ? '<span class="pill bad">! 시간 겹침</span>' : ''}${fav ? '<span class="pill gray">♥ 관심</span>' : ''}</span></span><span class="chev">›</span></button>`; }).join('') || '<p class="note">조건에 맞는 과목이 없어요.</p>'}</div>
    ${list.length > limit ? `<button type="button" class="btn weak" data-act="sMore">더 보기 (${(list.length - limit).toLocaleString()}개 남음)</button>` : ''}
  </div>`;
}
function vDetail(p) {
  const key = S.ttTab; const sc = SEC(p.sec);
  if (!sc) return `${top('과목 상세')}<div class="scroll"><p class="note">분반 정보를 찾을 수 없어요.</p></div>`;
  const x = C(sc.code);
  const inT = S.tt[key].includes(sc.id); const sameCode = S.tt[key].find(i => SEC(i) && SEC(i).code === sc.code && i !== sc.id);
  const cl = clashWith(sc.id, key).filter(i => i !== sameCode);
  const st = statusOf(sc.code); const fav = S.fav.includes(sc.code); const a = areaOf(R, sc.code);
  const pre = prereqs(sc.code).length ? prereqInfo(sc.code, NOW_TERM) : null;
  return `${top('과목 상세', { right: `<button type="button" class="act" data-act="fav" data-c="${sc.code}" aria-pressed="${fav}">${fav ? '♥ 관심 과목' : '♡ 관심 담기'}</button>` })}<div class="scroll">
    <div class="row">${st ? badge(st) : ''}<span class="muted small">${sc.code} · ${x.cr}학점</span></div>
    <div><div style="font-size:24px;font-weight:800">${esc(x.n)}</div><div class="muted">${esc(CAT_NAME[x.k] || x.k || '')}${x.g ? ' · ' + esc(x.g) : ''}</div></div>
    <div class="card" style="padding:4px 16px">
      <div class="li"><span class="grow muted">교수</span><b>${esc(sc.prof) || '-'}</b></div>
      <div class="li"><span class="grow muted">분반</span><b>${sc.no}분반</b></div>
      <div class="li"><span class="grow muted">시간</span><b style="text-align:right">${timeText(sc.id)}</b></div>
      <div class="li"><span class="grow muted">강의실</span><b style="text-align:right">${esc(sc.room) || '-'}</b></div>
    </div>
    ${R.ok ? `<div class="card soft" style="display:flex;flex-direction:column;gap:6px"><div class="h3">${a ? '내 졸업요건에 인정돼요' : '내 전공 요건에는 인정되지 않아요'}</div>
      <div class="tags">${a ? `<span class="pill ok">✓ ${esc(a.label)} +${x.cr}</span>` : `<span class="pill gray">일반선택 +${x.cr}</span>`}${x.u >= 3000 ? `<span class="pill ok">✓ 3·4000단위 +${x.cr}</span>` : ''}</div>
      ${pre ? `<div class="small muted">${esc(pre.t)}</div>` : ''}</div>` : ''}
    ${inT ? `<div class="banner ok"><span>✓</span><div><b>${tabName(key)}에 담겨 있어요</b></div></div>`
      : cl.length ? `<div class="banner bad"><span>!</span><div><b>${cl.map(i => esc(C(SEC(i).code).n)).join(', ')}과(와) 시간이 겹쳐요</b><p>담으면 시간 충돌이 생겨요. 대안 보기에서 바꿀 수 있어요.</p></div></div>`
        : `<div class="banner ok"><span>✓</span><div><b>${tabName(key)} 시간표와 충돌이 없어요</b></div></div>`}
    ${sameCode ? `<p class="note">지금 ${tabName(key)}에는 ${SEC(sameCode).no}분반이 담겨 있어요. 추가하면 이 분반으로 바뀌어요.</p>` : ''}
    <p class="note" style="margin:0">출처: ${NOW_TERM} 연세대학교 수강편람(신촌). 수강신청 전 학교 포털에서 다시 확인해 주세요.</p>
  </div>
  <div class="foot">${inT ? `<button type="button" class="btn weak" data-act="ttRemove" data-sec="${sc.id}">${tabName(key)}에서 빼기</button>` : `<button type="button" class="btn" data-act="ttAdd" data-sec="${sc.id}">${sameCode ? '이 분반으로 바꾸기' : tabName(key) + ' 시간표에 추가하기'}</button>`}
  ${st === 'done' || st === 'now' || st === 'plan' || !futureSems().length ? '' : `<button type="button" class="btn weak" data-act="planSheet" data-c="${sc.code}">다음 학기 이후 계획에 담기</button>`}</div>`;
}

/* ---------- 화면: 내 정보 / 온보딩 ---------- */
function vMe() {
  const pf = S.profile;
  const modeCard = S.mode === 'demo'
    ? `<div class="card soft" style="display:flex;flex-direction:column;gap:10px"><div class="h3">예시 데이터로 체험 중이에요</div><p class="note" style="margin:0">체험 데이터는 내 정보와 따로 저장돼요. 체험을 끝내면 내 정보 화면으로 돌아가요.</p><button type="button" class="btn" data-act="demoEnd">체험 끝내기</button><button type="button" class="btn weak" data-act="demoReset">예시 데이터 처음 상태로 되돌리기</button></div>`
    : S.mode === 'real' ? `<div class="card" style="display:flex;flex-direction:column;gap:10px"><div class="h3">먼저 둘러보고 싶다면</div><p class="note" style="margin:0">24학번 경제학 · 심리학 복수전공 학생의 예시 데이터로 모든 기능을 써 볼 수 있어요. 내 정보는 그대로 남아 있어요.</p><button type="button" class="btn weak" data-act="demo">예시 데이터로 체험하기</button></div>` : '';
  return `${top('내 정보', { big: true })}<div class="scroll">
    ${S.onboarded ? `<div class="card row" style="gap:14px"><div class="empty" style="padding:0"><div class="ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6z"/></svg></div></div><div><div class="h3">${esc(S.name) || '내 학적'}</div><div class="muted small">${profileText(pf)}</div></div></div>
    <div class="card" style="padding:4px 16px">
      ${[['입학 연도', pf.year + '년'], ['현재 학년', pf.grade === '5' ? '5학년 이상' : pf.grade + '학년'], ['본전공', pf.major], ['추가 이수과정', pf.track === '없음' ? '없음 (단일전공)' : pf.track], ...(hasSecond(pf.track) ? [[SECOND_LABEL[pf.track], pf.second || '-']] : []), ['목표 졸업 학기', pf.grad.replace('-', '년 ') + '학기']].map(([a, b]) => `<div class="li"><span class="grow muted">${a}</span><b>${esc(b)}</b></div>`).join('')}
    </div>
    ${R.ok ? '' : pendingCard(R)}
    <button type="button" class="btn weak" data-go="setup">학적 정보 수정</button>
    <button type="button" class="card li" style="padding:16px 20px" data-go="register"><span class="grow"><b>이수 내역 관리</b><br><span class="muted small">등록한 과목 ${S.taken.length}개 · ${fmt(sumCr(takenCodes()))}학점</span></span><span class="chev">›</span></button>`
    : `<div class="empty" style="padding:32px 12px"><div class="ico" aria-hidden="true">${SETUP_ICON}</div><div class="h3">학적 정보를 먼저 입력해 주세요</div><button type="button" class="btn sm" data-go="setup">학적 정보 입력하기</button></div>`}
    ${modeCard}
    <button type="button" class="card li" style="padding:16px 20px" data-go="source"><span class="grow"><b>정보 출처 및 유의사항</b></span><span class="chev">›</span></button>
    ${S.mode === 'real' && S.onboarded ? '<button type="button" class="link" data-act="wipe" style="align-self:flex-start">이 기기에 저장된 내 정보 모두 지우기</button>' : ''}
    ${UT_MODE ? `<div class="card soft" style="display:flex;flex-direction:column;gap:8px"><div class="h3">UT 진행 도구</div><p class="note" style="margin:0">과제 시작 상태로 바로 맞춰요. 휴대폰에서 진행할 때 쓰세요.</p>
      <div class="chips">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="chip" data-ut="${n}">T${n} 시작</button>`).join('')}</div></div>` : ''}
  </div>`;
}
function vSource() {
  return `${top('정보 출처 및 유의사항')}<div class="scroll">
    ${S.mode === 'demo' ? `<div class="card soft" style="display:flex;flex-direction:column;gap:8px"><div class="h3">이 화면은 프로토타입이에요</div><p class="note" style="margin:0">체험하기는 예시 학생(24학번 경제학 · 심리학 복수전공)의 학적과 이수 내역을 미리 넣어 둔 상태예요. 내 학적과 시간표로 처음부터 해 보려면 체험을 끝내고 내 정보를 입력해 주세요.</p></div>` : ''}
    <div class="card" style="display:flex;flex-direction:column;gap:8px">
      <div class="h3">데이터 출처</div>
      <p class="note" style="margin:0">졸업요건: 연세대학교 대학요람 2020~2026 (경제학 · 응용통계학 · 심리학)<br>개설 과목·분반·시간: ${NOW_TERM} 수강편람 신촌캠퍼스 ${D.sections.length.toLocaleString()}개 분반<br>선수과목: 요람과 강의계획서의 선수·권장 과목<br>정리한 날: ${esc(D.meta.built || '')}</p></div>
    <div class="card" style="display:flex;flex-direction:column;gap:8px">
      <div class="h3">유의사항</div>
      <p class="note" style="margin:0">연플랜은 학교 공식 서비스가 아니에요. 졸업 판정은 학교 학사지원팀과 학과 사무실 기준을 따라요.</p>
      <p class="note" style="margin:0">'확인 중'이 붙은 영역은 요람 원문만으로 확정하지 못한 부분이에요. 대학교양 영역별 조건(필수 영역 등)은 아직 학점만 계산해요.</p>
      <p class="note" style="margin:0">개설 이력만 있는 과목은 학점을 3학점으로 계산해요. 미래 학기 계획은 지난 개설 이력을 참고한 잠정 계획이에요.</p>
      <p class="note" style="margin:0">입력한 정보는 로그인 없이 이 기기의 브라우저에만 저장돼요.</p></div>
  </div>`;
}
function profileText(pf, sep = ' · ') {
  if (!pf || !pf.year) return '';
  const a = [`${pf.year.slice(2)}학번`, `${pf.grade === '5' ? '5학년 이상' : pf.grade + '학년'}`];
  if (hasSecond(pf.track) && pf.second) { a.push(`${pf.major} 1전공`, pf.track === '복수전공' ? `${pf.second} 2전공(복수전공)` : `${pf.second} ${pf.track}`); } else a.push(pf.major);
  return a.map(esc).join(sep);
}
function setupOptions(k, d) {
  const sel = v => d[k] === v ? 'selected' : '';
  let opts = SETUP_FIELDS.find(f => f[0] === k)[2];
  if (k === 'second' && d.track === '연계전공') opts = LINKED.map(v => [v, v]);
  if (k === 'major' || (k === 'second' && d.track !== '연계전공'))
    return opts.map(([g, list]) => `<optgroup label="${g}">${list.filter(v => k !== 'second' || v !== d.major).map(v => `<option value="${v}" ${sel(v)}>${v}${SUPPORTED[v] ? '' : ' (준비 중)'}</option>`).join('')}</optgroup>`).join('');
  return opts.map(([v, t]) => `<option value="${v}" ${sel(v)}>${t}</option>`).join('');
}
function vSetup(p) {
  const d = p.draft || Object.assign({}, S.profile);
  const fields = SETUP_FIELDS.filter(f => f[0] !== 'second' || hasSecond(d.track));
  const missing = fields.filter(f => !d[f[0]]).length;
  const onboarding = !S.onboarded;
  const unsupported = [d.major, hasSecond(d.track) ? d.second : ''].filter(v => v && !SUPPORTED[v]);
  return `${top(onboarding ? '학적 정보 입력' : '학적 정보 수정')}<div class="scroll">
    ${onboarding ? '<div class="steps"><i class="on"></i><i></i><span>1 / 2</span></div>' : ''}
    <div><div style="font-size:21px;font-weight:800">학적 정보를 입력해 주세요</div><div class="muted small">졸업요건은 입학 연도와 전공 기준으로 계산해요.</div></div>
    <div class="field"><label for="f-name">이름 (선택)</label><input class="search" id="f-name" type="text" maxlength="12" placeholder="홈에서 부를 이름" value="${esc(p.name !== undefined ? p.name : S.name)}"></div>
    ${fields.map(([k, n]) => `<div class="field"><label for="f-${k}">${k === 'second' ? SECOND_LABEL[d.track] : n}</label><select id="f-${k}" data-field="${k}" class="${d[k] ? '' : 'unset'}"><option value="" ${d[k] ? '' : 'selected'} disabled>선택해 주세요</option>${setupOptions(k, d)}</select></div>`).join('')}
    ${unsupported.length ? `<div class="card" style="display:flex;flex-direction:column;gap:4px"><div class="row"><span class="pill gray">준비 중</span><b class="small">${unsupported.map(esc).join(', ')} 졸업요건은 준비 중이에요</b></div><p class="note" style="margin:0">학적은 그대로 저장돼요. 졸업요건은 지금 ${Object.keys(SUPPORTED).join(' · ')}만 계산하고, 시간표와 과목 찾기는 모두 쓸 수 있어요.</p></div>` : ''}
  </div>
  <div class="foot"><div class="sum">${missing ? `${missing}개 항목을 더 골라 주세요` : '모두 입력했어요'}</div><button type="button" class="btn" data-act="setupNext" ${missing ? 'disabled' : ''}>${onboarding ? '다음' : '저장하기'}</button></div>`;
}
function vRegister(p) {
  const past = semesters(S.profile).filter(s => s.k === 'done');
  const sem = p.sem && past.some(s => s.id === p.sem) ? p.sem : (past.length ? past[past.length - 1].id : '');
  const q = (p.q || '').trim(), f = p.f || 'all', sel = p.sel || [];
  const majorGroups = R.groups.filter(g => g.k !== 'gen' && !g.pending);
  let list;
  if (q) list = searchCatalog(q, c => !isTaken(c) && groupFilter(f)(c), 50);
  else {
    const must = [...new Set(allAreas(R).flatMap(a => a.must))].filter(c => !isTaken(c) && groupFilter(f)(c));
    list = must.concat(searchCatalog('', c => !isTaken(c) && !must.includes(c) && groupFilter(f === 'all' ? (majorGroups[0] ? majorGroups[0].k : 'all') : f)(c), 30));
  }
  const inSem = S.taken.filter(x => x.sem === sem);
  const cr = sel.reduce((a, k) => a + C(k).cr, 0);
  if (!past.length) return `${top('이수 과목 등록')}<div class="scroll"><p class="note">입학 연도 기준으로 지난 학기가 없어서 등록할 과목이 없어요.</p></div><div class="foot"><button type="button" class="btn" data-act="regFinish">${p.onboard ? '시작하기' : '돌아가기'}</button></div>`;
  return `${top(p.onboard ? '이수 과목 등록' : '이수 내역 관리')}<div class="scroll">
    ${p.onboard ? '<div class="steps"><i class="on"></i><i class="on"></i><span>2 / 2</span></div>' : ''}
    <div><div style="font-size:21px;font-weight:800">들은 과목을 학기별로 등록해 주세요</div><div class="muted small">학기를 고르고 과목을 찾아 담아요. 남은 졸업요건 계산에 쓰여요.</div></div>
    <div class="field"><label for="regSem">들은 학기</label><select id="regSem">${past.map(s => `<option value="${s.id}" ${s.id === sem ? 'selected' : ''}>${s.id} · ${s.g} (${S.taken.filter(x => x.sem === s.id).length}과목)</option>`).join('')}</select></div>
    ${inSem.length ? `<div class="card" style="padding:4px 16px">${inSem.map(x => `<div class="li"><span class="grow"><b>${esc(C(x.c).n)}</b><br><span class="muted small">${x.c} · ${C(x.c).cr}학점 · ${esc(areaLabel(x.c))}</span></span><button type="button" class="pill gray" data-act="regRemove" data-c="${x.c}" aria-label="${esc(C(x.c).n)} 등록 취소">빼기</button></div>`).join('')}</div>` : `<p class="note" style="margin:0">${sem}에 등록한 과목이 아직 없어요.</p>`}
    <input class="search" id="rQ" type="search" placeholder="과목명 또는 학수번호 검색" value="${esc(q)}" aria-label="과목 검색">
    <div class="chips">${[['all', '전체'], ...majorGroups.map(g => [g.k, g.short]), ['gen', '교양']].map(([k, n]) => `<button type="button" class="chip" data-act="regF" data-f="${k}" aria-pressed="${f === k}">${n}</button>`).join('')}</div>
    <div class="h3">${q ? `"${esc(q)}" 검색 결과` : R.ok ? '내 졸업요건 지정 과목과 전공 과목' : '과목 목록'}</div>
    <div style="display:flex;flex-direction:column;gap:8px">${list.map(k => { const on = sel.includes(k); return `<button type="button" class="opt" role="checkbox" aria-checked="${on}" data-act="regToggle" data-c="${k}"><span class="check" aria-hidden="true">${on ? '✓' : ''}</span><span class="grow"><b>${esc(C(k).n)}</b><span class="muted small">${k} · ${C(k).cr}학점 · ${esc(areaLabel(k))}</span></span></button>`; }).join('') || '<p class="note">검색 결과가 없어요. 학수번호로도 찾아보세요.</p>'}</div>
  </div>
  <div class="foot"><div class="sum">${sel.length ? `선택한 과목 <b>${sel.length}개 · ${fmt(cr)}학점</b>을 <b>${sem}</b>에 등록해요` : '다른 학기도 골라서 이어서 등록할 수 있어요'}</div>
  ${sel.length ? `<button type="button" class="btn" data-act="regDone" data-sem="${sem}">${sem}에 ${sel.length}과목 등록하기</button>` : ''}
  <button type="button" class="btn ${sel.length ? 'weak' : ''}" data-act="regFinish">${p.onboard ? (S.taken.length ? '다 했어요, 시작하기' : '나중에 등록하기') : '완료'}</button></div>`;
}

const VIEWS = { home: vHome, req: vReq, area: vArea, roadmap: vRoadmap, course: vCourse, addplan: vAddPlan, tt: vTT, compare: vCompare, alt: vAlt, search: vSearch, detail: vDetail, me: vMe, setup: vSetup, register: vRegister, source: vSource };

function render(y) {
  R = buildReq(S.onboarded ? S.profile : null);
  const c = cur();
  const active = document.activeElement && document.activeElement.id;
  const caret = document.activeElement && document.activeElement.selectionStart;
  $screen.innerHTML = VIEWS[c.s](c.p || {});
  renderTabs();
  const sc = $screen.querySelector('.scroll');
  if (sc && typeof y === 'number') sc.scrollTop = y;
  if (active && /^(addQ|sQ|rQ)$/.test(active)) { const el = document.getElementById(active); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch (e) { /* noop */ } } }
  if (c.s === 'roadmap' && c.p && c.p.scrollTo) { const el = document.getElementById('sem-' + c.p.scrollTo); if (el && sc) { sc.scrollTop = el.offsetTop - sc.offsetTop - 8; } delete c.p.scrollTo; }
  if (S.flash.length) { setTimeout(() => { S.flash = []; }, 3500); }
  save();
}
function rerender() { saveScroll(); render(cur().y); }

/* ---------- 처음 방문 안내 ---------- */
function welcome() {
  $layer.innerHTML = `<div class="dim center"><div class="sheet modal" role="dialog" aria-modal="true" aria-labelledby="wTitle">
    <div class="h2" id="wTitle" style="margin:0">연플랜에 오신 걸 환영해요</div>
    <p class="note" style="margin:0">졸업요건 확인부터 학기별 로드맵, ${NOW_TERM} 시간표까지 한 곳에서 정리해요. 어떻게 시작할까요?</p>
    <button type="button" class="opt" data-act="startReal"><span class="grow"><b>처음부터 시작하기</b><span class="muted small">내 학적과 들은 과목을 직접 입력해요.</span></span><span class="chev">›</span></button>
    <button type="button" class="opt" data-act="demo"><span class="grow"><b>예시 데이터로 체험하기</b><span class="muted small">24학번 경제학 · 심리학 복수전공 학생 데이터가 채워진 상태로 둘러봐요. 체험 데이터는 따로 저장돼요.</span></span><span class="chev">›</span></button>
    <p class="note" style="margin:0">로그인 없이 이 기기의 브라우저에만 저장돼요.</p>
  </div></div>`;
}

/* ---------- 동작 ---------- */
function semSheet(code) {
  let pick = null; const fut = futureSems();
  const draw = () => {
    $layer.innerHTML = `<div class="dim" data-act="closeSheet"><div class="sheet" role="dialog" aria-label="로드맵 계획에 담기">
    <div class="h3">${esc(C(code).n)}을(를) 어느 학기에 담을까요?</div>
    ${fut.map(s => `<button type="button" class="opt" role="radio" aria-checked="${pick === s}" data-pick="${s}"><span class="radio" aria-hidden="true"></span><span class="grow"><b>${semLabel(s)}</b><span class="muted small">${esc(prereqInfo(code, s).t)}</span></span></button>`).join('')}
    <button type="button" class="btn" id="sheetOk" ${pick ? '' : 'disabled'}>${pick ? pick + ' 계획에 담기' : '학기를 골라 주세요'}</button>
    <button type="button" class="btn weak" data-act="closeSheet">취소</button></div></div>`;
    $layer.querySelectorAll('[data-pick]').forEach(b => { b.onclick = () => { pick = b.dataset.pick; draw(); }; });
    document.getElementById('sheetOk').onclick = () => { if (pick) addPlans([code], pick); };
  };
  draw();
}
function addPlans(codes, sem) {
  codes.forEach(c => { const ex = S.plan.find(x => x.c === c); if (ex) ex.sem = sem; else S.plan.push({ c, sem }); });
  closeSheet();
  S.open[sem] = true; S.flash = codes.slice();
  S.stack = [{ s: 'roadmap', p: { scrollTo: sem } }];
  render(0);
  toast(`${codes.map(c => esc(C(c).n)).join(', ')}을(를) ${sem} 계획에 추가했어요`, { t: '되돌리기', fn: () => { S.plan = S.plan.filter(x => !(codes.includes(x.c) && x.sem === sem)); rerender(); } });
}
function startUT(n) {
  closeSheet();
  if (n === 1) S = withUi(null, 'ut');
  else if (n === 2) { S = withUi({ onboarded: true, profile: demoFresh().profile }, 'ut'); S.stack = [{ s: 'register', p: { onboard: true, sel: [] } }]; }
  else S = withUi(demoFresh(), 'ut');
  render(0);
  toast(`T${n} 시작 상태로 맞췄어요`);
}

document.addEventListener('click', e => {
  const ut = e.target.closest('[data-ut]'); if (ut) { startUT(+ut.dataset.ut); return; }
  const t = e.target.closest('[data-tab],[data-go],[data-act]'); if (!t || !t.closest('#phone')) return;
  if (t.disabled) return;
  const c = cur(), p = c.p || (c.p = {});
  if (t.dataset.tab) { tab(t.dataset.tab); return; }
  if (t.dataset.go) {
    const g = t.dataset.go;
    if (g === 'area') return go('area', { a: t.dataset.a });
    if (g === 'course') return go('course', { c: t.dataset.c });
    if (g === 'addplan') return go('addplan', { sem: t.dataset.sem, sel: [] });
    if (g === 'detail') return go('detail', { sec: t.dataset.sec });
    if (g === 'search') return go('search', { req: t.dataset.req || null });
    if (g === 'setup') return go('setup', {});
    if (g === 'register') return go('register', { onboard: false, sem: t.dataset.sem });
    if (['roadmap', 'home', 'tt', 'me'].includes(g)) return tab(g);
    return go(g, {});
  }
  const a = t.dataset.act;
  switch (a) {
    case 'back': back(); break;
    case 'closeSheet': if (e.target === t || t.tagName === 'BUTTON') closeSheet(); break;
    case 'startReal': startMode('real', { go: store.get(KEY.real) && store.get(KEY.real).onboarded ? 'home' : 'setup' }); break;
    case 'demo': startMode('demo'); toast('예시 데이터로 체험을 시작했어요'); break;
    case 'demoReset': startMode('demo', { reset: true, go: 'me' }); toast('예시 데이터를 처음 상태로 되돌렸어요'); break;
    case 'demoEnd': startMode('real', { go: 'me' }); toast('체험을 끝냈어요'); break;
    case 'wipe': if (window.confirm('이 기기에 저장된 내 학적, 이수 과목, 시간표, 계획을 모두 지울까요? 되돌릴 수 없어요.')) { store.del(KEY.real); startMode('real', { reset: true }); toast('저장된 내 정보를 지웠어요'); } break;
    case 'toggleSem': S.open[t.dataset.sem] = t.dataset.open !== 'true'; rerender(); break;
    case 'rmFilter': S.rmFilter = t.dataset.f; rerender(); break;
    case 'togglePre': S.showPre = !S.showPre; rerender(); break;
    case 'addF': p.f = t.dataset.f; rerender(); break;
    case 'addToggle': { const k = t.dataset.c; p.sel = p.sel || []; p.sel = p.sel.includes(k) ? p.sel.filter(x => x !== k) : p.sel.concat(k); rerender(); break; }
    case 'addPlan': if (p.sel && p.sel.length) addPlans(p.sel, p.sem && futureSems().includes(p.sem) ? p.sem : futureSems()[0]); break;
    case 'savePlan': {
      const pl = S.plan.find(x => x.c === t.dataset.c); const from = pl.sem; pl.sem = p.sel; S.open[p.sel] = true; S.flash = [pl.c]; S.stack = [{ s: 'roadmap', p: { scrollTo: p.sel } }]; render(0);
      toast(`${esc(C(pl.c).n)}을(를) ${from}에서 ${pl.sem}(으)로 옮겼어요`, { t: '되돌리기', fn: () => { pl.sem = from; rerender(); } }); break;
    }
    case 'removePlan': { const k = t.dataset.c; const old = S.plan.find(x => x.c === k); S.plan = S.plan.filter(x => x.c !== k); back(); toast(`${esc(C(k).n)}을(를) 계획에서 뺐어요`, { t: '되돌리기', fn: () => { S.plan.push(old); rerender(); } }); break; }
    case 'adoptRec': { const fut = futureSems(); const rc = recs().find(x => x.c === t.dataset.c); addPlans([t.dataset.c], p.sel || (rc ? rc.sem : fut[0])); break; }
    case 'ttTab': S.ttTab = t.dataset.k; rerender(); break;
    case 'setMain': S.main = t.dataset.k; S.ttTab = t.dataset.k; rerender(); toast(`${tabName(S.main)}을 내 시간표로 정했어요. 홈과 로드맵에 반영돼요.`); break;
    case 'altTarget': p.t = t.dataset.t; p.pick = null; rerender(); break;
    case 'altPick': p.pick = t.dataset.sec; rerender(); break;
    case 'altApply': {
      const key = S.ttTab, from = t.dataset.t, to = p.pick; const before = S.tt[key].slice();
      S.tt[key] = S.tt[key].map(i => i === from ? to : i);
      const sameCourse = SEC(from).code === SEC(to).code;
      S.flash = [to]; const left = conflicts(key).length;
      S.stack = [{ s: 'tt' }]; render(0);
      toast(`${sameCourse ? `${esc(C(SEC(from).code).n)}을(를) ${SEC(to).no}분반으로 교체했어요.` : `${esc(C(SEC(from).code).n)} 대신 ${esc(C(SEC(to).code).n)}을(를) 담았어요.`} ${left ? '아직 충돌 ' + left + '건이 있어요.' : '시간 충돌이 없어요.'}`, { t: '되돌리기', fn: () => { S.tt[key] = before; rerender(); } }); break;
    }
    case 'sTab': p.tab = t.dataset.k; p.limit = 40; rerender(); break;
    case 'sReq': p.req = null; rerender(); break;
    case 'sMine': p.mine = !p.mine; rerender(); break;
    case 'sClash': p.noClash = !p.noClash; rerender(); break;
    case 'sMore': p.limit = (p.limit || 40) + 60; rerender(); break;
    case 'fav': { const k = t.dataset.c; const on = S.fav.includes(k); S.fav = on ? S.fav.filter(x => x !== k) : S.fav.concat(k); rerender(); toast(on ? '관심 과목에서 뺐어요' : `${esc(C(k).n)}을(를) 관심 과목에 담았어요`); break; }
    case 'ttAdd': {
      const key = S.ttTab, id = t.dataset.sec, code = SEC(id).code; const before = S.tt[key].slice();
      const same = S.tt[key].find(i => SEC(i) && SEC(i).code === code);
      S.tt[key] = same ? S.tt[key].map(i => i === same ? id : i) : S.tt[key].concat(id);
      const cf = conflicts(key).length; S.flash = [id];
      render(0);
      toast(`${esc(C(code).n)}${same ? '을(를) ' + SEC(id).no + '분반으로 바꿨어요' : `을(를) ${NOW_TERM} 시간표 ${tabName(key)}에 담았어요`}. ${cf ? '시간 충돌 ' + cf + '건이 있어요.' : '시간 충돌이 없어요.'}`, { t: '되돌리기', fn: () => { S.tt[key] = before; rerender(); } });
      break;
    }
    case 'ttRemove': { const key = S.ttTab, id = t.dataset.sec; const before = S.tt[key].slice(); S.tt[key] = S.tt[key].filter(i => i !== id); render(0); toast(`${esc(C(SEC(id).code).n)}을(를) 시간표에서 뺐어요`, { t: '되돌리기', fn: () => { S.tt[key] = before; rerender(); } }); break; }
    case 'planSheet': semSheet(t.dataset.c); break;
    case 'setupNext': {
      const d = p.draft || Object.assign({}, S.profile); if (!hasSecond(d.track)) d.second = '';
      const nm = document.getElementById('f-name'); S.name = nm ? nm.value.trim() : S.name;
      S.profile = d;
      if (!S.onboarded) { S.onboarded = true; S.stack = [{ s: 'register', p: { onboard: true, sel: [] } }]; render(0); } else { back(); toast('학적 정보를 저장했어요'); }
      break;
    }
    case 'regF': p.f = t.dataset.f; rerender(); break;
    case 'regToggle': { const k = t.dataset.c; p.sel = p.sel || []; p.sel = p.sel.includes(k) ? p.sel.filter(x => x !== k) : p.sel.concat(k); rerender(); break; }
    case 'regDone': {
      const sel = p.sel || []; const sem = t.dataset.sem;
      sel.forEach(c => { const ex = S.taken.find(x => x.c === c); if (ex) ex.sem = sem; else S.taken.push({ c, sem }); });
      S.plan = S.plan.filter(x => !sel.includes(x.c));
      p.sel = []; p.q = ''; rerender();
      toast(`${sem}에 ${sel.length}과목을 등록했어요`, { t: '되돌리기', fn: () => { S.taken = S.taken.filter(x => !(sel.includes(x.c) && x.sem === sem)); rerender(); } }); break;
    }
    case 'regRemove': { const k = t.dataset.c; const old = S.taken.find(x => x.c === k); S.taken = S.taken.filter(x => x.c !== k); rerender(); toast(`${esc(C(k).n)}을(를) 이수 내역에서 뺐어요`, { t: '되돌리기', fn: () => { S.taken.push(old); rerender(); } }); break; }
    case 'regFinish': if (p.onboard) { S.stack = [{ s: 'home' }]; render(0); toast(S.taken.length ? `${S.taken.length}과목을 바탕으로 졸업요건을 정리했어요` : '들은 과목은 내 정보에서 언제든 등록할 수 있어요'); } else back(); break;
  }
});
document.addEventListener('change', e => {
  const el = e.target; if (!el.closest || !el.closest('#phone')) return; const c = cur(), p = c.p || (c.p = {});
  if (el.id === 'jump' && el.value) { S.open[el.value] = true; c.p = { scrollTo: el.value }; render(0); return; }
  if (el.id === 'addSem') { p.sem = el.value; rerender(); return; }
  if (el.id === 'semSel') { p.sel = el.value; rerender(); return; }
  if (el.id === 'regSem') { p.sem = el.value; p.sel = []; rerender(); return; }
  if (el.id === 'f-name') { p.name = el.value; return; }
  if (el.dataset.field) {
    const f = el.dataset.field; p.draft = p.draft || Object.assign({}, S.profile); const prevTrack = p.draft.track; p.draft[f] = el.value;
    const nm = document.getElementById('f-name'); if (nm) p.name = nm.value;
    if (f === 'track' && (!hasSecond(el.value) || (prevTrack === '연계전공') !== (el.value === '연계전공'))) p.draft.second = '';
    if (f === 'major' && p.draft.second === el.value) p.draft.second = '';
    rerender(); return;
  }
});
document.addEventListener('input', e => {
  const el = e.target; const c = cur(), p = c.p || (c.p = {});
  if (['addQ', 'sQ', 'rQ'].includes(el.id)) { p.q = el.value; p.limit = 40; if (!e.isComposing) rerender(); }
});
document.addEventListener('compositionend', e => { const el = e.target; if (['addQ', 'sQ', 'rQ'].includes(el.id)) { cur().p.q = el.value; rerender(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $layer.innerHTML && !$layer.querySelector('.modal')) closeSheet(); });

/* ---------- 시작 ---------- */
$screen.innerHTML = '<div class="empty" style="padding-top:120px"><p class="note">과목과 졸업요건 데이터를 불러오는 중이에요…</p></div>';
loadData().then(() => {
  const mode = store.get(KEY.mode);
  if (UT_MODE) { S = withUi(null, 'ut'); render(0); return; }
  if (mode === 'demo' || mode === 'real') { S = withUi(store.get(KEY[mode]), mode); render(0); return; }
  S = withUi(null, 'new'); render(0); welcome();
}).catch(err => {
  $screen.innerHTML = `<div class="empty" style="padding-top:120px"><div class="h3">데이터를 불러오지 못했어요</div><p class="note">네트워크를 확인하고 새로고침해 주세요. (${esc(err.message)})</p></div>`;
});
