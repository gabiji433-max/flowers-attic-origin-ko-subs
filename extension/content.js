(() => {
  if (window.__FITA_RUNNING) {
    // 이미 켜져 있으면 아이콘 재클릭 = 패널 토글
    window.__FITA_TOGGLE_PANEL && window.__FITA_TOGGLE_PANEL();
    return;
  }
  const SUBS = window.__FITA_SUBS;
  if (!SUBS) return;

  // ---------- 광고 창(iframe)에서는 자막을 띄우지 않고 광고 음소거만 ----------
  // Lifetime은 일부 광고를 본편과 별개인 iframe 안의 짧은 영상으로 재생한다.
  // (본편 플레이어는 최상위 페이지에 있음) → 하위 창에선 자막 대신 짧은 영상 음소거 담당
  if (window !== window.top) {
    window.__FITA_RUNNING = true;
    // 예전 버전이 이 창에 띄워 둔 자막이 있으면 숨김
    document.documentElement.dataset.fitaOwner = "ad-frame";
    const g = document.createElement("style");
    g.textContent = "#fita-root{display:none!important}";
    (document.head || document.documentElement).appendChild(g);
    let mute = true;
    const load = () => { try { chrome.storage.local.get("fitaMuteAd", (r) => { mute = r && r.fitaMuteAd !== false; }); } catch {} };
    load(); setInterval(load, 5000);
    setInterval(() => {
      if (!mute) return;
      for (const v of document.querySelectorAll("video")) {
        const d = isFinite(v.duration) ? v.duration : 0;
        if (!v.paused && d > 0 && d < 300 && !v.muted) v.muted = true; // 5분 미만 영상 = 광고
      }
    }, 300);
    return;
  }

  // ---------- 저장 (사이트 localStorage, 실패해도 동작) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("fita:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("fita:" + k, JSON.stringify(v)); } catch {} },
  };

  // ---------- 본편 영상 찾기 ----------
  // 광고가 별도 <video>로 재생되는 경우를 피하려고, 길이가 가장 긴 영상을 본편으로 간주
  function pickVideo() {
    const vids = [...document.querySelectorAll("video")];
    let best = null;
    for (const v of vids) {
      const d = isFinite(v.duration) ? v.duration : 0;
      const r = v.getBoundingClientRect();
      if (r.width < 200 || r.height < 100) continue;
      if (!best || d > (isFinite(best.duration) ? best.duration : 0)) best = v;
    }
    return best;
  }

  // 이 프레임에 영상이 없으면 잠시 기다렸다가 그래도 없으면 종료 (다른 프레임이 담당)
  let tries = 0;
  const waitTimer = setInterval(() => {
    if (pickVideo()) { clearInterval(waitTimer); start(); }
    else if (++tries > 20) clearInterval(waitTimer);
  }, 500);

  const HAS_EN = Object.values(SUBS).some((cs) => cs.some((c) => c.en));

  function start() {
    window.__FITA_RUNNING = true;
    // 확장을 새로고침하면 예전 스크립트가 페이지에 남아 계속 돈다.
    // DOM은 공유되므로, 마지막으로 켜진 인스턴스만 남기고 나머지는 스스로 꺼지게 한다.
    const myId = Math.random().toString(36).slice(2);
    document.documentElement.dataset.fitaOwner = myId;
    document.querySelectorAll("#fita-root").forEach((el) => el.remove());
    const alive = () => document.documentElement.dataset.fitaOwner === myId;
    // 겹침 방지 기능이 없던 아주 예전 버전 자막이 남아 있어도 보이지 않게:
    // 최신 인스턴스의 자막(data-owner 일치)만 표시하는 스타일을 페이지에 걸어 둔다
    let guard = document.getElementById("fita-guard");
    if (!guard) { guard = document.createElement("style"); guard.id = "fita-guard"; document.documentElement.appendChild(guard); }
    guard.textContent = `#fita-root:not([data-owner="${myId}"]){display:none!important}`;

    const state = {
      ep: store.get("ep", "e1"),
      mode: store.get("mode", "both"), // both | ko
      offsets: store.get("offsets", {}), // 에피소드별 오프셋(초). 자막시간 = 영상시간 + offset
      hidden: false,
      size: store.get("size", 30),
      // 자막 높이(영상 아래에서부터 %)
      pos: store.get("pos", 12),
      font: store.get("font", "cinema"),
      autoAd: store.get("autoAd", true),
      muteAd: store.get("muteAd", true),  // 광고 중 자동 음소거 (광고 창과 공유하려고 chrome.storage에도 저장)
      perAd: store.get("perAd", 1.0),     // 광고 한 번 지날 때마다 더할 보정(초)
      breaks: store.get("breaks", {}),    // 에피소드별 광고 위치(본편 시간, 초) — 재생하면서 자동 기록
    };
    // 한글 자막 글꼴 (Mac에 설치된 글꼴 사용)
    const FONTS = {
      cinema: { family: '"a시네마M","aCinemaM","a시네마 M","a시네마B","aCinemaB","NanumGothic","Malgun Gothic",sans-serif', weight: 400 },
      nanum: { family: '"NanumGothic ExtraBold","NanumGothicExtraBold","NanumGothic","나눔고딕","Apple SD Gothic Neo",sans-serif', weight: 800 },
      pretendard: { family: '"Pretendard","Apple SD Gothic Neo",sans-serif', weight: 700 },
      sd: { family: '"Apple SD Gothic Neo",sans-serif', weight: 700 },
      myungjo: { family: '"AppleMyungjo","Nanum Myeongjo",serif', weight: 400 },
    };
    // 에피소드별 기본 오프셋(Lifetime 영상 기준으로 맞춘 값). 직접 맞추면 그 값이 우선
    const DEFAULT_OFF = { e2: -3, e3: -3 };
    try { chrome.storage.local.set({ fitaMuteAd: state.muteAd }); } catch {}
    // 예전 버전이 연달아 붙은 광고를 두 번으로 기록한 경우 정리 (120초 안에 붙은 기록은 하나로)
    for (const ep of Object.keys(state.breaks)) {
      const out = [];
      for (const x of [...state.breaks[ep]].sort((m, n) => m - n)) if (!out.length || x - out[out.length - 1] >= 120) out.push(x);
      state.breaks[ep] = out;
    }
    const off = () => (state.offsets[state.ep] ?? DEFAULT_OFF[state.ep] ?? 0);

    // ---------- 광고 인식 (bridge.js가 기록한 Lifetime 플레이어 정보) ----------
    // Lifetime은 광고를 본편 영상에 끼워 넣음(Google DAI) → 영상 시간에 광고 시간이 섞여 있음.
    // 플레이어가 알려 주는 "광고 뺀 본편 시간"을 쓰면 광고가 몇 번 나와도 자막이 밀리지 않음.
    function bridge() {
      try {
        const b = JSON.parse(document.documentElement.dataset.fitaBridge || "null");
        return b && Date.now() - b.t < 2000 ? b : null;
      } catch { return null; }
    }
    // 자막 기준 시간(초): 가능하면 광고 뺀 본편 시간, 아니면 영상 시간
    function baseTime(v) {
      const b = bridge();
      if (state.autoAd && b && typeof b.content === "number" && typeof b.cur === "number") {
        return v.currentTime - (b.cur - b.content); // 광고 누적 시간만큼 빼기
      }
      return v.currentTime;
    }
    const inAd = () => { const b = bridge(); return !!(state.autoAd && b && b.adsPlaying); };

    // 광고 직전·직후 짧은 암전 등으로 광고 하나당 약 1초씩 어긋남 → 지나온 광고 수만큼 자동 보정
    // 광고가 끝나는 순간의 본편 시간을 기록해 두므로, 되감기·건너뛰기를 해도 그 지점 기준으로 계산됨
    const epBreaks = () => state.breaks[state.ep] || [];
    function adCorr(t) {
      if (!state.autoAd) return 0;
      return state.perAd * epBreaks().filter((x) => x <= t + 1).length;
    }
    // 자막 시간 = 기준 시간 + 오프셋 + 광고 보정
    function subTime(v) { const t = baseTime(v); return t + off() + adCorr(t); }
    // 광고가 시작되면 소리 끄고, 본편으로 돌아오면 다시 켬 (확장이 끈 경우에만 다시 켬)
    let mutedByUs = false;
    function autoMute(v) {
      // 본편이 아닌 짧은 영상(별도 광고 영상)이 같은 페이지에서 재생되면 그것도 음소거
      if (state.muteAd) for (const o of document.querySelectorAll("video")) {
        const d = isFinite(o.duration) ? o.duration : 0;
        if (o !== v && !o.paused && d > 0 && d < 300 && !o.muted) o.muted = true;
      }
      const ad = inAd();
      // 플레이어(THEOplayer)가 소리 상태를 계속 되돌리므로 플레이어에게 직접 음소거를 요청(bridge.js가 처리)
      document.documentElement.dataset.fitaMute = ad && state.muteAd ? "1" : "0";
      if (ad && state.muteAd && !v.muted) { v.muted = true; mutedByUs = true; }
      else if ((!ad || !state.muteAd) && mutedByUs) { v.muted = false; mutedByUs = false; }
    }
    let wasAd = false;
    function trackBreaks() {
      const b = bridge();
      if (!b) return;
      if (wasAd && !b.adsPlaying && typeof b.content === "number" && b.content > 30) {
        const list = epBreaks();
        if (!list.some((x) => Math.abs(x - b.content) < 120)) {
          state.breaks[state.ep] = [...list, Math.round(b.content)].sort((a, c) => a - c);
          save();
        }
      }
      wasAd = !!b.adsPlaying;
    }
    const cues = () => SUBS[state.ep] || [];

    // ---------- DOM ----------
    const root = document.createElement("div");
    root.id = "fita-root";
    root.dataset.owner = myId;
    root.innerHTML = `
      <style>
        #fita-root{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
        #fita-cap{position:absolute;left:50%;transform:translateX(-50%);text-align:center;width:90%;}
        #fita-cap .ko{color:#fff;line-height:1.35;word-break:keep-all;letter-spacing:-0.01em;
          text-shadow:-1.5px -1.5px 0 #000,1.5px -1.5px 0 #000,-1.5px 1.5px 0 #000,1.5px 1.5px 0 #000,0 0 4px #000,0 2px 6px rgba(0,0,0,.8)}
        #fita-cap .en{color:#e8e2b0;font-weight:500;line-height:1.3;margin-top:6px;text-shadow:0 0 3px #000,0 0 3px #000,0 1px 2px #000}
        #fita-cap .it{font-style:italic}
        #fita-cap .box{display:inline-block;max-width:100%}
        #fita-panel{position:absolute;pointer-events:auto;background:rgba(20,20,24,.92);color:#eee;font-size:13px;border-radius:10px;padding:10px 12px;width:300px;box-shadow:0 4px 20px rgba(0,0,0,.5)}
        #fita-panel button,#fita-panel select{background:#333;color:#eee;border:1px solid #555;border-radius:5px;padding:3px 7px;font-size:12px;cursor:pointer}
        #fita-panel button:hover{background:#444}
        #fita-panel .row{display:flex;gap:5px;align-items:center;margin:5px 0;flex-wrap:wrap}
        #fita-panel .muted{color:#999;font-size:11px;line-height:1.5}
        #fita-panel .off{font-variant-numeric:tabular-nums;min-width:62px;text-align:center;font-weight:700}
        #fita-panel .hd{display:flex;justify-content:space-between;align-items:center;cursor:move;font-weight:700;margin-bottom:4px}
        #fita-sync{position:absolute;pointer-events:auto;background:rgba(20,20,24,.96);color:#eee;border-radius:10px;padding:10px;width:min(560px,80vw);max-height:60vh;overflow:auto;font-size:14px;display:none;box-shadow:0 4px 30px rgba(0,0,0,.6)}
        #fita-sync .it{padding:6px 8px;border-radius:5px;cursor:pointer;display:flex;gap:8px}
        #fita-sync .it:hover{background:#3a3a50}
        #fita-sync .it.cur{outline:1px solid #8a8af0}
        #fita-sync .t{color:#888;font-variant-numeric:tabular-nums;flex:none;width:52px}
        #fita-toast{position:absolute;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:6px 14px;border-radius:6px;font-size:14px;display:none}
      </style>
      <div id="fita-cap"></div>
      <div id="fita-panel">
        <div class="hd"><span>한글 자막</span><button data-a="close" title="P 키로도 열고 닫기">숨김</button></div>
        <div class="row">
          <select data-a="ep">
            ${Object.keys(SUBS).map((k) => `<option value="${k}">${k.slice(1)}화</option>`).join("")}
          </select>
          <select data-a="mode"><option value="both">영어+한글</option><option value="ko">한글만</option></select>
          <button data-a="size-">가-</button><button data-a="size+">가+</button>
        </div>
        <div class="row">
          <span>글꼴</span>
          <select data-a="font">
            <option value="cinema">a시네마 (극장 자막체)</option>
            <option value="nanum">나눔고딕</option>
            <option value="pretendard">프리텐다드</option>
            <option value="sd">애플 산돌고딕</option>
            <option value="myungjo">명조 (시대극 느낌)</option>
          </select>
        </div>
        <div class="row">
          <button data-a="-5">-5초</button><button data-a="-0.5">-0.5</button>
          <span class="off"></span>
          <button data-a="+0.5">+0.5</button><button data-a="+5">+5초</button>
          <button data-a="reset" title="기본값으로">0</button>
        </div>
        <div class="row"><button data-a="sync">광고 끝난 뒤 맞추기 (S)</button><button data-a="hide">자막 끄기 (H)</button></div>
        <div class="row"><span>높이</span><button data-a="up" title="영어 CC와 겹치면 위로">▲ 위로</button><button data-a="down">▼ 아래로</button><span class="pos"></span></div>
        <div class="row"><label style="display:flex;gap:4px;align-items:center;cursor:pointer"><input type="checkbox" data-a="autoAd">광고 자동 보정</label><span class="adst muted"></span><label style="display:flex;gap:4px;align-items:center;cursor:pointer"><input type="checkbox" data-a="muteAd">광고 음소거</label><button data-a="diag" title="문제가 있을 때 눌러서 제보에 붙여 주세요">진단 복사</button></div>
        <div class="row"><span>광고당</span><button data-a="perAd-">-0.5</button><span class="perad" style="font-weight:700;min-width:44px;text-align:center"></span><button data-a="perAd+">+0.5</button><span class="adn muted"></span></div>
        <div class="muted">
          자막이 늦게 나오면 +, 빨리 나오면 −<br>
          [ ] ±0.5초 · Shift+[ ] ±5초 · S 맞추기 · H 끄기 · K 언어 · P 패널
        </div>
      </div>
      <div id="fita-sync"></div>
      <div id="fita-toast"></div>`;
    const $ = (s) => root.querySelector(s);
    const cap = $("#fita-cap"), panel = $("#fita-panel"), syncBox = $("#fita-sync"), toast = $("#fita-toast");
    $('[data-a="ep"]').value = state.ep;
    if (!SUBS[state.ep]) state.ep = Object.keys(SUBS)[0];
    $('[data-a="ep"]').value = state.ep;
    $('[data-a="mode"]').value = state.mode;
    // 영어 자막이 없는 배포판이면 언어 선택 숨김
    if (!HAS_EN) $('[data-a="mode"]').style.display = "none";
    $('[data-a="font"]').value = state.font;
    $('[data-a="autoAd"]').checked = state.autoAd;
    $('[data-a="muteAd"]').checked = state.muteAd;

    function mount() {
      const fs = document.fullscreenElement || document.webkitFullscreenElement;
      const host = fs && fs.tagName !== "VIDEO" ? fs : document.body || document.documentElement;
      if (root.parentNode !== host) host.appendChild(root);
    }
    mount();
    document.addEventListener("fullscreenchange", () => setTimeout(mount, 50));
    document.addEventListener("webkitfullscreenchange", () => setTimeout(mount, 50));

    let toastT;
    function say(msg) {
      toast.textContent = msg; toast.style.display = "block";
      clearTimeout(toastT); toastT = setTimeout(() => (toast.style.display = "none"), 1500);
    }
    const fmtOff = (o) => (o >= 0 ? "+" : "−") + Math.abs(o).toFixed(1) + "초";
    const fmtT = (t) => { t = Math.max(0, Math.floor(t)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };

    function save() {
      store.set("ep", state.ep); store.set("mode", state.mode);
      store.set("offsets", state.offsets); store.set("size", state.size); store.set("font", state.font); store.set("pos", state.pos); store.set("autoAd", state.autoAd); store.set("perAd", state.perAd); store.set("muteAd", state.muteAd); store.set("breaks", state.breaks);
    }
    function shift(d) {
      state.offsets[state.ep] = Math.round((off() + d) * 10) / 10;
      save(); say("자막 " + fmtOff(off()));
    }

    // ---------- 광고 후 맞추기: 지금 들린 대사를 목록에서 고르면 오프셋 재계산 ----------
    function openSync() {
      const v = pickVideo(); if (!v) return;
      const now = subTime(v);
      const list = cues().filter((c) => c.s > now - 240 && c.s < now + 60);
      syncBox.innerHTML = `<div style="margin-bottom:6px;font-weight:700">방금 들린 대사를 누르세요 <span style="color:#999;font-weight:400">(Esc 닫기)</span></div>`;
      let curEl = null;
      for (const c of list) {
        const d = document.createElement("div");
        d.className = "it";
        if (!curEl && c.s >= now - 1) { d.classList.add("cur"); curEl = d; }
        d.innerHTML = `<span class="t">${fmtT(c.s)}</span><span></span>`;
        d.lastChild.textContent = (c.ko || "").replace(/\n/g, " ") + (c.en ? "  ·  " + c.en.replace(/\n/g, " ") : "");
        d.onclick = () => {
          const vv = pickVideo();
          { const t = baseTime(vv); state.offsets[state.ep] = Math.round((c.s - t - adCorr(t) + 0.3) * 10) / 10; }
          save(); closeSync(); say("맞췄어요 " + fmtOff(off()));
        };
        syncBox.appendChild(d);
      }
      if (!list.length) syncBox.insertAdjacentHTML("beforeend", "<div class='muted'>근처에 대사가 없어요. ±5초로 조정해 보세요.</div>");
      syncBox.style.display = "block";
      (curEl || syncBox.lastChild).scrollIntoView({ block: "center" });
    }
    function closeSync() { syncBox.style.display = "none"; }

    function copyDiag() {
      const v = pickVideo();
      const d = {
        step: "fita-diag", ver: "0.3.4", frame: window === window.top ? "top" : "sub", muteAd: state.muteAd, perAd: state.perAd, breaks: epBreaks(), ep: state.ep, off: off(), autoAd: state.autoAd, bridge: bridge(),
        raw: document.documentElement.dataset.fitaBridge ? "있음" : "없음",
        video: v ? { t: v.currentTime, dur: v.duration, base: baseTime(v) } : null,
        marks: [...document.querySelectorAll('[class*="adBreak"]')].slice(0, 8).map((e) => ({
          c: String(e.className.baseVal ?? e.className).replace(/Component-/g, "").slice(0, 40),
          left: e.style.left, width: e.style.width, ox: e.offsetLeft, pw: e.parentElement && e.parentElement.clientWidth })),
      };
      const s = JSON.stringify(d, null, 1);
      const ta = document.createElement("textarea"); ta.value = s; ta.style.cssText = "position:fixed;opacity:0";
      root.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch {}
      ta.remove(); console.log("[FITA 진단]", s); say(ok ? "진단 정보 복사됨 — 제보할 때 붙여 주세요" : "복사 실패 — 콘솔에 [FITA 진단] 출력함");
    }

    function togglePanel() { panel.style.display = panel.style.display === "none" ? "block" : "none"; }
    window.__FITA_TOGGLE_PANEL = togglePanel;

    panel.addEventListener("click", (e) => {
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === "close") togglePanel();
      else if (a === "sync") openSync();
      else if (a === "diag") copyDiag();
      else if (a === "perAd+") { state.perAd = Math.round((state.perAd + 0.5) * 10) / 10; save(); say("광고당 " + fmtOff(state.perAd)); }
      else if (a === "perAd-") { state.perAd = Math.round((state.perAd - 0.5) * 10) / 10; save(); say("광고당 " + fmtOff(state.perAd)); }
      else if (a === "hide") { state.hidden = !state.hidden; say(state.hidden ? "자막 끔" : "자막 켬"); }
      else if (a === "reset") { delete state.offsets[state.ep]; save(); say("자막 기본값 " + fmtOff(off())); }
      else if (a === "size+") { state.size = Math.min(60, state.size + 2); save(); }
      else if (a === "up") { state.pos = Math.min(80, state.pos + 2); save(); }
      else if (a === "down") { state.pos = Math.max(0, state.pos - 2); save(); }
      else if (a === "size-") { state.size = Math.max(14, state.size - 2); save(); }
      else if (!isNaN(parseFloat(a))) shift(parseFloat(a));
    });
    panel.addEventListener("change", (e) => {
      const a = e.target.dataset.a;
      if (a === "ep") { state.ep = e.target.value; save(); say((state.ep.slice(1)) + "화 자막"); }
      if (a === "mode") { state.mode = e.target.value; save(); }
      if (a === "font") { state.font = e.target.value; save(); lastKey = ""; }
      if (a === "muteAd") { state.muteAd = e.target.checked; save(); try { chrome.storage.local.set({ fitaMuteAd: state.muteAd }); } catch {} say(state.muteAd ? "광고 중 음소거 켬" : "광고 중 음소거 끔"); }
      if (a === "autoAd") { state.autoAd = e.target.checked; save(); say(state.autoAd ? "광고 자동 보정 켬" : "광고 자동 보정 끔"); }
    });

    // 패널 드래그
    panel.querySelector(".hd").addEventListener("mousedown", (e) => {
      const r = panel.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      const mv = (ev) => { panelPos = { x: ev.clientX - dx, y: ev.clientY - dy }; store.set("panelPos", panelPos); };
      const up = () => { removeEventListener("mousemove", mv, true); removeEventListener("mouseup", up, true); };
      addEventListener("mousemove", mv, true); addEventListener("mouseup", up, true);
      e.preventDefault();
    });
    let panelPos = store.get("panelPos", null);

    // 단축키 (입력창에서는 무시, 우리 키만 가로챔)
    window.addEventListener("keydown", (e) => {
      if (!alive()) return;
      const t = e.target;
      if (t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      let hit = true;
      if (e.code === "BracketLeft") shift(e.shiftKey ? -5 : -0.5);
      else if (e.code === "BracketRight") shift(e.shiftKey ? 5 : 0.5);
      else if (e.code === "KeyS") (syncBox.style.display === "block" ? closeSync() : openSync());
      else if (e.code === "KeyH") { state.hidden = !state.hidden; say(state.hidden ? "자막 끔" : "자막 켬"); }
      else if (e.code === "KeyK") { state.mode = state.mode === "both" ? "ko" : "both"; $('[data-a="mode"]').value = state.mode; save(); say(state.mode === "ko" ? "한글만" : "영어+한글"); }
      else if (e.code === "KeyP") togglePanel();
      else if (e.code === "Escape" && syncBox.style.display === "block") closeSync();
      else hit = false;
      if (hit) { e.preventDefault(); e.stopPropagation(); }
    }, true);

    // ---------- 렌더 루프 ----------
    let lastKey = "", ci = 0;
    function find(t) {
      const cs = cues(); if (!cs.length) return null;
      if (ci >= cs.length || cs[ci].s > t) ci = 0;
      while (ci < cs.length - 1 && cs[ci + 1].s <= t) ci++;
      // 위에서 선형 탐색이 느리지 않도록 큰 점프는 이진 탐색
      if (Math.abs(cs[ci].s - t) > 60) {
        let lo = 0, hi = cs.length - 1;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cs[m].s <= t) lo = m; else hi = m - 1; }
        ci = lo;
      }
      const c = cs[ci];
      return c && c.s <= t && t <= c.e ? c : null;
    }
    function tick() {
      if (!alive()) { root.remove(); return; } // 새 인스턴스가 켜지면 종료
      mount();
      const v = pickVideo();
      if (v) {
        const r = v.getBoundingClientRect();
        // 자막 위치: 영상 하단 12% 지점
        cap.style.bottom = Math.max(0, innerHeight - r.bottom + r.height * state.pos / 100) + "px";
        cap.style.left = r.left + r.width / 2 + "px";
        cap.style.width = r.width * 0.8 + "px";
        const scale = Math.max(0.6, Math.min(1.6, r.width / 1280));
        const fs = state.size * scale;
        if (!panelPos) { panel.style.left = r.left + 16 + "px"; panel.style.top = r.top + 16 + "px"; }
        else { panel.style.left = panelPos.x + "px"; panel.style.top = panelPos.y + "px"; }
        syncBox.style.left = r.left + r.width / 2 - Math.min(560, innerWidth * 0.8) / 2 + "px";
        syncBox.style.top = r.top + r.height * 0.1 + "px";
        $(".off").textContent = fmtOff(off());
        $(".pos").textContent = state.pos + "%";
        $(".perad").textContent = fmtOff(state.perAd);
        { const v2 = pickVideo(); const n = v2 ? epBreaks().filter((x) => x <= baseTime(v2) + 1).length : 0; $(".adn").textContent = `(지난 광고 ${n}회 → ${fmtOff(state.perAd * n)})`; }
        { const b = bridge(); $(".adst").textContent = !state.autoAd ? "" : !b ? "(정보 없음)" : b.adsPlaying ? "광고 중" : typeof b.content === "number" ? "작동 중" : "(보정 불가)"; }

        trackBreaks();
        autoMute(v);
        const c = state.hidden || inAd() ? null : find(subTime(v));
        const enText = state.hidden || state.mode !== "both" || !c ? "" : c.en || "";
        const key = (c ? c.s : "none") + "|" + enText + state.mode + fs + state.font + r.width;
        if (key !== lastKey) {
          lastKey = key;
          if (!c && !enText) cap.innerHTML = "";
          else {
            const it = c && c.it ? " it" : "";
            const f = FONTS[state.font] || FONTS.cinema;
            const ko = c && c.ko ? `<div class="ko${it}" style="font-size:${fs}px;font-family:${f.family.replace(/"/g, "'")};font-weight:${f.weight}"></div>` : "";
            const en = enText ? `<div class="en${it}" style="font-size:${fs * 0.6}px"></div>` : "";
            cap.innerHTML = `<div class="box">${ko}${en}</div>`;
            // 번역문의 줄 구분은 무시하고 한 줄로 이어 붙임 → 화면 폭이 모자랄 때만 자연스럽게 줄바꿈
            // 두 사람이 주고받는 대사(-로 시작)는 줄을 나눠 표시
            const flow = (t) => (/^\s*-/m.test(t) && t.includes("\n") ? t : t.replace(/\s*\n\s*/g, " "));
            if (ko) { const k = cap.querySelector(".ko"); k.textContent = flow(c.ko); k.style.whiteSpace = "pre-line"; }
            if (en) { const e = cap.querySelector(".en"); e.textContent = flow(enText); e.style.whiteSpace = "pre-line"; }
          }
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    say("한글 자막 켜짐 · " + state.ep.slice(1) + "화");
  }
})();
