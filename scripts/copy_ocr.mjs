// Tesseract.js 인식 엔진(worker, core wasm)과 영어 인식 모델을 public/ocr로 복사해요.
// npm run dev / build 전에 자동으로 실행돼요. public/ocr는 저장소에 올리지 않아요.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const out = join(process.cwd(), 'public', 'ocr');
mkdirSync(out, { recursive: true });
const tjs = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json'));
const eng = dirname(require.resolve('@tesseract.js-data/eng/package.json'));
cpSync(join(tjs, 'dist', 'worker.min.js'), join(out, 'worker.min.js'));
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) cpSync(join(core, f), join(out, f));
cpSync(join(eng, '4.0.0_best_int', 'eng.traineddata.gz'), join(out, 'eng.traineddata.gz'));
console.log('OCR 파일 복사 완료:', out, existsSync(join(out, 'eng.traineddata.gz')));
