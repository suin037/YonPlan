/* 졸업요건 계산: 학적(profile)으로 요건을 고르고, 과목 목록을 영역에 나눠 담아요. */
import { D, C, SUPPORTED, SHORT_DEPT, NOW_TERM, tracksOf, trackNames } from './data.js';

const KIND_LABEL = { 전기: '전공기초', 전필: '전공필수', 전선: '전공선택' };

/* 학적 정보 -> 요건 구조
   groups: 전공 그룹(1전공, 2전공) + 교양 그룹. 각 영역(area)은 need학점, 인정 분류(cat), 지정 과목(must)을 가져요. */
export function buildReq(pf) {
  const out = { ok: false, reason: '', groups: [], total: null, u3000: null, notes: [] };
  if (!pf || !pf.major) return out;
  const y = String(pf.year);
  const mCode = SUPPORTED[pf.major];
  const inRange = +y >= D.meta.cohorts[0] && +y <= D.meta.cohorts[1];
  if (!mCode) { out.reason = 'major'; return out; }
  if (!inRange) { out.reason = 'cohort'; return out; }
  const dual = tracksOf(pf).some(x => x.t === '복수전공' && x.d);
  const prog = dual ? '복수1' : '단일';
  const dep = D.req[mCode];
  const rows = (dep.programs[prog] || {})[y] || [];
  const single = (dep.programs['단일'] || {})[y] || [];
  out.ok = true;
  out.groups.push(majorGroup('m1', mCode, rows, dual ? '1전공' : '전공'));
  // 추가 이수과정(여러 개): 복수전공·부전공은 요람 표로 계산, 나머지는 준비 중
  trackNames(pf).forEach((x, i) => {
    const k = 'm' + (i + 2);
    const label = x.short.slice(x.d ? x.d.length + 2 : 0, -1) || x.t;
    const sCode = SUPPORTED[x.d];
    const p2 = x.t === '복수전공' ? '복수2' : x.t === '부전공' ? '부전공' : null;
    const rows2 = sCode && p2 ? ((D.req[sCode].programs[p2] || {})[y] || []) : [];
    if (rows2.length) out.groups.push(majorGroup(k, sCode, rows2, label, x.d));
    else out.groups.push({ k, pending: true, track: x.t, n: x.short, areas: [], need: 0 });
  });
  // 교양 (단일전공 표 기준)
  const g = single.filter(a => ['BASIC', 'GE', 'RC'].includes(a.kind));
  out.groups.push({ k: 'gen', n: '교양', areas: g.map(a => area(a, 'gen', '')), need: g.reduce((t, a) => t + a.need, 0) });
  const tot = rows.find(a => a.kind === 'TOTAL') || single.find(a => a.kind === 'TOTAL');
  const u3 = rows.find(a => a.kind === 'U3000') || single.find(a => a.kind === 'U3000');
  out.total = tot ? tot.need : 126;
  out.u3000 = u3 ? u3.need : 45;
  return out;
}

function area(a, gk, short) {
  const label = a.kind === 'MAJ' ? (short ? short + ' ' : '') + a.n : a.n;
  return { id: a.id, g: gk, kind: a.kind, n: a.n, label, need: a.need, cat: a.cat ? a.cat.split(',') : [], must: a.must || [], all: a.rule === 'ALL', check: a.check || '', fromSingle: !!a.fromSingle };
}
function majorGroup(k, code, rows, label, name) {
  const dep = D.req[code];
  const short = SHORT_DEPT[code];
  const areas = rows.filter(a => a.kind === 'MAJ').map(a => area(a, k, short));
  const major = rows.find(a => a.kind === 'MAJOR');
  // 전공 합계가 영역 합보다 크면(영역 구분이 없거나 일부만 있는 경우) 나머지를 '전공 과목(영역 무관)'으로 세요
  const sum = areas.reduce((t, a) => t + a.need, 0);
  if (major && major.need > sum) {
    areas.push(area({ id: major.id + '-REST', kind: 'MAJ', n: areas.length ? '그 외 전공 과목' : '전공 과목', need: major.need - sum, cat: '전기,전필,전선', must: [], rule: 'CREDITS', check: areas.length ? '' : '요람에서 영역 구분(전공기초·필수·선택)을 확인하지 못해 전공 과목 학점 합계로만 계산해요.' }, k, short));
  }
  return { k, code, prefix: dep.prefix, short, n: `${name || dep.name} (${label})`, areas, need: major ? major.need : areas.reduce((t, a) => t + a.need, 0) };
}

