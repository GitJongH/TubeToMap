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

// 상태 칩 앞의 아이콘(고정 SVG). 이모지는 OS마다 모양이 달라 쓰지 않고, currentColor로 칩 색을 따른다.
const chipIcon = (body, width = 2.6) =>
  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const STATE_ICON = {
  pending: chipIcon('<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>'),
  working: chipIcon('<path class="ring" d="M12 3a9 9 0 1 1-9 9"/>', 3),
  added: chipIcon('<path class="draw" d="M5 12.5l4.5 4.5L19 7.5"/>', 3),
  exists: chipIcon('<path d="M6.5 4h11v16l-5.5-3.8L6.5 20z"/>'),
  failed: chipIcon('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.3"/>'),
  canceled: chipIcon('<path d="M9 6v12M15 6v12"/>', 3),
};

// ---- 움직임 ----
// 시간과 곡선은 popup.css의 --d-* / --ease-out 토큰과 같은 값이다.
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';
// 패널을 다시 열어 이미 진행된 작업을 그릴 때처럼, 움직임 없이 바로 그려야 하는 동안 true
let instant = false;
const motionMs = (ms) => (instant || REDUCED_MOTION.matches ? 0 : ms);
function withoutMotion(fn) {
  instant = true;
  try {
    fn();
  } finally {
    instant = false;
  }
}

// hidden 토글 대신 높이·투명도를 함께 움직여 접고 펼친다. 끝나면 hidden 속성이 최종 상태가 된다.
function reveal(el, show) {
  const cur = el._reveal;
  if (show === (cur ? cur.show : !el.hidden)) return;
  if (cur) cur.anim.cancel();
  const duration = motionMs(220);
  if (!duration) {
    el.hidden = !show;
    return;
  }
  el.hidden = false;
  const cs = getComputedStyle(el);
  const gap = parseFloat(getComputedStyle(el.parentElement).rowGap) || 0; // 부모 flex/grid의 gap도 함께 접는다
  const open = { height: `${el.offsetHeight}px`, opacity: 1, transform: 'none', paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginBottom: '0px' };
  const shut = { height: '0px', opacity: 0, transform: 'translateY(-4px)', paddingTop: '0px', paddingBottom: '0px', marginBottom: `${-gap}px` };
  el.style.overflow = 'hidden';
  const anim = el.animate(show ? [shut, open] : [open, shut], { duration, easing: EASE_OUT });
  el._reveal = { show, anim };
  anim.onfinish = () => {
    el.style.overflow = '';
    el._reveal = null;
    if (!show) el.hidden = true;
  };
  anim.oncancel = () => {
    el.style.overflow = '';
    el._reveal = null;
  };
}

