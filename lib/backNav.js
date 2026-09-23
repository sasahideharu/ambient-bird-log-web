// 「戻る」「×」で、一つ前の画面へ戻るための道具。
// 決まった場所（トップなど）へ行くと、どこから来ても、トップまで戻ってしまう。
// ただし、この画面を直接開いたとき（アプリの中で、まだ移動していない）は、戻る先が、アプリの外（別のサイトなど）になるので、代わりの場所へ行く
let movedInApp = false;

// アプリの中で、画面の移動があったことを覚える（NavTracker から呼ばれる）
export function markInAppNavigation() {
  movedInApp = true;
}

// 一つ前の画面へ戻れるか（アプリの中で移動してきたか）
export function canGoBackInApp() {
  return movedInApp && typeof window !== "undefined" && window.history.length > 1;
}

// アプリの中で、一度でも画面の移動があったか（＝いまが、アプリを開いた最初の画面かどうかの目安）。
// トップページ（/）を、ログイン中は録音画面に自動で切り替える判断・トップの入場演出を1回だけにする判断に使う
export function hasNavigatedInApp() {
  return movedInApp;
}

// 一つ前の画面へ戻る。戻れないとき（直接開いたとき）だけ、fallbackHref へ行く
export function goBack(router, fallbackHref) {
  if (canGoBackInApp()) router.back();
  else router.push(fallbackHref);
}
