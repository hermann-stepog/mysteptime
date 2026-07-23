import "@tanstack/react-start/server-only";
import type { StorageState } from "../auth/types";

export type CookieRecord = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None" | string;
};

function asCookie(raw: Record<string, unknown>): CookieRecord | null {
  const name = typeof raw.name === "string" ? raw.name : "";
  const value = typeof raw.value === "string" ? raw.value : "";
  if (!name) return null;
  return {
    name,
    value,
    domain: typeof raw.domain === "string" ? raw.domain : undefined,
    path: typeof raw.path === "string" ? raw.path : "/",
    expires: typeof raw.expires === "number" ? raw.expires : undefined,
    httpOnly: Boolean(raw.httpOnly),
    secure: Boolean(raw.secure),
    sameSite: typeof raw.sameSite === "string" ? raw.sameSite : undefined,
  };
}

export function domainMatches(cookieDomain: string | undefined, host: string): boolean {
  if (!cookieDomain) return true;
  const d = cookieDomain.replace(/^\./, "").toLowerCase();
  const h = host.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/** RFC 6265 path-match (sem match falso em prefixos como /api vs /apiother). */
export function pathMatches(cookiePath: string | undefined, pathname: string): boolean {
  const p = cookiePath || "/";
  if (p === "/") return true;
  if (pathname === p) return true;
  const prefix = p.endsWith("/") ? p : `${p}/`;
  return pathname.startsWith(prefix);
}

/**
 * Parser de um único header Set-Cookie (sem split por vírgula no valor Expires).
 */
export function parseSingleSetCookie(
  raw: string,
  fallbackHost: string,
): CookieRecord | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Segmentos separados por ';' — Expires fica em um único atributo (vírgulas internas preservadas).
  const segments = splitSetCookieSegments(trimmed);
  if (segments.length === 0) return null;

  const [nameValue, ...attrs] = segments;
  const eq = nameValue!.indexOf("=");
  if (eq <= 0) return null;
  const name = nameValue!.slice(0, eq).trim();
  const value = nameValue!.slice(eq + 1).trim();
  if (!name) return null;

  const record: CookieRecord = {
    name,
    value,
    path: "/",
    domain: fallbackHost || undefined,
  };

  for (const attr of attrs) {
    const aEq = attr.indexOf("=");
    const key = (aEq >= 0 ? attr.slice(0, aEq) : attr).trim().toLowerCase();
    const val = aEq >= 0 ? attr.slice(aEq + 1).trim() : "";
    if (key === "domain" && val) record.domain = val;
    else if (key === "path" && val) record.path = val;
    else if (key === "secure") record.secure = true;
    else if (key === "httponly") record.httpOnly = true;
    else if (key === "samesite" && val) record.sameSite = val;
    else if (key === "max-age" && val) {
      const n = Number(val);
      if (Number.isFinite(n)) record.expires = Date.now() / 1000 + n;
    } else if (key === "expires" && val) {
      const ms = Date.parse(val);
      if (Number.isFinite(ms)) record.expires = ms / 1000;
    }
  }

  return record;
}

/**
 * Divide um Set-Cookie em name=value + atributos, preservando vírgulas em Expires.
 */
function splitSetCookieSegments(raw: string): string[] {
  const segments: string[] = [];
  let current = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === ";") {
      segments.push(current.trim());
      current = "";
      i += 1;
      while (i < raw.length && raw[i] === " ") i += 1;
      continue;
    }
    current += raw[i];
    i += 1;
  }
  if (current.trim()) segments.push(current.trim());
  return segments.filter(Boolean);
}

/**
 * Cookie jar em memória a partir do storageState / cookies do BrowserContext.
 * Nunca logar conteúdo.
 */
export class DrakeCookieJar {
  private cookies: CookieRecord[] = [];

  static fromStorageState(storageState: StorageState): DrakeCookieJar {
    const jar = new DrakeCookieJar();
    for (const raw of storageState.cookies ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const cookie = asCookie(raw as Record<string, unknown>);
      if (cookie) jar.cookies.push(cookie);
    }
    return jar;
  }

  upsertCookies(records: CookieRecord[]): void {
    for (const record of records) {
      this.upsert(record);
    }
  }

  private upsert(record: CookieRecord): void {
    const path = record.path || "/";
    this.cookies = this.cookies.filter(
      (c) =>
        !(
          c.name === record.name &&
          (c.domain || "") === (record.domain || "") &&
          (c.path || "/") === path
        ),
    );
    this.cookies.push({ ...record, path });
  }

  cookieNames(): string[] {
    return [...new Set(this.cookies.map((c) => c.name))].sort();
  }

  cookieHeaderFor(url: string): string {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return "";
    }
    const now = Date.now() / 1000;
    const matched: CookieRecord[] = [];
    for (const c of this.cookies) {
      if (c.expires != null && c.expires > 0 && c.expires < now) continue;
      if (!domainMatches(c.domain, parsed.hostname)) continue;
      if (!pathMatches(c.path, parsed.pathname)) continue;
      if (c.secure && parsed.protocol !== "https:") continue;
      matched.push(c);
    }
    // Prefer longer paths (more specific) when duplicate names exist.
    matched.sort((a, b) => (b.path?.length ?? 1) - (a.path?.length ?? 1));
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const c of matched) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      parts.push(`${c.name}=${c.value}`);
    }
    return parts.join("; ");
  }

  /** Atualiza jar a partir de um ou mais headers Set-Cookie (já separados). */
  absorbSetCookieHeaders(setCookies: string[], requestUrl: string): void {
    let host = "";
    try {
      host = new URL(requestUrl).hostname;
    } catch {
      host = "";
    }
    for (const raw of setCookies) {
      if (!raw) continue;
      const record = parseSingleSetCookie(raw, host);
      if (record) this.upsert(record);
    }
  }

  /**
   * @deprecated Prefer absorbSetCookieHeaders com getSetCookie().
   * Aceita um único header; não faz split por vírgula (evita quebrar Expires).
   */
  absorbSetCookie(setCookie: string | null, requestUrl: string): void {
    if (!setCookie) return;
    this.absorbSetCookieHeaders([setCookie], requestUrl);
  }
}
