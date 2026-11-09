// 서버 없이 올릴 수 있는 한 파일짜리 버전을 만든다(카페24 스킨 등 정적 호스팅용).
// CSS·JS를 모두 index.html 안에 넣고, 저장된 답변은 server/seed.js의 예시 데이터를 넣는다.
// 실시간 상담은 서버가 필요해서 이 버전에서는 [상담 연결]이 CONTACT_URL(1:1 문의 게시판)로 안내한다.
//
// 사용법: node tools/build-static.mjs [출력 폴더=dist/static]
//   CONTACT_URL=/board/consult/list.html node tools/build-static.mjs dist/cafe24
// API_URL에 레비 서버 주소를 주면 그 서버와 실시간 상담을 한다(서버의 ALLOWED_ORIGINS에 이 페이지 주소가 있어야 함).
// 서버에 닿지 않으면 넣어 둔 답변과 CONTACT_URL 안내로 바뀐다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAQ_SEED, SETTINGS_SEED } from '../server/seed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const outDir = path.resolve(ROOT, process.argv[2] || 'dist/static');
const read = (rel) => fs.readFileSync(path.join(PUB, rel), 'utf8');

// ES 모듈을 하나의 <script>로 묶는다. 모듈마다 함수로 감싸 이름이 겹치지 않게 하고,
// export한 이름만 돌려받아 import 자리에 풀어 넣는다.
const MODULES = [
  ['dom', 'js/dom.js'],
  ['rabbit', 'levi/rabbit.js'],
  ['levi', 'levi/levi.js'],
  ['shop', 'js/shop.js'],
];
const byFile = Object.fromEntries(MODULES.map(([name, rel]) => [rel, name]));

function bundleModule(name, rel) {
  let src = read(rel);
  const exported = [];
  src = src.replace(/^export (?:async )?(?:const|function) (\w+)/gm, (m, id) => {
    exported.push(id);
    return m.replace(/^export /, '');
  });
  src = src.replace(/^import\s*\{([^}]+)\}\s*from\s*'([^']+)';/gm, (m, names, from) => {
    const target = path.posix.join(path.posix.dirname(rel), from);
    const mod = byFile[target];
    if (!mod) throw new Error(`${rel}: 묶을 수 없는 import ${from}`);
    return `const {${names}} = __m_${mod};`;
  });
  if (/^\s*(import|export)\b/m.test(src)) throw new Error(`${rel}: 처리하지 못한 import/export`);
  return `const __m_${name} = (() => {\n${src}\nreturn { ${exported.join(', ')} };\n})();`;
}

const config = {
  api: process.env.API_URL || undefined,
  welcome: SETTINGS_SEED.welcome,
  hours: SETTINGS_SEED.hours,
  contactUrl: process.env.CONTACT_URL ?? '',
  contactText: process.env.CONTACT_TEXT || undefined,
  faqs: FAQ_SEED.map((f, i) => ({ id: i + 1, ...f })),
};

const js = [
  `window.LEVI_STATIC = ${JSON.stringify(config)};`,
  ...MODULES.map(([name, rel]) => bundleModule(name, rel)),
].join('\n\n');
const css = `${read('css/shop.css')}\n${read('levi/levi.css')}`;

let page = read('index.html')
  .replace(/\s*<link rel="icon"[^>]*>/, '')
  .replace(/\s*<link rel="stylesheet" href="\/[^"]*">/g, '')
  .replace(/\s*<script type="module" src="[^"]*"><\/script>/g, '')
  .replace('href="/" aria-label="rebit 홈"', 'href="#main" aria-label="rebit 홈"')
  .replace('</head>', `  <style>\n${css}\n  </style>\n</head>`)
  .replace('</body>', `  <script>\n(() => {\n${js}\n})();\n  </script>\n</body>`);

if (config.api) { /* 실시간 상담 서버가 있으면 문구 그대로 */ } else if (!config.contactUrl) page = page.replace('더 필요한 건 상담원과 1:1로 연결해 드려요.', '더 필요한 건 1:1 문의로 남겨 주세요.');
else page = page.replace('더 필요한 건 상담원과 1:1로 연결해 드려요.', '더 필요한 건 1:1 문의 게시판으로 안내해 드려요.');

// 카페24 같은 템플릿 엔진이 변수·모듈 문법으로 읽을 수 있는 글자 조합이 있으면 알린다.
for (const pat of ['{$', '<!--@', ' module="']) {
  if (page.includes(pat)) console.warn(`주의: 결과물에 "${pat}"가 들어 있어요. 템플릿 엔진에서 문제될 수 있어요.`);
}
if (/<\/script/i.test(js)) throw new Error('스크립트 안에 </script 가 있어요');

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), page);
console.log(`${path.relative(ROOT, path.join(outDir, 'index.html'))} (${(page.length / 1024).toFixed(1)} KB)`);
