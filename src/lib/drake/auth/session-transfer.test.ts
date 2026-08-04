import { describe, expect, it } from "vitest";
import {
  buildAuthenticatedSessionFromStorageState,
  extractProvenRequestHeaders,
  isBrowserDefaultHeaderName,
} from "./authenticated-session.server";
import { sanitizeSensitiveText } from "../sanitize-error.server";
import {
  DrakeCookieJar,
  domainMatches,
  parseSingleSetCookie,
  pathMatches,
} from "../http/drake-cookie-jar.server";

describe("session diagnostics sanitization", () => {
  it("valores de cookies e Authorization nao aparecem na sanitizacao", () => {
    const text = sanitizeSensitiveText(
      "Cookie: SapiensiaAuth=super-secret-cookie Authorization: Bearer tokensecret123",
    );
    expect(text).not.toContain("super-secret-cookie");
    expect(text).not.toContain("tokensecret123");
    expect(text).not.toMatch(/Bearer\s+tokensecret/i);
  });

  it("somente nomes de cookies sao registrados na estrutura", () => {
    const session = buildAuthenticatedSessionFromStorageState({
      cookies: [
        {
          name: "SapiensiaAuth",
          value: "secret-value-should-not-log",
          domain: ".drake.bz",
          path: "/",
          httpOnly: true,
          secure: true,
        },
      ],
      origins: [],
    });
    const names = session.cookieJar.cookieNames();
    expect(names).toEqual(["SapiensiaAuth"]);
    expect(JSON.stringify(names)).not.toContain("secret-value");
  });
});

describe("proven headers", () => {
  it("transfere Authorization comprovado e nao inventa headers", () => {
    const proven = extractProvenRequestHeaders({
      accept: "application/json",
      "user-agent": "Mozilla/5.0",
      cookie: "a=1",
      authorization: "Bearer proven-token",
      "x-drake-correlation": "corr-1",
    });
    expect(proven.authorizationHeaderPresent).toBe(true);
    expect(proven.authorizationHeader).toBe("Bearer proven-token");
    expect(proven.requiredHeaders.Authorization).toBe("Bearer proven-token");
    expect(proven.requiredHeaders["x-drake-correlation"]).toBe("corr-1");
    expect(proven.requiredHeaders.accept).toBeUndefined();
    expect(proven.requiredHeaders.cookie).toBeUndefined();
    expect(isBrowserDefaultHeaderName("user-agent")).toBe(true);
  });

  it("headers nao comprovados nao sao inventados", () => {
    const proven = extractProvenRequestHeaders({
      accept: "*/*",
      cookie: "x=1",
    });
    expect(proven.authorizationHeaderPresent).toBe(false);
    expect(Object.keys(proven.requiredHeaders)).toEqual([]);
  });
});

