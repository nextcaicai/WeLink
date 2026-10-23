/** Plugin settings: declarative definitions (1.13+) with an imperative login section */
import type { App } from 'obsidian';
import { Notice, normalizePath, PluginSettingTab, type Setting, type SettingDefinitionItem, type TextComponent } from 'obsidian';
import type WXLinkPlugin from './main';
import type { ConnState } from './main';
import { buildSendFailure, t } from './i18n';

export interface WXLinkSettings {
  language: 'system' | 'en' | 'zh' | 'tw'; // UI language; system follows Obsidian
  enabled: boolean; // auto-connect on startup
  inboxFolder: string;
  singleNoteFolder: string; // plain-text notes created via the standalone note trigger
  articleFolder: string;
  attachmentFolder: string;
  outboxFolder: string; // outbox folder (agents drop pending-send files here)
  deleteOutboxAfterSend: boolean; // remove originals only after the gateway confirms success
  singleNoteMarker: string; // first-line marker that saves a received text message as its own note
  fetchArticles: boolean; // fetch link metadata and create article notes
  groupArticlesByAccount: boolean; // one subfolder per official account under the article folder
  autoImport: boolean;
  notifyOnMessage: boolean;
  autoReply: boolean; // after recording an inbound message, send a confirmation reply back
}

export const DEFAULT_SETTINGS: WXLinkSettings = {
  language: 'system',
  enabled: true,
  inboxFolder: 'WXLink',
  singleNoteFolder: 'WXLink/notes',
  articleFolder: 'WXLink/articles',
  attachmentFolder: 'WXLink/attachments',
  outboxFolder: 'WXLink/outbox',
  deleteOutboxAfterSend: true,
  singleNoteMarker: '#单独保存',
  fetchArticles: true,
  groupArticlesByAccount: true,
  autoImport: true,
  notifyOnMessage: true,
  autoReply: true,
};

export const FOLDER_KEYS = ['inboxFolder', 'singleNoteFolder', 'articleFolder', 'attachmentFolder', 'outboxFolder'] as const satisfies readonly (keyof WXLinkSettings)[];

/** Pre-rename inbox root. Keep writing there when a vault already has that tree. */
export const LEGACY_INBOX_FOLDER = 'WeLink';

function remapDefaultRoot(value: string, from: string, to: string): string {
  if (value === from) return to;
  if (value.startsWith(`${from}/`)) return `${to}${value.slice(from.length)}`;
  return value;
}

/** If the vault still has WeLink/ and no WXLink/, keep the old folder tree instead of creating a parallel one. */
export function adoptLegacyFolderDefaults(
  settings: WXLinkSettings,
  hasLegacyInbox: boolean,
  hasDefaultInbox: boolean,
): WXLinkSettings {
  if (settings.inboxFolder !== DEFAULT_SETTINGS.inboxFolder) return settings;
  if (!hasLegacyInbox || hasDefaultInbox) return settings;
  const from = DEFAULT_SETTINGS.inboxFolder;
  const to = LEGACY_INBOX_FOLDER;
  return {
    ...settings,
    inboxFolder: remapDefaultRoot(settings.inboxFolder, from, to),
    singleNoteFolder: remapDefaultRoot(settings.singleNoteFolder, from, to),
    articleFolder: remapDefaultRoot(settings.articleFolder, from, to),
    attachmentFolder: remapDefaultRoot(settings.attachmentFolder, from, to),
    outboxFolder: remapDefaultRoot(settings.outboxFolder, from, to),
  };
}

/** A marker must be one visible line, so matching it at the start of a message stays predictable. */
export function isValidSingleNoteMarker(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/[\r\n]/.test(value);
}

export class WXLinkSettingTab extends PluginSettingTab {
  private botStatusEl: HTMLElement | null = null;

  constructor(
    app: App,
    private plugin: WXLinkPlugin,
  ) {
    super(app, plugin);
    this.plugin.onConnectionStateChange(() => this.updateBotStatus());
  }

