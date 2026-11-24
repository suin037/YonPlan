"""dataset CSV를 앱이 읽는 JSON(public/data/*.json)으로 바꿔요.

사용법:  python3 scripts/build_data.py <dataset 폴더 경로>

- 졸업요건: 지원 학과(경제학·응용통계학·심리학) 2020~2026학번
- 분반: 2026-2 신촌 캠퍼스, 폐강 제외
- 과목 목록: 2026-2 개설 과목 + 최근 개설 이력(subject_history) 학부 과목
- 선수과목: prerequisites.csv 중 과목 목록에 있는 학부 과목만
"""
import csv, json, os, re, sys
from collections import defaultdict

SRC = sys.argv[1] if len(sys.argv) > 1 else 'dataset'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')
os.makedirs(OUT, exist_ok=True)

TERM = '2026-2'
SUPPORTED = {  # 학과 코드: (앱에서 쓰는 이름, 과목 코드 앞자리)
    '0201': ('경제학', 'ECO'),
    '0203': ('응용통계학', 'STA'),
    '0142': ('심리학', 'PSY'),
}
DAY = {'MON': 0, 'TUE': 1, 'WED': 2, 'THU': 3, 'FRI': 4, 'SAT': 5}


def rows(name):
    with open(os.path.join(SRC, name), encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


def unit_of(code):
    m = re.search(r'(\d)\d{3}$', code)
    return int(m.group(1)) * 1000 if m else 0


def num(v):
    v = float(v)
    return int(v) if v == int(v) else v


# ---------- 2026-2 신촌 분반 ----------
courses = [x for x in rows('courses.csv') if x['campus'] == '신촌' and x['term'] == TERM and x['cancelled'] != 'Y']
times = defaultdict(list)
for t in rows('course_times.csv'):
    p = int(t['period'])
    if t['day'] in DAY and 0 <= p <= 13:
        times[t['course_id']].append([DAY[t['day']], p])

catalog = {}  # code -> dict


WEAK_CAT = {'', 'CC', 'UICE', 'ME', 'MR', 'MB', '선택', '자율'}


def put(code, name, cr, dept, cat, area=''):
    """같은 과목이 여러 학과·분반으로 열리면 학과 소속 분반, 일반 분류, 짧은 이름 순으로 골라요."""
    def score(d, k, n):
        home = any(code.startswith(pre) and d == dc for dc, (_, pre) in SUPPORTED.items())
        return (home, k not in WEAK_CAT, -len(n))
    old = catalog.get(code)
    if old and score(old['d'], old['k'], old['n']) >= score(dept, cat, name.strip()):
        return
    catalog[code] = {'n': name.strip(), 'cr': cr, 'd': dept, 'k': cat, 'g': area}


for x in courses:
    put(x['subject_code'], x['name_ko'], num(x['credits']), x['dept_code'], x['category'], x['gened_area'])

sections = []
for x in courses:
    no = x['course_id'].split('-')[1]
    sections.append([
        x['course_id'], x['subject_code'], no, x['professor'].strip(), x['classroom'].strip(),
        sorted(times.get(x['course_id'], [])), 1 if x['has_online'] == 'Y' else 0,
    ])

# ---------- 과목 개설 이력 ----------
for h in rows('subject_history.csv'):
    code = h['subject_code']
    if code in catalog or unit_of(code) >= 5000:
        continue
    cat = ''
    if code.startswith(('YCA', 'YCB')):
        cat = '공기'
    elif code.startswith('UCR'):
        cat = 'RC'
    elif code.startswith(('YC', 'UC')):
        cat = '대교'
    # 개설 이력에는 학점이 없어요: RC는 1학점, 채플(YCA10xx)은 0.5학점, 나머지는 3학점으로 봐요
    cr = 1 if code.startswith('UCR') else 0.5 if re.match(r'YCA10\d\d$', code) else 3
    catalog[code] = {'n': h['name_ko'].strip(), 'cr': cr, 'd': h['dept_code'],
                     'k': cat, 'g': '', 'h': h['terms_offered']}

# ---------- 졸업요건 ----------
req = rows('requirements.csv')
req_courses = defaultdict(list)
for r in rows('requirement_courses.csv'):
    req_courses[r['req_id']].append((r['subject_code'], r['subject_name']))
review = {}
for r in rows('_review_list.csv'):
    review.setdefault(r['req_id'], r['issue'])

AREA_KIND = {  # 영역 이름 -> 앱 안 영역 종류
    '졸업학점': 'TOTAL', '3·4000단위': 'U3000', '3000·4000단위': 'U3000', '전공 합계': 'MAJOR', '부전공 합계': 'MAJOR',
    '교양기초': 'BASIC', '대학교양': 'GE', 'RC교육': 'RC',
}
CAT_OF_AREA = {'전공기초': '전기', '전공필수': '전필', '전공선택': '전선', '전공필수·전공선택': '전필,전선'}

out_req = {}
for dept, (dname, pre) in SUPPORTED.items():
    by = defaultdict(lambda: defaultdict(list))  # program -> cohort -> rows
    for x in req:
        if x['owner_code'] != dept:
            continue
        for y in range(int(x['cohort_from']), int(x['cohort_to']) + 1):
            by[x['program']][str(y)].append(x)
    d_out = {}
    for prog, cohorts in by.items():
        p_out = {}
        for y, rs in cohorts.items():
            areas = []
            for x in rs:
                kind = AREA_KIND.get(x['area'], 'MAJ')
                must = [c for c, _ in req_courses.get(x['req_id'], [])]
                for c, n in req_courses.get(x['req_id'], []):
                    if c not in catalog:
                        catalog[c] = {'n': n.strip(), 'cr': 3, 'd': dept, 'k': '', 'g': ''}
                cat = x['match_category'] or (CAT_OF_AREA.get(x['area'], '') if kind == 'MAJ' else '')
                if kind == 'BASIC':
                    cat = '공기'
                if kind == 'GE':
                    cat = '대교,계기'
                a = {'id': x['req_id'], 'kind': kind, 'n': x['area'], 'need': num(x['min_credits'] or 0),
                     'cat': cat, 'must': must, 'rule': x['rule_type']}
                note = review.get(x['req_id'])
                for k, v in review.items():  # ECO-2025/2026-MB처럼 여러 학번을 묶은 항목
                    if '/' in k and k.endswith('-MB') and k.split('-')[0] == x['req_id'].split('-')[0] and x['area'] == '전공기초' and y[2:] in k:
                        note = v
                if note:
                    a['check'] = note
                areas.append(a)
            p_out[y] = areas
        d_out[prog] = p_out
    # 복수전공·부전공 영역에 같은 학번 단일전공의 지정 과목을 채워 넣어요
    for prog in ('복수1', '복수2'):
        for y, areas in d_out.get(prog, {}).items():
            single = {a['n']: a for a in d_out.get('단일', {}).get(y, [])}
            for a in areas:
                s = single.get(a['n'])
                if s and s['must'] and not a['must']:
                    a['must'] = list(s['must'])
                    a['fromSingle'] = True
    out_req[dept] = {'name': dname, 'prefix': pre, 'programs': d_out}

# 지정 과목 목록에 들어간 과목은 그 영역 분류로 표시
for dept, d in out_req.items():
    for prog in d['programs'].values():
        for areas in prog.values():
            for a in areas:
                if a['kind'] == 'MAJ':
                    for c in a['must']:
                        if not catalog[c]['k']:
                            catalog[c]['k'] = a['cat'].split(',')[0] or '전공'
# 지원 학과 과목인데 분류가 없으면 전공선택으로 봐요(개설 이력만 있는 과목)
for code, c in catalog.items():
    for dept, (_, pre) in SUPPORTED.items():
        if code.startswith(pre) and not c['k'] and unit_of(code) >= 2000:
            c['k'] = '전선'
            c['guess'] = 1

# ---------- 선수과목 ----------
prereq = defaultdict(list)
for p in rows('prerequisites.csv'):
    a, b = p['subject_code'], p['prereq_code']
    if a in catalog and b in catalog and unit_of(b) < 5000 and a != b:
        t = 'R' if p['type'] == 'REQUIRED' else 'S'
        if [b, t] not in prereq[a]:
            prereq[a].append([b, t])

# ---------- 학과 목록 ----------
depts = rows('departments.csv')

# ---------- 저장 ----------
def dump(name, obj):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    print(name, os.path.getsize(os.path.join(OUT, name)) // 1024, 'KB')


cat_out = {k: [v['n'], v['cr'], v['d'], v['k'], v['g']] + ([1] if v.get('guess') else []) for k, v in sorted(catalog.items())}
dump('courses.json', cat_out)
dump('sections-2026-2.json', sections)
dump('requirements.json', out_req)
dump('prerequisites.json', prereq)
dump('meta.json', {
    'term': TERM,
    'periods': [[int(r['period']), r['start'], r['end']] for r in rows('period_times.csv')],
    'supported': {k: v[0] for k, v in SUPPORTED.items()},
    'cohorts': [2020, 2026],
    'source': '연세대학교 대학요람(2020~2026), 2026-2 수강편람, 강의계획서',
    'built': '2026-11-25',
})
print('과목', len(catalog), '분반', len(sections), '선수과목', len(prereq))
