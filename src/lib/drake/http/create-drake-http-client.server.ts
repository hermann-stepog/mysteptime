import "@tanstack/react-start/server-only";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { env } from "../config.server";
import type { DrakeAuthenticatedSession } from "../auth/authenticated-session.server";
import type { StorageState } from "../auth/types";
import { DrakeCookieJar } from "./drake-cookie-jar.server";
import type {
  DrakeHttpClient,
  DrakeHttpHeaders,
  DrakeHttpRequestOptions,
  DrakeHttpResponse,
} from "./drake-http-client.types.server";

function resolveUrl(baseURL: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = baseURL.replace(/\/$/, "");
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${base}${path}`;
}

function headersToRecord(headers: Headers): DrakeHttpHeaders {
  const out: DrakeHttpHeaders = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function createDrakeDispatcher(): Dispatcher {
  // pipelining:0 é obrigatório: long polling do SignalR + POST de handshake concorrentes
  // quebram com pipeline HTTP/1.1 (poll fica 204/404 e o handshake não completa).
  return new Agent({
    connect: env.DRAKE_IGNORE_HTTPS_ERRORS
      ? { rejectUnauthorized: false }
      : undefined,
    connections: 16,
    pipelining: 0,
  });
}

function readSetCookieHeaders(response: Response): string[] {
  const withGet = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGet.getSetCookie === "function") {
    return withGet.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

class FetchDrakeHttpResponse implements DrakeHttpResponse {
  constructor(
    private readonly response: Response,
    private readonly finalUrl: string,
    private readonly bodyBuffer: Buffer,
  ) {}

  status(): number {
    return this.response.status;
  }

  statusText(): string {
    return this.response.statusText;
  }

  headers(): DrakeHttpHeaders {
    return headersToRecord(this.response.headers);
  }

  url(): string {
    return this.finalUrl;
  }

  async text(): Promise<string> {
    return this.bodyBuffer.toString("utf8");
  }

  async json(): Promise<unknown> {
    const text = this.bodyBuffer.toString("utf8");
    if (!text.trim()) return null;
    return JSON.parse(text) as unknown;
  }

  async body(): Promise<Buffer> {
    return this.bodyBuffer;
  }
}

function createClient(
  jar: DrakeCookieJar,
  requiredHeaders: Record<string, string>,
): DrakeHttpClient {
  const baseURL = env.DRAKE_BASE_URL;
  const dispatcher = createDrakeDispatcher();
  const defaultHeaders: DrakeHttpHeaders = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "pt-BR",
    "User-Agent": env.DRAKE_USER_AGENT,
    ...requiredHeaders,
  };

  async function send(
    method: string,
    url: string,
    options: DrakeHttpRequestOptions = {},
  ): Promise<DrakeHttpResponse> {
    const absoluteBase = resolveUrl(baseURL, url);
    let absolute = absoluteBase;
    if (options.params && Object.keys(options.params).length > 0) {
      const u = new URL(absoluteBase);
      for (const [key, value] of Object.entries(options.params)) {
        if (value == null) continue;
        u.searchParams.set(key, String(value));
      }
      absolute = u.toString();
    }
    const timeoutMs = options.timeout ?? env.DRAKE_TIMEOUT_MS;
    const maxRedirects = options.maxRedirects ?? 10;
    const headers: DrakeHttpHeaders = { ...defaultHeaders, ...(options.headers ?? {}) };
    const cookie = jar.cookieHeaderFor(absolute);
    if (cookie) headers.cookie = cookie;

    let body: string | undefined;
    if (options.data !== undefined && options.data !== null) {
      if (typeof options.data === "string") {
        // Não inventar Content-Type: SignalR envia text/plain no handshake.
        body = options.data;
      } else {
        body = JSON.stringify(options.data);
        if (!headers["content-type"] && !headers["Content-Type"]) {
          headers["content-type"] = "application/json";
        }
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let currentUrl = absolute;
      let response: Response | null = null;
      let redirects = 0;
      let currentMethod = method;
      let currentBody = body;

      while (true) {
        const init = {
          method: currentMethod,
          headers,
          body: currentMethod === "GET" || currentMethod === "HEAD" ? undefined : currentBody,
          redirect: "manual" as const,
          signal: controller.signal,
          dispatcher,
        };

        response = (await undiciFetch(currentUrl, init)) as unknown as Response;

        const status = response.status;
        const location = response.headers.get("location");
        if (status >= 300 && status < 400 && location && redirects < maxRedirects) {
          const next = new URL(location, currentUrl).toString();
          jar.absorbSetCookieHeaders(readSetCookieHeaders(response), currentUrl);
          const nextCookie = jar.cookieHeaderFor(next);
          if (nextCookie) headers.cookie = nextCookie;
          else delete headers.cookie;
          if (status === 303 || status === 302 || status === 301) {
            currentMethod = "GET";
            currentBody = undefined;
            delete headers["content-type"];
            delete headers["Content-Type"];
          }
          currentUrl = next;
          redirects += 1;
          continue;
        }
        break;
      }

      if (!response) {
        throw new Error("Resposta HTTP vazia.");
      }

      jar.absorbSetCookieHeaders(readSetCookieHeaders(response), currentUrl);

      const arrayBuf = await response.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      return new FetchDrakeHttpResponse(response, currentUrl, buf);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get: (url, options) => send("GET", url, options),
    post: (url, options) => send("POST", url, { ...options, method: "POST" }),
    fetch: (url, options) =>
      send((options?.method ?? "GET").toUpperCase(), url, options),
    dispose: async () => {
      /* nothing persistent */
    },
  };
}

/**
 * Cliente HTTP a partir da sessão autenticada (cookies + headers comprovados).
 * Não importa Playwright.
 */
export function createDrakeHttpClientFromAuthenticatedSession(
  session: DrakeAuthenticatedSession,
): DrakeHttpClient {
  return createClient(session.cookieJar, session.requiredHeaders);
}

/**
 * Cliente HTTP baseado em storageState (cookies apenas).
 * Preferir createDrakeHttpClientFromAuthenticatedSession após login validado.
 */
export function createDrakeHttpClientFromStorageState(
  storageState: StorageState,
): DrakeHttpClient {
  const jar = DrakeCookieJar.fromStorageState(storageState);
  return createClient(jar, {});
}
