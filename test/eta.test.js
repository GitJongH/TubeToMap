// 남은 시간 추정(lib/eta.js) 테스트
const test = require('node:test');
const assert = require('node:assert');
const { estimateRemainingMs, describeRemaining } = require('../lib/eta.js');

const items = (...states) => states.map((state, i) => ({ name: 'p' + i, url: 'u' + i, state }));
const job = (states, extra = {}) => ({ running: true, runStartedAt: 1000, runTotal: states.length, items: items(...states), ...extra });

test('끝낸 장소가 있으면 평균 시간 × 남은 장소 수', () => {
  // 8곳 중 2곳을 끝내는 데 20초 → 장소당 10초, 남은 6곳(진행 중 1 + 대기 5) → 60초
  const j = job(['added', 'exists', 'working', 'pending', 'pending', 'pending', 'pending', 'pending']);
  assert.strictEqual(estimateRemainingMs(j, 1000 + 20000), 60000);
});

test('하나도 못 끝냈으면 추정하지 않는다', () => {
  assert.strictEqual(estimateRemainingMs(job(['working', 'pending', 'pending']), 5000), null);
});

test('남은 장소가 없거나 작업 중이 아니면 추정하지 않는다', () => {
  assert.strictEqual(estimateRemainingMs(job(['added', 'added']), 9000), null);
  assert.strictEqual(estimateRemainingMs(job(['added', 'pending'], { running: false }), 9000), null);
  assert.strictEqual(estimateRemainingMs(null, 9000), null);
  assert.strictEqual(estimateRemainingMs({ running: true, items: [] }, 9000), null);
});

test('실패한 장소도 처리한 것으로 센다', () => {
  const j = job(['added', 'failed', 'working', 'pending'], { runStartedAt: 0 });
  assert.strictEqual(estimateRemainingMs(j, 20000), 20000); // 2곳에 20초 → 10초 × 남은 2곳
});

test('재시도: 이번 실행에서 처리할 장소 수(runTotal)만 기준으로 삼는다', () => {
  // 전체 8곳 중 7곳은 이미 끝남. 이번에는 2곳만 다시 시도(runTotal 2): 1곳 끝내는 데 12초 → 남은 1곳 12초
  const j = {
    running: true,
    runStartedAt: 0,
    runTotal: 2,
    items: items('added', 'added', 'added', 'added', 'added', 'added', 'added', 'working'),
  };
  assert.strictEqual(estimateRemainingMs(j, 12000), 12000);
});

test('표시 단위: 45초 미만은 "1분 미만", 그 이상은 반올림한 분(최소 1분)', () => {
  assert.deepStrictEqual(describeRemaining(10_000), { lessThanMinute: true });
  assert.deepStrictEqual(describeRemaining(44_999), { lessThanMinute: true });
  assert.deepStrictEqual(describeRemaining(45_000), { minutes: 1 });
  assert.deepStrictEqual(describeRemaining(90_000), { minutes: 2 });
  assert.deepStrictEqual(describeRemaining(5 * 60_000), { minutes: 5 });
});

test('표시 단위: 값이 없거나 이상하면 null', () => {
  assert.strictEqual(describeRemaining(null), null);
  assert.strictEqual(describeRemaining(undefined), null);
  assert.strictEqual(describeRemaining(NaN), null);
  assert.strictEqual(describeRemaining(-5), null);
});
