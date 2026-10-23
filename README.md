# dsh-whale-greeting

进入 DSH 工作界面时，自动向主人问一声好；一轮任务跑完时，再向主人交一张报告；
跑得太久时说一句「我在」；工具要权限时，由小鲸来请示 ——
**全都长在对话区里**，不是浮在窗口角落。

| 场景 | 插在哪 | 长什么样 |
|---|---|---|
| 已有对话 | `conversation.input.dock`（输入框下沿那条 strip） | 头像 + 气泡：`下午好，主人～ 小鲸泡好了茶，就等主人坐下啦～`，12 秒后淡出 |
| 空白 / 新对话 | `conversation.hero.options`（首屏「探索未至之境」那一行） | 一条同样文案的小气泡，点了才收 |
| 一轮跑完 | 同一个 `conversation.input.dock` | 换成绿色的交付卡：`任务完成啦，主人！ 总共用了 2 分 10 秒，小鲸把现场收拾干净啦～`，署名改成「任务完成 · 小鲸交付」，14 秒后淡出 |
| 长跑陪伴 | 同一个 `conversation.input.dock` | 青绿色的陪伴卡：`已经跑了 6 分 20 秒啦，小鲸一步都没挪开，就在旁边守着。`，署名「长跑陪伴 · 小鲸在」 |
| 需要授权 | `conversation.composer`（**接管整个输入框**） | 橙黄色的请示卡：`工具 bash 想动一点超出平时的权限：……` + 工具详情 + 两个答复按钮，署名「等待授权 · 小鲸请示」 |

同一个问候只出现一次：两个 slot 都是 session 作用域的 list，宿主按当前对话只渲染其中一个。

## 安装

在 dsh-market 里搜 `dsh-whale-greeting` 点安装；或者命令行：

```sh
dsh plugin --profile <你的 profile> add dsh-whale-greeting
```

官方 DSH Desktop 请在应用自己的 **设置 → 插件** 里装（桌面端的 profile 归应用管理，跑着的
时候命令行改不动它）。这个包声明了 `dsh.bundle`，装进 profile 时由 `cordis.patch.yml` 插入
一行 `id: whale-greeting`，不往 profile 的补丁层写任何东西。

装完刷新页面即可，没有需要重启的 Host 侧改动。

- **触发时机**：每次启动 DSH、每次开新对话都会问候（间隔再短也触发）；长时间待机后回来，
  再随机触发一次，阈值在 10~15 分钟之间每次重抽；任务跑满 4~8 分钟的随机时刻说一句陪伴；
  一旦出现待审批就换成请示面板
- **首屏大卡优先**：新对话时 hero 立刻举手，dock 让 300ms，保证首屏拿到大卡；
  hero 会强制亮出，哪怕上一个会话的问候还没收

- **文案不固定**：8 个时段 × 每种 6 种说法 + 120 句轮换池（按时段/迎接/茶点/工作/陪伴/鼓励/
  天气/夜话/碎碎念分组），`sessionStorage` 记住最近用过的 48 句，一轮之内不重复；用完自动洗牌
- **等你看得见才问**：启动动画的全屏覆盖层（`.dshba`）还在时不动，等它消失、且页面可见，才开始
- **头像每次随机**：`assets/avatars/` 里的 24 张表情包头像，每次问候换一张（连续不重复），
  由 Host 的 `/plugins/dsh-whale-greeting/avatar/<name>.png` 提供；路由失效时回落到内联的 `assets/avatar.png`
- **跟随主题**：只用 `--dsw-alias-*` token，深浅色自动适配
- **可关闭**：点气泡、点 ×、按 Esc / Enter

## 任务完成报告

一轮任务的终点在宿主里是一个明确的事实：Session 快照的 `running` 由 `true` 变回 `false`。
卡片从 slot 拿到的 `useSession` 座椅上盯着这一个布尔值：

