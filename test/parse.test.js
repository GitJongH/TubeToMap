const test = require('node:test');
const assert = require('node:assert');
const { parseDescription, getVideoId, isMapUrl } = require('../lib/parse.js');

const SAMPLE = [
  '🔽오늘 영상을 촬영한 장소🔽',
  '골목 안쪽에서 줄 서서 먹는 칼국수집 Noodle House https://maps.app.goo.gl/sample0001',
  '현지인이 가는 원조 식당 Old Kitchen https://maps.app.goo.gl/sample0002',
  '노을 보러 모두가 오는 언덕 공원 https://maps.app.goo.gl/sample0003 ',
  '가성비 좋은 국밥집 Sample Diner https://maps.app.goo.gl/sample0004  ',
  '',
  '샘플채널 (요리 영상) : https://www.youtube.com/@samplechannel',
  '인스타그램 : https://www.instagram.com/yooxicman/',
  'https://share.epidemicsound.com/g7t89r',
].join('\n');

test('지도 링크만 뽑고 이름을 붙인다', () => {
  const places = parseDescription(SAMPLE);
  assert.deepStrictEqual(places.map((p) => p.url), [
    'https://maps.app.goo.gl/sample0001',
    'https://maps.app.goo.gl/sample0002',
    'https://maps.app.goo.gl/sample0003',
    'https://maps.app.goo.gl/sample0004',
  ]);
  assert.strictEqual(places[0].name, '골목 안쪽에서 줄 서서 먹는 칼국수집 Noodle House');
  assert.strictEqual(places[3].name, '가성비 좋은 국밥집 Sample Diner');
});

test('같은 링크는 한 번만, 링크 뒤 구두점은 제거', () => {
  const places = parseDescription('A (https://maps.app.goo.gl/x1),\nA again https://maps.app.goo.gl/x1');
  assert.strictEqual(places.length, 1);
  assert.strictEqual(places[0].url, 'https://maps.app.goo.gl/x1');
});

test('이름이 윗줄에 있으면 윗줄을 이름으로 사용', () => {
  const places = parseDescription('1. 맛집 이름\nhttps://www.google.com/maps/place/abc');
  assert.strictEqual(places[0].name, '1. 맛집 이름');
});

test('google.com/maps, goo.gl/maps 형식도 인식', () => {
  const places = parseDescription('a https://www.google.com/maps/place/foo\nb https://goo.gl/maps/Abc123');
  assert.strictEqual(places.length, 2);
});

test('지도 링크가 없으면 빈 배열', () => {
  assert.deepStrictEqual(parseDescription('안녕 https://example.com'), []);
  assert.deepStrictEqual(parseDescription(''), []);
});

test('getVideoId는 watch 페이지에서만 ID 반환', () => {
  assert.strictEqual(getVideoId('https://www.youtube.com/watch?v=aaaaaaaaaaa&t=5'), 'aaaaaaaaaaa');
  assert.strictEqual(getVideoId('https://www.youtube.com/'), null);
  assert.strictEqual(getVideoId('https://example.com/watch?v=abc'), null);
});

test('getVideoId는 11자 ID 형식이 아니면 거부', () => {
  assert.strictEqual(getVideoId('https://www.youtube.com/watch?v=abc'), null);
  assert.strictEqual(getVideoId('https://www.youtube.com/watch?v=abc%26x%3D1defg'), null);
  assert.strictEqual(getVideoId('https://m.youtube.com/watch?v=aaaaaaaaaaa'), 'aaaaaaaaaaa');
});

test('isMapUrl: 진짜 지도 호스트만 허용', () => {
  for (const ok of [
    'https://maps.app.goo.gl/sample0001',
    'https://goo.gl/maps/Abc123',
    'https://www.google.com/maps/place/foo',
    'https://google.co.kr/maps?q=x',
    'https://www.google.com.br/maps/@1,2,3z',
    'https://maps.google.com/?q=x',
  ]) assert.strictEqual(isMapUrl(ok), true, ok);
  for (const bad of [
    'https://google.evil.com/maps',
    'https://google.com.evil.com/maps',
    'https://maps.google.com@evil.com/x',
    'https://evil.com/maps.app.goo.gl/x',
    'https://www.google.com/search?q=maps',
    'https://goo.gl/other',
    'https://maps.app.goo.gl/',
    'ftp://maps.app.goo.gl/x',
    'javascript:alert(1)',
    'not a url',
  ]) assert.strictEqual(isMapUrl(bad), false, bad);
});

test('설명란의 가짜 지도 링크는 장소로 뽑지 않는다', () => {
  const places = parseDescription(
    ['가짜1 https://google.evil.com/maps', '가짜2 https://maps.google.com@evil.com/x', '진짜 https://maps.app.goo.gl/real1'].join('\n')
  );
  assert.deepStrictEqual(places.map((p) => p.url), ['https://maps.app.goo.gl/real1']);
});

test('http 링크는 https로 통일하고 한글 문장부호 접미는 제거', () => {
  const places = parseDescription('맛집 「http://maps.app.goo.gl/abc123」\n다음 https://maps.app.goo.gl/def456。');
  assert.deepStrictEqual(places.map((p) => p.url), ['https://maps.app.goo.gl/abc123', 'https://maps.app.goo.gl/def456']);
});

test('한 줄에 링크가 여러 개면 같은 이름을 공유', () => {
  const places = parseDescription('두 곳 https://maps.app.goo.gl/a1 https://maps.app.goo.gl/b2');
  assert.deepStrictEqual(places.map((p) => p.name), ['두 곳', '두 곳']);
});
