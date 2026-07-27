import "@tanstack/react-start/server-only";
import type { Locator, Page } from "playwright";
import { env } from "../config.server";
import { logger } from "../logger";
import { normalizeText } from "../text";
import {
  DrakeAuthError,
  DRAKE_CLIENT_NOT_FOUND,
  DRAKE_CLIENT_SELECTION_AMBIGUOUS,
  DRAKE_CLIENT_SELECTION_FAILED,
} from "./errors";
import { usableFrames } from "./locate.server";

const CLIENT_SELECTION_HINTS =
  /empresa|company|cliente|client|tenant|ambiente|environment|contexto|context|selecione|selecionar|escolha|escolher|\bbase\b/i;

const NON_INTERACTIVE_ANCESTOR =
  /header|footer|nav|breadcrumb|logo|toolbar|menubar|sidebar/i;

export type DrakeClientCandidate = {
  locator: Locator;
  kind: "button" | "link" | "card" | "option" | "other";
  score: number;
  textNormalized: string;
};

export type DrakeClientSelectionResult = {
  clickCompleted: boolean;
  candidateFound: boolean;
  candidateKind?: DrakeClientCandidate["kind"];
  selectionSucceeded: boolean;
};

function getConfiguredClientName(): string {
  return (env.DRAKE_CLIENT_NAME || env.DRAKE_CONTEXT_NAME || "STEP").trim();
}

export function normalizeClientLabel(value: string): string {
  return normalizeText(value);
}

