// 구글 지도 페이지를 자동 조작한다. 화면 문구(한국어/영어)는 lib/ui.js에 모아 두었고(구글 UI가 바뀌면 거기와 이 파일을 고친다),
// 이 파일은 그 문구를 써서 요소를 찾고 조작한다.
// 확인한 구조(2026-10):
//  - "저장됨" 화면(/maps/@/data=!4m2!10m1!1e1): 내 목록 행(버튼)들과 "새 목록" 버튼. 새 목록은 누르면 바로 "제목 없는 목록"이 만들어지고
//    그 페이지의 제목 입력칸을 고쳐서 이름을 정한다.
//  - 장소 페이지: 저장 버튼 → role=menu 대화상자(목록 행 = menuitemradio). 저장 후 패널에 "<목록> 에 저장됨"(영어: "Saved in<목록>")
//    + 메모 입력칸이 나타난다.
// 실패에는 오류 코드를 붙인다. "ui:"로 시작하는 코드는 "구글 지도 화면이 바뀌어 요소를 못 찾았다"는 뜻이라 패널이 신고 안내를 보여 준다.
(() => {
  const UI = globalThis.GMLUi; // lib/ui.js (manifest에서 이 파일보다 먼저 주입됨)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 저장 창의 "이미 저장됨" 체크 표시를 읽을 때 값이 안정되기를 기다리는 시간(readSavedState)
  const SAVED_STABLE_TRUE_MS = 600; // 저장됨(true)은 빨리 확정
  const SAVED_STABLE_FALSE_MS = 2000; // 저장 안 됨(false)은 늦게 채워질 수 있어 더 오래 본다
  const SAVED_STATE_MAX_MS = 6000;

  // 코드가 붙은 오류를 만든다.
  // params는 번역 문장에 들어갈 값(예: 목록 이름)이다. 패널이 코드로 사용자 언어의 문장을 만든다(_locales의 err_<코드>).
  const fail = (code, message, params) => Object.assign(new Error(message), { code, params });

  async function waitFor(fn, timeout = 15000, interval = 200) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  const stripIcons = UI.stripIcons;
  const label = (el) => stripIcons(el.getAttribute('aria-label') || el.textContent || '');
  const findButton = (root, test) => [...root.querySelectorAll('button')].find((el) => test(label(el)));
  // 저장 버튼은 저장된 장소면 이름표가 "<목록>에 저장됨"으로 바뀌므로(2026-11) 보이는 글자("저장"/"저장됨")를 우선 본다.
  const shownText = (el) => stripIcons(el.textContent || '') || label(el);

  // 장소 패널의 저장 버튼: "경로" 버튼과 같은 버튼 줄 안에서 찾아 왼쪽 레일의 "저장됨"과 구분한다.
  // 검색창 옆에도 "경로" 버튼이 있어서(2026-11) 모든 "경로" 버튼을 차례로 본다.
  function findSaveButton() {
    const dirs = [...document.querySelectorAll('button')].filter((el) => UI.TEXT.directions.includes(label(el)));
    for (const dir of dirs) {
      let c = dir.parentElement;
      for (let i = 0; i < 6 && c; i++, c = c.parentElement) {
        const b = [...c.querySelectorAll('button')].find((el) => UI.isSaveLabel(shownText(el)));
        if (b) return b;
      }
    }
    return null;
  }

  const findMenu = () =>
    [...document.querySelectorAll('[role=menu]')].find((m) => m.querySelector('[role=menuitemradio]'));

  // innerText가 아이콘 글리프 줄로 시작하므로, 글리프를 뺀 첫 번째 비어 있지 않은 줄을 이름으로 쓴다.
  const rowName = (row) => row.innerText.split('\n').map(stripIcons).find(Boolean) || '';
  const menuRows = (menu) => [...menu.querySelectorAll('[role=menuitemradio]')];

  function placeName() {
    const h1 = document.querySelector('h1');
    return h1 ? h1.textContent.trim() : '';
  }

  // 메뉴가 열린 직후에는 행만 있고 글자가 아직 그려지지 않을 수 있어, 모든 행에 이름이 채워질 때까지 기다린다.
  const menuReady = (menu) => menuRows(menu).every(rowName);

  async function openSaveMenu() {
    if (!(await waitFor(findSaveButton, 20000))) {
      throw fail('ui:save-button', '장소 페이지에서 저장 버튼을 찾지 못했어요');
    }
    if (!findMenu()) findSaveButton().click();
    const menu = await waitFor(() => {
      const m = findMenu();
      return m && menuReady(m) ? m : null;
    }, 8000);
    if (!menu) throw fail('ui:save-menu', '저장 목록 창이 열리지 않았어요(로그인 상태를 확인하세요)');
    return menu;
  }

  async function closeMenu() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(300);
    if (findMenu()) {
      const active = document.activeElement || document.body;
      active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      await sleep(300);
    }
  }

  function setValue(el, value) {
    el.focus();
    // 값을 직접 대입하면 구글 지도가 입력으로 인식하지 못하므로(빈 이름으로 저장됨), 실제 타이핑과 같은 insertText를 우선 사용한다.
    if (!el.isContentEditable && el.select) el.select();
    else document.execCommand('selectAll');
    if (document.execCommand('insertText', false, value) && getValue(el) === value) return;
    if (el.isContentEditable) return;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const getValue = (el) => (el.isContentEditable ? el.innerText : el.value) || '';

  // 기존 내용은 건드리지 않고 끝에 이어 쓴다(전체 선택 후 교체하면 기존 메모가 사라질 수 있음).
  function appendValue(el, text) {
    el.focus();
    if (el.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } else if (el.setSelectionRange) {
      el.setSelectionRange(el.value.length, el.value.length);
    }
    return document.execCommand('insertText', false, text);
  }

  // ---- "저장됨" 화면(/maps/@/data=!4m2!10m1!1e1): 장소 없이 목록을 읽고 만든다 ----
  // 내 목록 행: 버튼 안에 "이름 / 비공개·N개 장소" 두 줄. 남이 만든 목록은 제외한다(판별은 UI.parseListRow).
  function listRows() {
    return [...document.querySelectorAll('button')].filter((b) => UI.parseListRow(b.innerText));
  }
  const listName = (b) => UI.parseListRow(b.innerText).name;

  async function readLists() {
    if (!(await waitFor(() => listRows().length, 20000))) {
      throw fail('ui:list-rows', '내 목록을 찾지 못했어요(로그인 상태를 확인하세요)');
    }
    let n = -1;
    await waitFor(() => {
      const now = listRows().length;
      const stable = now === n;
      n = now;
      return stable;
    }, 5000, 700); // 목록이 더 로딩되는 중일 수 있어 개수가 안정될 때까지 기다린다.
    return listRows().map(listName);
  }

  // "저장됨" 화면에서 이름이 같은 목록을 눌러 그 목록 페이지를 연다(저장 결과 확인용).
  async function openList(name) {
    const row = await waitFor(() => listRows().find((b) => UI.sameList(name, listName(b))), 20000);
    if (!row) throw fail('list-missing', `"${name}" 목록을 찾지 못했어요`, [name]);
    row.click();
    return name;
  }

  // "저장됨" 화면의 "새 목록"을 누르면 대화상자 없이 "제목 없는 목록"이 바로 만들어지고 그 목록 페이지가 열린다(장소는 0개).
  // 이름은 페이지 상단 제목 입력칸을 고쳐서 정하고, 포커스를 옮기면 저장된다.
  async function createList(name) {
    const btn = await waitFor(() => findButton(document, UI.isNewListLabel), 15000);
    if (!btn) throw fail('ui:new-list-button', '"새 목록" 버튼을 찾지 못했어요');
    btn.click();
    const titleInput = () =>
      [...document.querySelectorAll('input[type=text]')].find(
        (i) => i.id !== 'searchboxinput' && i.getAttribute('role') !== 'combobox' && i.getClientRects().length && UI.TEXT.untitledList.test(i.value)
      );
    const input = await waitFor(titleInput, 8000);
    if (!input) throw fail('ui:title-input', '목록 제목 입력칸을 찾지 못했어요');
    setValue(input, name);
    await sleep(300);
    if (getValue(input) !== name) throw fail('ui:title-input', '목록 이름을 입력하지 못했어요');
    input.blur();
    document.body.click();
    // 제목이 실제로 바뀌었는지 페이지 제목으로 확인한다.
    const named = await waitFor(() => document.title.startsWith(`${name} - `), 6000);
    if (!named) throw fail('ui:title-saved', '목록 이름이 저장되지 않았어요. 구글 지도의 "제목 없는 목록"을 확인해 주세요.');
    return name;
  }

  // 저장 후 패널에서 대상 목록의 메모 입력칸을 찾는다.
  async function findNoteBox(list) {
    // 입력칸에서 위로 올라가다 처음 "어느 목록에 저장됨" 제목이 나오는 조상이 대상 목록의 것이면 true, 다른 목록이면 false, 제목을 못 찾으면 null.
    const belongs = (b) => {
      for (let c = b.parentElement; c; c = c.parentElement) {
        const state = UI.savedHeadingFor(c.innerText || '', list);
        if (state !== null) return state;
      }
      return null;
    };
    const find = () => {
      const boxes = [...document.querySelectorAll('[role=textbox], textarea, input')].filter((e) =>
        UI.isNoteLabel(label(e)) || UI.isNoteLabel(e.getAttribute('placeholder') || '')
      );
      // 칸이 하나뿐이어도 다른 목록의 것이면 쓰지 않는다(다른 목록 메모에 영상 URL이 들어가는 것을 막음).
      if (boxes.length === 1) return belongs(boxes[0]) === false ? null : boxes[0];
      return boxes.find((b) => belongs(b) === true) || null;
    };
    let box = find();
    if (!box) {
      // 펼치기: 단일 목록이면 "세부정보 표시" 이름표 버튼, 여러 목록이면 이름표 없는 접힌 제목 버튼(aria-expanded=false).
      const toggle =
        findButton(document, UI.isDetailsShow) ||
        [...document.querySelectorAll('button[aria-expanded="false"]')].find((b) => UI.hasSavedHeading(b.innerText));
      if (toggle) toggle.click();
      box = await waitFor(find, 5000);
    }
    return box;
  }

  async function writeNote(list, note, marker) {
    // findNoteBox는 async(내부에서 필요하면 세부정보를 펼치고 기다림)이므로 waitFor가 아니라 직접 await한다.
    if (!(await findNoteBox(list))) throw fail('ui:note-box', '메모 입력칸을 찾지 못했어요');
    // 페이지 로딩 직후에는 기존 메모가 아직 채워지지 않아 빈 값으로 보일 수 있다(덮어쓰기 방지).
    // 채워지면서 요소가 바뀔 수 있으니 기다린 뒤 다시 찾는다.
    await sleep(1500);
    let box = await findNoteBox(list);
    if (!box) throw fail('ui:note-box', '메모 입력칸을 찾지 못했어요');
    // 이름표가 "메모 수정"/"Edit note"면 기존 메모가 있다는 뜻이다. 내용이 아직 안 채워졌으면 기다리고, 끝내 못 읽으면 덮어쓰지 않고 중단한다.
    if (UI.isNoteEditLabel(label(box)) && !(await waitFor(() => getValue(box).trim(), 6000))) {
      throw fail('note-unreadable', '기존 메모를 읽지 못해서 메모를 쓰지 않았어요');
    }
    const current = getValue(box).trim();
    if (current.includes(marker)) return 'note-exists';
    const expected = current ? `${current}\n${note}` : note;
    // 영상 URL이 들어 있고 기존 메모도 그대로 보존되어 있으면 정상(끝 공백 차이는 무시).
    const good = (v) => v.includes(marker) && (!current || v.includes(current));
    // 이어 쓰기가 안 되면(예외적) 전체를 다시 쓴다. expected에 기존 내용이 포함돼 있어 잃지 않는다.
    if (!appendValue(box, current ? `\n${note}` : note) || !good(getValue(box))) setValue(box, expected);
    await sleep(300);
    box.blur();
    // 입력칸 밖을 눌러 저장을 확정한다.
    document.body.click();
    await sleep(1000);
    // 확정 후에도 입력칸 값이 기대한 내용인지 다시 확인한다.
    box = await findNoteBox(list);
    if (!box || !good(getValue(box))) throw fail('ui:note-commit', '메모가 저장되지 않았어요');
    return 'note-added';
  }

  // 저장 창에서 이 이름의 목록 행을 찾아 "이미 저장됨(체크)" 상태를 안정될 때까지 읽는다.
  // 체크 표시가 늦게 그려질 수 있다. 이미 저장된 장소를 "아직 아님"으로 읽고 클릭하면 저장이 해제되므로,
  // 연속으로 같은 값이 읽힐 때까지 확인한 뒤 판단한다. 반환: { list(저장 창에 보이는 이름), checked }
  async function readSavedState(menu, wanted) {
    // 기본 목록은 "저장됨" 화면과 저장 창, 화면 언어에 따라 이름이 다르다(Saved places ↔ 저장한 장소 등).
    const row = menuRows(menu).find((r) => UI.sameList(wanted, rowName(r)));
    if (!row) {
      await closeMenu();
      throw fail('list-missing', `"${wanted}" 목록을 찾지 못했어요`, [wanted]);
    }
    const list = rowName(row);
    const rows = () => menuRows(findMenu() || menu);
    const readChecked = () => {
      const r = rows().find((x) => rowName(x) === list);
      return r ? r.getAttribute('aria-checked') === 'true' : null;
    };
    const anyChecked = () => rows().some((x) => x.getAttribute('aria-checked') === 'true');
    // 장소 패널의 저장 버튼이 "저장됨"이면 이 장소는 어딘가에 저장되어 있다(독립된 두 번째 신호).
    const savedAnywhere = () => {
      const b = findSaveButton();
      return b ? UI.isSavedLabel(shownText(b)) : null;
    };

    // 새로 연 창에서는 저장 창이 열린 뒤에도 체크 표시가 조금 늦게 채워질 수 있다. 일찍 "저장 안 됨"으로 읽으면
    // 이미 저장된 장소를 없다고 판단하고(확인이 틀림), 저장 단계에서는 오히려 저장을 해제해 버린다.
    // 그래서 값이 한동안 바뀌지 않을 때까지 지켜본다: 저장됨(true)은 빨리 확정하고, 저장 안 됨(false)은 더 오래 본다.
    // 또 저장 버튼이 "저장됨"인데 어느 목록도 체크되지 않았다면 아직 덜 그려진 것이므로 더 기다린다.
    const startedAt = Date.now();
    let checked = readChecked();
    let changedAt = startedAt;
    while (Date.now() - startedAt < SAVED_STATE_MAX_MS) {
      await sleep(300);
      const now = readChecked();
      if (now !== checked) {
        checked = now;
        changedAt = Date.now();
      }
      const stable = Date.now() - changedAt >= (checked ? SAVED_STABLE_TRUE_MS : SAVED_STABLE_FALSE_MS);
      const notYetDrawn = checked === false && savedAnywhere() === true && !anyChecked();
      if (stable && !notYetDrawn) break;
    }
    if (checked === null) {
      await closeMenu();
      throw fail('ui:list-state', `"${list}" 목록 상태를 읽지 못했어요`, [list]);
    }
    return { list, checked };
  }

  async function savePlace({ list, note, marker }) {
    const menu = await openSaveMenu();
    const name = placeName();
    const state = await readSavedState(menu, list);
    list = state.list;
    const already = state.checked;
    if (!already) {
      const target = menuRows(findMenu() || menu).find((x) => rowName(x) === list);
      target.click();
      // 행을 누르면 대화상자가 닫히고 행이 다시 그려지므로, 다시 열어서 체크됐는지로 확인한다.
      await sleep(1500);
      const again = await openSaveMenu();
      const saved = menuRows(again).find((r) => rowName(r) === list);
      if (!saved || saved.getAttribute('aria-checked') !== 'true') {
        await closeMenu();
        throw fail('not-saved', '목록에 저장되지 않았어요');
      }
    }
    await closeMenu();
    const noteResult = await writeNote(list, note, marker);
    return { name, status: already ? 'exists' : 'added', note: noteResult };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const run = {
      readLists,
      createList: () => createList(msg.name),
      openList: () => openList(msg.name),
      savePlace: () => savePlace(msg),
    }[msg.type];
    if (!run) return false;
    run()
      .then((data) => sendResponse({ ok: true, data }))
      // 실패에는 코드와 화면 언어를 함께 보낸다(화면이 바뀐 경우 신고할 때 진단 정보로 쓰임).
      .catch((e) => sendResponse({ ok: false, error: e.message, code: e.code || 'error', params: e.params, lang: document.documentElement.lang }));
    return true;
  });
})();