| 发生什么 | 卡片说什么 |
|---|---|
| `running` true → false，且这一轮 ≥ 1.2 秒 | 交付卡（成功色）：`任务完成啦，主人！` + 用时 + 今天第几件 |
| 同时 `promptError` 有值 | 中断卡（警告色）：`这一件卡住了，主人……`，文案里说明用了多久、停在哪 |
| 这一轮短于 1.2 秒 | 不报（回车即答的闲聊不值得一张卡） |
| 停在子 Agent 会话里 | 不报（只报主人自己的那一轮） |

- **用时**：`running` 变 true 的那一刻起表，变 false 时结算，写成 `42 秒` / `3 分 12 秒` / `1 小时 5 分`
- **今天第几件**：本次页面加载内的完成计数，`run.count`，文案里可以写「第 3 件收工」
- **只报一次**：计时器是模块级的 `run`，dock 与 hero 两个 slot 的同款观察者共用它，
  先到的报，后到的看到 `run.reported` 就安静 —— 不会因为同时挂着两个 slot 刷两张卡
- **抢得过问候**：报告用 `force` 亮出，即使上一条问候还没到 12 秒也会被替换，因为「做完了」比「你来了」更该被看见
- **后台不作废**：页面被切走时卡片停止计时（进度条也停），回来时把起点往后挪 ——
  任务在后台跑完，主人切回来仍然看得到这张报告，而不是「打开就没了」
- **换个色不换张卡**：仍是同一张 `.dshg`，只把 `--dshg-accent` 换成 `state-success-primary`
  （完成）或 `state-warn-primary`（中断），署名与对勾跟着 accent 走

已知限制：宿主没把「这一轮是被主人按 Stop 掐掉的」放进 Session 快照，所以手动中止的一轮也会走
完成卡（文案只承诺用时，不承诺结果细节）。要区分中止，得等宿主暴露对应的事实。

## 长跑陪伴

一轮任务跑得久，主人最容易在「还不知道要多久」的时候烦躁。所以小鲸不报进度（它看不见进度），
只负责说一句「我在」：

| 发生什么 | 卡片说什么 |
|---|---|
| 这一轮从开始算起，到了本次抽出的随机时刻（4~8 分钟之间） | `跑得有点久了，主人还顺利吗？` + `已经跑了 6 分 20 秒啦，小鲸一步都没挪开，就在旁边守着。` |
| 说完还接着跑 | 立刻重抽一个 4~8 分钟的窗口，到点再说一次（跑得越久，陪得越久） |
| 卡片正在显示别的内容（问候 / 交付 / 请示） | 让位，不抢戏；下一个窗口再补 |
| 这一轮结束 | 计时归零，下一次陪伴重新从新一轮的 4 分钟起算 |

- **随机在哪**：`COMFORT_MIN_MS`~`COMFORT_MAX_MS` 之间每次重抽，所以不是「第 5 分钟固定响一次」，
  而是每一轮都不一样；40 秒一轮的巡检节拍只负责「到点没有」，不负责精确到毫秒
- **一份心跳**：巡检员是模块级的 `comfortAgent`，dock / hero 谁挂上来就谁启动，最后一个离开才停 ——
  两个 slot 同时在场也只有一份节拍、不会说两句
- **子会话不陪**：子 Agent 的轮次不报完成，也不陪（主人等的是自己那一轮）
- **页面在后台也照常计时**：这是「任务在跑」的陪伴，不是「主人在看」的陪伴；卡片本身的进度条
  仍然会在页面不可见时停走（回来还看得见）

## 授权请示

需要授权时，宿主会把整个输入框交给审批面板（`conversation.input.dock` 连同问候卡一起被藏起来），
所以小鲸必须**接管输入框**才在画面上 —— 这也是这个功能只能做成 composer 链条目的原因。

| 发生什么 | 面板说什么 |
|---|---|
| 会话出现 `pendingInteraction.kind === 'approval'` | 请示卡：`主人，小鲸要请示一下～` + `工具 {tool} 想动一点超出平时的权限：{reason}。` |
| 这条审批带 `callId` | 原样把 `conversation.approval.detail` 渲染在卡片里 —— 要批准的那条命令还是原来那份 |
| 主人点「允许一次」/ 按 Enter | `pending.answer('allowed-once')` |
| 主人点「拒绝」/ 按 Esc | `pending.answer('rejected')` |
| 已经答过、或宿主撤回 | 两个按钮一起禁用，等它自己消失 |

