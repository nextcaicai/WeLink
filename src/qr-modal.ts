/** Scan-login modal: renders the QR code and polls scan status (the flow reuses loginLoop from core/qrlogin) */
import { App, Modal } from 'obsidian';
import type { HttpTransport } from './core/http';
import { loginLoop, type LoginOutcome } from './core/qrlogin';
import { encodeQr } from './core/qrcode';
import { t } from './i18n';

export class QrLoginModal extends Modal {
  private cancelled = false;
  private attemptCancelled = false;
  private qrEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private retryEl: HTMLButtonElement | null = null;

  constructor(
    app: App,
    private transport: HttpTransport,
    private baseUrl: string,
    private onDone: (out: LoginOutcome) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass('welink-qr-modal');
    contentEl.empty();
    contentEl.createEl('h3', { text: t('modal.title'), cls: 'welink-qr-title' });
    this.qrEl = contentEl.createDiv({ cls: 'welink-qr welink-qr-center' });
    contentEl.createEl('p', { text: t('modal.hint'), cls: 'welink-qr-hint' });
    this.statusEl = contentEl.createEl('p', { text: t('login.fetching'), cls: 'welink-qr-status' });
    this.statusEl.setAttribute('aria-live', 'polite');
    const actions = contentEl.createDiv({ cls: 'welink-qr-actions' });
    this.retryEl = actions.createEl('button', { text: t('login.retry') });
    this.retryEl.hidden = true;
    this.retryEl.addEventListener('click', () => this.startLogin());
    const cancel = actions.createEl('button', { text: t('modal.cancel') });
    cancel.addEventListener('click', () => this.close());

    this.startLogin();
  }

  private startLogin(): void {
    if (this.cancelled) return;
    this.attemptCancelled = false;
    this.qrEl?.empty();
    this.setStatus(t('login.fetching'));
    if (this.retryEl) this.retryEl.hidden = true;
    void loginLoop(this.transport, this.baseUrl, {
      onQr: (url) => {
        if (this.cancelled) return;
        this.attemptCancelled = !this.renderQr(url);
        this.setStatus(this.attemptCancelled ? t('login.renderFailed') : '');
      },
      onScanned: () => this.setStatus(t('login.scanned')),
      onError: (msg) => this.setStatus(msg),
      cancelled: () => this.cancelled || this.attemptCancelled,
    })
      .then((out) => {
        if (this.cancelled) return;
        if (!out) {
          this.qrEl?.empty();
          if (this.retryEl) this.retryEl.hidden = false;
          return;
        }
        this.setStatus(t('login.success'));
        this.close();
        this.onDone(out);
      })
      .catch((e: unknown) => {
        if (this.cancelled) return;
        this.qrEl?.empty();
        this.setStatus(String((e as Error)?.message ?? e));
        if (this.retryEl) this.retryEl.hidden = false;
      });
  }

  private renderQr(url: string): boolean {
    if (!this.qrEl) return false;
    this.qrEl.empty();
    try {
      const qr = encodeQr(url);
      const cell = 3;
      const quiet = 4;
      const n = qr.size + quiet * 2;
      const canvas = this.qrEl.createEl('canvas', { cls: 'welink-qr-canvas' });
      canvas.width = n * cell;
      canvas.height = n * cell;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is unavailable');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000000';
      for (let r = 0; r < qr.size; r++) {
        for (let c = 0; c < qr.size; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
          }
        }
      }
      return true;
    } catch (e) {
      this.qrEl.empty();
      this.setStatus(t('modal.renderFailed', { err: String((e as Error)?.message ?? e) }));
      return false;
    }
  }

  private setStatus(text: string): void {
    if (!this.statusEl) return;
    this.statusEl.setText(text);
    this.statusEl.hidden = !text;
  }

  onClose(): void {
    this.cancelled = true;
    this.attemptCancelled = true;
    this.contentEl.empty();
  }
}
