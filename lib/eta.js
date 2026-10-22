// 저장 작업의 남은 시간을 추정한다. 브라우저(패널)/Node(테스트) 양쪽에서 사용.
// 이번 실행에서 이미 처리한 장소 수와 걸린 시간으로 평균을 내고, 남은 장소 수를 곱한다(장소 사이의 대기 시간도 평균에 포함됨).
(function (root) {
  const REMAINING = ['pending', 'working'];

  // job: { running, runStartedAt(ms), runTotal(이번 실행에서 처리할 장소 수), items[{state}] }
  // 아직 하나도 못 끝냈거나 남은 게 없으면 null(추정할 근거가 없음).
  function estimateRemainingMs(job, now) {
    if (!job || !job.running || typeof job.runStartedAt !== 'number' || !job.runTotal) return null;
    const left = job.items.filter((i) => REMAINING.includes(i.state)).length;
    const done = job.runTotal - left;
    if (done < 1 || left < 1) return null;
    return ((now - job.runStartedAt) / done) * left;
  }

  // 화면에 보여 줄 단위로 바꾼다: { lessThanMinute: true } | { minutes: n } | null
  function describeRemaining(ms) {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
    const seconds = ms / 1000;
    if (seconds < 45) return { lessThanMinute: true };
    return { minutes: Math.max(1, Math.round(seconds / 60)) };
  }

  const api = { estimateRemainingMs, describeRemaining };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GMLEta = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