- **只接管，不改语义**：答复只有原来那两个，`answer()` 用的还是宿主给的那个 pending 对象，
  失败时按钮会还回来（不会卡在「小鲸在处理…」）
- **不是审批就绝不出现**：`question` / `plan-review` 一律返回 `null`，那些面板照旧由宿主自己渲染
- **接口变了就自动让位**：`select` 里检查 `typeof pending.answer === 'function'`，一旦宿主换了形状，
  这个条目直接返回 `null`，输入框还给宿主，不会白屏
- **`priority: 0`**：比宿主审批面板的 `priority: 1` 靠前，所以审批时才轮到小鲸；
  其它局面它返回 `null`，一枚字节都不占
- **`data-approval-key`**：卡片带着审批的 key，宿主的「连按两次 Esc 停止本轮」会绕开这里，
  不会在等待授权时误杀任务

## 实现

| 半 | 文件 | 作用 |
|---|---|---|
| Host | `index.js` | `/plugins/dsh-whale-greeting/status.json`、`/diag`、`/avatar/<name>.png` 三条路由；entry 被装载，`dsh.client` 声明的浏览器模块才会进页面 |
| Browser | `src/client.js` → `lib/client.js` | 两个 list slot 各注册一个 `Greeting(variant, props)`（渲染问候 / 交付 / 陪伴卡，内部再挂一个不渲染的 `ReportWatch` 盯 `running` 并驱动陪伴心跳），外加 `conversation.composer` 链上的一个 `ApprovalComposer`（只在审批挂起时获选） |

浏览器半是纯 JS + `React.createElement`，不 import 任何包（React 由页面的模块表给）。
构建做三件事：把 `src/style.css` 内联成 `CSS` 常量、把 `assets/avatar.png` 内联成兜底 data URI、
把 `assets/avatars/*.png` 的文件名注入成随机头像名单。

```sh
node build.mjs         # src/* + assets/* -> lib/client.js + preview.html
node test/smoke.mjs    # 假 loader / 假 React / 假 ctx，断言注册、形态、三类卡片与文案库
node test/report.mjs   # 假 Session 快照，断言完成报告只报一次、用时、出错与短轮次
node test/comfort.mjs  # 假时钟 + 假心跳，断言陪伴只在 4~8 分钟之间出声、请示只认 approval
```

## 没有控制台也能看它走到哪一步

浏览器半会往 `localStorage` 写一条诊断，阶段是
`module → apply → mounted:dock|hero → shown:dock|hero → hidden:dock`（报告是 `show:dock:done`）：

```js
localStorage.getItem('dsh-whale-greeting:diag')
```

读不到控制台时，直接从磁盘上看：

```
C:\Users\<你>\AppData\Roaming\@deepseek-ai\dsh-desktop\Local Storage\leveldb\*.log
```

- 只有 `module` / `apply` → 客户端插件没被激活（`dsh.client` 声明或 entry 有问题）
- 有 `mounted` 没 `shown` → 覆盖层没撤、或页面一直在后台
- 有 `shown` 但看不见 → 是 slot 内布局问题，不是加载问题
- 问候正常但没有 `show:*:done` → 报告没装上：宿主没给 `useSession` 座椅，或这一轮短于 1.2 秒
- 跑到 4 分钟以上仍没有 `show:dock:comfort` → 这一轮被判定成子会话，或卡片当时正显示别的内容
- 审批弹了但没看到小鲸 → 说明 `select` 让位了（`answer()` 不在、或 kind 不是 `approval`），
  输入框会退回宿主自己的审批面板，功能不受影响

## 想改点什么

