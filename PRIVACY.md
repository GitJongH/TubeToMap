# 개인정보 처리 안내 / Privacy

*English summary at the bottom.*

TubeToMap은 **개발자나 제3자의 서버로 어떤 데이터도 보내지 않습니다.** 분석/추적 도구도 없습니다.

## 어디에 무엇이 저장되나요
브라우저의 `chrome.storage`에만 저장되고, 이 확장 프로그램을 지우면 함께 사라집니다.

| 저장소 | 내용 | 용도 |
|---|---|---|
| `local` | 내 구글 지도 목록 이름, 마지막으로 고른 목록, 목록을 불러온 시각 | 패널을 열 때 목록을 바로 보여 주기 위한 캐시 |
| `session` (브라우저를 닫으면 삭제) | 지금 진행 중이거나 방금 끝난 저장 작업의 상태(장소 이름, 성공/실패) | 패널이 진행 상황을 그리기 위함 |

## 네트워크는 무엇과 통신하나요
- **구글 지도**: 내 브라우저에서 **내가 로그인한 상태로** 구글 지도 페이지를 열어, 내 목록에 장소를 저장하고 메모를 씁니다. 이 확장 프로그램이 따로 구글 계정 정보(비밀번호, 토큰 등)를 읽거나 저장하지 않습니다.
- **유튜브**: 영상 설명란을 읽습니다. 보통은 현재 열린 영상 페이지에서 직접 읽고, 읽지 못하면 그 영상 페이지를 한 번 내려받아 설명란을 찾습니다. 패널의 영상 썸네일은 `i.ytimg.com`에서 불러옵니다.

## 메모에 남는 내용
저장한 각 장소의 메모에 `YouTube: <영상 제목> <영상 주소>`가 한 줄 추가됩니다. 이 메모는 **내 구글 지도 목록**에 있는 내 데이터입니다. 공유 목록에 저장하면 목록을 보는 사람에게도 보입니다.

## 권한을 왜 요구하나요
| 권한 | 이유 |
|---|---|
| `scripting`, 호스트 권한 `youtube.com` | 현재 영상의 제목과 설명란을 읽기 위해 |
| `tabs` | 현재 탭이 유튜브 영상인지, 지도 작업 창이 열렸는지 확인하기 위해 |
| `storage` | 위 표의 캐시와 진행 상태를 저장하기 위해 |
| `sidePanel` | 작업 중에도 닫히지 않는 사이드 패널을 보여 주기 위해 |
| `debugger` | 지도 작업 창이 포커스가 없어도 글자 입력과 메모 저장이 동작하도록 "포커스 있음" 상태를 흉내 내기 위해(`Emulation.setFocusEmulationEnabled` 한 가지 명령만 사용). 작업 중 Chrome 상단에 "디버깅 중" 안내가 잠깐 뜹니다. |
| 콘텐츠 스크립트 `google.com/maps`, `google.co.kr/maps` | 구글 지도 화면에서 목록을 읽고 장소를 저장하기 위해 |

## 문의
개인정보와 관련해 궁금한 점은 저장소의 이슈로 남겨 주세요.

---

## English summary
TubeToMap sends **no data to any server operated by the developer or third parties** and has no analytics. It stores only a cache of your Google Maps list names, your last selected list and the progress of the current job, in `chrome.storage` inside your browser. It opens Google Maps pages in your own logged-in browser to save places and write a note (`YouTube: <title> <url>`) into your own lists, reads the YouTube video description, and loads the thumbnail from `i.ytimg.com`. It never reads or stores Google account credentials. The `debugger` permission is used only to emulate page focus (`Emulation.setFocusEmulationEnabled`) so text input and note saving work in the background work window.