// 같은 클래스를 다시 붙여도 CSS 애니메이션이 처음부터 다시 돌게 한다.
function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// 글자가 바뀔 때만 아래에서 살짝 올라오며 나타난다(개수, 제목).
function rollText(el, text) {
  if (el.textContent === text) return;
  el.textContent = text;
  const duration = motionMs(240);
  if (duration && text) el.animate([{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], { duration, easing: EASE_OUT });
}

let video = null; // { id, url, title, places }
let activeJob = null; // 화면에 표시 중인 작업
let currentTask = null; // 목록 불러오기/만들기 같은 단일 작업의 상태
let busy = false;

let currentDiag = null; // 화면 변경 오류일 때 "진단 정보 복사"에 쓸 값 { code, message, lang }

// 상태 줄을 바꾼다. diag가 있으면(구글 지도 화면이 바뀐 오류) "진단 정보 복사" 버튼도 함께 보여 준다.
function setStatus(text, kind, diag) {
  const el = $('status');
  // 사라질 때는 글자와 색을 그대로 둔 채 접는다(먼저 비우면 빈 띠가 접히는 것처럼 보인다).
  if (text) {
    el.textContent = text;
    if (kind) el.dataset.kind = kind;
    else delete el.dataset.kind;
  }
  reveal(el, !!text);
  currentDiag = diag || null;
  $('copyDiag').textContent = t('copyDiag');
  reveal($('copyDiag'), !!currentDiag);
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
  let done = false;
  if (currentTask && currentTask.running) {
    text = t(TASK_TITLE_KEY[currentTask.kind] || 'titleWorking');
    dots = true;
  } else if (activeJob) {
    if (activeJob.running) {
      text = t('titleJobRunning');
      dots = true;
    } else {
      const { ok } = counts(activeJob);
      text = t('titleSaved', ok);
      done = ok > 0;
    }
  }
  rollText($('titleText'), text);
  $('dots').hidden = !dots;
  // 저장이 끝나면 제목 옆에 체크가 한 번 튀어나온다.
  const badge = $('doneBadge');
  if (done && badge.hidden) {
    badge.hidden = false;
    const duration = motionMs(420);
    if (duration) {
      badge.animate(
        [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }],
        { duration, delay: 120, easing: EASE_OUT, fill: 'backwards' },
      );
    }
  } else if (!done) {
    badge.hidden = true;
  }
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

// 장소 행은 영상마다 한 번만 만들고, 저장이 진행되는 동안에는 같은 행의 칩·오류 문구만 바꾼다.
// (매번 새로 만들면 CSS 전환이 시작될 요소가 사라지고, 마우스를 올려 둔 링크나 키보드 포커스도 튄다.)
const rows = new Map(); // url → { place, li, cb, pin, name, err, chip, state }

function checkboxes() {
  return [...rows.values()].map((r) => r.cb);
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
  // 저장을 시작한 뒤에는 체크박스가 접혀 숨어 있으므로 계속 잠가 둔다.
  checkboxes().forEach((cb) => (cb.disabled = b || !!activeJob));
  updateButtons();
}

// 장소 행을 새로 만든다(체크할 수 있는 상태). places: [{ name, url }]
function renderPlaces(places) {
  const ul = $('places');
  ul.innerHTML = '';
  rows.clear();
  const stagger = motionMs(280);
  places.forEach((p, i) => {
    const li = document.createElement('li');
    const item = document.createElement('label');
    item.className = 'item';
    item.dataset.url = p.url;
    // 체크박스는 감싸 두었다가 저장을 시작하면 너비를 접어 사라지게 한다(popup.css: .is-job .cb-wrap).
    const cbWrap = document.createElement('span');
    cbWrap.className = 'cb-wrap';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.onchange = updateButtons;
    cbWrap.append(cb);
    item.append(cbWrap);
    item.insertAdjacentHTML('beforeend', PIN_SVG);
    const box = document.createElement('div');
    box.className = 'place';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name;
    name.title = p.url;
    const err = document.createElement('span');
    err.className = 'err';
    err.hidden = true;
    box.append(name, err);
    item.append(box);
    const chip = document.createElement('span');
    chip.hidden = true;
    item.append(chip);
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
    rows.set(p.url, { place: p, li, cb, pin: item.querySelector('.pin'), name, err, chip, state: null });
    // 새 영상을 열면 행이 위에서부터 차례로 나타난다.
    if (stagger) {
      li.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
        duration: stagger,
        delay: Math.min(i, 10) * 30,
        easing: EASE_OUT,
        fill: 'backwards',
      });
    }
  });
  updateButtons();
}

