/**
 * 每道 gate 的**掃描範圍**，從它實際餵進判斷的檔案推導出來，並釘成 ratchet。
 *
 * ## 為什麼需要這個
 *
 * 2026-09-04 的載體盲區調查（#296）發現：A17 觸控 gate 少掃 `shared/` 不知道多久，
 * 而**它一直是綠的**。review-steward 把這件事講得最準：
 *
 * > gate 說 0 筆，但它沒說「**我只看了這些地方**」——
 * > 我讀到的是一個**沒有標註範圍的 0**。
 *
 * 「0 筆違規」跟「掃過的地方 0 筆違規」在畫面上長得一模一樣，而只有後者是真的。
 *
 * ## 為什麼是 ratchet，不是「綠燈時印出範圍」
 *
 * 印出來有兩個問題：12 道每次刷一片會**稀釋訊號**，而且要印什麼得有人**宣告** ——
 * 而「宣告的範圍 ≠ 實掃的範圍」正是同一個病的下一代。
 *
 * 所以：**範圍算自實際餵進判斷的那些檔**（沒有東西可以跟現實不一致，因為它就是
 * 現實的投影），比對進版控的 `scan-scope.json`：一樣就**一個字都不印**，
 * 不一樣就紅燈並印出 diff。
 *
 * 好處是**範圍變動會出現在 PR diff 裡** —— 印出來的東西會被滑過去，diff 會被 review。
 *
 * ## 它順手守住一件現在沒人看的事：**範圍靜靜縮小**
 *
 * 有人加一個 filter、一個提早 `return`、或把某個目錄從陣列裡拿掉 ——
 * 今天 gate 只會**更綠**，沒有任何訊號。有了 ratchet，那是紅燈。
 *
 * ## 已知邊界（明說，不假裝有守）
 *
 * **新增的 gate 必須自己呼叫 `recordScope`，沒呼叫的不會有任何訊號。**
 * 這份檔案不可能知道一個從來沒登記過的 gate 存在。
 *
 * 想過用 self-test 斷言「註冊數 == gate 呼叫數」，但那是數量斷言 ——
 * 它會在每次增減 gate 時紅得沒有意義（charter 有這條）。
 * 結構解是「讓 scope 成為判斷函式的必要輸入，不註冊就跑不了」，
 * 但那要動 12 道的簽章，**跟目前的風險不成比例**（2026-09-04 計畫席裁）。
 * 緩解放在 charter 的 gate 撰寫清單裡 —— 讓它出現在**新 gate 誕生的地方**。
 */

const recorded = new Map();

/**
 * 記下一道 gate 的掃描範圍。
 *
 * ## 為什麼收的是 walk 的**參數**，不是走出來的檔案路徑
 *
 * 第一版是從實際檔案路徑推導根目錄。**零漂移，但噪音太大** —— 新增一個
 * `apps/api/src/routes/<新功能>/` 子目錄就會讓根目錄集合變動、gate 變紅，
 * 而那跟「範圍」一點關係都沒有。**每次都紅的 gate，人的反應是把它關掉。**
 *
 * 所以改收「掃描時實際傳給 walk 的那幾個目錄」。它仍然不是另一份手寫清單 ——
 * 是**同一個變數**：有人把 `sharedDir` 從陣列裡拿掉，這裡記到的就少一個。
 *
 * 代價要說清楚：**walk 之後的 filter 不反映在範圍裡**（例如 A17 會排除
 * mobile-first baseline 裡的 admin 檔）。那類排除本來就在別的 baseline 裡可見，
 * 而這支要抓的是「**一整片沒被看**」，不是「某幾個檔被跳過」。
 *
 * @param {string} gate 顯示用的名字（也是 scan-scope.json 的鍵）
 * @param {{roots: string[], exts: string[]}} scope roots 用 repo 相對路徑
 */
export function recordScope(gate, { roots, exts }) {
  const prev = recorded.get(gate) ?? { roots: new Set(), exts: new Set() };
  for (const r of roots) prev.roots.add(r);
  for (const e of exts) prev.exts.add(e);
  recorded.set(gate, prev);
}

/**
 * 目前這一輪記錄到的範圍，正規化成可比對的形狀。
 *
 * **刻意不含檔案數** —— 含的話每加一個檔就紅，那會是致命的噪音，
 * 而人對每次都紅的 gate 的反應是把它關掉。同理不含個別檔名。
 */
export function collectedScopes() {
  return Object.fromEntries(
    [...recorded.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([gate, { roots, exts }]) => [
        gate,
        { roots: [...roots].sort(), exts: [...exts].sort() },
      ]),
  );
}

/**
 * 比對現況與 baseline，回傳人看得懂的差異描述（沒有差異就回空陣列）。
 *
 * **縮小與擴大分開講** —— 兩者的意思完全不同：擴大通常是刻意的（新 gate、擴範圍），
 * 縮小則多半是意外，而且是這支主要要抓的那一種。
 */
export function diffScopes(current, baseline) {
  const out = [];
  const names = [...new Set([...Object.keys(current), ...Object.keys(baseline)])].sort();
  for (const gate of names) {
    const now = current[gate];
    const was = baseline[gate];
    if (!was) {
      out.push(`${gate}：新的 gate（範圍 ${now.roots.join('、')}）`);
      continue;
    }
    if (!now) {
      out.push(`${gate}：**整道 gate 不見了** —— 先前掃 ${was.roots.join('、')}`);
      continue;
    }
    for (const key of ['roots', 'exts']) {
      const label = key === 'roots' ? '目錄' : '副檔名';
      const lost = was[key].filter((v) => !now[key].includes(v));
      const gained = now[key].filter((v) => !was[key].includes(v));
      if (lost.length > 0) {
        out.push(`${gate}：**${label}範圍縮小** —— 不再掃 ${lost.join('、')}`);
      }
      if (gained.length > 0) {
        out.push(`${gate}：${label}範圍擴大 —— 新增 ${gained.join('、')}`);
      }
    }
  }
  return out;
}