describe("DrakeCookieJar", () => {
  it("inclui cookies HttpOnly no header Cookie", () => {
    const jar = DrakeCookieJar.fromStorageState({
      cookies: [
        {
          name: "SapiensiaAuth",
          value: "http-only-value",
          domain: "drake.bz",
          path: "/",
          httpOnly: true,
          secure: true,
        },
      ],
      origins: [],
    });
    const header = jar.cookieHeaderFor("https://drake.bz/api/v2/Authorization/Menu");
    expect(header).toContain("SapiensiaAuth=http-only-value");
  });

  it("envia cookies Secure apenas em HTTPS", () => {
    const jar = DrakeCookieJar.fromStorageState({
      cookies: [
        {
          name: "SecureAuth",
          value: "v",
          domain: "drake.bz",
          path: "/",
          secure: true,
        },
      ],
      origins: [],
    });
    expect(jar.cookieHeaderFor("https://drake.bz/api")).toContain("SecureAuth=v");
    expect(jar.cookieHeaderFor("http://drake.bz/api")).toBe("");
  });

  it("respeita domain e path", () => {
    expect(domainMatches(".drake.bz", "drake.bz")).toBe(true);
    expect(domainMatches(".drake.bz", "www.drake.bz")).toBe(true);
    expect(domainMatches("other.com", "drake.bz")).toBe(false);
    expect(pathMatches("/api", "/api/v2/Authorization/Menu")).toBe(true);
    expect(pathMatches("/api", "/apiother")).toBe(false);
    expect(pathMatches("/", "/anything")).toBe(true);

    const jar = DrakeCookieJar.fromStorageState({
      cookies: [
        {
          name: "A",
          value: "1",
          domain: ".drake.bz",
          path: "/api",
        },
        {
          name: "B",
          value: "2",
          domain: ".drake.bz",
          path: "/other",
        },
      ],
      origins: [],
    });
    const header = jar.cookieHeaderFor("https://drake.bz/api/v2/Authorization/Menu");
    expect(header).toContain("A=1");
    expect(header).not.toContain("B=2");
  });

  it("atualiza jar com Set-Cookie em redirects sem quebrar Expires", () => {
    const jar = new DrakeCookieJar();
    jar.absorbSetCookieHeaders(
      [
        "SapiensiaAuth=abc; Path=/; Domain=.drake.bz; Secure; HttpOnly; Expires=Wed, 21 Oct 2026 07:28:00 GMT",
      ],
      "https://drake.bz/logon",
    );
    const header = jar.cookieHeaderFor("https://drake.bz/api/v2/Authorization/Menu");
    expect(header).toContain("SapiensiaAuth=abc");
    const parsed = parseSingleSetCookie(
      "X=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/",
      "drake.bz",
    );
    expect(parsed?.name).toBe("X");
    expect(parsed?.expires).toBeGreaterThan(0);
  });

  it("nao sobrescreve cookies com mesmo nome e paths diferentes", () => {
    const jar = new DrakeCookieJar();
    jar.upsertCookies([
      { name: "X", value: "root", domain: "drake.bz", path: "/" },
      { name: "X", value: "api", domain: "drake.bz", path: "/api" },
    ]);
    expect(jar.cookieHeaderFor("https://drake.bz/api/v2/x")).toContain("X=api");
    expect(jar.cookieHeaderFor("https://drake.bz/home")).toContain("X=root");
  });
});

describe("auth provider contracts", () => {
  it("login HTTP valida a sessao pelo Menu antes de continuar", async () => {
    const fs = await import("node:fs/promises");
    const auth = await fs.readFile(
      "src/lib/drake/auth/environment-credentials-auth.server.ts",
      "utf8",
    );
    expect(auth).toMatch(/validateHttpSessionTransfer|validateDrakeApiSession/);
    expect(auth).toMatch(/createDrakeHttpClientFromAuthenticatedSession/);
    expect(auth).toMatch(/loginWithDrakeHttpCredentials/);
    expect(auth).not.toMatch(/performHeadlessDrakeLogin/);
    expect(auth).not.toMatch(/from ["']playwright["']/);
    expect(auth).not.toMatch(/request\.newContext/);
    expect(auth).not.toMatch(/interactiveBootstrapRequiredError/);
  });

  it("SignalR nao inicia antes da sessao validada", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/update-service.server.ts", "utf8");
    const authIdx = src.indexOf("await authenticate(false)");
    const signalrIdx = src.indexOf("await openDrakeSignalRSession");
    expect(authIdx).toBeGreaterThan(-1);
    expect(signalrIdx).toBeGreaterThan(authIdx);
    expect(src).toMatch(/createDrakeApiContextFromAuthenticatedSession/);
    expect(src).toMatch(/renovando automaticamente/);
  });

  it("nenhum token e persistido no cache de sessao", async () => {
    const fs = await import("node:fs/promises");
    const auth = await fs.readFile(
      "src/lib/drake/auth/environment-credentials-auth.server.ts",
      "utf8",
    );
    expect(auth).toMatch(/writeSessionCache\(authenticatedSession\.storageState\)/);
    expect(auth).not.toMatch(/writeSessionCache\([^)]*authorization/i);
    expect(auth).not.toMatch(/writeSessionCache\([^)]*requiredHeaders/i);
  });

  it("importadores nao foram alterados nesta correcao", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const glob = await import("node:fs");
    const roots = ["src/lib/histograma", "src/components/histograma"];
    for (const root of roots) {
      if (!glob.existsSync(root)) continue;
      const card = path.join("src/components/histograma/DrakeUpdateCard.tsx");
      if (glob.existsSync(card)) {
        const src = await fs.readFile(card, "utf8");
        expect(src).not.toMatch(/playwright/);
        expect(src).not.toMatch(/DrakeCookieJar/);
        expect(src).toMatch(/runDrakeUpdate|drake\/update|Atualizar/);
      }
    }
  });
});
