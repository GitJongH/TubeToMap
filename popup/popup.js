// 패널은 지도 작업을 직접 하지 않고 background.js에 맡긴 뒤, storage(lists/selectedList/task/job)를 보고 화면을 그린다.
const $ = (id) => document.getElementById(id);
// ---- 다국어: 문구는 _locales/{en,ko}/messages.json 에 있고, 브라우저 언어에 맞는 것이 자동으로 쓰인다 ----
// 치환 값은 순서대로 $1.. 에 들어간다(메시지의 $NAME$ 자리).
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));

// HTML의 data-i18n(글자) / data-i18n-attr("속성:키;속성:키") 자리를 번역해 채운다.
function applyI18n() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const m = t(el.dataset.i18n);
    if (m) el.textContent = m;
  });
  document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(';').forEach((pair) => {
      const [attr, key] = pair.split(':');
      const m = t(key);
      if (m) el.setAttribute(attr, m);
    });
  });
}

// 오류 코드 → 메시지 키. 예: "ui:note-box" → "err_ui_note_box" (_locales의 키와 짝이 맞아야 한다: test/i18n.test.js)
const errKey = (code) => 'err_' + String(code).replace(/[^A-Za-z0-9]/g, '_');
// { code, params, error } 모양의 오류(작업 상태/응답/장소 항목)를 사용자 언어의 문장으로. 번역이 없으면 원래 문장을 보여 준다.
function errText(e) {
  const translated = e && e.code ? t(errKey(e.code), ...(e.params || [])) : '';
  return translated || (e && (e.error || e.message)) || t('err_error');
}

const STATE_KEY = { pending: 'stPending', working: 'stWorking', added: 'stAdded', exists: 'stExists', failed: 'stFailed', canceled: 'stCanceled' };
const stateText = (state) => t(STATE_KEY[state]);
// 헤더 제목: 지금 무슨 일을 하는지 한 줄로. 진행 중에는 뒤에 점(.)이 1개씩 늘어난다.
const TITLE_IDLE = 'TubeToMap';
const TASK_TITLE_KEY = { refresh: 'titleRefresh', create: 'titleCreate' };
const LISTS_TTL_MS = 10 * 60 * 1000;
// 장소 앞 지도 핀 아이콘(고정 SVG)
const PIN_SVG =
  '<svg class="pin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/></svg>';
// 장소 행 끝의 "구글 지도에서 열기" 아이콘(고정 SVG)
const OPEN_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
const clean = (s) => String(s).replace(/[-]/g, '').trim();

let video = null; // { id, url, title, places }
let activeJob = null; // 화면에 표시 중인 작업
let currentTask = null; // 목록 불러오기/만들기 같은 단일 작업의 상태
let busy = false;

let currentDiag = null; // 화면 변경 오류일 때 "진단 정보 복사"에 쓸 값 { code, message, lang }

// 상태 줄을 바꾼다. diag가 있으면(구글 지도 화면이 바뀐 오류) "진단 정보 복사" 버튼도 함께 보여 준다.
function setStatus(text, kind, diag) {
  const el = $('status');
  el.hidden = !text;
  el.textContent = text || '';
  if (kind) el.dataset.kind = kind;
  else delete el.dataset.kind;
  currentDiag = diag || null;
  $('copyDiag').hidden = !currentDiag;
  $('copyDiag').textContent = t('copyDiag');
}

// "ui:"로 시작하는 오류 코드는 구글 지도 화면이 바뀌어 요소를 못 찾았다는 뜻이다(content/maps.js).
const isUiError = (code) => typeof code === 'string' && code.startsWith('ui:');

// 신고할 때 붙여 넣을 진단 정보(개인 정보 없음: 오류 코드와 메시지, 화면 언어, 버전, 브라우저뿐).
// 개발자가 읽기 쉽도록 사용자 언어와 상관없이 영어로 고정한다.
function diagText({ code, message, lang }) {
  return [
    `TubeToMap ${chrome.runtime.getManifest().version}`,
    `Error code: ${code}`,
    `Message: ${message}`,
    `Google Maps language: ${lang || 'unknown'}`,
    `Browser: ${navigator.userAgent}`,
  ].join('\n');
}

