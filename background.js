// 서비스 워커: 구글 지도 작업(목록 불러오기/새 목록/장소 저장)을 전용 창 하나에서 순차 처리하고,
// 결과는 storage에 기록한다. 패널(UI)은 storage만 보고 상태를 그린다.
//  - storage.local:   lists, listsAt, selectedList
//  - storage.session: task({kind, running, message, error}), job({running, list, note, marker, items[...]}), workWin({windowId, tabId})
importScripts('lib/parse.js'); // GMLParse.isMapUrl: 외부 입력(URL)을 열기 전에 호스트를 검증한다.

const GAP_MS = 1500;
// 오류는 코드(+치환 값)와 한국어 문장을 함께 가진다. 패널은 코드로 사용자 언어의 문장을 찾고(_locales의 err_<코드>), 없으면 이 문장을 그대로 보여 준다.
const fail = (code, message, params) => Object.assign(new Error(message), { code, params });
const bad = (code, message, params) => ({ ok: false, error: message, code, params });
const busyReply = () => bad('busy', '다른 작업이 진행 중이에요');
const LIST_NOT_VISIBLE = /목록을 찾지 못했어요/; // content/maps.js savePlace의 "목록을 찾지 못했어요" 오류
const LIST_RETRY_MS = 4000;
const SAVED_URL = 'https://www.google.com/maps/@/data=!4m2!10m1!1e1'; // "저장됨" 화면: 내 목록 전체 + 새 목록
const MAPS_URL = /^https:\/\/www\.google\.(com|co\.kr)\/maps/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s).replace(/[-]/g, '').trim();
const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

// UI는 팝업이 아니라 사이드 패널이다. 팝업은 포커스를 잃으면 닫히는데, 지도 작업 창이 열리고 닫힐 때마다 포커스가 흔들려
// 작업 중에 UI가 꺼졌다. 사이드 패널은 다른 창의 포커스와 무관하게 열려 있다. 아이콘을 누르면 패널이 열린다.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

let currentJob = null; // 지금 돌고 있는 저장 작업(멈추기 요청을 표시하는 용도)
let cancelRequested = false; // 멈추기 요청: 진행 중인 장소는 끝까지 처리하고 남은 장소는 "중단됨"으로 남긴다
let busy = false; // 단일 작업만 허용한다. 반드시 await 이전에 동기적으로 잡는다(claim).
let work = null; // { windowId, tabId, attached, focusOk, originWindowId }

const setTask = (task) => chrome.storage.session.set({ task });
const setJob = (job) => chrome.storage.session.set({ job });

const claim = () => {
  if (busy) return false;
  busy = true;
  return true;
};

// 서비스 워커가 작업 도중 종료되면(확장 프로그램 새로고침, 유휴 종료 등) 메모리의 busy/work는 사라지지만
// storage의 running 상태와 지도 작업 창/디버거는 남는다. 시작할 때 이를 정리해서 UI가 "진행 중"에 갇히지 않게 한다.
async function recover() {
  const { task, job, workWin } = await chrome.storage.session.get(['task', 'job', 'workWin']);
  if (workWin) {
    await chrome.debugger.detach({ tabId: workWin.tabId }).catch(() => {});
    await chrome.windows.remove(workWin.windowId).catch(() => {});
    await chrome.storage.session.remove('workWin');
  }
  if (task && task.running) {
    await setTask({ kind: task.kind, running: false, error: '작업이 중단됐어요. 다시 시도해 주세요.', code: 'interrupted' });
  }
  if (job && job.running) {
    job.running = false;
    // 처리 중이거나 아직 못 한 항목은 실패로 돌려, "실패한 항목 다시 시도"로 이어서 할 수 있게 한다.
    job.items.forEach((i) => {
      if (i.state === 'working' || i.state === 'pending') {
        i.state = 'failed';
        i.error = '작업이 중단됐어요';
        i.code = 'interrupted';
      }
    });
    await setJob(job);
  }
}
recover().catch(() => {});