| 想要 | 改哪 |
|---|---|
| 换时段问候语 | `src/client.js` 里的 `SALUTATIONS`（每个时段一组 `variants`） |
| 换正文轮换池 | `LINES`（一句一行，注释按主题分组） |
| 换完成 / 中断文案 | `DONE_HEADS` + `DONE_LINES`、`FAIL_HEADS` + `FAIL_LINES`（`{time}` 用时、`{count}` 第几件、`{at}` 完成时刻） |
| 换陪伴文案 | `COMFORT_HEADS` + `COMFORT_LINES`（`{time}` = 已经跑了多久） |
| 换陪伴的触发窗口 | `COMFORT_MIN_MS` / `COMFORT_MAX_MS`（默认 4 / 8 分钟，每次重抽）；巡检节拍是 `COMFORT_TICK_MS` |
| 换请示文案 | `PERMISSION_HEADS` + `PERMISSION_LINES`（`{tool}` 工具名、`{reason}` 申请理由） |
| 让请示不再接管输入框 | `apply()` 里删掉 `conversation.composer` 那一段（陪伴与其余卡片不受影响） |
| 换时段分界 | `salutationFor()` |
| 换停留时长 | `SHOW_MS`（问候 / 陪伴）、`REPORT_SHOW_MS`（报告），毫秒 |
| 多短的轮次不报 | `MIN_TURN_MS` |
| 关掉完成报告 | `Greeting` 里把 `watcher` 那段去掉 |
| 只保留一种形态 | `apply()` 里删掉不需要的那个 `ctx.slots.inject` 段 |
| 换头像 | 把正方形透明 PNG 放进 `assets/avatars/`（随机池，文件名只留小写字母/数字/`-`）；`assets/avatar.png` 只是兜底图。改完重跑 `node build.mjs` |

改完 `node build.mjs`，**重启 DSH**（客户端 bundle 的 `rev` 是宿主装配时算出来的，只刷新会拿到旧 rev）。

<details>
<summary>作者本机是怎么挂的（开发自用，与使用者无关）</summary>

用 `link:` 挂在 profile 里，改完 `node build.mjs` + 重启即可，**不需要** `pnpm install`，
也不用往安装目录复制 `lib/client.js`：

| 项 | 值 |
|---|---|
| 依赖 | profile `package.json` → `"dsh-whale-greeting": "link:<插件目录绝对路径>"` |
| 挂载 | `dsh.profile.bundles` 里有 `dsh-whale-greeting`，由本插件的 `cordis.patch.yml` 插入 `id: whale-greeting` |
| 实体 | `node_modules/dsh-whale-greeting` 指向插件目录（junction / symlink） |

profile 的 `cordis.patch.yml` 里**不要**再手写一段 `- insert: id: whale-greeting`，
那会和 bundle 层叠成两份（两条 Host 半边、两张卡）。

</details>

要装**新**插件前，先确认 profile 里 `pnpm-workspace.yaml` 的 `storeDir` 还在：pnpm 11 只认这里，
项目级 `.npmrc` 的 `store-dir` 会被忽略；那一行丢了或写错，`pnpm add` 就会抛
`ERR_PNPM_UNEXPECTED_STORE`（提示让你重装，其实只要把 storeDir 写回去）。

`preview.html` 是三栏离线预览：问候大卡、首屏紧凑卡、任务完成交付卡（浅色 / 深色各一栏，
直接双击就能看，不需要 DSH）。

## 卸载

从市场装的：在插件列表里点卸载即可。

用 `link:` 手动挂的，两处一起拆：

```powershell
# 1) 从 <profile>\package.json 的 dsh.profile.bundles 里删掉 "dsh-whale-greeting"
#    以及 dependencies 里的 "dsh-whale-greeting": "link:<插件目录>"
# 2) 删链接（junction 只删链接，不会跟到插件目录里）
cmd /c rmdir "<profile>\node_modules\dsh-whale-greeting"
```

不要再改 profile 的 `cordis.patch.yml` —— 这个插件走的是 bundle 通道，那里本来就没有它的行。

## 许可

MIT。头像素材仅用于本插件的问候卡。