async function copyDiag() {
  if (!currentDiag) return;
  try {
    await navigator.clipboard.writeText(diagText(currentDiag));
    $('copyDiag').textContent = t('copied');
  } catch {
    $('copyDiag').textContent = t('copyFailed');
  }
  setTimeout(() => {
    $('copyDiag').textContent = t('copyDiag');
  }, 1500);
}

const counts = (job) => {
  const ok = job.items.filter((i) => i.state === 'added' || i.state === 'exists').length;
  const failed = job.items.filter((i) => i.state === 'failed').length;
  const canceled = job.items.filter((i) => i.state === 'canceled').length;
  return { ok, failed, canceled, total: job.items.length };
};

// 남은 시간 문구(처음 한 곳을 끝내기 전에는 근거가 없어 빈 문자열)
function etaText(job) {
  const d = GMLEta.describeRemaining(GMLEta.estimateRemainingMs(job, Date.now()));
  if (!d) return '';
  return d.lessThanMinute ? t('etaLessMinute') : t('etaMinutes', d.minutes);
}

// 헤더 제목을 지금 상태에 맞춰 바꾼다.
function renderTitle() {
  let text = TITLE_IDLE;
  let dots = false;
  if (currentTask && currentTask.running) {
    text = t(TASK_TITLE_KEY[currentTask.kind] || 'titleWorking');
    dots = true;
  } else if (activeJob) {
    if (activeJob.running) {
      text = t('titleJobRunning');
      dots = true;
    } else {
      text = t('titleSaved', counts(activeJob).ok);
    }
  }
  $('titleText').textContent = text;
  $('dots').hidden = !dots;
  document.title = dots ? `${text}…` : text;
}

// 영상 제목과 설명란을 읽는다. 1순위: 재생기가 들고 있는 현재 영상 정보(페이지 내부),
// 2순위: 영상 페이지 HTML에서 shortDescription 파싱.
async function readVideo(tab, id) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: (vid) => {
      const r = document.getElementById('movie_player')?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
      const d = r?.videoDetails;
      return d && d.videoId === vid ? { title: d.title, description: d.shortDescription } : null;
    },
    args: [id],
  });
  if (result) return result;

  const html = await (await fetch(`https://www.youtube.com/watch?v=${id}`, { credentials: 'omit' })).text();
  const m = html.match(/"shortDescription":("(?:[^"\\]|\\.)*")/);
  // <title>의 &amp; 같은 HTML 엔티티는 DOMParser로 해석한다(스크립트는 실행되지 않음).
  const pageTitle = new DOMParser().parseFromString(html, 'text/html').title;
  return {
    title: (pageTitle || id).replace(/ - YouTube$/, ''),
    description: m ? JSON.parse(m[1]) : '',
  };
}

function renderLists(lists, selected) {
  const sel = $('list');
  const keep = selected || sel.value;
  sel.innerHTML = '';
  // 예전 버전이 저장한 아이콘 글자/빈 이름이 남아 있어도 걸러서 보여 준다.
  lists.map(clean).filter(Boolean).forEach((n) => sel.add(new Option(n, n)));
  if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
  updateButtons();
}

function checkboxes() {
  return [...$('places').querySelectorAll('input[type=checkbox]')];
}

function updateButtons() {
  const boxes = checkboxes();
  const n = boxes.filter((cb) => cb.checked).length;
  const hasList = !!$('list').value;
  $('start').textContent = n === 1 ? t('saveOne') : n ? t('saveMany', n) : t('selectPlaces');
  $('start').disabled = busy || !n || !hasList;
  $('selCount').textContent = boxes.length ? t('selectedCount', n) : '';
  $('openList').disabled = !hasList && !activeJob;
  const all = $('all');
  all.checked = boxes.length > 0 && n === boxes.length;
  all.indeterminate = n > 0 && n < boxes.length;
  all.disabled = busy || !!activeJob;
}

function setBusy(b) {
  busy = b;
  ['refresh', 'create', 'list', 'newName'].forEach((id) => ($(id).disabled = b));
  checkboxes().forEach((cb) => (cb.disabled = b));
  updateButtons();
}