// 창에 OS 포커스가 없어도 페이지가 "포커스 있음"으로 동작하게 한다(글자 입력·메모 확정이 포커스에 의존하기 때문).
// 디버거 연결이 안 되면(예: 개발자 도구가 열려 있음) 그냥 진행한다.
async function emulateFocus() {
  try {
    if (!work.attached) {
      await chrome.debugger.attach({ tabId: work.tabId }, '1.3');
      work.attached = true;
    }
    await chrome.debugger.sendCommand({ tabId: work.tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true });
    work.focusOk = true;
  } catch {
    work.focusOk = false; // 포커스 에뮬레이션 없이 진행
  }
}

// 사용자가 노란 "디버깅 중" 바를 닫거나 개발자 도구를 열면 디버거가 분리된다 → 다음 페이지에서 다시 붙인다.
chrome.debugger.onDetach.addListener((source) => {
  if (work && source.tabId === work.tabId) work.attached = false;
});
// 사용자가 작업 창을 직접 닫으면 참조를 비워, 다음 항목이 새 창을 만들게 한다.
chrome.windows.onRemoved.addListener((windowId) => {
  if (work && work.windowId === windowId) work = null;
});

async function getPage(url) {
  if (work) {
    try {
      await chrome.tabs.get(work.tabId);
    } catch {
      work = null; // 창/탭이 이미 사라짐
    }
  }
  let prevUrl = null;
  if (!work) {
    const origin = await chrome.windows.getLastFocused().catch(() => null);
    // focused:false — 지도 창이 포커스를 가져가지 않게 한다.
    const w = await chrome.windows.create({ url, type: 'popup', focused: false, width: 1100, height: 800 });
    work = { windowId: w.id, tabId: w.tabs[0].id, attached: false, focusOk: false, originWindowId: origin && origin.id };
    await chrome.storage.session.set({ workWin: { windowId: w.id, tabId: w.tabs[0].id } });
  } else {
    prevUrl = (await chrome.tabs.get(work.tabId)).url;
    await chrome.tabs.update(work.tabId, { url });
  }
  const w = work;
  // 이동이 시작(loading)되었거나 주소가 바뀐 뒤에 완료(complete)를 받아들인다. 이전 페이지의 complete를 새 페이지로 오인하지 않기 위함.
  const startedAt = Date.now();
  let sawLoading = false;
  for (;;) {
    const t = await chrome.tabs.get(w.tabId);
    if (t.status === 'loading') sawLoading = true;
    const moved = sawLoading || t.url !== prevUrl || Date.now() - startedAt > 8000;
    if (t.status === 'complete' && MAPS_URL.test(t.url || '') && moved) {
      await emulateFocus();
      return w.tabId;
    }
    if (Date.now() - startedAt > 40000) throw fail('page-open-timeout', '구글 지도 페이지가 열리지 않았어요');
    await sleep(250);
  }
}

async function closeWork() {
  if (!work) return;
  const { windowId, tabId, attached, originWindowId } = work;
  work = null;
  if (attached) await chrome.debugger.detach({ tabId }).catch(() => {});
  await chrome.windows.remove(windowId).catch(() => {});
  await chrome.storage.session.remove('workWin').catch(() => {});
  if (originWindowId) await chrome.windows.update(originWindowId, { focused: true }).catch(() => {});
}

// 페이지가 이동 중이면 콘텐츠 스크립트가 아직 없거나 포트가 닫힐 수 있어 잠시 재시도한다.
const RETRYABLE = /Receiving end does not exist|Could not establish connection|message port closed/;

async function send(tabId, msg, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, msg);
      if (!res) throw new Error('Receiving end does not exist');
      // 콘텐츠 스크립트가 보낸 오류 코드("ui:…"는 구글 지도 화면이 바뀐 경우)와 화면 언어를 그대로 이어 준다.
      if (!res.ok) throw Object.assign(new Error(res.error), { code: res.code, lang: res.lang, params: res.params });
      return res.data;
    } catch (e) {
      if (!RETRYABLE.test(e.message)) throw e;
      await sleep(500);
    }
  }
  throw fail('page-no-response', '구글 지도 페이지가 응답하지 않아요');
}

// "저장됨" 화면에서 내 목록 이름을 읽어 저장한다.
async function readLists() {
  const tabId = await getPage(SAVED_URL);
  const lists = (await send(tabId, { type: 'readLists' })).map(clean).filter(Boolean);
  const { selectedList } = await chrome.storage.local.get('selectedList');
  await chrome.storage.local.set({
    lists,
    listsAt: Date.now(),
    selectedList: lists.includes(selectedList) ? selectedList : lists[0] || '',
  });
  return lists;
}

