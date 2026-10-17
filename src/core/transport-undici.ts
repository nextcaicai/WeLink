/** Node's fetch stack for the WeChat gateway, including QR login and media. */
import { fetch } from 'undici';
import type { HttpResponse, HttpTransport } from './http';
import { HttpError, lowerHeaders } from './http';

export class UndiciTransport implements HttpTransport {
  get(url: string, headers: Record<string, string>, timeoutMs: number): Promise<HttpResponse> {
    return this.run('GET', url, headers, undefined, timeoutMs);
  }

  post(url: string, headers: Record<string, string>, body: string | ArrayBuffer, timeoutMs: number): Promise<HttpResponse> {
    return this.run('POST', url, headers, body, timeoutMs);
  }

  private async run(
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>,
    body: string | ArrayBuffer | undefined,
    timeoutMs: number,
  ): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        method,
        headers,
        body: body instanceof ArrayBuffer ? new Uint8Array(body) : body,
        signal: controller.signal,
      });
      return {
        status: resp.status,
        body: await resp.arrayBuffer(),
        headers: lowerHeaders(Object.fromEntries(resp.headers)),
      };
    } catch (e) {
      const timeout = controller.signal.aborted;
      throw new HttpError(timeout ? 'request timeout' : String((e as Error)?.message ?? e), 0, timeout);
    } finally {
      window.clearTimeout(timer);
    }
  }
}
