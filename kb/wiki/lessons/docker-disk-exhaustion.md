---
title: 磁碟爆了怎麼查 —— Docker 佔滿主機的處置流程
summary: 主機從 2.9 GB 掉到 207 MB 的一次救援。記錄 docker system df 卡死時的替代量法、「兩個世界各看到假數字」為什麼讓自動 GC 永遠不觸發、以及 buildctl 是 shim、prune 兩參數、exit 0 不等於做了事這三個會讓人以為清完了的坑。
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

那次的數字：主機 `414Gi/460Gi`、可用 **2.9 GB**、`Docker.raw` 實佔 **163 GB**。

> **主機吃緊 ≠ Docker 內部吃緊。** 這兩件事要分開量，見第 2 節 —— 混為一談會讓你清錯地方。

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

| 時點                                       | 主機可用              | `Docker.raw` |
| ------------------------------------------ | --------------------- | ------------ |
| 開始                                       | 2.9 GB                | 163 G        |
| 清 dangling 映像（129.7 MB）               | 839 MB ↓              | 162 G        |
| 刪 4 個未使用的 supabase 舊版映像（~7 GB） | 241 MB ↓              | 156 G        |
| 清 npm cache（3.0→1.3 GB）                 | 2.0 GB                | —            |
| **第一次 prune（參數不全）**               | 210 MB                | 160 G        |
| **第二次 prune（帶觸發門檻）**             | **持續回升至 18 GB+** | **142 G**    |

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

- **一次清理買不到多久。** dagger 21 小時就長到 120 GB，保留 20 GB 的話大約一兩天回到原點。
- **根因是沒有 GC 政策**：那顆引擎的 `/etc/dagger/engine.toml` 是**空的**，
  沒有任何 `max-used-space` 設定 —— 加上第 2 節的「看到假數字」，等於完全沒有煞車。
  常設上限比定期人工清理可靠。
- **真正的問題是「這台機器要不要繼續當 CI runner」**，那不是 infra 席能裁的。