// 작업이 끝나면 항상 전용 창을 닫고 busy를 푼다(창 정리에서 오류가 나도 busy는 반드시 해제).
async function finish() {
  try {
    await closeWork();
  } finally {
    busy = false;
  }
}

// 단일 작업을 시작만 하고 바로 응답한다. 진행 상황은 storage(task)로 전달한다(긴 작업 동안 메시지 응답을 붙잡지 않기 위함).
function runTask(kind, message, fn) {
  if (!claim()) return busyReply();
  (async () => {
    try {
      await setTask({ kind, running: true, message });
      await fn();
      await setTask({ kind, running: false });
    } catch (e) {
      await setTask({ kind, running: false, error: e.message, code: e.code, lang: e.lang, params: e.params }).catch(() => {});
    } finally {
      await finish();
    }
  })();
  return { ok: true };
}

const refreshLists = () => runTask('refresh', '내 구글 지도 목록을 불러오는 중…', () => readLists());

const createList = ({ name }) => {
  if (!isStr(name, 40)) return bad('bad-name', '목록 이름을 확인해 주세요(1~40자)');
  return runTask('create', `"${name}" 목록을 만드는 중…`, async () => {
    const tabId = await getPage(SAVED_URL);
    // 같은 이름이 이미 있으면 만들지 않는다(만든 것인지 구분할 수 없고, 저장 때 엉뚱한 목록으로 갈 수 있음).
    const existing = (await send(tabId, { type: 'readLists' })).map(clean);
    if (existing.includes(name)) throw fail('list-exists', `"${name}" 목록이 이미 있어요. 다른 이름을 쓰거나 기존 목록을 선택해 주세요.`, [name]);
    await send(tabId, { type: 'createList', name });
    // 만든 뒤 자동으로 목록을 다시 불러와, 실제로 생겼는지 확인하고 선택해 둔다.
    const lists = await readLists();
    if (!lists.includes(name)) throw fail('list-not-found-after-create', '목록이 만들어졌지만 목록에서 찾지 못했어요. 구글 지도에서 확인해 주세요.');
    await chrome.storage.local.set({ selectedList: name });
  });
};

// job.items 중 state가 pending인 항목만 처리한다(새 작업은 전부 pending, 재시도는 실패 항목만 pending으로 되돌림).
// 호출 전에 claim()으로 busy를 잡아야 한다.
async function runJob(job) {
  try {
    job.running = true;
    // 남은 시간 추정용(lib/eta.js): 이번 실행의 시작 시각과 처리할 장소 수. 재시도 때는 다시 시작하는 장소만 센다.
    job.runStartedAt = Date.now();
    job.runTotal = job.items.filter((i) => i.state === 'pending').length;
    job.cancelRequested = false;
    currentJob = job;
    cancelRequested = false;
    await setJob(job);
    for (const item of job.items) {
      if (item.state !== 'pending') continue;
      if (cancelRequested) {
        item.state = 'canceled';
        continue;
      }
      item.state = 'working';
      delete item.error;
      delete item.code;
      delete item.lang;
      delete item.params;
      await setJob(job);
      // 방금 만든 목록은 장소 페이지의 저장 창에 잠깐 늦게 나타날 수 있다(저장됨 화면에는 보임). 그 경우에만 새로 불러와 한 번 더 시도한다.
      for (let attempt = 0; ; attempt++) {
        try {
          const tabId = await getPage(item.url);
          const r = await send(tabId, { type: 'savePlace', list: job.list, note: job.note, marker: job.marker });
          item.state = r.status; // added | exists
          item.note = r.note; // note-added | note-exists
          if (r.name) item.name = r.name;
          break;
        } catch (e) {
          if (attempt === 0 && (e.code === 'list-missing' || LIST_NOT_VISIBLE.test(e.message))) {
            await sleep(LIST_RETRY_MS);
            continue;
          }
          item.state = 'failed';
          item.error = e.message;
          item.code = e.code;
          item.lang = e.lang;
          item.params = e.params;
          break;
        }
      }
      await setJob(job);
      if (!cancelRequested && job.items.some((i) => i.state === 'pending')) await sleep(GAP_MS);
    }
  } catch (e) {
    // 예기치 못한 오류: 처리 중/대기 항목을 실패로 돌려 재시도할 수 있게 한다.
    job.items.forEach((i) => {
      if (i.state === 'working' || i.state === 'pending') {
        i.state = 'failed';
        i.error = e.message;
      }
    });
  } finally {
    job.running = false;
    job.cancelRequested = false;
    currentJob = null;
    cancelRequested = false;
    await setJob(job).catch(() => {});
    await finish();
  }
}