  hide(): void {
    this.botStatusEl = null;
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  setControlValue(key: string, value: unknown): void {
    if ((FOLDER_KEYS as readonly string[]).includes(key) && typeof value === 'string') value = normalizePath(value);
    if (key === 'singleNoteMarker') {
      if (!isValidSingleNoteMarker(value)) {
        new Notice(t('set.singleNoteMarker.invalid'));
        return;
      }
      value = value.trim();
    }
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    if (key === 'language') {
      this.plugin.applyLanguage(value as WXLinkSettings['language']); // switch commands/status bar immediately
      this.update(); // re-render every label in the new language
    }
    if ((FOLDER_KEYS as readonly string[]).includes(key) || key === 'singleNoteMarker' || key === 'deleteOutboxAfterSend') this.plugin.refreshAgentGuide();
    void this.plugin.saveSettings();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: 'group',
        heading: t('set.group.connection'),
        cls: 'wxlink-settings-group',
        items: [
          {
            name: t('set.autoConnect'),
            desc: t('set.autoConnect.desc'),
            control: { type: 'toggle', key: 'enabled', defaultValue: DEFAULT_SETTINGS.enabled },
          },
          { name: t('set.wechatBot'), render: (setting) => this.renderBotSetting(setting) },
          {
            name: t('sendTest.name'),
            visible: () => Boolean(this.plugin.getState().token),
            render: (setting) => this.renderTestSetting(setting),
          },
        ],
      },
      {
        type: 'group',
        heading: t('set.group.messages'),
        cls: 'wxlink-settings-group',
        items: [
          {
            name: t('set.autoImport'),
            desc: t('set.autoImport.desc'),
            control: { type: 'toggle', key: 'autoImport', defaultValue: DEFAULT_SETTINGS.autoImport },
          },
          {
            name: t('set.singleNoteMarker'),
            desc: t('set.singleNoteMarker.desc'),
            control: { type: 'text', key: 'singleNoteMarker', defaultValue: DEFAULT_SETTINGS.singleNoteMarker },
          },
          {
            name: t('set.fetchArticles'),
            desc: t('set.fetchArticles.desc'),
            control: { type: 'toggle', key: 'fetchArticles', defaultValue: DEFAULT_SETTINGS.fetchArticles },
          },
          {
            name: t('set.groupByAccount'),
            desc: t('set.groupByAccount.desc'),
            control: {
              type: 'toggle',
              key: 'groupArticlesByAccount',
              defaultValue: DEFAULT_SETTINGS.groupArticlesByAccount,
            },
          },
          {
            name: t('set.notify'),
            control: { type: 'toggle', key: 'notifyOnMessage', defaultValue: DEFAULT_SETTINGS.notifyOnMessage },
          },
          {
            name: t('set.autoReply'),
            desc: t('set.autoReply.desc'),
            control: { type: 'toggle', key: 'autoReply', defaultValue: DEFAULT_SETTINGS.autoReply },
          },
        ],
      },
      {
        type: 'group',
        heading: t('set.group.files'),
        cls: 'wxlink-settings-group',
        items: [
          {
            name: t('set.inboxFolder'),
            desc: t('set.inboxFolder.desc'),
            control: { type: 'text', key: 'inboxFolder', defaultValue: DEFAULT_SETTINGS.inboxFolder },
          },
          {
            name: t('set.singleNoteFolder'),
            desc: t('set.singleNoteFolder.desc'),
            control: { type: 'text', key: 'singleNoteFolder', defaultValue: DEFAULT_SETTINGS.singleNoteFolder },
          },
          {
            name: t('set.articleFolder'),
            desc: t('set.articleFolder.desc'),
            control: { type: 'text', key: 'articleFolder', defaultValue: DEFAULT_SETTINGS.articleFolder },
          },
          {
            name: t('set.attachmentFolder'),
            desc: t('set.attachmentFolder.desc'),
            control: { type: 'text', key: 'attachmentFolder', defaultValue: DEFAULT_SETTINGS.attachmentFolder },
          },
          {
            name: t('set.outboxFolder'),
            desc: t('set.outboxFolder.desc'),
            control: { type: 'text', key: 'outboxFolder', defaultValue: DEFAULT_SETTINGS.outboxFolder },
          },
          {
            name: t('set.deleteOutboxAfterSend'),
            desc: t('set.deleteOutboxAfterSend.desc'),
            control: { type: 'toggle', key: 'deleteOutboxAfterSend', defaultValue: DEFAULT_SETTINGS.deleteOutboxAfterSend },
          },
          // Where agents learn the outbox protocol: a note file maintained inside the vault
          {
            name: t('set.agentGuide'),
            desc: t('set.agentGuide.desc', { path: `${this.plugin.settings.inboxFolder}/Agent.md` }),
          },
        ],
      },
      {
        type: 'group',
        heading: t('set.group.general'),
        cls: 'wxlink-settings-group',
        items: [
          {
            name: t('set.language'),
            desc: t('set.language.desc'),
            control: {
              type: 'dropdown',
              key: 'language',
              defaultValue: DEFAULT_SETTINGS.language,
              options: { system: t('set.language.system'), en: 'English', zh: '中文（简体）', tw: '中文（繁體）' },
            },
          },
          {
            name: t('set.about'),
            desc: t('set.footer'),
          },
        ],
      },
    ];
  }

  private renderBotSetting(setting: Setting): void {
    setting.setName(t('set.wechatBot')).setDesc(t('set.wechatBot.desc'));
    this.botStatusEl = setting.nameEl.createSpan({ cls: 'wxlink-bot-status' });
    this.botStatusEl.setAttribute('aria-live', 'polite');
    this.updateBotStatus();

    if (this.plugin.getState().token) {
      setting
        .addButton((button) => button.setButtonText(t('login.rescan')).onClick(() => this.openLoginModal()))
        .addButton((button) =>
          button.setButtonText(t('login.logout')).setDestructive().onClick(async () => {
            await this.plugin.logout();
            this.update();
          }),
        );
    } else {
      setting.addButton((button) => button.setButtonText(t('login.connect')).setCta().onClick(() => this.openLoginModal()));
    }
  }

  private updateBotStatus(): void {
    if (!this.botStatusEl) return;
    const state: ConnState | 'unbound' | 'bound' = !this.plugin.getState().token
      ? 'unbound'
      : this.plugin.getConnState() === 'disconnected'
        ? 'bound'
        : this.plugin.getConnState();
    const key = `botState.${state}`;
    this.botStatusEl.setText(t(key));
    this.botStatusEl.dataset.state = state;
  }

  private openLoginModal(): void {
    this.plugin.startLogin(() => this.update());
  }

  /** A separate peer setting row, shown after a successful QR binding. */
  private renderTestSetting(setting: Setting): void {
    let testInput: TextComponent | null = null;
    setting
      .setName(t('sendTest.name'))
      .setDesc(t('sendTest.desc'))
      .addText((txt) => {
        txt.setPlaceholder(t('sendTest.placeholder')).setValue('Hello from WXLink');
        txt.inputEl.addClass('wxlink-send-input');
        testInput = txt;
      })
      .addButton((button) => {
        button.setButtonText(t('sendTest.send')).setCta();
        button.onClick(async () => {
          const text = (testInput?.getValue() ?? '').trim();
          if (!text) {
            new Notice(t('sendTest.empty'));
            return;
          }
          button.setDisabled(true);
          try {
            const result = await this.plugin.sendTestMessage(text);
            if (result.ok) {
              new Notice(t('sendTest.ok'));
            } else {
              new Notice(t('sendTest.failed', { err: buildSendFailure(result.errmsg, result.ret, result.contextToken) }), 10000);
            }
          } catch (error) {
            new Notice(t('sendTest.failed', { err: String((error as Error)?.message ?? error) }), 10000);
          } finally {
            button.setDisabled(false);
          }
        });
      });
  }
}
