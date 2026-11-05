# ux-walk — 任務型 UX 走查用的常駐 Playwright

#2298 第一輪走查的工具（原本只活在 `~/.cache/clessia-ux-walk/`，2026-11-05 收進版控）。
只看畫面、不讀碼；登入態用 magic link 換（24 小時內有效，過期重產）。

```sh
PW_FROM=tools/a6-conformance/node_modules node tools/ux-walk/driver.mjs   # 常駐 127.0.0.1:9496
./tools/ux-walk/r.sh new '{"state":"<登入態 json>","width":360,"name":"m"}'  # 開一個 context
./tools/ux-walk/r.sh m "$(cat tools/ux-walk/settle.js) return page.shot('M0-home')" # 跑一段 JS
```

- `UX_WALK_API`（預設 `http://localhost:8796`）：自己起的 API；瀏覽器層把 8787 的請求轉過去，不改 repo。
- 截圖落在 `tools/ux-walk/shots/`（gitignored），不進版控也不進 home。
- `settle.js`：等 skeleton 消失再截圖，接在每段 JS 前面。
- ⚠️ 用 Playwright 假時鐘看「課開始後」的畫面時，RxJS debounce 會停住（搜尋卡在「搜尋中…」），那是工具造成的。
