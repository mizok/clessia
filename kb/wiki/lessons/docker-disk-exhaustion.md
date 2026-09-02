---
title: 磁碟爆了怎麼查 —— Docker 佔滿主機的處置流程
summary: 主機從 2.9 GB 掉到 206 MB 的一次救援，最終回收 126 GB（Docker.raw 163 G → 37 G）。含磁碟量測工具的選用（mole 已棄用，改用 PureMac；含它被 Homebrew CLT 檢查誤擋時的取用方式）。記錄 docker system df 卡死時的替代量法、「兩個世界各看到假數字」為什麼讓自動 GC 永遠不觸發、以及 buildctl 是 shim、prune 兩參數、exit 0 不等於做了事這三個會讓人以為清完了的坑。
category: lesson
status: active
updated: 2026-09-02
tags: [lessons, docker, disk, dagger, ci, runbook]
---

# 磁碟爆了怎麼查 —— Docker 佔滿主機的處置流程

> **這頁是操作用的。** 下次主機磁碟爆掉照著走，不要重新發明。
> 2026-09-02 的實例貫穿全文，但寫法是流程不是流水帳。

## 0. 先認出這是哪一種滿

```bash
df -h /System/Volumes/Data        # 主機還剩多少
du -sh ~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw
```

`Docker.raw` 是**稀疏檔**：`ls -lh` 會顯示它的上限（例如 460G），**要看 `du` 才是實際佔用**。

### 先量主機這一側，不要憑印象

