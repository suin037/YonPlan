/* 런어스 '과거강좌조회' 캡처에서 학수번호와 연도·학기를 읽어요.
   - Tesseract.js(무료 오픈소스 OCR)를 브라우저 안에서 돌려요. 사진은 서버로 보내지 않아요.
   - 한국어 과목명은 인식이 불안정해서 영어·숫자인 학수번호(예: CAS2250.01-00)만 읽고,
     과목명·학점은 앱 데이터에서 찾아요.
   - 인식 엔진 파일은 사이트와 함께 배포해요(scripts/copy_ocr.mjs가 public/ocr에 복사). */

let workerPromise = null;
async function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const base = new URL(import.meta.env.BASE_URL + 'ocr/', location.href).href;
      return createWorker('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base,
        langPath: base,
        gzip: true,
        workerBlobURL: false,
        logger: m => { if (onProgress && m && typeof m.progress === 'number') onProgress(m.status, m.progress); }
      });
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

/* 흑백으로 바꿔 글자를 또렷하게 (휴대폰 캡처의 파란 링크 글자 인식이 좋아져요) */
async function toBinary(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) { const v = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2] > 170 ? 255 : 0; a[i] = a[i + 1] = a[i + 2] = v; }
  x.putImageData(d, 0, 0);
  return c;
}

/* 원본과 흑백본을 모두 읽고 합쳐요. 한쪽에서 놓친 학수번호를 다른 쪽이 잡아 줘요. */
export async function readImage(file, onProgress) {
  const worker = await getWorker(onProgress);
  const a = parseText((await worker.recognize(file)).data.text || '');
  let b = { text: '', rows: [] };
  try { b = parseText((await worker.recognize(await toBinary(file))).data.text || ''); } catch (e) { /* 흑백 변환이 안 되는 브라우저는 원본만 */ }
  const rows = [...a.rows];
  b.rows.forEach(r => {
    // 숫자·분반이 같으면 같은 과목을 글자만 다르게 읽은 것으로 봐요(예: MAT1012 / ATL1012)
    const same = rows.find(x => x.code === r.code || (x.code.slice(3) === r.code.slice(3) && x.section === r.section));
    if (!same) rows.push(r); else if (!same.sem && r.sem) Object.assign(same, { year: r.year, sem: r.sem });
  });
  return { text: a.text + '\n' + b.text, rows };
}

/* OCR이 헷갈리기 쉬운 글자 바로잡기 */
const TO_LETTER = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z', '4': 'A', '6': 'G', '7': 'T', '|': 'I', 'l': 'I', '!': 'I' };
const TO_DIGIT = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', L: '1', '|': '1', i: '1', '!': '1', ']': '1', '[': '1', S: '5', s: '5', B: '8', Z: '2', z: '2', A: '4', G: '6', b: '6', T: '7', g: '9', q: '9' };
const CODE_RE = /([A-Za-z0-9|!]{3})\s?([0-9OoDQIlLi|!\]\[SsBZzAGbTgq]{4})\s?[.,·:]\s?([0-9OoIlL]{2})\s?[-–~—]\s?([0-9OoIlL]{2})/g;

export function fixCode(a, b) {
  const L = a.toUpperCase().split('').map(ch => TO_LETTER[ch] || ch).join('');
  const N = b.split('').map(ch => TO_DIGIT[ch] || ch).join('');
  return /^[A-Z]{3}$/.test(L) && /^\d{4}$/.test(N) ? L + N : null;
}

/* 한 줄씩 보며 '연도 학기 ... (학수번호)'를 찾아요.
   학기는 연도 바로 뒤 글자(예: "2026 2학기" → 2)로 읽고, 못 읽으면 비워 둬요.
   과목명이 길어 학수번호가 다음 줄로 넘어가면 바로 앞 줄의 연도·학기를 써요. */
export function parseText(text) {
  const rows = []; let last = null;
  // 휴대폰 화면처럼 학수번호가 줄바꿈으로 나뉘면("(CAS4151.01-" + "00)") 이어 붙여요
  const raw = text.split(/\r?\n/), lines = [];
  for (let i = 0; i < raw.length; i++) {
    if (/[.,·:]\s?[0-9OoIlL]{2}\s?[-–~—]\s*$/.test(raw[i]) && i + 1 < raw.length) { lines.push(raw[i] + raw[i + 1].trim()); i++; }
    else if (/[A-Za-z0-9|!]{3}\s?[0-9OoDQIlLi|!\]\[SsBZzAGbTgq]{4}\s?[.,·:]?\s*$/.test(raw[i]) && i + 1 < raw.length && /^\s*[.,·:]?\s?[0-9OoIlL]{2}\s?[-–~—]/.test(raw[i + 1])) { lines.push(raw[i] + raw[i + 1].trim()); i++; }
    else lines.push(raw[i]);
  }
  let header = null;
  for (const line of lines) {
    const ym = /(?<![A-Za-z0-9])(20[1-3]\d)(?![\d.])\s*[^\dA-Za-z]{0,2}\s*([^\s]{1,6})?/.exec(line);
    let ys = null;
    if (ym) {
      const t = (ym[2] || '').trim();
      const s = /^[1１]/.test(t) ? '1' : /^[2２]/.test(t) ? '2' : '';
      ys = { year: ym[1], sem: s };
    }
    CODE_RE.lastIndex = 0;
    const found = [];
    let m;
    while ((m = CODE_RE.exec(line))) { const code = fixCode(m[1], m[2]); if (code) found.push({ code, section: `${m[3]}-${m[4]}`, raw: m[0] }); }
    if (found.length) {
      const ctx = ys || last || header || { year: '', sem: '' };
      found.forEach(f => rows.push({ ...f, year: ctx.year, sem: ctx.sem }));
      if (ys) last = ys;
    } else if (ys) {
      // 표 위쪽 검색 조건(연도 학기 2026 2학기) 또는 줄이 나뉜 행의 앞부분
      if (!rows.length && !header) header = ys;
      last = ys;
    }
  }
  // 같은 과목이 두 번 읽히면 하나만
  const seen = new Set();
  return { text, rows: rows.filter(r => { const k = r.code + r.year + r.sem; if (seen.has(k)) return false; seen.add(k); return true; }) };
}
