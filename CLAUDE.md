# 담다 (Damda) 작업 규칙

- 작업 전에 `PLAN.md`를 읽는다. 화면은 `docs/ui.md`, 데이터·동기화·보안은 `docs/data-sync.md`, 보류 항목은 `docs/backlog.md`, 배포·수익화·법 같은 기능 밖 정리는 `docs/other.md`.
- 결정이 바뀌면 PLAN.md의 "결정 기록"과 로드맵 상태를 갱신한다. 문서는 이 5개(PLAN + docs 4개)를 넘기지 않고 짧게 유지한다.
- `README.md`는 레포 첫 화면(소개·사용법·포트폴리오)이다. 기능이 크게 바뀌면 README의 기능·스크린샷(`docs/images/`)·숫자도 함께 고친다.
- 사용자와는 한국어로 소통한다. 코드 식별자는 영어, 주석은 한국어 OK.
- **단순하고 가볍게**: 프레임워크·빌드 도구·npm 의존성 없이 순수 HTML/CSS/JS(ES Modules)로 작성한다. **예외는 `desktop/`(PC 앱, Electron)과 `mobile/`(갤럭시 앱, Capacitor)뿐**이고, 웹 코드는 `window.desk`가 있을 때만 PC 화면(`js/desk.js`), `window.Capacitor`가 있을 때만 폰 기능(`js/native.js`)을 켠다. 폰·웹 화면을 바꾸지 않았는지 함께 확인한다.
- `test/`는 시험 스크립트와 기록 보관용이다. 앱 코드에서 불러오지 않는다.
- 외부 스크립트는 Google Identity Services 하나만 허용한다 (Phase 3부터). 폰트는 Google Fonts.
- 원본 달빛달력은 https://github.com/Crowtit517/moonlight_calendar 에서 본다 (로컬 사본은 지웠다).
- 레포: https://github.com/Crowtit517/damdanote (공개, 10-04 첫 커밋). 사용자가 요청할 때만 커밋·푸시한다.
- 모든 저장/읽기는 `try/catch`로 감싸고, 저장이 실패해도 화면은 정상 렌더링한다.
- 데이터 항목에는 항상 `updatedAt`, `deleted`를 둔다 (실제 삭제 대신 `deleted: true`).
- 은행, 카드, 결제 연동 코드는 어떤 형태로도 추가하지 않는다.
- **사용자가 요청하기 전에는 커밋하지 않는다.**
- 패널·선택 창·모달은 `docs/ui.md` 6장의 공통 닫기 규칙을 따르고, `js/ui/overlay.js`로만 연다.
- 실행: `python -m http.server 5500` → http://localhost:5500
