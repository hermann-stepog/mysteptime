import "@tanstack/react-start/server-only";

/**
 * Cliente HTTP server-side do Drake (substitui Playwright APIRequestContext).
 * Sem dependência de playwright / playwright-core / chromium-bidi.
 */

export type DrakeHttpHeaders = Record<string, string>;

export interface DrakeHttpResponse {
  status(): number;
  statusText(): string;
  headers(): DrakeHttpHeaders;
  url(): string;
  text(): Promise<string>;
  json(): Promise<unknown>;
  body(): Promise<Buffer>;
}

export type DrakeHttpRequestOptions = {
  failOnStatusCode?: boolean;
  timeout?: number;
  maxRedirects?: number;
  headers?: DrakeHttpHeaders;
  data?: unknown;
  method?: string;
  /** Query string params (compatível com o antigo APIRequestContext.get). */
  params?: Record<string, string | number | boolean | undefined | null>;
};

export interface DrakeHttpClient {
  get(url: string, options?: DrakeHttpRequestOptions): Promise<DrakeHttpResponse>;
  post(url: string, options?: DrakeHttpRequestOptions): Promise<DrakeHttpResponse>;
  fetch(url: string, options?: DrakeHttpRequestOptions): Promise<DrakeHttpResponse>;
  dispose(): Promise<void>;
}
