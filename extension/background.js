// 자막을 켠 탭 목록을 기억해 두었다가, 확장이 새로고침되면 그 탭들에 자동으로 다시 주입한다.
// → 코드·번역을 고친 뒤 확장만 새로고침하면 Lifetime 탭은 그대로 두고 바로 새 버전이 뜬다.

const FILES = ["subs.js", "content.js"];

async function getTabs() {
  try { return (await chrome.storage.local.get("fitaTabs")).fitaTabs || []; } catch { return []; }
}
async function setTabs(ids) {
  try { await chrome.storage.local.set({ fitaTabs: ids }); } catch {}
}

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: FILES });
  // 플레이어 정보(광고 여부·광고 뺀 본편 시간) 읽기용 다리 — 페이지 world에서 실행
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["bridge.js"], world: "MAIN" });
  } catch (e) { console.warn("[FITA] bridge 주입 실패", e); }
}

// 아이콘 클릭(또는 단축키): 자막 켜기 + 탭 기억
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await inject(tab.id);
    const ids = await getTabs();
    if (!ids.includes(tab.id)) await setTabs([...ids, tab.id]);
  } catch (e) {
    console.warn("[FITA] 주입 실패", e);
  }
});

// 확장이 새로고침/업데이트되면 기억해 둔 탭에 다시 주입
// (페이지에 남아 있던 예전 자막은 content.js가 알아서 끔)
chrome.runtime.onInstalled.addListener(async () => {
  const alive = [];
  for (const id of await getTabs()) {
    try { await inject(id); alive.push(id); } catch { /* 닫혔거나 다른 사이트로 이동한 탭 */ }
  }
  await setTabs(alive);
});

// 탭을 닫으면 목록에서 제거
chrome.tabs.onRemoved.addListener(async (id) => {
  const ids = await getTabs();
  if (ids.includes(id)) await setTabs(ids.filter((x) => x !== id));
});

// 단축키: 확장 새로고침 (chrome://extensions에 가지 않아도 됨)
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === "reload-extension") chrome.runtime.reload();
});
