// Clessia 推播 service worker（#1663，設計稿 kb/wiki/architecture/web-push.md §1、Q1）。
//
// **只處理 push 與 notificationclick。不註冊 fetch、不快取任何東西** ——
// 瀏覽器的所有請求照舊走網路與 HTTP 快取，跟 #1611 的 _headers／404 設計完全無關。
// 不要在這裡加 fetch 監聽器：加了就變成每個請求都經過這支，換版、404、chunk 恢復全部要重想。
//
// 檔名固定、不帶雜湊（註冊網址不能變），所以落在 Pages 預設的 max-age=0，不要加進 _headers 的長快取。

// 新版 sw.js 一到就接手，不必等所有分頁關掉 —— 這支沒有快取，換手沒有不一致的問題
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// payload：{ title, body, url, topic }（設計稿 §3）。不含金額（Q3：鎖定畫面旁人看得到）
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // 解不開就用預設文字 —— 不能什麼都不顯示（瀏覽器會判定成「靜默推播」）
  }
  const title = data.title || 'Clessia';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/assets/icons/icon-192.png',
      badge: '/assets/icons/icon-192.png',
      // 同一張帳單的提醒用同一個 tag：手機離線時累積的舊提醒被新的蓋掉，不會一開機跳三則
      tag: data.topic || undefined,
      data: { url: data.url || '/parent' },
    }),
  );
});

// 點通知：已經有開著的分頁就 focus 並導過去，沒有才開新的（設計稿 §6）
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // 只導到自己網站：payload 的 url 若是別的網域（不該發生，但不信它），就退回家長首頁
  const target = new URL(event.notification.data?.url || '/parent', self.location.origin);
  const url = target.origin === self.location.origin ? target.href : `${self.location.origin}/parent`;
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const same = tabs.find((c) => new URL(c.url).origin === self.location.origin);
      if (same) {
        await same.focus();
        // navigate 只對受這支 SW 控制的分頁有效；註冊前就開著的分頁會丟錯 —— 那就只 focus
        if ('navigate' in same) await same.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