**⚠️ 工具已更換（2026-09-02）：不要用 `mole`。**
本頁初版是用它寫的，但**使用者基於供應鏈考量已棄用**，指定改用
[PureMac](https://github.com/momenbasel/PureMac)（MIT、明示零遙測）。
**mole 已於 2026-09-02 `brew uninstall`**（設定 `~/.config/mole/` 尚未清）。

留這段話是為了讓下一個人**不會因為在舊文件或搜尋結果裡看到 `mo` 就把它裝回來** ——
它不是壞掉，是被換掉的，換的理由是供應鏈不是功能。

兩條都**實測過**，擇一即可。

#### 首選：PureMac CLI

```bash
puremac analyze ~ --json              # 依大小排序，機器可讀
puremac analyze ~/Library --depth 2   # 往下鑽
puremac ignore add <path>             # 保護路徑，clean/purge/analyze 都不碰
puremac clean --dry-run --json        # 預覽，不刪除
```

2026-09-02 實測（v1.0.0）：`analyze ~ --json` **106 秒**跑完，輸出是
`[{"bytes": …, "path": …}]` 的陣列、依大小排序，排名與 `du` 一致。
`clean --dry-run --json` 確認**不會刪除任何東西**（跑前跑後磁碟數字不變）。

**`ignore` 是它勝過其他工具的地方**：`puremac ignore add <path>` 保護的路徑
**連 `analyze` 都不會碰**。這讓 supabase volume、別席的 worktree 這類護欄
**變成工具本身的設定**，而不是靠操作者每次記得。

##### 安裝

```bash
brew install momenbasel/tap/puremac-cli
```

**正常情況下就是這一條**（2026-09-02 實測成功，裝到 `/opt/homebrew/bin/puremac`）。

###### 如果它報「CLT does not support macOS 26」

```
Error: Your Command Line Tools (CLT) does not support macOS 26.
```

**這個錯誤具有誤導性，而且跟 PureMac 無關。** 看 formula 就知道它**不編譯任何東西**：

```ruby
def install
  bin.install "puremac"     # 只是把預編譯好的 binary 放進去
end
```

那是 Homebrew 安裝前的**通用環境檢查**，會擋下所有安裝，不分該 formula 需不需要編譯。
（本頁初版因為只讀了錯誤訊息、沒讀 formula，一度誤判成「PureMac 裝不起來 / 不支援 Tahoe」。
**兩個結論都是錯的** —— 那支 binary 是 universal binary，在 Tahoe 上跑得好好的。）

真正的問題是**這台機器的 CLT 過期**，診斷方式：

```bash
xcrun --show-sdk-version                          # 遠低於 OS 版本就是它
ls /Library/Developer/CommandLineTools/SDKs/      # 沒有對應 OS 版本的 SDK
pkgutil --pkg-info=com.apple.pkg.CLTools_Executables   # 查不到 = Homebrew 說的 "modified"
```

2026-09-02 那次：OS 是 26.2，但 SDK 只到 **15.5**、`pkgutil` 查不到安裝紀錄。
修法要在**真的終端機**裡跑（sudo 需要 TTY，agent session 給不了）：

```bash
sudo rm -rf /Library/Developer/CommandLineTools
sudo xcode-select --install
```

修完 SDK 從 15.5 → 26.5、clang 17 → 21，`brew install` 隨即正常。
**這是機器層級的操作，影響所有需要編譯的 formula，該由機器擁有者執行。**

###### 真的不能修 CLT 時的備援

直接取用發佈的預編譯 binary，**並自己驗雜湊**：

```bash
curl -sSL -o puremac-cli.tar.gz \
  https://github.com/momenbasel/PureMac/releases/download/cli-v1.0.0/puremac-cli-1.0.0.tar.gz
shasum -a 256 puremac-cli.tar.gz   # 必須等於 formula 裡宣告的 sha256
tar -xzf puremac-cli.tar.gz        # 得到 universal binary `puremac`
```

**雜湊一定要比對** —— 繞過 Homebrew 就等於繞過它的完整性檢查，那一步要自己補回來。
這正是換掉前一個工具的理由（供應鏈），不該在繞行時放掉。

#### Fallback：內建指令（無依賴）

```bash
du -xh -d 1 ~ | sort -rh | head -12      # 換路徑重複，一層一層縮小
```

2026-09-02 實測：`~` 上 **69 秒**（比 PureMac 快，但只有人類可讀的概數、沒有 JSON）。
`-x` 限制在同一個檔案系統。

**限制**：`du` 不論 `-d` 給多少都會**走訪全部檔案**，`-d` 只限制輸出層數。
很大的目錄（100 GB 級的 volume）會跑很久 —— 第 1 節那條量 volume 的指令
就曾經跑超過 5 分鐘被逾時砍掉。

#### 為什麼這一節重要

2026-09-02 那次我們**盯著 Docker 看了整場**，直到量了主機這一側才發現真相：

```
~/Desktop            126.9 GB
  └ Repository       102.8 GB
      └ bkw           94.8 GB
          └ .angular  84.3 GB   ← 純建置快取，可拋棄
```

**單一個 `.angular` 快取目錄 84.3 GB，比清理後的整個 Docker（37 G）還大。**
如果一開始就量，整場的優先順序會完全不同。

## 1. `docker system df` 卡死時的替代量法

磁碟接近滿的時候 `docker system df` 會**跑不完**（實測卡了 40 分鐘才吐出結果），
但 `docker version` 秒回 —— daemon 是活的，只是用量計算走不動。**不要在那裡等。**

代替方案，全部都快：

```bash
docker ps -a --format '{{.State}}\t{{.Image}}\t{{.Names}}'   # 容器
docker ps -a --size --format '{{.Size}}\t{{.Names}}'          # 可寫層
docker images --format '{{.Size}}\t{{.Repository}}:{{.Tag}}'  # 映像
docker builder du                                             # build cache
docker volume ls -q                                           # volume 清單
```

**volume 的大小**沒有便宜的查法，用現有映像唯讀掛載去量（不要為此拉新映像）：

```bash
docker run --rm --entrypoint du -v <volume>:/v:ro docker:latest -sh /v
```

⚠️ 這條在**大 volume 上會跑很久**。逾時被砍的話容器會殘留，記得 `docker rm -f`。

**VM 內部的實況**（決定性問題：VM 裡是真的滿，還是只有主機的 `Docker.raw` 沒縮回去）：

```bash
docker run --rm --entrypoint df -v <任一volume>:/v:ro docker:latest -h /v
```

## 2. 兩個世界各看到假數字

這是最反直覺、也最容易讓人查錯方向的一點：

| 誰在看                      | 它看到的                            | 真相                 |
| --------------------------- | ----------------------------------- | -------------------- |
| **主機**                    | `Docker.raw` 佔 163 GB，可用 2.9 GB | 對                   |
| **VM 內部 / dagger engine** | 452 GB 的磁碟、**296 GB 可用**      | 對，但那是 VM 的視角 |

兩邊都沒說謊，但**沒有人看得到全貌**。後果很嚴重：

- **快取的自我節制依據它看得到的磁碟，而它看到的是假的。** dagger 的 GC 門檻拿 VM 的
  296 GB 可用去比，永遠判定「還很寬裕」，於是**自動 GC 永遠不會觸發** ——
  它會一路寫到主機爆掉為止，自己卻毫無所覺。
- 所以「等它自己 GC」不是選項。**外部沒有壓力訊號能傳進去。**

## 3. 按類別處置（含護欄）

先歸因再動手。那次的權威數字（`docker system df` 最後吐出來的）：

| 類別              | 大小         | 判斷           |
| ----------------- | ------------ | -------------- |
| Images            | 16.39 GB     | 可回收 8.35 GB |
| Containers        | 28.17 MB     | 忽略           |
| **Local Volumes** | **120.6 GB** | ← 大頭         |
| Build Cache       | 0 B          | 空操作         |

**教訓：直覺會說「清 build cache」，但那次它是 0 B。先量再動手。**

### 安全度由高到低

1. **dangling 映像** —— `docker image prune -f`。安全。
2. **未被任何容器引用的映像** —— **不要用 `docker image prune -a`**，它會連別人的工具映像
   一起掃掉。用差集算出來再逐一 `docker rmi`：

   ```bash
   docker ps -a --format '{{.Image}}'      # 使用中
   docker images --format '{{.Repository}}:{{.Tag}}'
   ```

3. **已停止的容器** —— 先確認真的有；那次 12 個容器**全部在跑**，blanket prune 是空操作。
4. **volumes** —— 最危險，**不要自己決定**。volume 裡通常是別人的狀態或暖快取。

### 非 Docker 的部分也要看

那次主機 460 GB 裡只有 163 GB 是 Docker。我們自己的足跡也不小：

```bash
du -sh ~/.npm                                    # 那次 3.0 GB
du -sch <repo>/.worktrees/*/node_modules         # 那次 13 個 worktree 共 8.1 GB
```

**清理工具的預設掃描路徑不可靠。** 那次 `mo purge --dry-run` 只找到 **55 MB**，
完全沒看到上面那 84.3 GB —— 因為 `~/Desktop/Repository` 不在它的預設掃描目錄裡。
**這個教訓與工具無關**：任何「自動找可清理項目」的工具都有一份預設路徑清單，
而你的專案很可能不在上面。**先量出大頭在哪，再決定要不要靠工具的自動掃描。**

同一次 `mo clean --dry-run` 估算可回收約 10.5 GB（瀏覽器與系統快取）。
它有內建白名單、不會碰 Docker 資料，但**它不知道我們的護欄**（supabase volume、
別席的工作狀態）。**任何清理工具跑之前一定先 dry-run 看完整清單。**

> 上面兩段的數字來自已棄用的 mole（見第 0 節）。保留是因為**教訓本身是工具中立的**，
> 換成 PureMac 之後同樣適用：預設路徑會漏、白名單不認識你的護欄。

`npm cache clean --force` 是**可自行處置**的（定義上就是快取、零資料損失）。
worktree 的 `node_modules` 是**別人正在用的工作狀態**，要清得先協調。

> 那次清 npm cache 時出現 `ENOTEMPTY` —— 那是「有別的程序正在寫 cache」的訊號，
> 等於告訴你**還有人在跑 `npm ci`**。清理期間值得請大家暫緩。

## 4. dagger / CI runner 的特有坑

那台機器上最大的 volume（120 GB）屬於 `dagger-engine`。三件事按順序搞清楚：

**它不是殘留，是有人在用的暖快取。** 查它在做什麼：

```bash
docker logs --tail 40 dagger-engine-v0.21.6 | grep -oE 'msg="[^"]*"|args="[^"]*"'
docker stats --no-stream dagger-engine-v0.21.6
```

那次查出來是 **fvg 專案的 CI**（GitLab runner project 658 觸發 `FvgCi.verify`），
正在跑 `bun install` → `check-architecture` → `lint`。容器 21 小時內累計
**Block IO 174 GB 讀 / 163 GB 寫** —— 它才是磁碟的動態消耗來源。

**動手前確認空檔**：

```bash
docker ps --filter name=runner-        # 必須為空
docker logs --tail 5 <engine> | grep -oE 'dagger-session-count=[0-9]+'   # 必須是 0
```

### 坑一：`buildctl prune` 在 dagger 引擎裡不存在

網路上與 fvg KB 的指引都是 `buildctl ... prune --keep-storage`。**在 dagger v0.21.6 的容器裡
`/usr/sbin/buildctl` 是個只支援 `dial-stdio` 的 shim**：

```
Error: unknown flag: --keep-storage
Usage:
  dial-stdio [flags]
```

它印出的 usage 很像 help，**容易被當成成功**。正確入口是 dagger 自己的：

```bash
docker exec <engine> /usr/local/bin/dagger core engine local-cache prune \
  --max-used-space 20GB --target-space 20GB
```

### 坑二：兩個參數缺一不可

- `--max-used-space` = **觸發門檻**（超過多少才開始清）
- `--target-space` = 觸發後**要縮到多少**

只給 `--target-space` 的話，政策判定「還沒到該清的時候」直接跳過。
症狀是命令**看起來完全成功**，engine log 裡才有真話：

```
dagql prune skip policy: no reclaim target
```

### 坑三：`exit 0 + DONE` 不等於做了事

第一次 prune 的輸出是 `EngineCache.prune DONE [0.3s]`、exit code 0 ——
**實際釋放 0 位元組**。0.3 秒完成本身就是線索：要刪 100 GB 不可能那麼快。

> **判斷清理是否生效，看實際佔用數字，不看命令的退出碼。**
> 這跟 [[lessons/local-green-is-not-repo-green]] 同族：工具的輸出不是事實，量出來的數字才是。

## 5. 認定方式與實際結果

每一步都用**同一組外部指標**認定，不採信命令自報：

```bash
df -h /System/Volumes/Data                       # 主機可用
du -sh ~/Library/.../Docker.raw                  # 實際佔用
```

那次的完整時間線：

| 時點                                       | 主機可用   | `Docker.raw` |
| ------------------------------------------ | ---------- | ------------ |
| 開始                                       | 2.9 GB     | 163 G        |
| 清 dangling 映像（129.7 MB）               | 839 MB ↓   | 162 G        |
| 刪 4 個未使用的 supabase 舊版映像（~7 GB） | 241 MB ↓   | 156 G        |
| 清 npm cache（3.0→1.3 GB）                 | 2.0 GB     | —            |
| **第一次 prune（參數不全）**               | 210 MB     | 160 G        |
| **第二次 prune（帶觸發門檻）**             | **122 GB** | **37 G**     |

**淨結果：`Docker.raw` 163 G → 37 G，回收 126 GB；主機可用從最低點 206 MB 回到 122 GB。**
引擎**沒有重啟**（`Up 2 days` 不變）、12 個容器全數存活、supabase 未受影響、
清理全程沒有 CI job 進來。

**注意中段那三行：清理在進行，可用空間卻一路往下。** 因為 CI 同時在寫。
**清理速度要跟消耗速度比較**，只看「我清掉了多少」會得到錯誤的成功感。

> `Docker.raw` 會自動縮小還空間給主機（Docker Desktop 的自動 TRIM 有在運作 ——
> 刪掉 7 GB 映像後它自己從 162G 掉到 156G）。**不需要**為此拉第三方映像跑
> `--privileged --pid=host` 的 fstrim。

## 6. 為什麼那條指引能壞這麼久

`buildctl prune` 這條維運指引在 fvg 的 KB 裡失效了不知道多久，沒有人發現。原因不是有人粗心：

> **只在故障時才被執行的指令，最容易長期是壞的。**

它的正確性**沒有任何日常流量在體檢** —— 只有磁碟吃緊時才會有人跑它，而跑的人正在救火、
看到 `exit 0` 就走了。錯誤的指令與正確的指令在那一刻長得一模一樣（見第 4 節坑三）。

這對**這一頁本身**同樣成立。所以：

- 頁面裡的每條指令都附**怎麼確認它真的做了事**（第 5 節的外部指標），不要只寫指令
- 下次照這頁操作時，**如果哪條指令的行為和這裡寫的不一樣，先更新這頁再繼續** ——
  救完火就忘了是這類文件腐化的標準路徑
- 平常不叫的東西，要嘛給它日常體檢，要嘛讓它失敗時**真的叫**（而不是安靜地 exit 0）

## 7. 這次沒解決的（下次的起點）

### 最大的單一消費者不在 Docker 裡

**這次事故只解決了 Docker 那一半。** 整場回收的 126 GB 全部來自 Docker，
而主機上**最大的單一項目從頭到尾沒被碰過** —— 直到最後量了主機這一側才看見它：

|                                                     | 大小                     |
| --------------------------------------------------- | ------------------------ |
| 整場 Docker 清理（映像 + dagger cache + npm cache） | 126 GB，分散在十幾個項目 |
| **`bkw/.angular/cache` 單一目錄**                   | **84 GB**                |

我們盯著 Docker 看了整場，是因為**工單是這樣派的**（「Docker 磁碟快滿」），
而第一手證據（`Docker.raw` 163 GB）確實支持那個框架。
但「Docker 佔 163 GB」與「Docker 是最大的問題」是兩件事 ——
**沒有人先量過主機這一側**，這個盲區持續了整場。

> **下次先做第 0 節的「量主機這一側」，再決定要不要相信工單的框架。**

**結局**（2026-09-02 當天）：通知 bkw 席之後由他們自己確認並刪除
（不是我刪的 —— 別人的專案，只提供數字），主機可用 **118 GB → 196 GB**、
bkw 全庫 94.8 GB → 10.5 GB。

那 79–84 GB **全部堆在單一版本目錄** `.angular/cache/17.3.8` 底下，
所以不是「多版本殘留」而是**單版本無限長大** —— Angular CLI 的 cache 沒有預設上限。
設不設上限是該 repo owner 的決定，不是外人能代改的設定。

### 其他

- **一次清理買不到多久。** dagger 21 小時就長到 120 GB，保留 20 GB 的話大約一兩天回到原點。
- **根因是沒有 GC 政策**：那顆引擎的 `/etc/dagger/engine.toml` 是**空的**，
  沒有任何 `max-used-space` 設定 —— 加上第 2 節的「看到假數字」，等於完全沒有煞車。
  常設上限比定期人工清理可靠。
- **真正的問題是「這台機器要不要繼續當 CI runner」**，那不是 infra 席能裁的。
