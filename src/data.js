/* 화면에서 쓰는 고정 목록과, public/data/*.json을 읽어 오는 부분이에요.
   과목·분반·졸업요건·선수과목은 scripts/build_data.py가 dataset CSV에서 만들어요. */

export const D = { courses: {}, sections: [], secById: {}, secByCode: {}, req: {}, pre: {}, meta: {} };

export async function loadData() {
  const base = import.meta.env.BASE_URL + 'data/';
  const get = n => fetch(base + n).then(r => { if (!r.ok) throw new Error(n); return r.json(); });
  const [courses, sections, req, pre, meta] = await Promise.all([
    get('courses.json'), get('sections-2026-2.json'), get('requirements.json'), get('prerequisites.json'), get('meta.json')
  ]);
  D.courses = courses; D.req = req; D.pre = pre; D.meta = meta;
  D.sections = sections.map(([id, code, no, prof, room, meets, online, lang, grading]) => ({ id, code, no, prof, room, meets, online: !!online, lang: lang || '', grading: grading || '' }));
  D.sections.forEach(s => { D.secById[s.id] = s; (D.secByCode[s.code] = D.secByCode[s.code] || []).push(s); });
}

/* 과목 정보: 이름, 학점, 개설 학과, 이수구분, 교양 영역 */
export function C(code) {
  const x = D.courses[code];
  if (!x) return { code, n: code, cr: 3, d: '', k: '', g: '', u: unitOf(code) };
  return { code, n: x[0], cr: x[1], d: x[2], k: x[3], g: x[4], guess: !!x[5], t: x[6] || 0, u: unitOf(code) }; // t: 개설 학기 경향 1·2·3(둘 다)·0(모름)
}
export const unitOf = code => { const m = /(\d)\d{3}$/.exec(code); return m ? +m[1] * 1000 : 0; };
export const SEC = id => D.secById[id];

export const NOW_TERM = '2026-2';
export const DAYS = ['월', '화', '수', '목', '금', '토'];

export const ST = { done: ['✓', '이수'], now: ['●', '수강 중'], plan: ['◆', '계획'], rec: ['☆', '추천'] };
export const badge = k => `<span class="st st-${k}"><i aria-hidden="true">${ST[k][0]}</i>${ST[k][1]}</span>`;

