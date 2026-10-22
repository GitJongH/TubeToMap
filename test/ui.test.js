// 구글 지도 화면 문구 판별 테스트. 샘플은 2026-10에 한국어 화면과 영어 화면(?hl=en)에서 실제로 읽은 값이다.
// 구글이 문구를 바꿔서 요소를 못 찾게 되면, 새 화면의 문구를 여기에 추가해 재현한 뒤 lib/ui.js를 고친다.
const test = require('node:test');
const assert = require('node:assert');
const ui = require('../lib/ui.js');

const G = ''; // 아이콘 글리프(행 맨 앞에 한 줄로 들어 있음)

test('목록 행: 한국어 화면의 내 목록', () => {
  assert.deepStrictEqual(ui.parseListRow(`${G}\n음식\n비공개·12개 장소`), { name: '음식', subtitle: '비공개·12개 장소' });
  assert.deepStrictEqual(ui.parseListRow('가고 싶은 장소\n비공개·1개 장소'), { name: '가고 싶은 장소', subtitle: '비공개·1개 장소' });
});

test('목록 행: 장소가 0개면 부제가 "비공개"만 있다', () => {
  assert.strictEqual(ui.parseListRow('별표 표시된 장소\n비공개').name, '별표 표시된 장소');
  assert.strictEqual(ui.parseListRow('Starred places\nPrivate').name, 'Starred places');
});

test('목록 행: 영어 화면(복수/단수)', () => {
  assert.strictEqual(ui.parseListRow('음식\nPrivate · 17 places').name, '음식');
  assert.strictEqual(ui.parseListRow('Want to go\nPrivate · 1 place').name, 'Want to go');
  assert.strictEqual(ui.parseListRow('Saved places\nPrivate · 0 places').name, 'Saved places');
});

test('목록 행: 남이 만든 목록과 목록이 아닌 버튼은 제외', () => {
  assert.strictEqual(ui.parseListRow('[샘플 EP.3] 맛집 지도\nBy 샘플작성자 · 38 places'), null);
  assert.strictEqual(ui.parseListRow('[샘플 EP.3] 맛집 지도\n작성자: 샘플작성자 · 38개 장소'), null);
  assert.strictEqual(ui.parseListRow('새 목록'), null);
  assert.strictEqual(ui.parseListRow('New list'), null);
  assert.strictEqual(ui.parseListRow('Terrain\nTraffic'), null);
});

test('저장 버튼 이름표: 한국어/영어, 여러 목록이면 숫자', () => {
  for (const ok of ['저장', '저장됨', '저장됨(2)', '저장됨 (3)', 'Save', 'Saved', 'Saved (2)', 'Saved(2)']) {
    assert.strictEqual(ui.isSaveLabel(ok), true, ok);
  }
  for (const bad of ['저장된 장소', 'Saved places', 'Save in your lists', '']) assert.strictEqual(ui.isSaveLabel(bad), false, bad);
});

test('저장 버튼이 "저장됨"이면 어딘가에 저장된 장소, "저장"이면 아무 데도 없다', () => {
  for (const saved of ['저장됨', '저장됨(2)', '저장됨 (3)', 'Saved', 'Saved (2)', `저장됨`]) assert.strictEqual(ui.isSavedLabel(saved), true, saved);
  for (const notSaved of ['저장', 'Save', 'Save in your lists', '저장된 장소', 'Saved places', '']) assert.strictEqual(ui.isSavedLabel(notSaved), false, notSaved);
});

test('메모 입력칸 이름표: 추가/수정', () => {
  for (const ok of ['메모 추가', '메모 수정', 'Add note', 'Edit note']) assert.strictEqual(ui.isNoteLabel(ok), true, ok);
  assert.strictEqual(ui.isNoteLabel('Add a note'), false); // 입력칸 둘레 텍스트이지 이름표가 아니다
  assert.strictEqual(ui.isNoteEditLabel('메모 수정'), true);
  assert.strictEqual(ui.isNoteEditLabel('Edit note'), true);
  assert.strictEqual(ui.isNoteEditLabel('Add note'), false);
  assert.strictEqual(ui.isNoteEditLabel('메모 추가'), false);
});

test('세부정보 토글: 펼치기만 인식(접기는 제외)', () => {
  assert.strictEqual(ui.isDetailsShow('장소 목록 세부정보 표시'), true);
  assert.strictEqual(ui.isDetailsShow('Show place lists details'), true);
  assert.strictEqual(ui.isDetailsShow('Hide place lists details'), false);
  assert.strictEqual(ui.isDetailsShow('장소 목록 세부정보 숨기기'), false);
});