// 저장 중에 "멈추기": 지금 처리 중인 장소는 끝까지 마치고(중간에 끊으면 반쯤 저장된 상태가 남을 수 있음) 나머지는 "중단됨"으로 남긴다.
// 중단된 장소는 "이어서 저장"(retryFailed)으로 다시 처리할 수 있다.
async function cancelJob() {
  if (!currentJob || !currentJob.running) return bad('nothing-to-cancel', '멈출 작업이 없어요');
  cancelRequested = true;
  currentJob.cancelRequested = true; // 패널이 "멈추는 중…"을 보여 주도록
  await setJob(currentJob);
  return { ok: true };
}

// 패널이 보낸 입력을 믿지 않고 형식을 검증한다. 지도 링크는 호스트까지 확인한다.
function validateJob(job) {
  if (!job || !isStr(job.list, 200) || !isStr(job.note, 2000) || !isStr(job.marker, 200)) return null;
  if (!Array.isArray(job.places) || !job.places.length || job.places.length > 100) return null;
  const places = [];
  for (const p of job.places) {
    if (!p || typeof p.url !== 'string' || !GMLParse.isMapUrl(p.url)) return null;
    places.push({ name: String(p.name || p.url).slice(0, 200), url: p.url });
  }
  return { list: job.list, note: job.note, marker: job.marker, places };
}

function startJob({ job }) {
  const v = validateJob(job);
  if (!v) return bad('bad-request', '요청 형식이 올바르지 않아요');
  if (!claim()) return busyReply();
  runJob({ list: v.list, note: v.note, marker: v.marker, items: v.places.map((p) => ({ ...p, state: 'pending' })) });
  return { ok: true };
}

async function retryFailed() {
  if (!claim()) return busyReply();
  let job;
  try {
    ({ job } = await chrome.storage.session.get('job'));
  } catch (e) {
    busy = false;
    return { ok: false, error: e.message };
  }
  // 실패한 장소와 중간에 멈춘(중단됨) 장소를 다시 처리 대상으로 돌린다.
  const retryable = (i) => i.state === 'failed' || i.state === 'canceled';
  if (!job || !job.items.some(retryable)) {
    busy = false;
    return bad('nothing-to-retry', '다시 시도할 실패 항목이 없어요');
  }
  job.items.forEach((i) => {
    if (retryable(i)) i.state = 'pending';
  });
  runJob(job);
  return { ok: true };
}

// 저장 결과 확인용: 눈에 보이는 새 탭에서 구글 지도 "저장됨" 화면을 열고 해당 목록을 연다.
// 작업용 창과 별개라서 작업 중에도 쓸 수 있고, 탭은 닫지 않고 사용자에게 남긴다.
async function openList({ name }) {
  if (!isStr(name, 200)) return bad('bad-name', '목록 이름을 확인해 주세요');
  const tab = await chrome.tabs.create({ url: SAVED_URL, active: true });
  const end = Date.now() + 30000;
  for (;;) {
    const t = await chrome.tabs.get(tab.id);
    if (t.status === 'complete') break;
    if (Date.now() > end) return bad('page-open-timeout', '구글 지도 페이지가 열리지 않았어요');
    await sleep(250);
  }
  await send(tab.id, { type: 'openList', name });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 이 확장 프로그램의 패널(탭이 없는 확장 페이지)에서 온 메시지만 처리한다.
  if (sender.id !== chrome.runtime.id || sender.tab || !msg) return false;
  const handler = { refreshLists, createList, start: startJob, retryFailed, openList, cancelJob }[msg.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg))
    .catch((e) => bad(e.code || 'error', e.message, e.params))
    .then(sendResponse);
  return true;
});