/* 신촌캠퍼스 학부 전공 목록 (단과대학별) */
export const DEPTS = [
  ['문과대학', ['국어국문학', '중어중문학', '영어영문학', '독어독문학', '불어불문학', '노어노문학', '사학', '철학', '문헌정보학', '심리학']],
  ['상경대학', ['경제학', '응용통계학']],
  ['경영대학', ['경영학']],
  ['이과대학', ['수학', '물리학', '화학', '지구시스템과학', '천문우주학', '대기과학']],
  ['공과대학', ['화공생명공학', '전기전자공학', '건축공학', '건축학(5년제)', '도시공학', '건설환경공학', '기계공학', '신소재공학', '산업공학', '시스템반도체공학', '디스플레이융합공학']],
  ['생명시스템대학', ['시스템생물학', '생화학', '생명공학']],
  ['인공지능융합대학', ['첨단컴퓨팅학부', 'IT융합공학', '지능형반도체', '모빌리티시스템', '첨단융합공학부']],
  ['신과대학', ['신학']],
  ['사회과학대학', ['정치외교학', '행정학', '사회복지학', '사회학', '문화인류학', '언론홍보영상학부']],
  ['음악대학', ['교회음악', '성악', '피아노', '관현악', '작곡']],
  ['생활과학대학', ['의류환경학', '식품영양학', '실내건축학', '아동·가족학', '통합디자인학']],
  ['교육과학대학', ['교육학', '체육교육학', '스포츠응용산업학']],
  ['언더우드국제대학', ['UIC 비교문학과문화', 'UIC 경제학', 'UIC 국제학', 'UIC 정치외교학', 'UIC 생명과학공학', 'UIC 아시아학', 'UIC 정보·인터랙션디자인', 'UIC 창의기술경영', 'UIC 문화디자인경영', 'UIC 사회정의리더십', 'UIC 계량위험관리', 'UIC 과학기술정책', 'UIC 지속개발협력', 'UIC 나노과학공학', 'UIC 에너지환경융합', 'UIC 바이오융합']],
  ['글로벌인재대학', ['국제통상', '한국문화', '문화미디어', '한국언어문화교육', '응용정보공학', '바이오생활공학']],
  ['학부대학', ['진리자유학부']],
  ['약학대학', ['약학']],
  ['의과대학', ['의예과', '의학과']],
  ['치과대학', ['치의예과', '치의학과']],
  ['간호대학', ['간호학과']]
];
export const LINKED = ['공공리더십', '디지털예술학', '리더십', '문화비평학', '벤처학', '비교문학', '외교통상학', '유럽지역학', '인지과학', '한국및동아시아학(한국학)', '한국및동아시아학(일본학)', '한국및동아시아학(동아시아학)'];
/* 융합전공 (학사지원팀 '연계전공/융합전공' 안내, yonsei.ac.kr/sc/387) */
export const CONVERGENCE = ['지능형반도체융합(소자·공정)', '지능형반도체융합(회로·시스템)'];
/* 마이크로전공 (학사지원팀 '마이크로전공 신청 안내' 목록, yonsei.ac.kr/bbs/sc/58/944478): [이름, 개설 학과] */
export const MICRO = [
  ['영어학', '영어영문학과'], ['영미문학과 문화비평이론', '영어영문학과'], ['현대독일문화비평', '독어독문학과'],
  ['러시아문학과 예술', '노어노문학과'], ['유라시아지역문화', '노어노문학과'], ['심리과학', '심리학과'],
  ['한국의 경제와 기업경영', '경제학과·경영학과'], ['마케팅과 인공지능', '경영학과·첨단컴퓨팅학부'],
  ['인공지능과 경영과학', '경영학과·첨단컴퓨팅학부'], ['인공지능과 경영정보시스템', '경영학과·첨단컴퓨팅학부'],
  ['천문우주학', '천문우주학과'], ['집적회로공학', '전기전자공학부'], ['스마트 건설 정보', '건설환경공학과'],
  ['지속가능 사회환경시스템', '건설환경공학과'], ['시스템생물학', '시스템생물학과'], ['생화학', '생화학과'],
  ['생명공학', '생명공학과'], ['컴퓨터프로그래밍', '첨단컴퓨팅학부'], ['IT시스템융합', 'IT융합공학전공'],
  ['반도체융합기술', '지능형반도체전공'], ['지능형반도체 소자/공정기술', '지능형반도체전공'],
  ['지능형반도체 회로/시스템기술', '지능형반도체전공'], ['모빌리티ICT융합', '기계공학부·모빌리티시스템전공'],
  ['종교와인권', '신학과'], ['공공관리', '행정학과'], ['공공정책', '행정학과'], ['인적자원개발', '교육학과'],
  ['개인정보보호', '글로벌인재대학'], ['바이오생활공학', '글로벌인재대학'], ['응용정보공학', '글로벌인재대학'],
  ['한국어와한국문화', '글로벌인재대학'], ['바이오공정', '약학과'], ['인지과학', '융복합전공'], ['스타트업 인사이트', '창업지원단'],
];
/* 졸업요건 데이터를 연결한 학과: 앱 이름 -> 학과 코드 */
export const SUPPORTED = { '경제학': '0201', '응용통계학': '0203', '심리학': '0142' };
export const SHORT_DEPT = { '0201': '경제', '0203': '응통', '0142': '심리' };
export const NOW_YEAR = 2026;
export const SETUP_FIELDS = [
  ['year', '입학 연도', Array.from({ length: NOW_YEAR - 2012 + 1 }, (_, i) => { const y = String(NOW_YEAR - i); return [y, `${y}년 (${y.slice(2)}학번)`]; })],
  ['grade', '현재 학년', [['1', '1학년'], ['2', '2학년'], ['3', '3학년'], ['4', '4학년'], ['5', '5학년 이상']]],
  ['major', '본전공', DEPTS],
  ['tracks', '추가 이수과정', []],
  ['grad', '졸업 예정', (() => { const o = [['2026-2', '2026년 2학기']]; for (let y = NOW_YEAR + 1; y <= NOW_YEAR + 6; y++) for (const s of [1, 2]) o.push([`${y}-${s}`, `${y}년 ${s}학기`]); return o; })()]
];
/* 추가 이수과정: 여러 개 고를 수 있어요(다중 전공). 교직과정만 학과를 고르지 않아요. */
export const TRACK_TYPES = ['복수전공', '융복합·연계전공', '부전공', '마이크로전공', '교직과정'];
export const TRACK_DEPT_LABEL = { 복수전공: '복수전공 학과', '융복합·연계전공': '융복합·연계전공', 부전공: '부전공 학과', 마이크로전공: '마이크로전공' };
export const needsDept = t => !!TRACK_DEPT_LABEL[t];
// 예전 저장 형식(track 하나 + second)을 새 형식(tracks 배열)으로 읽어요
export function tracksOf(pf) {
  if (!pf) return [];
  if (Array.isArray(pf.tracks)) return pf.tracks;
  if (!pf.track || pf.track === '없음') return [];
  return [{ t: pf.track === '연계전공' ? '융복합·연계전공' : pf.track, d: pf.second || '' }];
}
// 화면에 쓰는 이름: "심리학 2전공(복수전공)", "통계학 부전공", "교직과정"
export function trackNames(pf) {
  let n = 2;
  return tracksOf(pf).filter(x => x.t === '교직과정' || x.d).map(x => x.t === '복수전공' ? { ...x, short: `${x.d}(${n}전공)`, long: `${x.d} ${n++}전공(복수전공)` }
    : x.t === '교직과정' ? { ...x, short: '교직과정', long: '교직과정' } : { ...x, short: `${x.d}(${x.t})`, long: `${x.d} ${x.t}` });
}
