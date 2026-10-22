// 번역(_locales) 일관성 테스트. 문구를 추가/삭제할 때 두 언어가 어긋나거나, 코드가 없는 키를 쓰거나, 안 쓰는 키가 쌓이는 일을 막는다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const en = JSON.parse(read('_locales/en/messages.json'));
const ko = JSON.parse(read('_locales/ko/messages.json'));

const src = {
  popupJs: read('popup/popup.js'),
  popupHtml: read('popup/popup.html'),
  background: read('background.js'),
  content: read('content/maps.js'),
  manifest: read('manifest.json'),
};

// 오류 코드 → 메시지 키 (popup.js의 errKey와 같은 규칙)
const errKey = (code) => 'err_' + code.replace(/[^A-Za-z0-9]/g, '_');

const matches = (re, text) => [...text.matchAll(re)].map((m) => m[1]);

// 코드가 던지거나 응답하는 오류 코드들
const usedCodes = () => [
  ...matches(/\bfail\('([^']+)'/g, src.content),
  ...matches(/\bfail\('([^']+)'/g, src.background),
  ...matches(/\bbad\('([^']+)'/g, src.background),
  ...matches(/code: '([^']+)'/g, src.background),
  'error', // 코드가 없는 일반 오류의 기본값
];

test('영어와 한국어의 키가 같다', () => {
  assert.deepStrictEqual(Object.keys(en).sort(), Object.keys(ko).sort());
});

test('두 언어의 치환 값(placeholders) 이름과 순서가 같다', () => {
  for (const key of Object.keys(en)) {
    assert.deepStrictEqual(en[key].placeholders || {}, ko[key].placeholders || {}, key);
  }
});

test('메시지의 $NAME$ 자리는 모두 placeholders에 정의되어 있다', () => {
  for (const [lang, table] of [['en', en], ['ko', ko]]) {
    for (const [key, entry] of Object.entries(table)) {
      const used = matches(/\$([A-Z_]+)\$/g, entry.message).map((n) => n.toLowerCase());
      const defined = Object.keys(entry.placeholders || {}).map((n) => n.toLowerCase());
      assert.deepStrictEqual([...new Set(used)].sort(), defined.sort(), `${lang}/${key}`);
    }
  }
});

test('모든 메시지가 비어 있지 않다', () => {
  for (const table of [en, ko]) for (const [key, entry] of Object.entries(table)) assert.ok(entry.message.trim(), key);
});

test('코드가 던지는 오류 코드마다 번역(err_…)이 있다', () => {
  const codes = new Set(usedCodes());
  assert.ok(codes.size > 10, '오류 코드를 찾지 못함(정규식 점검 필요)');
  for (const code of codes) assert.ok(en[errKey(code)], `번역 없음: ${code} → ${errKey(code)}`);
});

// popup.js / popup.html / manifest.json 이 (오류 코드가 아닌) 직접 쓰는 번역 키들
const usedKeys = () =>
  new Set([
    ...matches(/\bt\('([A-Za-z0-9_]+)'/g, src.popupJs), // t('키')
    ...matches(/(?::|\|\|)\s*'((?:st|title)[A-Z][A-Za-z0-9]*)'/g, src.popupJs), // 상태/제목 키 표의 값
    ...matches(/data-i18n="([^"]+)"/g, src.popupHtml),
    ...matches(/data-i18n-attr="([^"]+)"/g, src.popupHtml).flatMap((v) => v.split(';').map((p) => p.split(':')[1])),
    ...matches(/__MSG_([A-Za-z0-9_]+)__/g, src.manifest),
  ]);

test('popup.js 와 popup.html 이 쓰는 키가 모두 번역에 있다', () => {
  const keys = usedKeys();
  assert.ok(keys.size > 20, '키를 찾지 못함(정규식 점검 필요)');
  for (const key of keys) assert.ok(en[key], `번역 없음: ${key}`);
});

test('안 쓰는 번역 키가 남아 있지 않다', () => {
  const used = usedKeys();
  const codeKeys = new Set(usedCodes().map(errKey));
  const unused = Object.keys(en).filter((key) => !used.has(key) && !codeKeys.has(key));
  assert.deepStrictEqual(unused, []);
});

test('매니페스트: 기본 언어가 있고 해당 _locales 폴더가 있다', () => {
  const manifest = JSON.parse(src.manifest);
  assert.ok(manifest.default_locale);
  assert.ok(fs.existsSync(path.join(root, '_locales', manifest.default_locale, 'messages.json')));
});
