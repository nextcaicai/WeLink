# WXLink 移动端与 iLink 登录调研

日期：2026-10-20。范围：评估 Android 使用者的需求、腾讯公开 `openclaw-weixin` 当前实现的 iLink 登录边界，以及 Obsidian/Android 对后台运行的公开约束。未登录微信、未生成二维码、未使用账号或凭据，也未改动产品源码。

## 结论

建议先做“Android 单手机绑定 + 打开 Obsidian 后收取文字与剪藏文章”的可行性验证，但**不应把它承诺为手机后台持续收微信消息**。截图中的反馈说明，至少有一类 Android 用户主要使用手机上的 Obsidian，且想把公众号文章和电脑文字汇入同一套笔记；这足以支持小范围验证，但还不是需求规模的统计证据。

第一步应验证手机能否独立绑定、访问 iLink、抓取公众号正文与图片，并在用户从微信返回 Obsidian 后完成收取。已有个人电脑且常开的用户可以继续用“桌面接收 + 笔记同步”；这不能覆盖截图中电脑长期不用、公司电脑不存私人信息的用户。也不建议为此次需求默认新增作者中转服务。

当前无法承诺“单手机保存二维码到相册后，微信扫一扫选图就能登录”。腾讯的公开协议只定义“扫码后轮询到确认”，没有规定扫码来源、相册选图、同设备摄像头或普通二维码识别的可用性。普通二维码能被微信识别，不等于 iLink 登录码能完成授权；该点必须在目标 Android 机型和微信版本上真机验证。

## 为什么有必要做，但边界应当很窄

| 用户问题 | 移动端能带来的价值 | 首期不应承诺的内容 |
| --- | --- | --- |
| 工作电脑不能保存私人信息，只在 Android Obsidian 里记笔记 | 手机直接接收并落库，减少对个人电脑和笔记同步的依赖 | 手机锁屏后持续接收并即时写入笔记 |
| 微信里看到公众号文章，想直接进入笔记 | 可补“文章保存/分享”入口或引导到可用的手机方案 | 将任意公众号页面抓取宣称为已验证 |
| 只有一台手机 | 可尝试同机链接跳转和相册扫码，并提供另一设备扫码兜底 | 假定任一微信版本允许自扫当前屏幕 |

Obsidian 官方移动插件文档明确：移动端没有 Node.js 或 Electron API，插件及其依赖调用这些 API 可能崩溃；若依赖它们，官方建议用 `isDesktopOnly` 阻止移动安装。这个事实决定了移动支持不是“把现有设置页做窄”就够，而需要把移动可用网络、加密和持久化路径独立出来，或保留桌面/服务端网关作为收件端。[Obsidian Mobile development](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development)

