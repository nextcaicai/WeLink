<p align="right"><a href="README.md">中文</a> · <strong>English</strong></p>

# WeLink

An [Obsidian](https://obsidian.md) desktop plugin. It sends and receives messages through Tencent’s official **ilink** bot gateway. It does not modify the WeChat client, does not require following any official account or mini program, and does not pass through the author’s own server.

Scan to bind your own WeChat account, then send text, images, voice, files, and official-account article links to the WeChat Clawbot. They land in your Obsidian vault.

## Features

- **Receive:** WeChat messages are written into the daily conversation note (received and sent on one timeline). Images, videos, files, and voice are decrypted into the attachment folder. Links in messages are fetched as Markdown article notes when possible.
- **Standalone notes:** If the first line of a plain-text message is `#单独保存`, the body starting on the next line is saved as its own note. The daily conversation note keeps only a link.
- **Send:** Drop one file into the outbox. A `.md` file is sent as text (headings, lists, bold, and code blocks are supported). Images, videos, and documents are sent as attachments (≤100MB).
- **Agent:** The plugin maintains `Agent.md` in the inbox folder. After reading it, an Agent can send WeChat messages through the outbox. See [Agent.md](Agent.md) for the protocol.

This project is a fork of [Wechatian](https://github.com/laruence/wechatian), with these enhancements:

- **Standalone notes (new):** Set a trigger such as `#单独保存`, then plain text sent to the WeChat Clawbot is saved as its own note instead of mixing into the daily log.
- **Official-account articles:** Fetching is improved for image-heavy and text-only posts. Verification pages and UI chrome such as like/favorite labels are no longer written into the note as article body.
- **Scan and connection:** Fixed the case where the QR code did not appear after **Re-scan** or **Log out**. Connection states (not connected / connected / session expired) are clearer.
- **Voice:** Compatible with newer gateway media URLs. Voice audio is saved together with any transcript the gateway provides.

## Requirements

- Obsidian desktop **1.13.0** or later (the mobile app cannot run this plugin)
- Network access to the WeChat ilink gateway
- Your own WeChat account, used to scan and bind

WeLink is not in the Obsidian community plugin store yet. After install, Obsidian loads `manifest.json`, `main.js`, and `styles.css` from `<Vault>/.obsidian/plugins/welink/`.

## Install

| Method | Who it is for | What it does |
|---|---|---|
| Method 1: Let an Agent install | You already use Cursor, Claude, or a similar Agent | Hand it this repo and the prompt below |
| Method 2: Releases | You just want to use it | Copy the three built files into the plugin folder |
| Method 3: BRAT | You want updates from the repo | BRAT (Beta Reviewers Auto-update Tester) pulls this repository |
| Method 4: Build from source | You are developing or packaging it yourself | Compile locally, then copy into the vault |

**Method 1: Let an Agent install**

Give the Agent this repository and the following prompt:

```text
Read README_EN.md and install WeLink into the Obsidian vault I specify.
Install only main.js, manifest.json, and styles.css — the files Obsidian loads.
Do not modify my notes, do not delete other plugin folders, and do not read, print, or commit secrets.
When finished, tell me how to scan and bind WeChat.
```

**Method 2: Install from Releases**

1. Open this repo’s [Releases](https://github.com/nextcaicai/WeLink/releases/) and download `main.js`, `manifest.json`, and `styles.css`.
2. Put them in `<your-vault>/.obsidian/plugins/welink/` (the three files sit directly in that folder — do not nest another directory).
3. Obsidian → Settings → Community plugins → turn off Restricted mode → reload → enable **WeLink**.
4. After changing the files, reload the plugin or restart Obsidian.

**Method 3: Install with BRAT**

1. Install the community plugin [BRAT](https://obsidian.md/plugins?id=obsidian42-brat).
2. In BRAT, add `https://github.com/nextcaicai/WeLink`.
3. Enable **WeLink**, then reload the plugin.

**Method 4: Build from source**

```bash
git clone https://github.com/nextcaicai/WeLink.git
cd WeLink
npm install
OBSIDIAN_PLUGIN_DIR=/path/to/vault/.obsidian/plugins/welink npm run build
```

If `OBSIDIAN_PLUGIN_DIR` is not set, the build only writes `main.js` at the repo root and does not touch any vault.

## Quick start

About five minutes. Button labels below match the English UI.

1. Obsidian → Settings → WeLink → **Connect WeChat**. In the **Connect WeChat** window, scan with WeChat and confirm on your phone.
2. A bot contact appears in WeChat. The status bar shows **WeChat online**, and settings show **Connected**.
3. **Send any message to this bot from WeChat first** (for example, “Hello”). The gateway issues the send credential only after the bound account has messaged the bot. Skip this step and test send will fail.
4. Back in settings, click **Send** under **Test connection**. When the test message arrives on your phone, the bridge is live in both directions.

Command palette commands: `Connect WeChat`, `Disconnect WeChat`, `Re-scan QR code to log in`, `Open today's inbox`.

## Usage

Default folders, all changeable under **Files and sending**:

```text
WeLink/
├── Agent.md              # outbox instructions for Agents (plugin-maintained)
├── 2026-10-17.md         # daily conversation note (received / sent)
├── notes/                # plain-text notes saved via the standalone note trigger
├── articles/             # official-account / web article notes
│   └── <account>/
│       ├── 2026-10-17 Some title.md
│       └── assets/       # images that belong to that account's articles
├── attachments/          # chat images, files, videos, voice
└── outbox/               # write a file here to send it to yourself
```

### Receiving

Content sent to the bot lands in `WeLink/YYYY-MM-DD.md`: timestamped, marked received/sent, body in a quote block, media as `![[...]]`.

| You send | Result |
|---|---|
| Ordinary text | Appended to the daily conversation note |
| Plain text whose first line is `#单独保存` | Trigger stripped; saved under `WeLink/notes/`; daily note keeps a link |
| Image / video / file / voice | Decrypted into `WeLink/attachments/` and embedded in the daily note; voice is transcoded to playable WAV when possible |
| A message with http(s) links | Also fetched as article notes when possible |

Standalone notes apply only to plain text with no links and no attachments. Linked or attached messages keep the normal import path. The trigger must match the whole first line; you can change it in settings.

Article fetching is on by default. At most 5 links per message are processed. Official-account articles can be grouped into a folder per account (optional). Fetching uses a standalone HTTP request and does not reuse your browser login. Public articles usually come through; some pages return a verification screen, and the note may show “Allow / Scan with WeChat” instead of the article. Retry with the original link, or turn off **Fetch article info**.

**Always reply on receipt** is on by default: after a message is recorded, the bot sends a confirmation (for example, where an image or article was saved). Heavy traffic may hit the gateway rate limit; turn this off in settings if needed.

### Sending

This is a one-to-one channel to yourself: **no recipient is specified**. Every file goes to the WeChat account that scanned to bind. Do not call any HTTP API; the file channel is the whole interface.

Write **one file** into `WeLink/outbox/`:

| File in the outbox | Result |
|---|---|
| `notify.md` (any text) | Sent as a text message, Markdown supported; keep it to about one phone screen |
| Image `.jpg/.png/.gif/.webp`, video `.mp4`, document `.pdf/.docx/…` (≤100MB) | Sent as an attachment |

The plugin consumes the outbox on its next poll (about 30–60 seconds). Wait about a minute, then check:

- **File gone** = sent, and recorded in today’s conversation note (media keeps a copy under `attachments/` and is linked)
- **File still there** = failed: a `.md` gets a trailing `<!-- WeLink send failed: ... -->` comment; media gets a sibling `.welink-failed.md` with the reason

Unknown extensions stay in the outbox and are not sent.

### For Agents

Point the Agent at `WeLink/Agent.md` in the vault (use the path from settings). It explains which folder to write, how to judge success, where to read your reply, and the rate limit. The full protocol is in [Agent.md](Agent.md).

Use this channel for notifications (a job finished) and decisions (send a question with options, you reply in one line), not for chat. The gateway rate-limits proactive sends to a handful per day.

## Safety and privacy

- The plugin talks to the WeChat ilink gateway directly. Messages are stored only in this vault. There is no author server and no telemetry.
- Only the WeChat account that scanned to bind is accepted. Anyone else who learns the bot ID cannot write into your vault.
- Login state lives in `state.json` in the plugin folder (token, cursor, send credentials, and similar). Settings live in `data.json` in the same folder. Do not commit these files or share them.
- Network destinations:
  - `https://ilinkai.weixin.qq.com`: scan, long-poll receive, send (the gateway may also return a dedicated base URL)
  - `https://novac2c.cdn.weixin.qq.com/c2c`: images, videos, files, voice
  - Only when **Fetch article info** is on: the article URLs inside messages
- If you turn off **Auto-import messages**, the plugin still polls, but it does not write content into notes.

## FAQ

**If Obsidian is closed, do messages sent to the bot get lost?**
Not immediately. They are picked up the next time you open Obsidian and connect. How long the gateway keeps them is not documented; treat very old offline messages as best-effort.

**Why can’t I send right after scanning?**
Send any message to the bot from WeChat first. The settings error says you do not have a send credential yet.

**Does it work in Obsidian mobile?**
The plugin itself is desktop-only. It writes plain Markdown, so iCloud / Obsidian Sync / Git can let you read on a phone, but you cannot send or receive from mobile.

**Why didn’t a forwarded article or file arrive?**
Known ilink bot limitation: forwarded articles and files may not arrive. Send the original link, or send the file itself.

**Do voice messages include a transcript?**
If WeChat sends a transcript with the voice message, it is written into the daily note. The audio is also saved as playable WAV. If WeChat does not send text, this version does not send the audio to another recognition service.

**What if the session expires?**
The status bar shows **session expired**. In settings, click **Re-scan**, confirm, then send the bot a message from WeChat again so sending unlocks.

## Good to know

- **Rate limit:** Proactive sends are a notification/decision channel, not a chat tool. Receipt replies can also be rejected if there are too many.
- **One device:** Do not run the plugin on multiple computers for the same account at once. Concurrent long-polls compete for the message stream.
- **Desktop online:** Continuous receiving requires desktop Obsidian to stay open and connected.

## Contributing

Issues and PRs are welcome. Please include:

- Plugin version (currently `0.1.7`) and Obsidian version
- OS (macOS / Windows / Linux)
- Steps to reproduce, expected result, actual result
- For platform-specific issues: source content, target note, and import/paste result; redact account IDs and QR codes in screenshots

Development commands:

```bash
npm test    # build, then run unit tests
npm run lint
npm run build
```

## License

Author: [nextcacai](https://github.com/nextcacai), [MIT](LICENSE)