function renderPlaces(job) {
  const ul = $('places');
  ul.innerHTML = '';
  const items = job ? job.items : video.places.map((p) => ({ ...p, state: null }));
  items.forEach((p, i) => {
    const li = document.createElement('li');
    // 저장 전에는 체크할 수 있는 라벨, 저장 시작 후에는 상태를 보여 주는 행
    const item = document.createElement(job ? 'div' : 'label');
    item.className = 'item';
    item.dataset.url = p.url;
    if (!job) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.i = i;
      cb.onchange = updateButtons;
      item.append(cb);
    }
    item.insertAdjacentHTML('beforeend', PIN_SVG);
    const box = document.createElement('div');
    box.className = 'place';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name;
    name.title = p.url;
    box.append(name);
    if (p.error) {
      const err = document.createElement('span');
      err.className = 'err';
      err.textContent = errText(p);
      box.append(err);
    }
    item.append(box);
    if (p.state) {
      const chip = document.createElement('span');
      chip.className = `chip s-${p.state}`;
      chip.textContent = stateText(p.state);
      item.append(chip);
    }
    // 저장 전에 어떤 곳인지 확인할 수 있게 지도 링크를 새 탭으로 연다(주소는 parse.js가 지도 호스트까지 검증한 값).
    // 칩 너비와 상관없이 줄이 맞도록 항상 맨 오른쪽 끝에 둔다.
    const link = document.createElement('a');
    link.className = 'open-link';
    link.href = p.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = t('openPlace');
    link.setAttribute('aria-label', `${t('openPlace')}: ${p.name}`);
    link.innerHTML = OPEN_SVG;
    item.append(link);
    li.append(item);
    ul.append(li);
  });
  updateButtons();
}

// 화면에 붙어 있던 이전 작업을 놓는다(헤더 제목도 기본으로 돌아간다).
function clearJobView() {
  activeJob = null;
  renderTitle();
}

// 새 영상: 목록 선택/장소 체크 화면으로 되돌린다.
function showReadyMode() {
  activeJob = null;
  $('listCard').hidden = false;
  $('progressCard').hidden = true;
  $('placesHead').hidden = false;
  $('start').hidden = false;
  $('cancel').hidden = true;
  $('retry').hidden = true;
  $('openList').className = 'btn ghost';
  $('openList').textContent = t('openInMaps');
  renderTitle();
}

function applyTask(task) {
  currentTask = task || null;
  if (!task) return renderTitle();
  if (task.running) {
    setBusy(true);
    setStatus(t('mapsWindowNote'));
  } else if (task.error) {
    setBusy(false);
    if (isUiError(task.code)) {
      setStatus(`${errText(task)}\n${t('uiChangedHint')}`, 'error', { code: task.code, message: task.error, lang: task.lang });
    } else {
      setStatus(errText(task), 'error');
    }
  } else {
    setBusy(false);
    setStatus('');
  }
  renderTitle();
}

function applyJob(job) {
  if (!job || !job.items.length) return;
  activeJob = job;
  renderPlaces(job);
  setBusy(job.running);

  const { ok, failed, canceled, total } = counts(job);
  const done = ok + failed;
  const left = failed + canceled; // 아직 저장되지 않은 장소(실패 + 중단됨)
  // 저장을 시작하면 목록 선택 대신 진행 카드를 보여 준다.
  $('listCard').hidden = true;
  $('progressCard').hidden = false;
  $('placesHead').hidden = true;
  $('start').hidden = true;
  // 저장 중에만 "멈추기"를 보여 준다. 누르면 지금 장소까지 마치고 멈춘다.
  $('cancel').hidden = !job.running;
  $('cancel').disabled = !!job.cancelRequested;
  $('cancel').textContent = job.cancelRequested ? t('cancelling') : t('cancelBtn');
  $('pcTitle').textContent = job.running
    ? t('progressTitle', job.list)
    : canceled
      ? t('stoppedSummary', ok, left)
      : failed
        ? t('resultSummary', ok, failed)
        : t('progressDone', job.list);
  $('pcCount').textContent = job.running ? `${done} / ${total}` : '';
  $('pcEta').textContent = job.running ? etaText(job) : '';
  $('pcEta').hidden = !$('pcEta').textContent;
  $('barOk').style.width = `${(ok / total) * 100}%`;
  $('barFail').style.width = `${(failed / total) * 100}%`;
  $('bar').setAttribute('aria-valuemax', String(total));
  $('bar').setAttribute('aria-valuenow', String(done));
  const note = job.running ? t('noteRunning') : failed && !canceled ? t('noteFailed') : '';
  $('pcNote').hidden = !note;
  $('pcNote').textContent = note;

  // 중단된 장소가 있으면 "이어서 저장", 실패만 있으면 "다시 시도"
  $('retry').hidden = job.running || !left;
  $('retry').textContent = canceled ? t('resumeN', left) : t('retryN', failed);
  // 끝나면 "구글 지도에서 결과 확인"을 가장 눈에 띄게 한다.
  const finished = !job.running && ok > 0;
  $('openList').className = finished ? 'btn primary' : 'btn ghost';
  $('openList').textContent = finished ? t('openResult') : t('openInMaps');
  // 끝났는데 "화면이 바뀌어 요소를 못 찾음" 실패가 있으면 신고 안내와 진단 정보 복사를 보여 준다.
  const uiFail = job.running ? null : job.items.find((i) => i.state === 'failed' && isUiError(i.code));
  if (uiFail) {
    setStatus(t('uiChangedHint'), 'error', { code: uiFail.code, message: uiFail.error, lang: uiFail.lang });
  } else if (!(currentTask && currentTask.running)) {
    setStatus('');
  }
  renderTitle();
}