// 작업 항목 하나의 상태를 그 장소의 행에 반영한다. 바뀐 것이 없으면 아무것도 하지 않는다.
function updateRow(p) {
  const r = rows.get(p.url);
  if (!r) return;
  if (p.name && r.name.textContent !== p.name) r.name.textContent = p.name; // 저장하면서 지도의 실제 이름으로 바뀔 수 있다
  const err = p.error ? errText(p) : '';
  if (r.err.textContent !== err) {
    r.err.textContent = err;
    r.err.hidden = !err;
  }
  if (r.state === p.state) return;
  r.state = p.state;
  const saved = p.state === 'added' || p.state === 'exists';
  r.chip.hidden = false;
  r.chip.className = `chip s-${p.state}`;
  r.chip.innerHTML = STATE_ICON[p.state] || '';
  r.chip.append(stateText(p.state));
  r.li.classList.toggle('is-working', p.state === 'working');
  r.pin.classList.toggle('saved', saved);
  r.pin.classList.remove('drop');
  if (!motionMs(1)) return;
  // 상태가 바뀌는 순간에만 칩이 톡 튀고, 저장된 장소는 핀이 지도에 꽂히듯 떨어진다.
  replay(r.chip, 'pop');
  if (saved) replay(r.pin, 'drop');
  if (p.state === 'working') r.li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// 저장이 시작되면 체크박스를 접고, 이번 작업에 들어가지 않은 장소는 목록에서 접어 없앤다.
function enterJobMode(job) {
  // 행이 이 작업의 장소와 맞지 않으면(예: 영상 설명이 바뀜) 작업 항목으로 행을 다시 만든다.
  if (job.items.some((i) => !rows.has(i.url))) withoutMotion(() => renderPlaces(job.items));
  if (document.body.classList.contains('is-job')) return;
  document.body.classList.add('is-job');
  const inJob = new Set(job.items.map((i) => i.url));
  rows.forEach((r, url) => {
    r.cb.disabled = true;
    if (!inJob.has(url)) reveal(r.li, false);
  });
}

// 화면에 붙어 있던 이전 작업을 놓는다(헤더 제목도 기본으로 돌아간다).
function clearJobView() {
  activeJob = null;
  renderTitle();
}

// 새 영상: 목록 선택/장소 체크 화면으로 되돌린다.
function showReadyMode() {
  activeJob = null;
  document.body.classList.remove('is-job');
  reveal($('progressCard'), false);
  reveal($('listCard'), true);
  reveal($('placesHead'), true);
  reveal($('start'), true);
  reveal($('cancel'), false);
  reveal($('retry'), false);
  $('bar').classList.remove('running');
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
  enterJobMode(job);
  job.items.forEach(updateRow);
  if (!job.running) rows.forEach((r) => r.li.classList.remove('is-working'));
  setBusy(job.running);

  const { ok, failed, canceled, total } = counts(job);
  const done = ok + failed;
  const left = failed + canceled; // 아직 저장되지 않은 장소(실패 + 중단됨)
  // 저장을 시작하면 목록 선택 카드가 접히는 동시에 진행 카드가 펼쳐진다.
  reveal($('listCard'), false);
  reveal($('progressCard'), true);
  reveal($('placesHead'), false);
  reveal($('start'), false);
  // 저장 중에만 "멈추기"를 보여 준다. 누르면 지금 장소까지 마치고 멈춘다.
  reveal($('cancel'), job.running);
  $('cancel').disabled = !!job.cancelRequested;
  $('cancel').textContent = job.cancelRequested ? t('cancelling') : t('cancelBtn');
  $('pcTitle').textContent = job.running
    ? t('progressTitle', job.list)
    : canceled
      ? t('stoppedSummary', ok, left)
      : failed
        ? t('resultSummary', ok, failed)
        : t('progressDone', job.list);
  rollText($('pcCount'), job.running ? `${done} / ${total}` : '');
  $('pcEta').textContent = job.running ? etaText(job) : '';
  $('pcEta').hidden = !$('pcEta').textContent;
  $('bar').classList.toggle('running', !!job.running); // 저장 중에는 막대 위로 빛이 흐른다
  $('barOk').style.width = `${(ok / total) * 100}%`;
  $('barFail').style.width = `${(failed / total) * 100}%`;
  $('bar').setAttribute('aria-valuemax', String(total));
  $('bar').setAttribute('aria-valuenow', String(done));
  const note = job.running ? t('noteRunning') : failed && !canceled ? t('noteFailed') : '';
  $('pcNote').hidden = !note;
  $('pcNote').textContent = note;

  // 중단된 장소가 있으면 "이어서 저장", 실패만 있으면 "다시 시도"
  if (!job.running && left) $('retry').textContent = canceled ? t('resumeN', left) : t('retryN', failed);
  reveal($('retry'), !job.running && !!left);
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
  const chosen = [...rows.values()].filter((r) => r.cb.checked).map((r) => r.place);
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

// 영상 정보를 이보다 오래 읽을 때만 스켈레톤을 보여 준다(바로 끝나면 깜빡임만 생긴다).
const SKELETON_DELAY_MS = 150;
let skeletonTimer = null;
function hideSkeleton() {
  clearTimeout(skeletonTimer);
  $('skeleton').hidden = true;
}

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
    // 읽기가 잠깐이면 아무것도 바꾸지 않고, 길어지면 "읽는 중…" 글자 대신 화면 자리 모양(스켈레톤)을 먼저 보여 준다.
    setStatus('');
    skeletonTimer = setTimeout(() => {
      $('main').hidden = true;
      $('skeleton').hidden = false;
    }, SKELETON_DELAY_MS);
    const info = await readVideo(tab, id);
    const places = GMLParse.parseDescription(info.description);
    hideSkeleton();
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
    // 남아 있던 작업은 이미 지나간 일이므로 칩이 튀거나 카드가 접히는 움직임 없이 바로 그린다.
    const { task, job } = await chrome.storage.session.get(['task', 'job']);
    const ownJob = job && job.items.some((i) => i.url === places[0].url);
    const draw = () => {
      showReadyMode();
      renderPlaces(places);
      setBusy(!!((task && task.running) || (job && job.running)));
      if (ownJob) applyJob(job);
    };
    if (ownJob) withoutMotion(draw);
    else draw();
    if (task && (task.running || task.error)) applyTask(task);
  } catch (e) {
    // 영상 정보를 못 읽어도 "읽는 중…"에 멈추지 않고 이유를 보여 준다.
    hideSkeleton();
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