export function matchesConfiguredClient(text: string, configured = getConfiguredClientName()): boolean {
  return normalizeClientLabel(text) === normalizeClientLabel(configured);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pageBodyText(page: Page): Promise<string> {
  const chunks: string[] = [];
  for (const frame of usableFrames(page)) {
    chunks.push(await frame.locator("body").innerText().catch(() => ""));
  }
  return chunks.join("\n");
}

function pageMeta(page: Page): { pageHost?: string; pagePath?: string } {
  try {
    const url = new URL(page.url());
    return { pageHost: url.hostname, pagePath: url.pathname };
  } catch {
    return {};
  }
}

async function isInNonInteractiveRegion(locator: Locator): Promise<boolean> {
  return locator
    .evaluate((el, patternSource) => {
      const re = new RegExp(patternSource, "i");
      let node: HTMLElement | null = el as HTMLElement;
      for (let depth = 0; depth < 8 && node; depth += 1) {
        const tag = node.tagName.toLowerCase();
        const cls = `${node.className ?? ""} ${node.id ?? ""} ${node.getAttribute("role") ?? ""}`;
        if (re.test(tag) || re.test(cls)) return true;
        if (tag === "header" || tag === "nav" || tag === "footer") return true;
        node = node.parentElement;
      }
      return false;
    }, NON_INTERACTIVE_ANCESTOR.source)
    .catch(() => false);
}

/**
 * Detecta tela de seleção de cliente/tenant/ambiente do Drake.
 * Não é MFA.
 */
export async function isClientSelectionScreen(page: Page): Promise<boolean> {
  const body = await pageBodyText(page);
  const hasHints = CLIENT_SELECTION_HINTS.test(body);
  const candidates = await collectClientCandidates(page);
  if (candidates.length > 0 && hasHints) return true;
  if (candidates.some((c) => c.kind === "button" || c.kind === "link" || c.kind === "card")) {
    return true;
  }
  return false;
}

export async function collectClientCandidates(
  page: Page,
  configured = getConfiguredClientName(),
): Promise<DrakeClientCandidate[]> {
  const expected = normalizeClientLabel(configured);
  const found: DrakeClientCandidate[] = [];
  const seen = new Set<string>();

  for (const frame of usableFrames(page)) {
    const roleAttempts: Array<{
      kind: DrakeClientCandidate["kind"];
      score: number;
      locator: Locator;
    }> = [
      {
        kind: "button",
        score: 100,
        locator: frame.getByRole("button", {
          name: new RegExp(`^\\s*${escapeRegExp(configured)}\\s*$`, "i"),
        }),
      },
      {
        kind: "link",
        score: 95,
        locator: frame.getByRole("link", {
          name: new RegExp(`^\\s*${escapeRegExp(configured)}\\s*$`, "i"),
        }),
      },
      {
        kind: "option",
        score: 90,
        locator: frame.getByRole("option", {
          name: new RegExp(`^\\s*${escapeRegExp(configured)}\\s*$`, "i"),
        }),
      },
    ];

    for (const attempt of roleAttempts) {
      const count = await attempt.locator.count().catch(() => 0);
      for (let i = 0; i < count; i += 1) {
        const item = attempt.locator.nth(i);
        if (!(await item.isVisible().catch(() => false))) continue;
        if (!(await item.isEnabled().catch(() => false))) continue;
        if (await isInNonInteractiveRegion(item)) continue;
        const text = ((await item.innerText().catch(() => "")) || "").trim();
        if (normalizeClientLabel(text) !== expected) continue;
        const key = `${attempt.kind}:${i}:${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({
          locator: item,
          kind: attempt.kind,
          score: attempt.score,
          textNormalized: normalizeClientLabel(text),
        });
      }
    }

    // Cards / elementos clicáveis com texto exato STEP
    const exactText = frame
      .locator("button, a, [role='button'], [role='link'], [role='option'], [tabindex='0'], div, span, li, td")
      .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(configured)}\\s*$`, "i") });
    const textCount = Math.min(await exactText.count().catch(() => 0), 40);
    for (let i = 0; i < textCount; i += 1) {
      const item = exactText.nth(i);
      if (!(await item.isVisible().catch(() => false))) continue;
      if (await isInNonInteractiveRegion(item)) continue;
      const text = ((await item.innerText().catch(() => "")) || "").trim();
      if (normalizeClientLabel(text) !== expected) continue;

      const tag = await item.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
      const role = ((await item.getAttribute("role").catch(() => "")) || "").toLowerCase();
      let kind: DrakeClientCandidate["kind"] = "other";
      let score = 40;
      if (tag === "button" || role === "button") {
        kind = "button";
        score = 100;
      } else if (tag === "a" || role === "link") {
        kind = "link";
        score = 95;
      } else if (role === "option") {
        kind = "option";
        score = 90;
      } else {
        // Prefer clickable card ancestors
        const cursor = await item
          .evaluate((el) => window.getComputedStyle(el).cursor)
          .catch(() => "");
        const parentClickable = await item
          .evaluate((el) => {
            const parent = el.closest(
              "button, a, [role='button'], [role='link'], [tabindex='0'], [onclick]",
            );
            return Boolean(parent);
          })
          .catch(() => false);
        if (cursor === "pointer" || parentClickable) {
          kind = "card";
          score = 80;
        } else {
          // texto solto (logo/título) — baixa prioridade, filtrado depois se houver melhores
          kind = "other";
          score = 10;
        }
      }

      const key = `${kind}:${tag}:${i}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        locator: item,
        kind,
        score,
        textNormalized: normalizeClientLabel(text),
      });
    }
  }

  found.sort((a, b) => b.score - a.score);
  return found.filter((c) => c.score >= 40);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KIND_PRIORITY: Record<DrakeClientCandidate["kind"], number> = {
  button: 5,
  link: 4,
  option: 3,
  card: 2,
  other: 1,
};

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

/**
 * Remove wrappers duplicados do mesmo STEP (botão + span interno + card).
 * Só gera ambiguidade se restarem alvos interativos distintos.
 */
async function pickUniqueClientCandidate(
  pool: DrakeClientCandidate[],
): Promise<DrakeClientCandidate | null> {
  if (pool.length === 0) return null;

  const ranked = [...pool].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind];
  });

  const unique: Array<DrakeClientCandidate & { box: { x: number; y: number; width: number; height: number } }> =
    [];

  for (const candidate of ranked) {
    const box = await candidate.locator.boundingBox().catch(() => null);
    if (!box) continue;
    const overlapIdx = unique.findIndex((u) => boxesOverlap(u.box, box));
    if (overlapIdx >= 0) {
      const existing = unique[overlapIdx]!;
      if (
        KIND_PRIORITY[candidate.kind] > KIND_PRIORITY[existing.kind] ||
        candidate.score > existing.score
      ) {
        unique[overlapIdx] = { ...candidate, box };
      }
      continue;
    }
    unique.push({ ...candidate, box });
  }

  if (unique.length === 0) return ranked[0] ?? null;
  if (unique.length > 1) {
    // Se ainda há vários, preferir o de maior prioridade se scores iguais e um for claramente melhor
    unique.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind];
    });
    const best = unique[0]!;
    const rivals = unique.filter(
      (u) => u.score === best.score && KIND_PRIORITY[u.kind] === KIND_PRIORITY[best.kind],
    );
    if (rivals.length > 1) {
      throw new DrakeAuthError(
        DRAKE_CLIENT_SELECTION_AMBIGUOUS,
        "Foi encontrada mais de uma opção para o ambiente configurado no Drake.",
      );
    }
    return best;
  }

  return unique[0] ?? null;
}

async function clickCandidate(candidate: DrakeClientCandidate): Promise<void> {
  await candidate.locator.scrollIntoViewIfNeeded().catch(() => undefined);

  if (candidate.kind === "card" || candidate.kind === "other") {
    const clickedViaAncestor = await candidate.locator
      .evaluate((el) => {
        const parent = (el as HTMLElement).closest(
          "button, a, [role='button'], [role='link'], [tabindex='0'], [onclick]",
        ) as HTMLElement | null;
        const node = parent ?? (el as HTMLElement);
        const style = window.getComputedStyle(node);
        if (style.visibility === "hidden" || style.display === "none") return false;
        node.click();
        return true;
      })
      .catch(() => false);
    if (clickedViaAncestor) return;
  }

  const visible = await candidate.locator.isVisible().catch(() => false);
  const enabled = await candidate.locator.isEnabled().catch(() => true);
  if (!visible || !enabled) {
    throw new DrakeAuthError(
      DRAKE_CLIENT_SELECTION_FAILED,
      "Não foi possível acessar o ambiente configurado no Drake.",
    );
  }
  try {
    await candidate.locator.click({ timeout: 4_000 });
  } catch {
    await candidate.locator.click({ force: true, timeout: 4_000 });
  }
}

async function waitForSelectionTransition(
  page: Page,
  previousUrl: string,
  timeoutMs = env.DRAKE_BROWSER_MENU_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + Math.min(timeoutMs, 60_000);
  while (Date.now() < deadline) {
    const url = page.url();
    if (url !== previousUrl) return true;
    if (!(await isClientSelectionScreen(page))) return true;
    await sleep(750);
  }
  return false;
}

/**
 * Seleciona automaticamente o cliente/ambiente configurado (padrão STEP).
 * Compartilhado entre local e remoto.
 */
export async function selectDrakeClient(
  page: Page,
  clientName = getConfiguredClientName(),
): Promise<DrakeClientSelectionResult> {
  const meta = pageMeta(page);
  const candidates = await collectClientCandidates(page, clientName);

  logger.info("drake-authentication", "Tela de seleção de cliente detectada", {
    stage: "client-selection",
    targetClientConfigured: Boolean(clientName),
    visibleCandidateCount: candidates.length,
    pageHost: meta.pageHost,
    pagePath: meta.pagePath,
  });

  if (candidates.length === 0) {
    // Pode ser só combobox — deixa o fluxo legado tentar.
    return { clickCompleted: false, candidateFound: false, selectionSucceeded: false };
  }

  const interactive = candidates.filter((c) => c.kind !== "other");
  const pool = interactive.length > 0 ? interactive : candidates;
  const chosen = await pickUniqueClientCandidate(pool);
  if (!chosen) {
    throw new DrakeAuthError(
      DRAKE_CLIENT_NOT_FOUND,
      "O ambiente configurado não foi encontrado na conta do Drake.",
    );
  }

  logger.info("drake-authentication", "Selecionando ambiente Drake", {
    targetClient: clientName,
    candidateKind: chosen.kind,
  });

  const previousUrl = page.url();
  await clickCandidate(chosen);

  const transitioned = await waitForSelectionTransition(page, previousUrl);
  if (!transitioned) {
    throw new DrakeAuthError(
      DRAKE_CLIENT_SELECTION_FAILED,
      "Não foi possível acessar o ambiente configurado no Drake.",
    );
  }

  logger.info("drake-authentication", "Ambiente Drake selecionado", {
    selectionSucceeded: true,
    candidateKind: chosen.kind,
  });

  return {
    clickCompleted: true,
    candidateFound: true,
    candidateKind: chosen.kind,
    selectionSucceeded: true,
  };
}

/** Heurística pura para testes unitários. */
export function classifyClientSelectionBodyForTests(body: string): {
  isClientSelection: boolean;
  isMfa: boolean;
  hasStepButtonText: boolean;
} {
  const hasStepButtonText = /\bSTEP\b/i.test(body);
  const isClientSelection =
    hasStepButtonText &&
    /empresa|cliente|tenant|ambiente|selecione|escolha|company|client/i.test(body);
  const isMfa =
    /approve sign in request|\benter code\b|number matching/i.test(body) && !isClientSelection;
  return { isClientSelection, isMfa, hasStepButtonText };
}