/* 과목이 들어갈 수 있는 영역 후보 (지정 과목이 먼저) */
function candidates(R, code) {
  const c = C(code);
  for (const g of R.groups) {
    if (g.pending) continue;
    const must = g.areas.filter(a => a.must.includes(code));
    if (must.length) return must;
    if (g.k === 'gen') {
      const isRC = code.startsWith('UCR') || c.k === 'RC';
      const ar = g.areas.filter(a => (a.kind === 'RC' && isRC) || (!isRC && a.cat.includes(c.k)));
      if (ar.length) return ar;
      continue;
    }
    if (!code.startsWith(g.prefix)) continue;
    const ar = g.areas.filter(a => a.cat.includes(c.k));
    if (ar.length) return ar;
  }
  return [];
}

/* 과목 목록을 영역에 나눠 담기. 영역이 차면 다음 후보로, 모두 차면 첫 후보에 넘쳐 담아요. */
export function assign(R, codes) {
  const cr = {}, of = {};
  const list = [...new Set(codes)];
  // 지정 과목을 먼저 담아야 자리 다툼이 덜해요
  list.sort((a, b) => (isMust(R, b) ? 1 : 0) - (isMust(R, a) ? 1 : 0));
  for (const code of list) {
    const cand = candidates(R, code);
    if (!cand.length) { of[code] = null; continue; }
    const c = C(code).cr;
    const a = cand.find(x => (cr[x.id] || 0) < x.need) || cand[0];
    cr[a.id] = (cr[a.id] || 0) + c;
    of[code] = a;
  }
  const groupCr = {};
  R.groups.forEach(g => { groupCr[g.k] = g.areas.reduce((t, a) => t + (cr[a.id] || 0), 0); });
  const total = list.reduce((t, k) => t + C(k).cr, 0);
  const u3 = list.reduce((t, k) => t + (C(k).u >= 3000 ? C(k).cr : 0), 0);
  return { cr, of, groupCr, total, u3 };
}
const isMust = (R, code) => R.groups.some(g => g.areas.some(a => a.must.includes(code)));

/* 이 과목이 내 요건 어디에 인정되는지 (하나만) */
export function areaOf(R, code) { const c = candidates(R, code); return c[0] || null; }
export const areaById = (R, id) => { for (const g of R.groups) for (const a of g.areas) if (a.id === id) return a; return null; };
export const groupOf = (R, k) => R.groups.find(g => g.k === k);
export const allAreas = R => R.groups.flatMap(g => g.areas);

export function ruleText(a, R) {
  const g = groupOf(R, a.g);
  const names = a.must.map(k => C(k).n).join(', ');
  if (a.kind === 'BASIC') return `채플, 기독교의이해, 글쓰기 같은 교양기초 과목을 ${a.need}학점 이상 이수해요.`;
  if (a.kind === 'GE') return `대학교양 과목을 ${a.need}학점 이상 이수해요. 필수 영역과 영역별 학점은 학과마다 달라서 요람에서 함께 확인해 주세요.`;
  if (a.kind === 'RC') return `RC 교육 과목을 ${a.need}학점 이수해요.`;
  if (a.all) return `지정 과목 ${a.must.length}개(${names})를 모두 이수해요.`;
  const cat = a.cat.map(x => KIND_LABEL[x] || x).join('·');
  return `${g ? g.n.split(' (')[0] : ''} ${cat} 과목 중 ${a.need}학점 이상 이수해요.${a.must.length ? ` 지정 과목(${names})은 꼭 들어야 해요.` : ''}`;
}

/* ---------- 학기 ---------- */
export function semesters(pf) {
  if (!pf || !pf.year) return [];
  const out = []; let y = +pf.year, s = 1; let i = 0;
  const end = pf.grad && pf.grad >= NOW_TERM ? pf.grad : NOW_TERM;
  while (true) {
    const id = `${y}-${s}`;
    const g = `${Math.min(Math.floor(i / 2) + 1, 9)}학년 ${s}학기`;
    out.push({ id, g, k: id < NOW_TERM ? 'done' : id === NOW_TERM ? 'now' : 'future' });
    if (id >= end || i > 30) break;
    i++; if (s === 1) s = 2; else { s = 1; y++; }
  }
  return out;
}

/* ---------- 선수과목 ---------- */
export const prereqs = code => D.pre[code] || [];
