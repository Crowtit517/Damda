// 담다 갤럭시 앱 설정.
// 화면은 공개 사이트에서 받는다 (PC 앱과 같음: 사이트를 고치면 앱도 저절로 최신, 한 번 열면 인터넷 없이도 열림).
// 개발할 때: DAMDA_DEV=1 npx cap sync → 폰이 PC의 http://localhost:5500 을 연다 (adb reverse tcp:5500 tcp:5500)
const DEV = !!process.env.DAMDA_DEV;
module.exports = {
  appId: 'io.github.crowtit517.damda',
  appName: '담다',
  webDir: 'www', // 사이트를 처음 못 불러올 때 보여 줄 화면
  server: DEV
    ? { url: 'http://localhost:5500/', cleartext: true }
    : { url: 'https://crowtit517.github.io/damdanote/' },
  android: { backgroundColor: '#6b74c9' },
  plugins: {
    // 담다가 준비될 때까지 보라색 시작 화면을 붙잡아 두고, 담다 시작 화면으로 자연스럽게 넘긴다
    SplashScreen: { launchAutoHide: false, backgroundColor: '#6b74c9', showSpinner: false, androidScaleType: 'CENTER_INSIDE' },
    LocalNotifications: { smallIcon: 'ic_stat_damda', iconColor: '#6b74c9' },
  },
};