test('새 목록 버튼 이름', () => {
  assert.strictEqual(ui.isNewListLabel(`${G}새 목록`), true);
  assert.strictEqual(ui.isNewListLabel('New list'), true);
  assert.strictEqual(ui.isNewListLabel('새 목록 만들기'), false);
});

test('기본 목록 이름 별칭(한국어 ↔ 영어)', () => {
  assert.deepStrictEqual(ui.aliasNames('저장한 장소'), ['저장한 장소', 'Saved places']);
  assert.deepStrictEqual(ui.aliasNames('Want to go'), ['가고 싶은 장소', 'Want to go']);
  assert.deepStrictEqual(ui.aliasNames('음식'), ['음식']); // 기본 목록이 아니면 자기 자신뿐
  assert.strictEqual(ui.sameList('Saved places', '저장한 장소'), true);
  assert.strictEqual(ui.sameList('Favorites', '즐겨찾기'), true);
  assert.strictEqual(ui.sameList('음식', '즐겨찾기'), false);
  assert.strictEqual(ui.sameList(`${G}음식`, '음식'), true);
});

test('"어느 목록에 저장됨" 제목: 한국어', () => {
  assert.strictEqual(ui.savedHeadingFor('음식 에 저장됨\n비공개·17개 장소', '음식'), true);
  assert.strictEqual(ui.savedHeadingFor('음식에 저장됨', '음식'), true);
  assert.strictEqual(ui.savedHeadingFor('음식 에 저장됨', '여행 계획'), false);
});

test('"어느 목록에 저장됨" 제목: 영어는 목록 이름이 공백 없이 붙는다', () => {
  assert.strictEqual(ui.savedHeadingFor('Saved in음식 /  / Private · 17 places', '음식'), true);
  assert.strictEqual(ui.savedHeadingFor('Saved in 음식', '음식'), true);
  assert.strictEqual(ui.savedHeadingFor('Saved in음식', 'Want to go'), false);
});

test('"어느 목록에 저장됨" 제목: 제목이 없으면 null, 기본 목록 별칭도 인식', () => {
  assert.strictEqual(ui.savedHeadingFor('Add a note', '음식'), null);
  assert.strictEqual(ui.savedHeadingFor('', '음식'), null);
  assert.strictEqual(ui.savedHeadingFor('Saved inWant to go', '가고 싶은 장소'), true);
  assert.strictEqual(ui.savedHeadingFor('가고 싶은 장소 에 저장됨', 'Want to go'), true);
});

test('"어느 목록에 저장됨" 제목: 목록 이름의 특수문자는 문자 그대로 비교', () => {
  assert.strictEqual(ui.savedHeadingFor('Saved in맛집 (서울) [A+]', '맛집 (서울) [A+]'), true);
  assert.strictEqual(ui.savedHeadingFor('Saved in맛집 서울', '맛집 (서울) [A+]'), false);
  assert.strictEqual(ui.savedHeadingFor('Saved in.*', '.*'), true);
});

test('저장됨 제목 텍스트 감지: 여러 목록이면 한국어 제목이 "A 및 B에 저장됨"으로 합쳐진다', () => {
  assert.strictEqual(ui.hasSavedHeading('TubeToMap-test 및 음식에 저장됨'), true);
  assert.strictEqual(ui.hasSavedHeading('TubeToMap-test 및 음식에 저장됨\nYouTube: Video AAAAAAAAAAA htt...'), true);
  assert.strictEqual(ui.hasSavedHeading('Saved in음식'), true);
  assert.strictEqual(ui.hasSavedHeading('Add a note'), false);
  assert.strictEqual(ui.hasSavedHeading(''), false);
});

test('합쳐진 제목은 개별 목록의 제목이 아니다(펼친 뒤 각 칸의 제목으로만 구분)', () => {
  assert.strictEqual(ui.savedHeadingFor('TubeToMap-test 및 음식에 저장됨', 'TubeToMap-test'), false);
  assert.strictEqual(ui.savedHeadingFor('TubeToMap-test 에 저장됨', 'TubeToMap-test'), true);
});

test('기본 이름의 새 목록 판별', () => {
  assert.strictEqual(ui.TEXT.untitledList.test('제목 없는 목록'), true);
  assert.strictEqual(ui.TEXT.untitledList.test('Untitled list'), true);
  assert.strictEqual(ui.TEXT.untitledList.test('내 목록'), false);
});
