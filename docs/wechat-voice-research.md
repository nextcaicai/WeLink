# 微信语音接收与转文字方案调研

日期：2026-10-17。范围：当前 WeLink 源码、模拟验证、腾讯公开客户端与语音识别官方文档。未读取私人消息或凭据，未调用真实微信/付费识别接口，未修改插件代码或安装版本。

## 结论

可以实现。推荐先补齐语音接收兼容性和失败记录，再采用“微信返回文字优先，没有文字时用腾讯云一句话识别”的方案。音频与转写应关联同一条消息，识别失败也要保留音频和可重试状态。

当前项目并非完全没有语音接收：已实现语音下载、解密、SILK 转 WAV、音频入库，以及保存网关返回的文字；缺少的是独立 ASR 兜底和接收异常的完整可见性。实际发送后毫无变化的根因尚未实测确认。

## 当前实现与已发现缺口

| 环节 | 当前证据 | 判断 |
| --- | --- | --- |
| 识别微信语音消息 | `src/core/types.ts` 定义 `ITEM_VOICE = 3` | 已有 |
| 使用网关转写 | `src/core/ilink.ts:504` 读取 `voice_item.text` | 已有，但为空时不主动转写 |
| 下载与解密 | `src/core/ilink.ts:167`、`:253` | 已有，仅接受 `encrypt_query_param` 下载定位方式 |
| 可播放音频 | `src/core/silk.ts:65`、`src/core/importer.ts:298` | 已有内置 silk-wasm 与 WAV 嵌入，不必额外安装 ffmpeg |
| 独立识别服务 | 搜索 ASR/transcription/provider 实现 | 未发现 |
| 空语音诊断 | `src/core/ilink.ts:153`、`:182`、`:255` | 无文字且无可下载媒体时，可能直接忽略 |