// background에 요청을 보내고, 거절(ok:false)이나 전송 실패를 화면에 알린다(조용히 사라지지 않게).
async function request(msg) {
  try {
    const res = await chrome.runtime.sendMessage(msg);
    if (res && !res.ok) setStatus(errText(res), 'error');
    return res;
  } catch (e) {
    setStatus(t('requestFail', e.message), 'error');
    return null;
  }
}

function start() {
  const chosen = checkboxes().filter((cb) => cb.checked).map((cb) => video.places[cb.dataset.i]);
  const list = $('list').value;
  if (!chosen.length || !list) return;
  chrome.storage.local.set({ selectedList: list });
  const note = `YouTube: ${video.title} ${video.url}`;
  request({ type: 'start', job: { list, note, marker: video.url, places: chosen } });
}

function createList() {
  const name = $('newName').value.trim();
  if (!name) return;
  $('newName').value = '';
  request({ type: 'createList', name });
}

function openList() {
  const name = activeJob ? activeJob.list : $('list').value;
  if (!name) return;
  request({ type: 'openList', name });
}

const refreshLists = () => request({ type: 'refreshLists' });
const retryFailed = () => request({ type: 'retryFailed' });
const cancelJob = () => request({ type: 'cancelJob' });

let myWindowId = null; // 이 패널이 속한 브라우저 창(지도 작업 창이 아니라 사용자가 보던 창)
let loading = false;
let reloadAgain = false;

// 현재 탭이 유튜브 영상이면 영상 정보와 장소를 읽어 화면을 그린다. 같은 영상이면 아무것도 하지 않는다.
// 읽는 도중 탭/영상이 또 바뀌면 끝난 뒤 한 번 더 읽는다.
async function loadVideo() {
  if (loading) {
    reloadAgain = true;
    return;
  }
  loading = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId: myWindowId });
    const id = GMLParse.getVideoId(tab?.url || '');
    if (id && video && video.id === id) return;
    // 영상이 바뀌거나 영상이 아닌 탭으로 가면 이전 영상의 저장 결과("6곳 저장됨" 등)를 헤더에서 걷어 낸다.
    clearJobView();
    if (!id) {
      video = null;
      $('main').hidden = true;
      setStatus(t('openVideo'));
      return;
    }
    setStatus(t('readingVideo'));
    const info = await readVideo(tab, id);
    const places = GMLParse.parseDescription(info.description);
    video = null;
    if (!places.length) {
      $('main').hidden = true;
      setStatus(t('noMapLinks'));
      return;
    }
    video = { id, url: `https://www.youtube.com/watch?v=${id}`, title: info.title, places };
    $('video').textContent = info.title;
    $('videoSub').textContent = places.length === 1 ? t('placesOne') : t('placesMany', places.length);
    // 썸네일이 안 열리면(오프라인 등) 재생 아이콘만 남긴다.
    const thumb = $('thumb');
    thumb.hidden = false;
    thumb.onerror = () => (thumb.hidden = true);
    thumb.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
    $('main').hidden = false;
    setStatus('');

    // 새 영상이면 이전 작업 화면을 비우고, 이 영상의 작업이 남아 있으면 그것을 보여 준다.
    showReadyMode();
    renderPlaces(null);

    const { task, job } = await chrome.storage.session.get(['task', 'job']);
    setBusy(!!((task && task.running) || (job && job.running)));
    if (job && job.items.some((i) => i.url === places[0].url)) applyJob(job);
    if (task && (task.running || task.error)) applyTask(task);
  } catch (e) {
    // 영상 정보를 못 읽어도 "읽는 중…"에 멈추지 않고 이유를 보여 준다.
    video = null;
    clearJobView();
    $('main').hidden = true;
    setStatus(t('videoReadFail', e.message), 'error');
  } finally {
    loading = false;
    if (reloadAgain) {
      reloadAgain = false;
      loadVideo();
    }
  }
}

