/** WXLink main plugin: WeChat message bridge */
import { normalizePath, Notice, Plugin, TFile } from 'obsidian';
import { IlinkClient, type PollResult, sleep } from './core/ilink';
import type { InboundMessage } from './core/types';
import { UndiciTransport } from './core/transport-undici';
import { NodeTransport } from './core/transport-node';
import { StateStore, type BotState } from './core/store';
import { appendOutbound, ensureFolder, importMessage, quoteBlock, timeOfDay, type ImportResult } from './core/importer';
import { ensureAgentGuide } from './core/agent-guide';
import type { LoginOutcome } from './core/qrlogin';
import { adoptLegacyFolderDefaults, DEFAULT_SETTINGS, FOLDER_KEYS, LEGACY_INBOX_FOLDER, WXLinkSettings, WXLinkSettingTab } from './settings';
import { QrLoginModal } from './qr-modal';
import { Outbox } from './outbox';
import { CDN_BASE, ILINK_DEFAULT_BASE } from './core/constants';
import { applyLanguage, buildReceiptReplies, buildSendFailure, resolvedLanguage, t, type ReceiptReplyInput, type UiLanguage } from './i18n';

/** typing tickets stay valid ~24h (the official SDK caches them a day); refetch after that */
const TICKET_TTL_MS = 24 * 3600_000;

export type ConnState = 'disconnected' | 'connecting' | 'connected' | 'expired' | 'error';

export default class WXLinkPlugin extends Plugin {
  settings: WXLinkSettings = DEFAULT_SETTINGS;
  store!: StateStore;
  private client: IlinkClient | null = null;
  /** The gateway accepts undici's fetch stack; Node's http/https stack gets 412.
   * CDN downloads use NodeTransport: the live voice CDN response hangs in
   * undici but completes through Node's https stack. */
  private transport = new UndiciTransport();
  private articleTransport = new NodeTransport();
  private polling = false;
  private stopRequested = false;
  private pollGeneration = 0;
  private connState: ConnState = 'disconnected';
  private connectionListeners = new Set<() => void>();
  private statusBar: HTMLElement | null = null;
  private outbox: Outbox | null = null;
  /** command id -> i18n key, so names can be re-rendered when the language changes */
  private commandNameKeys: Record<string, string> = {};

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.adoptLegacyFolders();
    applyLanguage(this.settings.language); // respect the saved choice; 'system' follows Obsidian
    // State lives inside the plugin's own folder: that directory always exists
    // once the plugin is installed, so the write can never fail on a missing parent
    const stateDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    this.store = new StateStore(this.app, `${stateDir}/state.json`);
    await this.store.init();
    this.outbox = new Outbox(this.app);
    await this.ensureFolders();

    this.statusBar = this.addStatusBarItem();
    this.renderStatus();

    const cmds: Array<[string, string, () => void]> = [
      ['wxlink-connect', 'cmd.connect', () => void this.connect()],
      ['wxlink-disconnect', 'cmd.disconnect', () => this.disconnect()],
      ['wxlink-login', 'cmd.login', () => this.startLogin()],
      ['wxlink-open-inbox', 'cmd.inbox', () => void this.openTodayInbox()],
    ];
    for (const [id, key, callback] of cmds) {
      this.commandNameKeys[id] = key;
      this.addCommand({ id, name: t(key), callback });
    }

    this.addSettingTab(new WXLinkSettingTab(this.app, this));