腾讯当前公开客户端支持 CDN `full_url`，并优先使用它；WeLink 的 `IlinkMedia` 类型与下载逻辑均未处理这个字段。若实际语音仅携带 `full_url`、没有 `encrypt_query_param` 和文字，本地逻辑将忽略它。这是明确的兼容缺口，也是本次现象的候选原因，不能在没有真实消息证据时认定为根因。[腾讯协议参考](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md#cdn-media-reference)、[类型定义](https://github.com/Tencent/openclaw-weixin/blob/main/src/api/types.ts)

其他需排除的情况：运行中的插件与当前源码不一致、网关没有下发该条消息、字段结构不同、绑定发送者过滤、自动导入关闭、下载或写入失败。应先在现有插件接收循环内收集脱敏诊断，不另启动竞争轮询客户端。

诊断只需记录：消息 ID/类型、item 类型、文字是否存在、媒体字段名称、编码/采样率/时长、下载状态码、字节数和处理阶段；不输出 token、AES key、完整签名下载 URL 或语音正文。

## 微信能否直接返回转写

腾讯公开源码将 `VoiceItem.text` 描述为语音转文字内容，协议文档使用“may include a transcript”。公开客户端有文字时使用它，没有时处理音频。因此可以优先复用网关文字，但没有依据保证每条语音都有文字，也不能保证延迟多久后会补发。[腾讯协议参考](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md#message-model)、[接收处理](https://github.com/Tencent/openclaw-weixin/blob/main/src/messaging/process-message.ts)

腾讯文档同时明确：客户端类型和行为不是完整服务端契约。本调研未把可选字段、源码注释或模拟测试当作线上服务保证。

## 可选方案

| 方案 | 实现方式 | 用户影响与取舍 | 建议 |
| --- | --- | --- | --- |
| 仅依赖微信转写 | 保存 `voice_item.text` | 无额外识别配置，但文字缺失时仍无法自动记录内容 | 作为优先路径，不单独承担完整功能 |
| 腾讯云一句话识别 | 解密后上传 SILK 或规范化 WAV | 需开通服务并配置凭据；音频会提交腾讯云 ASR | 首期兜底候选 |
| 阿里云百炼短音频识别 | 既有 SILK 解码后，用 WAV 调用支持 Base64 的同步模型 | 需 API Key；可避免额外对象存储；模型/地域需明确选择 | 已有百炼账号时可优先试 |
| OpenAI 转写 API | 解码为 WAV，通过音频转写接口上传 | 需 API Key、可用网络及独立 API 用量；SILK 需转换 | 已有此链路时备选 |
| 本地 whisper.cpp | 插件调用本地识别服务或程序 | 下载模型、占用本机资源、维护运行环境；转写阶段无需把音频交给额外云服务 | 对本地处理有明确要求时再做 |

腾讯 `SentenceRecognition` 支持不超过 60 秒、3MB 的音频，格式包含 SILK、WAV；支持请求体上传，所以短语音无需先上传 COS。原始 SILK 是否直接适配微信实际样本，应做真实验证；不适配则用 WAV。长音频超过限制时需要其他接口，不能硬塞进短语音识别。[腾讯接口](https://cloud.tencent.com/document/api/1093/35646)

截至调研日，腾讯计费页列出一句话识别每月 5000 次免费额度，低用量后付费为 3.20 元/千次。按一天 20 条估算，一个月约 600 次，若账户具备并仍有该免费额度，可覆盖个人使用；实际以账户开通情况、额度消耗和账单为准。[腾讯计费](https://cloud.tencent.com/document/product/1093/35686)

百炼当前提供短音频同步模型，部分支持 URL/Base64 输入，格式列表含 WAV、未列 SILK。选这些接口时无需强制引入 OSS；不要套用旧版长音频异步接口的接入方式。[百炼模型与音频规格](https://help.aliyun.com/zh/model-studio/asr-model/)、[非实时识别指南](https://help.aliyun.com/zh/model-studio/non-realtime-speech-recognition-user-guide)

OpenAI 的音频转写接口可上传 WAV 等格式；本次未做账号、网络、效果或费用对比测试。[OpenAI 转写 API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)

whisper.cpp 支持 Apple Silicon 加速并提供 HTTP 转写服务。WeLink 当前是桌面插件，技术上可以连接本地服务；但本次未测设备速度或中文准确率，也不建议首期把模型部署复杂性强加给所有用户。[whisper.cpp 官方仓库](https://github.com/ggml-org/whisper.cpp)

## 推荐落地方式

```text
微信语音 → 接收与格式校验 → 下载、解密并保存音频
                            ├─ 已有微信文字 → 保存文字
                            └─ 没有文字 → 持久化待转写任务 → ASR
                                                       ├─ 成功：补入同一条记录
                                                       └─ 失败：音频保留，显示原因，可重试
```

1. 先解决“没有任何变化”：确认真实语音是否进 `getupdates`；兼容有效 `full_url` 与旧下载参数；缺媒体/密钥/不支持编码必须留下明确状态。即使只收到文字而没有音频，也应先保存文字。
2. 复用现有解码：原音频留存，WAV 用于播放或识别。当前解码默认先尝试 24kHz；若识别引擎要求 16kHz，应真实解码/重采样到相应规格，不能只改扩展名或 WAV 头。
3. 保存后后台识别：任务至少包含稳定消息 ID、音频路径、状态、尝试次数、来源与结果。识别不占用收件轮询，Obsidian 重启后能继续处理。
4. 按消息更新：识别结果回填同一条语音，避免重试后重复笔记；记录文字来源为网关或 ASR。保留原话，不默认改写成摘要。后续摘要应为另一步用户功能。
5. 明确状态：音频已保存/转写中/转写完成/转写失败可重试。若沿用现有自动回复开关，回执应真实反映保存和转写状态，不提前宣称“已转文字”。
6. 凭据单独保存：个人使用可由用户提供服务凭据；不能把开发者统一密钥打包进插件。若产品目标是不让用户配置云账号，需另行设计后端代转写、身份与计费，不属于本次最小方案。

需要特别处理当前状态机制：`src/main.ts:349` 在导入前推进 cursor，`src/main.ts:402` 调用的 `StateStore.seen()` 会立即标记去重。故不能把 ASR 失败恢复寄托在“微信再次发同一条消息”；应在接收确认前确保消息/任务可靠落地，并将接收去重与转写重试状态分开。

## 验证与实施验收

本次把当前测试源码打包到系统临时目录，执行 `node --test --test-name-pattern='voice|extractText|failed media download'`：6 项通过，涵盖语音文字提取、SILK 解密转 WAV、文字与音频同时保留、非 SILK 回退、下载错误记录、音频写入笔记。未运行有覆盖现有构建产物可能的 `npm test`/`npm run build`，未修改现有 `main.js`。

另用内存模拟消息验证：`voice_item: {}` 或 `voice_item: {media:{}}` 都返回零条消息、无错误，同时返回下一游标；仅含转写文字的语音返回一条消息。这证实静默分支存在，不证明真实网关发的就是这些内容。

实施后至少验证：

- 真实微信 5 秒与接近 60 秒的语音，有/无网关文字两种情况。
- `full_url` 与 `encrypt_query_param` 两种媒体地址；仅文字、缺地址、缺密钥。
- 普通话、中文夹英文、环境噪声；用用户实际样本比较准确率。
- 下载失败、ASR 超时、凭据错误、额度不足：音频/错误记录不丢失。
- 连续发语音时文字消息仍能接收；重启后恢复待处理任务。
- 转写重试和网关重放不重复生成记录，不覆盖用户已编辑正文。
- 目标 Obsidian 内实际可播放、可搜索转写、状态可理解。

本轮只完成可行性研究和模拟验证；尚未安装修复版本、真实发送语音或接入任何 ASR 服务。
