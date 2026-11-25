// 콘텐츠 스크립트 주입 범위: maps.app.goo.gl 단축 링크는 "/maps?q=…"(슬래시 없음) 문서로 열린 뒤 주소만 "/maps/place/…"로 바뀐다.
// 크롬은 처음 열린 문서 주소로 주입 여부를 정하므로, 둘 다 맞아야 저장이 된다(2026-11, 안 맞으면 "구글 지도 페이지가 응답하지 않아요").
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
const { matches } = manifest.content_scripts[0];
// 크롬 match pattern의 경로 부분 "*"는 쿼리까지 포함해 아무 문자열과 맞는다.
const toRegExp = (p) => new RegExp('^' + p.split('*').map((s) => s.replace(/[.?+^$()|[\]\\{}]/g, '\\$&')).join('.*') + '$');
const injected = (url) => matches.some((p) => toRegExp(p).test(url));

test('content script covers short-link landing URLs and place pages', () => {
  for (const host of ['www.google.com', 'www.google.co.kr']) {
    assert.ok(injected(`https://${host}/maps?q=Goldee%27s+Barbecue&ftid=0x1:0x2&entry=gps`), host);
    assert.ok(injected(`https://${host}/maps/place/Goldee%27s+Barbecue/@32.6,-97.2,17z`), host);
    assert.ok(injected(`https://${host}/maps/@/data=!4m2!10m1!1e1`), host);
  }
  assert.ok(!injected('https://www.google.com/search?q=maps'));
});