官方 Obsidian Sync FAQ 说“文件只会在 Obsidian 运行时同步”。这是 Sync 的产品语义，不能外推成“任何社区插件必然暂停”的技术证明；但它已说明不能把手机锁屏后的同步当成可靠抵达通道。[Obsidian Sync FAQ](https://help.obsidian.md/sync/faq)

Android 官方文档还说明：应用转入后台数分钟后会进入 idle，系统会停止其后台 service；持续任务需要应用本身实现前台服务或调度能力。Obsidian 社区插件没有公开的能力证明可以自行注册该类 Android 原生服务，因此它进一步支持“移动端前台触发、后台不作保证”的产品边界，但不是 Obsidian 插件实际行为的直接实测。[Android Background Execution Limits](https://developer.android.com/about/versions/oreo/background)

## iLink 登录：公开事实

腾讯 `openclaw-weixin` 是可核对的公开客户端实现，不是 iLink 服务端规范。它的协议文档也明确说明：内容来自当前客户端源码，服务端要求超出源码所示的部分需要另行验证。[协议范围说明](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md#L198-L210)

1. 客户端以 `POST /ilink/bot/get_bot_qrcode?bot_type=3` 获取 `qrcode` 与 `qrcode_img_content`；本地可附带最近至多 10 个 Bot token。随后用 `GET /ilink/bot/get_qrcode_status?qrcode=...` 轮询，确认后才获得 `bot_token`、`ilink_bot_id`、`baseurl` 与扫码用户 ID。[取码](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md#L267-L303)
2. 当前实现处理的状态包含 `wait`、`scaned`、`confirmed`、`expired`、`need_verifycode`、`verify_code_blocked`、`scaned_but_redirect` 和 `binded_redirect`。因此任何新登录 UI 至少要能表示“需输入手机验证码”和“轮询主机切换”；只处理等待、已扫、成功、过期会漏掉当前公开客户端已兼容的分支。[状态表](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md#L305-L315)
3. 官方客户端将 `qrcode_img_content` 作为二维码的展示内容，并在终端显示二维码后等待“用手机微信扫描”。协议只称该字段为“用于展示二维码的 URL 或内容”，没有把它定义为可在微信内直开并完成授权的 deep link。[字段定义](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md#L281-L285)、[终端登录流程](https://github.com/Tencent/openclaw-weixin/blob/main/src/channel.ts#L2225-L2241)

## 单手机登录可选路径

| 路径 | 公开证据 | 产品判断 | 真机验收点 |
| --- | --- | --- | --- |
| `qrcode_img_content` 的“在微信打开”候选入口 | 字段可能是 URL 或内容；客户端会展示它 | 优先验证候选。仅当字段是安全的 HTTPS URL 才考虑提供打开/复制入口；没有证据证明它能在同一手机进入授权 | Android Chrome、微信内 WebView、不同微信版本能否进入确认页并使轮询变为 `confirmed` |
| 保存二维码图片，再用微信“扫一扫”的相册选图 | 腾讯源码仅要求“扫码”，未说明来源 | 与链接打开并列的候选；验证通过后才可作为默认或备用入口 | 相册选图是否触发 `scaned`，是否能输入验证码并确认；失败时错误提示是否可理解 |
| 另一台手机、平板或电脑展示码，本机微信扫描 | 与公开客户端“桌面展示、手机扫描”模型一致 | 最接近现有流程的兜底；只需另一块屏幕展示码，无需在那里保存私人笔记 | 取码、扫码、验证码、确认、重启后会话恢复 |
| 把 `qrcode` 原始值当作 URL/Token 使用 | 无此协议接口 | 不可做。必须经过微信侧确认后由状态轮询取得凭据 | 不适用 |

如果候选入口通过真机验证，现有登录弹窗可增加相应操作；不必另建网页登录系统。需要注意“保存到 Obsidian 库”不等于“出现在系统相册”，导出/系统分享能否被微信相册选中也要验证。切换到微信期间应保留同一登录尝试，返回后先查询原二维码状态，避免主动刷新导致刚保存的二维码失效；同时补齐验证码/重定向 UI。登录二维码和链接不应写进普通笔记或公开反馈材料。

## 多账号、重复登录与离线消息

腾讯 README 明确支持同一个 OpenClaw Gateway 管理多个微信账号，并建议通过 `session.dmScope=per-account-channel-peer` 隔离会话；这证明“多账号”是客户端支持的目标，而不是 iLink 服务端对单账号可同时绑定多少 Bot 的承诺。[多账号配置](https://github.com/Tencent/openclaw-weixin/blob/main/README.zh_CN.md#L242-L251)

`binded_redirect` 在当前实现中表示 Bot 已绑定当前 OpenClaw 实例；客户端可保留已保存的凭据并按成功处理。它不能证明跨设备、跨插件或重复扫码的完整限制，也不能据此推断“一个微信账号只能有一个 Bot”。这些限制仍需实际测试或腾讯服务端文档。[处理逻辑](https://github.com/Tencent/openclaw-weixin/blob/main/src/auth/login-qr.ts#L1499-L1514)

入站是 `POST /ilink/bot/getupdates` 长轮询：请求带上一次响应的 `get_updates_buf`，响应返回消息、新游标和服务端建议的长轮询超时。该机制可支持应用在恢复后用游标继续拉取；但公开资料没有给出服务端队列保留多久、最大积压量、游标过期行为或“离线消息永不丢失”的 SLA，不能把它表述为离线补收保证。[getUpdates 协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md#L317-L363)

README 中的“文本 30 天/每账号 10,000 条、媒体 7 天”等数值说的是本地引用上下文缓存，不是 iLink 的入站消息队列保留期，二者不能混用。[本地缓存](https://github.com/Tencent/openclaw-weixin/blob/main/README.zh_CN.md#L280-L284)

## 建议的验证闸门

在决定实现完整 Android 支持前，用一台真实 Android 手机完成以下闭环：

1. 前台打开插件，验证移动依赖不会崩溃；登录页能取码、刷新、退出后不泄漏二维码或 token。
2. 分别验证“HTTPS `qrcode_img_content` 在微信打开”“保存到相册后微信选图”“另一设备扫码”，记录每条路径的 `wait → scaned → confirmed` 或失败状态。
3. 验证 `need_verifycode`、`scaned_but_redirect`、`binded_redirect` 都有可完成或可解释的 UI，且新版本登录状态不会误报成功。
4. 应用切到后台、锁屏 5/30/60 分钟后，再回到前台检查是否仍在轮询；分别在保留/丢失网络连接下测试恢复。记录 `get_updates_buf` 是否续拉及是否漏、重、乱序；不以一次成功代替保留期保证。
5. 若核心目标只是手机收集网页，可并行评估官方 Obsidian Web Clipper：其免费、Firefox Mobile 可用，内容本地保存到 vault；它是低摩擦备选而非微信入口的等价替代，公众号页面的实际提取效果仍需实测。[Obsidian Web Clipper](https://help.obsidian.md/web-clipper)

完成上述验证前，只能说正在验证“Android 独立绑定与前台收取”，不能宣称已支持；通过后再发布限定范围的试验版。

## 本地实现核对：移动适配的实际范围

核对对象：当前工作区 WXLink 0.2.1，插件 ID `welink`。本轮初始 `git status --short` 无输出；以下均为静态源码结论，不代表已在 Android/iOS 运行。

| 环节 | 当前代码证据 | 对移动支持的影响 |
| --- | --- | --- |
| 安装声明 | [manifest.json](../manifest.json#L9) 为 `isDesktopOnly: true` | 当前明确仅桌面；改变声明本身不能消除运行时依赖。 |
| 启动产物 | [esbuild.config.js](../esbuild.config.js#L22) 给整个插件加顶层 `require('node:timers')` 和 `require('node:perf_hooks')` | 移动端没有 Node/Electron；即便页面尚未登录，也会在加载阶段遇到不兼容依赖。 |
| 网关 / 登录 | [main.ts](../src/main.ts#L5) 顶层引入并实例化 `UndiciTransport`；[transport-undici.ts](../src/core/transport-undici.ts) 使用 Node Undici 的 Agent | 需要移动网络实现，并确保桌面依赖不会在移动端被提前求值。源码已有 [ObsidianTransport](../src/core/transport-obsidian.ts)，但未被当前主入口使用，其移动可用性仍需验证。 |
| 文章与媒体下载 | [main.ts](../src/main.ts#L30) 使用 `NodeTransport`；[transport-node.ts](../src/core/transport-node.ts) 使用 Node http/https 和流式空闲超时 | 是截图用户的核心功能，不能只验证文字收取。替换后需重测公众号正文、图片、重定向及异常慢响应；不能把桌面已遇过卡顿的请求路径原样作为移动支持保证。 |
| 字节处理与加密 | [http.ts](../src/core/http.ts) 使用 Buffer 解码；[crypto.ts](../src/core/crypto.ts) 使用 Node AES-128-ECB / MD5；[ilink.ts](../src/core/ilink.ts) 大量使用 Buffer | 要有浏览器兼容的字节/加密实现或经过验证的依赖。标准 Web Crypto 没有直接提供 AES-ECB / MD5，不能只把 Node crypto 改成 crypto.subtle。[Web Crypto 算法表](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)。 |
| 文件落库 | [importer.ts](../src/core/importer.ts)、[store.ts](../src/core/store.ts)、[outbox.ts](../src/outbox.ts) 主要走 Obsidian Vault / adapter | 这是较有利的基础：无需把整个文件系统重写，但必须用真实移动库验收写入、附件路径和重启后的状态。 |
| 语音 | [silk.ts](../src/core/silk.ts) 使用内嵌 WASM；vendor 当前显式关闭 Node 分支 | 不应直接判定“语音一定不支持手机”，也不能因 WASM 存在就判定已兼容；需验证移动 WebView 解码和内存。可放在文字/文章之后验收。 |
| 连接恢复 | [main.ts](../src/main.ts#L315) 在插件进程中长轮询；未见移动生命周期专项处理 | 首版需明确返回前台后如何重连、补收与显示处理结果；普通计时器不是系统后台服务。 |
| 处理可靠性 | [main.ts](../src/main.ts#L388) 先更新 cursor，再导入；[main.ts](../src/main.ts#L443) 在导入前调用 `seen()`；[store.ts](../src/core/store.ts) 保存会延迟触发 | 这是静态可见的中断窗口：导入尚未完成时，进度/去重状态可能已落盘。手机被系统终止后可能跳过未落库内容，需用中断恢复验收确认并设计持久化待处理项或提交顺序；不是本轮已复现的丢消息故障。 |
| 多设备 | 凭证、cursor、dedup 都在插件目录的同一个 state.json；源码已经有减少同步冲突写入的注释 | 首版建议每个绑定只由一个设备收取，其他设备同步笔记；不能假设复制 token 到手机后，桌面和手机都能完整接到同一批消息。 |

Obsidian 官方明确移动端无 Node/Electron，且可使用真机远程调试；桌面模拟手机主要用于 UI，不能证明这些依赖可用：[Mobile development](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development)。

## 需求判断与产品建议

截图提供的是一条具体的需求证据，不能据此推算需求规模。用户只在 Android 保存个人笔记，电脑数月不打开，也不愿把个人库放在公司电脑；因此“先在电脑接收，再同步手机”无法覆盖他。他看重免费公众号剪藏、微信发送文字、少依赖中转服务，而非桌面 Agent 发通知。

建议进入 Android 的限定可行性验证，暂不宣布完整移动支持。目标体验是“微信先发给机器人，打开手机 Obsidian 后收取并剪藏”，但离线消息的保留与补收必须先实测，不能直接承诺。手机本机落库不要求额外购买 Obsidian Sync，也无需新增作者中转服务；跨设备同步是另外一项需求。

| 用户类型 | 移动版新增价值 | 建议 |
| --- | --- | --- |
| 已有桌面收取，手机只阅读 | 低；已有笔记同步可覆盖 | 继续现有方案，避免为同一绑定增加双设备消费者。 |
| 只有手机，偶尔批量收集文字与公众号文章 | 高；截图属于此类 | Android 验证优先。若认可打开 Obsidian 后收取，范围可以控制。 |
| 要求锁屏 / 杀进程后仍即时保存、即时回执 | 当前插件架构不能保证 | 不作为首版承诺；原生常驻服务或独立网关会显著改变产品维护范围。 |
| 主要需要本地桌面 Agent 主动通知 | 移动插件新增价值有限 | 仍以桌面运行端为主。 |

成本判断：不是仅改二维码 UI 的小修；属于涉及网络、打包、字节/加密及恢复机制的中等规模跨平台适配。由于网关 / CDN 对传输栈敏感，真机联网结果会决定是否值得继续投入，此时给精确工期依据不足。

## 建议验证顺序与停止条件

1. **先验证绑定入口**：用现有桌面生成的同类 iLink 码，分别验证同手机相册识码、微信内打开原始码 URL；另用第二块屏幕摄像头扫描作对照。记录微信版本、Android 版本、实际授权结果及插件是否收到 confirmed。二维码不得公开。
2. **验证移动网络与文章**：在最小独立验证环境检查 iLink 获取 / 确认 / getupdates、公众号正文及图片；无需先搬完整插件。任何扫码前提与验证码/重定向状态都要覆盖。
3. **验证核心承诺**：同手机在微信发文字和文章链接，返回 Obsidian 收取；再测切后台、锁屏、断网、系统终止后的重启与补收，检查是否重复 / 漏记 / 虚假成功回执。离线间隔可设为 5 分钟、1 小时和隔夜，但观测结果只能说明该版本与时段，不能据此推导永久保留 SLA。
4. **决定首版范围**：前三项通过后，才考虑 Android 试验版，优先文字、公众号正文与图片、回执；大附件、语音、发件箱放后续。iOS 需独立验收，不因共享代码而自动宣布支持。

停止条件：如果相册与链接均无法通过授权，且目标用户不接受借用第二块屏幕，移动独立绑定价值明显受限；如果短时离线补收不可靠，即使绑定成功，也不应按“微信收集箱”体验发布。两者都不是单纯修改提示文案能解决。

## 用户急用时的备选路径

Obsidian 官方 Web Clipper 免费，支持 Firefox Mobile，并在本地保存内容：[官方介绍](https://help.obsidian.md/web-clipper)。可让用户尝试“公众号文章复制链接 → Android Firefox 打开 → Web Clipper 保存”。

这是不同的操作流程：不提供微信机器人文字同步，也不能从浏览器支持推导每篇公众号文章和图片都能完整提取；具体公众号页面仍要试用。它可以减少立刻适配整个 WXLink 的压力，但不能算已满足截图的全部诉求。

## 本轮交付与证据边界

本轮只新增调研文档，没有修改产品代码、manifest 或构建产物，也没有发起微信登录、获取账号凭证或进行外部绑定。结论来自当前源码与在线官方资料；未做 Android/iOS 真机、相册扫码授权、移动 iLink/CDN、离线补收或双设备并发验收。文档检查不能替代这些验收。