    // Auto-connect once the vault is ready
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.enabled && this.store.get().token) {
        void this.startPollLoop();
      } else if (this.settings.enabled) {
        this.setConn('disconnected');
        new Notice(t('notice.notLoggedIn', { cmd: t('cmd.login') }));
      }
    });
  }

  onunload(): void {
    this.disconnect();
    this.transport.shutdown();
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Record<string, unknown> | null;
    if (raw && typeof raw === 'object') {
      delete raw.allowFrom; // legacy field: whitelist removed, only the scanning user is accepted
      delete raw.sentFolder; // legacy field: sent copies now live in the daily conversation note
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
    // user-typed folder paths: scrub them once on load (normalizePath)
    for (const key of FOLDER_KEYS) {
      this.settings[key] = normalizePath(this.settings[key]);
    }
    // legacy installs inferred standalone notes under <inbox>/notes before this setting existed
    if (raw && !('singleNoteFolder' in raw)) {
      this.settings.singleNoteFolder = normalizePath(`${this.settings.inboxFolder}/notes`);
    }
    if (typeof this.settings.singleNoteMarker !== 'string' || !this.settings.singleNoteMarker.trim() || /[\r\n]/.test(this.settings.singleNoteMarker)) {
      this.settings.singleNoteMarker = DEFAULT_SETTINGS.singleNoteMarker;
    } else {
      this.settings.singleNoteMarker = this.settings.singleNoteMarker.trim();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** First launch after the rename: reuse an existing WeLink/ tree instead of creating WXLink/. */
  private async adoptLegacyFolders(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const next = adoptLegacyFolderDefaults(
      this.settings,
      await adapter.exists(LEGACY_INBOX_FOLDER),
      await adapter.exists(DEFAULT_SETTINGS.inboxFolder),
    );
    if (next === this.settings) return;
    this.settings = next;
    await this.saveSettings();
  }

  /** Switch the UI language at runtime (commands, status bar; the settings page re-renders itself) */
  applyLanguage(lang: UiLanguage): void {
    applyLanguage(lang);
    // app.commands exists at runtime but is not part of the public type definitions
    const registry = (this.app as unknown as { commands?: { findCommand(id: string): { name: string } | null } }).commands;
    for (const [id, key] of Object.entries(this.commandNameKeys)) {
      const cmd = registry?.findCommand(id);
      if (cmd) cmd.name = t(key);
    }
    this.renderStatus();
    void ensureAgentGuide(this.app, this.settings, resolvedLanguage());
  }

  /** Create the whole Wechat directory tree + Agent.md once the plugin is enabled */
  private async ensureFolders(): Promise<void> {
    const s = this.settings;
    for (const folder of [s.inboxFolder, s.singleNoteFolder, s.articleFolder, s.attachmentFolder, s.outboxFolder]) {
      try {
        await ensureFolder(this.app, folder);
      } catch {
        /* a missing folder is only a problem when a message actually needs it */
      }
    }
    await ensureAgentGuide(this.app, s, resolvedLanguage());
  }

  /** Directory settings changed: re-sync Agent.md with the new paths */
  refreshAgentGuide(): void {
    void ensureAgentGuide(this.app, this.settings, resolvedLanguage());
  }

  /** Status-bar rendering */
  private renderStatus(): void {
    if (!this.statusBar) return;
    const map: Record<ConnState, string> = {
      disconnected: t('status.disconnected'),
      connecting: t('status.connecting'),
      connected: t('status.connected'),
      expired: t('status.expired'),
      error: t('status.error'),
    };
    this.statusBar.setText(`WXLink ${map[this.connState]}`);
    this.statusBar.setAttribute('aria-label', this.store.get().lastError || '');
  }

  private setConn(s: ConnState): void {
    const changed = this.connState !== s;
    this.connState = s;
    this.renderStatus();
    if (changed) {
      for (const listener of this.connectionListeners) listener();
    }
  }

  /** Keep the settings status in sync with the polling state. */
  onConnectionStateChange(listener: () => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  /** Current connection state */
  getConnState(): ConnState {
    return this.connState;
  }

  /** Login state and binding info (shown on the settings page) */
  getState(): BotState {
    return this.store.get();
  }

  /** Whether polling is active */
  isPolling(): boolean {
    return this.polling;
  }

  /** HTTP transport layer (used for scanning in the settings page) */
  getTransport(): UndiciTransport {
    return this.transport;
  }

  /** ilink gateway address (scan-login always uses the default gateway) */
  getApiBase(): string {
    return ILINK_DEFAULT_BASE;
  }

  /** Persist the scan-login result and start polling */
  applyLogin(out: LoginOutcome): void {
    // Re-scanning can replace an active token. Retire its poll loop before
    // creating a client with the new credentials.
    if (this.polling) this.disconnect();
    this.store.update((st) => {
      st.token = out.token;
      st.botId = out.botId;
      st.baseUrl = out.baseUrl;
      st.scannedUser = out.scannedUser;
      st.cursor = '';
      st.contextTokens = {};
      st.pausedUntil = 0;
    });
    void this.store.saveNow();
    void this.startPollLoop();
  }

  /** Clear login credentials (re-scan required) */
  clearCredentials(): void {
    this.store.update((st) => {
      st.token = '';
      st.botId = '';
      st.baseUrl = '';
      st.scannedUser = '';
      st.cursor = '';
      st.contextTokens = {};
      st.pausedUntil = 0;
    });
    void this.store.saveNow();
    this.setConn('disconnected');
  }

  /** Start scan-login (for the command palette) */
  startLogin(onDone?: () => void): void {
    new QrLoginModal(this.app, this.transport, ILINK_DEFAULT_BASE, (out) => {
      this.applyLogin(out);
      new Notice(t('notice.loggedIn'));
      onDone?.();
    }).open();
  }

  /** Disconnect and clear login credentials */
  async logout(): Promise<void> {
    this.disconnect();
    this.clearCredentials();
    new Notice(t('notice.loggedOut'));
  }

  /** Connect directly with the stored token */
  async connect(): Promise<void> {
    const st = this.store.get();
    if (!st.token) {
      this.startLogin();
      return;
    }
    if (!this.polling) await this.startPollLoop();
  }

  disconnect(): void {
    // best-effort: don't leave the "typing" indicator lit after disconnect
    this.stopAllTyping().catch(() => {});
    this.stopRequested = true;
    this.pollGeneration++;
    this.polling = false;
    this.client = null;
    this.setConn('disconnected');
  }

  /** Send a test message to the bound account (one-to-one; used by the settings page) */
  async sendTestMessage(text: string): Promise<{ ok: boolean; errmsg: string; ret: number; contextToken: string }> {
    const st = this.store.get();
    const to = st.scannedUser.trim();
    if (!to || !st.token.trim()) return { ok: false, errmsg: t('sendTest.notBound'), ret: 0, contextToken: '' };
    const client = this.client ?? this.makeClient();
    const contextToken = st.contextTokens[to] ?? '';
    const res = await client.sendText(to, text, contextToken);
    if (res.ok) {
      const now = Date.now();
      await appendOutbound(this.app, this.settings.inboxFolder, now, to, [
        `**${timeOfDay(now)}** · ${t('importer.sent')}`,
        '',
        ...quoteBlock(text),
      ]);
    }
    return { ok: res.ok, errmsg: res.errmsg.trim() || res.raw || '', ret: res.ret, contextToken };
  }

  private makeClient(): IlinkClient {
    const st = this.store.get();
    return new IlinkClient(
      this.transport,
      {
        baseUrl: st.baseUrl || ILINK_DEFAULT_BASE,
        cdnBase: CDN_BASE,
      },
      st.token,
      this.articleTransport,
    );
  }

  /** Main long-poll loop */
  private async startPollLoop(): Promise<void> {
    if (this.polling) return;
    const generation = ++this.pollGeneration;
    this.polling = true;
    this.stopRequested = false;
    this.client = this.makeClient();
    this.setConn('connecting');

    let backoff = 1000;
    // consecutive 412 cursor resets: the wait doubles per streak (2s -> 4s -> ...)
    // so a persistent 412 stays polite instead of knocking every 2 seconds
    let resetStreak = 0;
    // user we currently show "typing" for; cleared once the round finishes processing
    let typingFor = '';
    while (this.polling && !this.stopRequested && generation === this.pollGeneration) {
      const store = this.store;
      if (!store) break;
      const st = store.get();

      if (st.pausedUntil > Date.now()) {
        this.setConn('expired');
        await sleep(5000);
        continue;
      }

      const result: PollResult = await this.client.poll(st.cursor);
      if (generation !== this.pollGeneration || this.stopRequested) break;

      if (result.sessionExpired) {
        // state changes once, on the transition: without the guard every
        // poll until the pause kicks in would bump pausedUntil and rewrite
        // state.json pointlessly
        store.update((s) => {
          if (s.pausedUntil <= Date.now()) {
            s.pausedUntil = Date.now() + 3600_000;
            s.lastError = t('error.sessionExpired');
          }
        });
        this.setConn('expired');
        new Notice(t('notice.sessionExpired'));
        await sleep(30_000);
        continue;
      }

      if (result.resetCursor) {
        // gateway rejected the stored cursor (412) but the session itself is
        // fine: resume with an empty cursor — no user action needed
        resetStreak++;
        store.update((s) => {
          s.cursor = '';
          s.lastError = '';
        });
        this.setConn('connecting');
        await sleep(Math.min(2000 * 2 ** (resetStreak - 1), 30_000));
        continue;
      }

      if (result.error) {
        store.update((s) => {
          s.lastError = result.error ?? '';
        });
        this.setConn('error');
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30_000);
        continue;
      }

      backoff = 1000;
      resetStreak = 0;
      this.setConn('connected');
      // idle rounds change nothing: update() only when a value actually
      // differs, otherwise every poll rewrites state.json and iCloud forks a
      // conflict copy per round on the second device
      store.update((s) => {
        if (s.lastError !== '') s.lastError = '';
      });

      if (result.cursor && result.cursor !== st.cursor) {
        store.update((s) => {
          s.cursor = result.cursor ?? '';
        });
      }

      const receipts: ReceiptReplyInput[] = [];
      for (const msg of result.messages) {
        if (generation !== this.pollGeneration || this.stopRequested) break;
        receipts.push(...(await this.handleInbound(msg)));
        typingFor = msg.from; // showTyping fired in handleInbound; remember who
      }
      if (generation !== this.pollGeneration || this.stopRequested) break;
      // processing finished: hide "typing" before any outbound send (even when
      // no receipt goes out), best-effort
      if (typingFor) {
        const tFor = typingFor;
        typingFor = '';
        await this.stopTypingFor(tFor);
      }
      if (generation !== this.pollGeneration || this.stopRequested) break;
      // one batched receipt reply per polling round, not one per message
      if (receipts.length) {
        await this.sendReceiptReplies(receipts);
      }
      if (generation !== this.pollGeneration || this.stopRequested) break;

      // Consume the outbox (pending-send files written by agents)
      try {
        await this.outbox?.flush(
          this.client,
          store,
          this.settings.outboxFolder,
          this.settings.inboxFolder,
          this.settings.attachmentFolder,
        );
      } catch {
        /* send failures must not block polling */
      }

      void store.saveNow();
    }
    if (generation === this.pollGeneration) this.polling = false;
  }

  /** Handle a single inbound message; returns a receipt entry when one should be sent */
  private async handleInbound(msg: InboundMessage): Promise<ReceiptReplyInput[]> {
    const store = this.store;
    if (!store) return [];

    // Only accept messages from the account that scanned to bind the bot.
    // Without this, anyone who discovers the bot ID could write into the vault.
    const scanned = store.get().scannedUser.trim();
    if (scanned && msg.from !== scanned) return [];

    // dedup
    const key = `${msg.from}|${msg.messageId}|${msg.timeMs}`;
    if (store.seen(key)) return [];

    // cache the context_token (credential for replying)
    const tok = (msg.raw.context_token ?? '').trim();
    if (tok) {
      store.update((s) => {
        s.contextTokens[msg.from] = tok;
      });
    }

    if (this.settings.notifyOnMessage) {
      const preview = msg.text.slice(0, 40) || `[${t('notice.attachments', { n: msg.attachments.length })}]`;
      // the bot account ID is noise; a single sender is bound to this bot anyway
      new Notice(`${t('notice.prefix')}: ${preview}`);
    }

    // immediate feedback while the message is processed (import + receipt).
    // Awaited on purpose: the loop cancels typing once handleInbound returns,
    // so the indicator must be confirmed lit (or failed) before that point —
    // a fire-and-forget here raced the cancel and left typing stuck on.
    await this.showTyping(msg.from, tok);

    if (this.settings.autoImport) {
      let result: ImportResult | null = null;
      try {
        result = await importMessage(this.app, this.articleTransport, msg, {
          inboxFolder: this.settings.inboxFolder,
          attachmentFolder: this.settings.attachmentFolder,
          articleFolder: this.settings.articleFolder,
          singleNoteFolder: this.settings.singleNoteFolder,
          singleNoteMarker: this.settings.singleNoteMarker,
          fetchArticles: this.settings.fetchArticles,
          groupArticlesByAccount: this.settings.groupArticlesByAccount,
        });
      } catch (e) {
        new Notice(t('notice.importFailed', { err: String((e as Error)?.message ?? e) }));
      }
      if (this.settings.autoReply) {
        return [
          result
            ? {
                ok: result.appended,
                appended: result.appended,
                dailyNote: result.dailyNote,
                attachments: result.attachments,
                attachmentFailures: result.attachmentFailures,
                linkCount: result.linkCount,
                articleAssets: result.articleAssets,
                singleNote: result.singleNote,
                articleFailures: result.articleFailures,
              }
            : { ok: false, appended: false, dailyNote: '', attachments: [], attachmentFailures: [], linkCount: 0, articleAssets: [], articleFailures: [] },
        ];
      }
    }
    return [];
  }

  /**
   * One batched confirmation reply per polling round: a "received and saved"
   * line per recorded message, with failure reasons attached. Failures never
   * break the receive flow.
   */
  private async sendReceiptReplies(receipts: ReceiptReplyInput[]): Promise<void> {
    try {
      if (!receipts.length) return; // nothing recorded this round -> no receipt
      const to = this.store.get().scannedUser.trim();
      if (!to) return;
      const client = this.client ?? this.makeClient();
      const contextToken = this.store.get().contextTokens[to] ?? '';
      const lines = buildReceiptReplies(receipts);
      if (!lines.length) return;

      const res = await client.sendText(to, lines.join('\n'), contextToken);
      if (res.ok) {
        await appendOutbound(this.app, this.settings.inboxFolder, Date.now(), to, [
          `**${timeOfDay(Date.now())}** · ${t('importer.sent')}`,
          '',
          ...quoteBlock(lines.join('\n')),
        ]);
      } else if (this.settings.notifyOnMessage) {
        // surface a categorized reason + fix hint, not a silent failure
        new Notice(t('sendTest.failed', { err: buildSendFailure(res.errmsg, res.ret, contextToken) }), 10000);
      }
    } catch {
      /* receipt replies are best-effort: a failure must not disturb receiving */
    }
  }

  /* ------------------------------------------------------------- typing */

  /** Show the "typing" indicator while a message is being processed.
   * Fully best-effort: any failure (missing ticket, network error) is swallowed. */
  private async showTyping(userId: string, contextToken: string): Promise<void> {
    try {
      const client = this.client ?? this.makeClient();
      const cached = this.store.get().typingTickets[userId];
      let ticket = cached && Date.now() - cached.at < TICKET_TTL_MS ? cached.ticket : '';
      if (!ticket) {
        const cfg = await client.getConfig(userId, contextToken);
        if (!cfg.typingTicket) return;
        ticket = cfg.typingTicket;
        this.store.update((s) => {
          s.typingTickets[userId] = { ticket, at: Date.now() };
        });
      }
      if (!(await client.sendTyping(userId, ticket, true))) {
        // stale/invalid ticket: refetch once and retry
        this.store.update((s) => {
          delete s.typingTickets[userId];
        });
        const cfg = await client.getConfig(userId, contextToken);
        if (!cfg.typingTicket) return;
        this.store.update((s) => {
          s.typingTickets[userId] = { ticket: cfg.typingTicket, at: Date.now() };
        });
        await client.sendTyping(userId, cfg.typingTicket, true);
      }
    } catch {
      /* typing is cosmetic; never disturb the receive flow */
    }
  }

  /** Cancel the "typing" indicator for one user (best-effort) */
  private async stopTypingFor(userId: string): Promise<void> {
    try {
      const cached = this.store.get().typingTickets[userId];
      if (!cached) return;
      const client = this.client ?? this.makeClient();
      await client.sendTyping(userId, cached.ticket, false);
    } catch {
      /* best-effort */
    }
  }

  /** Cancel typing for all cached tickets (used on disconnect; best-effort) */
  private async stopAllTyping(): Promise<void> {
    try {
      const st = this.store.get();
      const users = Object.keys(st.typingTickets);
      if (!users.length) return;
      const client = this.client ?? this.makeClient();
      await Promise.all(users.map((u) => client.sendTyping(u, st.typingTickets[u].ticket, false)));
    } catch {
      /* best-effort */
    }
  }

  private async openTodayInbox(): Promise<void> {
    const d = new Date();
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const path = `${this.settings.inboxFolder}/${today}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf().openFile(file);
    } else {
      new Notice(t('notice.noMsgToday', { path }));
    }
  }
}
