// PC 앱(desktop/ 폴더의 Electron)에서 열렸는지.
// PC 앱이 window.desk 를 넣어 주면 그때만 PC 화면(창 전체를 쓰는 화면, 오른쪽 구역 탭, 위젯 버튼)을 켠다.
// 폰·웹 브라우저에서는 window.desk 가 없으므로 아무것도 바뀌지 않는다.
export const isDesk = !!window.desk?.isApp;
if (isDesk) document.documentElement.classList.add('desk-app');

/** 바탕화면 위젯 열기 (PC 앱에서만) */
export const openWidget = () => window.desk?.openWidget?.();