async function setup() {
  applyI18n();
  myWindowId = (await chrome.windows.getCurrent()).id;

  // 처음 열었을 때만 짧은 안내를 보여 주고, "확인했어요"를 누르면 다시 보이지 않는다.
  const { onboarded } = await chrome.storage.local.get('onboarded');
  $('onboarding').hidden = !!onboarded;
  $('onbOk').onclick = () => {
    $('onboarding').hidden = true;
    chrome.storage.local.set({ onboarded: true });
  };

  $('refresh').onclick = refreshLists;
  $('create').onclick = createList;
  $('start').onclick = start;
  $('retry').onclick = retryFailed;
  $('cancel').onclick = cancelJob;
  $('openList').onclick = openList;
  $('copyDiag').onclick = copyDiag;
  // 주의: onkeydown 핸들러가 false를 반환하면 그 키 입력이 취소된다(영어·숫자·단축키가 막힘). 반환값을 만들지 않는다.
  $('newName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) createList();
  });
  $('list').onchange = () => {
    chrome.storage.local.set({ selectedList: $('list').value });
    updateButtons();
  };
  $('all').onchange = () => {
    checkboxes().forEach((cb) => (cb.checked = $('all').checked));
    updateButtons();
  };

  // storage가 바뀌면(백그라운드 작업 결과) 화면을 다시 그린다.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.lists || changes.selectedList)) {
      chrome.storage.local.get(['lists', 'selectedList']).then((p) => renderLists(p.lists || [], p.selectedList));
    }
    if (area === 'session' && changes.task) applyTask(changes.task.newValue);
    if (area === 'session' && changes.job) {
      const job = changes.job.newValue;
      // 지금 보고 있는 영상의 작업만 그린다(다른 영상의 작업이 돌고 있으면 버튼만 잠근다).
      if (video && job && job.items.some((i) => i.url === video.places[0].url)) applyJob(job);
      else if (job) setBusy(job.running);
    }
  });

  // 패널은 계속 열려 있으므로 탭을 바꾸거나 영상을 이동하면 다시 읽는다. 지도 작업 창의 탭 변화는 무시한다.
  chrome.tabs.onActivated.addListener((info) => info.windowId === myWindowId && loadVideo());
  chrome.tabs.onUpdated.addListener((_id, change, tab) => {
    if (tab.windowId === myWindowId && tab.active && (change.url || change.status === 'complete')) loadVideo();
  });

  const prefs = await chrome.storage.local.get(['lists', 'selectedList', 'listsAt']);
  const cached = (prefs.lists || []).map(clean).filter(Boolean);
  renderLists(cached, prefs.selectedList);

  await loadVideo();

  // 목록이 없거나 오래됐으면 자동으로 불러온다. 진행 중이거나 방금 실패한 경우에는 건너뛴다(필요하면 새로고침 버튼).
  const { task, job } = await chrome.storage.session.get(['task', 'job']);
  const running = (task && task.running) || (job && job.running);
  const stale = !prefs.listsAt || Date.now() - prefs.listsAt > LISTS_TTL_MS;
  if (video && !running && !activeJob && !(task && task.error) && (!cached.length || stale)) refreshLists();
}

setup().catch((e) => {
  setStatus(t('genericError', e.message), 'error');
});
