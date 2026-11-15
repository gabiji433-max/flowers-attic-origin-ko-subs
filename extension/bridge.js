// 페이지(MAIN world)에서 실행: Lifetime의 THEOplayer + Google DAI 정보를 읽어 DOM에 기록한다.
// 확장 content.js(격리된 world)는 페이지 JS 객체에 직접 접근할 수 없어서 이 다리를 거친다.
// 플레이어 정보는 읽기만 하고, 조작은 광고 중 음소거 요청(data-fita-mute)에 따른 음소거/해제만 한다.
(() => {
  // 확장을 새로고침해 새 버전이 들어오면 예전 다리는 멈추고 교체
  const VER = "0.3.4";
  if (window.__fitaBridge && window.__fitaBridge.ver === VER) return;
  if (window.__fitaBridge) clearInterval(window.__fitaBridge.timer);
  const de = document.documentElement;

  function player() {
    try {
      const T = window.THEOplayer;
      if (T && T.players && T.players.length) return T.players[0];
    } catch {}
    return null;
  }

  let mutedByBridge = false;
  const timer = setInterval(() => {
    const d = { t: Date.now() };
    try {
      d.theo = typeof window.THEOplayer;
      const p = player();
      d.player = !!p;
      if (p) {
        d.cur = p.currentTime;
        d.adsPlaying = !!(p.ads && p.ads.playing);
        const dai = p.ads && p.ads.dai;
        d.dai = !!dai;
        // 광고 중 음소거 요청 처리 (content.js가 data-fita-mute="1"/"0"으로 요청)
        const want = de.dataset.fitaMute === "1";
        if (want && !p.muted) { p.muted = true; mutedByBridge = true; }
        else if (!want && mutedByBridge) { p.muted = false; mutedByBridge = false; }
        d.muted = !!p.muted;
        if (dai && typeof dai.contentTimeForStreamTime === "function") {
          const c = dai.contentTimeForStreamTime(p.currentTime);
          if (typeof c === "number" && isFinite(c)) d.content = c;
        }
      }
    } catch (e) {
      d.err = String(e).slice(0, 160);
    }
    de.dataset.fitaBridge = JSON.stringify(d);
  }, 200);
  window.__fitaBridge = { ver: VER, timer };
})();
