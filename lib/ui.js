// 구글 지도 화면의 문구(한국어/영어)와 그 문구를 판별하는 순수 함수 모음.
// 구글이 화면 문구를 바꾸거나 새 언어를 지원할 때는 이 파일만 고치면 된다. 브라우저(콘텐츠 스크립트)/Node(테스트) 양쪽에서 사용.
// 아래 문구는 2026-10에 한국어 화면과 영어 화면(?hl=en)에서 직접 읽은 값이다.
(function (root) {
  // 버튼/목록 행 텍스트에 섞이는 아이콘 글리프(사용자 정의 영역 문자)를 지운다.
  const stripIcons = (s) => String(s).replace(/[-]/g, '').trim();

  const TEXT = {
    directions: ['경로', 'Directions'],
    // "저장됨"에서 만든 목록 화면의 "새 목록" 버튼 / 저장 창의 "새 목록" 버튼
    newList: ['새 목록', 'New list'],
    // 장소 패널의 저장 버튼: 여러 목록에 저장되면 "저장됨(2)"처럼 숫자가 붙는다
    saveButton: /^(저장됨|저장|Saved|Save)\s*(\(\d+\))?$/,
    // 메모 입력칸 이름표: 메모가 없으면 "추가", 있으면 "수정"
    noteLabel: /^(메모 추가|메모 수정|Add note|Edit note)$/i,
    noteEditLabel: /^(메모 수정|Edit note)$/i,
    // 장소 패널의 "저장된 목록 세부정보" 펼침 버튼(접기 버튼은 "숨기기/Hide")
    detailsShow: ['장소 목록 세부정보 표시', 'Show place lists details', 'Show place list details'],
    // 새 목록의 기본 이름
    untitledList: /제목 없는 목록|Untitled list/i,
    // 저장됨 화면에서 남이 만든 목록의 부제("작성자…" / "By …")
    othersListSubtitle: /^(작성자|By )/,
    // 내 목록 부제: "비공개·12개 장소", "Private · 17 places", 장소가 0개면 "비공개"/"Private"만
    myListSubtitle: /^(비공개|공개|공유|Private|Public|Shared)|장소|places?/i,
  };

  // 기본 목록은 화면 언어마다(심지어 "저장됨" 화면과 저장 창에서도) 이름이 다르다.
  const DEFAULT_LISTS = [
    ['가고 싶은 장소', 'Want to go'],
    ['즐겨찾기', 'Favorites'],
    ['여행 계획', 'Travel plans'],
    ['별표 표시된 장소', 'Starred places'],
    ['저장한 장소', 'Saved places'],
  ];

  // 같은 목록을 가리키는 이름들(자기 자신 포함). 기본 목록이 아니면 이름 하나뿐이다.
  function aliasNames(name) {
    const n = stripIcons(name);
    const group = DEFAULT_LISTS.find((g) => g.includes(n));
    return group ? [...group] : [n];
  }

  const sameList = (a, b) => aliasNames(a).includes(stripIcons(b));

  const isSaveLabel = (label) => TEXT.saveButton.test(stripIcons(label));
  // 장소 패널의 저장 버튼이 "저장됨"/"Saved"(숫자가 붙을 수도 있음)면 이 장소는 어떤 목록에든 저장되어 있다. "저장"/"Save"면 아무 데도 없다.
  const isSavedLabel = (label) => /^(저장됨|Saved)\s*(\(\d+\))?$/.test(stripIcons(label));
  const isNoteLabel = (label) => TEXT.noteLabel.test(stripIcons(label));
  const isNoteEditLabel = (label) => TEXT.noteEditLabel.test(stripIcons(label));
  const isDetailsShow = (label) => TEXT.detailsShow.includes(stripIcons(label));
  const isNewListLabel = (label) => TEXT.newList.includes(stripIcons(label));

  // 목록 행(버튼)의 텍스트에서 { name, subtitle } 를 뽑는다. 내 목록이 아니면 null.
  function parseListRow(text) {
    const lines = String(text).split('\n').map(stripIcons).filter(Boolean);
    if (lines.length < 2) return null;
    const [name, subtitle] = lines;
    if (TEXT.othersListSubtitle.test(subtitle)) return null;
    if (!TEXT.myListSubtitle.test(subtitle)) return null;
    return { name, subtitle };
  }

  const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // "…에 저장됨"(한국어) / "Saved in…"(영어) 제목이 들어 있는 텍스트인지.
  // 장소가 여러 목록에 저장되면 접힌 제목이 "A 및 B에 저장됨"처럼 합쳐지고, 이를 펼치는 버튼에는 이름표(aria-label)가 없다.
  // 그래서 단일 목록의 "세부정보 표시" 이름표 대신, 이 제목 텍스트를 가진 접힌(aria-expanded=false) 버튼으로도 펼친다.
  const hasSavedHeading = (text) => /에 저장됨|Saved in/.test(String(text));

  // 메모 입력칸 둘레의 텍스트가 "어느 목록에 저장됨" 제목을 담고 있는지 본다.
  //  - 제목 자체가 없으면 null(더 위 조상을 계속 찾는다)
  //  - 있으면 listName의 제목인지 true/false
  // 한국어는 "<목록> 에 저장됨", 영어는 "Saved in" 뒤에 목록 이름이 공백 없이 붙어 나온다.
  function savedHeadingFor(text, listName) {
    const t = String(text);
    if (!hasSavedHeading(t)) return null;
    return aliasNames(listName).some(
      (n) => t.includes(`${n} 에 저장됨`) || t.includes(`${n}에 저장됨`) || new RegExp(`Saved in\\s*${escapeRegExp(n)}`).test(t)
    );
  }

  const api = {
    stripIcons,
    TEXT,
    DEFAULT_LISTS,
    aliasNames,
    sameList,
    isSaveLabel,
    isSavedLabel,
    isNoteLabel,
    isNoteEditLabel,
    isDetailsShow,
    isNewListLabel,
    parseListRow,
    hasSavedHeading,
    savedHeadingFor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GMLUi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
