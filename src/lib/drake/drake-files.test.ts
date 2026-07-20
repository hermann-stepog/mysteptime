import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("drake-files lifecycle", () => {
  const originalEnv = { ...process.env };
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await mkdtemp(path.join(tmpdir(), "mysteptime-drake-test-"));
    process.env.DRAKE_TEMP_DIR = testRoot;
    process.env.DRAKE_DIAGNOSTICS_ENABLED = "false";
    process.env.DRAKE_KEEP_TEMP_FILES = "false";
    process.env.DRAKE_KEEP_DIAGNOSTICS_ON_ERROR = "false";
    process.env.DRAKE_TEMP_MAX_AGE_MINUTES = "60";
    vi.resetModules();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await rm(testRoot, { recursive: true, force: true }).catch(() => undefined);
    vi.resetModules();
  });

  it("cria diretorio pai antes de writeFile", async () => {
    const { ensureParentDirectory, writeJsonAtomic } = await import("./drake-files.server");
    const nested = path.join(testRoot, "a", "b", "c", "file.json");
    await ensureParentDirectory(nested);
    await writeJsonAtomic(nested, { ok: true });
    const raw = await readFile(nested, "utf8");
    expect(JSON.parse(raw)).toEqual({ ok: true });
  });

  it("context-controls nao grava quando diagnostico desabilitado", async () => {
    process.env.DRAKE_DIAGNOSTICS_ENABLED = "false";
    vi.resetModules();
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/auth/context-diagnostics.server.ts", "utf8");
    expect(src).toMatch(/if \(!env\.DRAKE_DIAGNOSTICS_ENABLED\)/);
    expect(src).toMatch(/context-controls\.json/);
    expect(src).toMatch(/writeJsonAtomic/);
    expect(src).not.toMatch(/withTimestamp\(["']context-controls/);
  });

  it("diagnostico nao e criado quando desabilitado", async () => {
    process.env.DRAKE_DIAGNOSTICS_ENABLED = "false";
    vi.resetModules();
    const { createDrakeRunFiles, runWithDrakeFiles, writeJsonAtomic } =
      await import("./drake-files.server");
    const { env } = await import("./config.server");
    const run = await createDrakeRunFiles();
    await runWithDrakeFiles(run, async () => {
      expect(env.DRAKE_DIAGNOSTICS_ENABLED).toBe(false);
      const entries = await readdir(run.diagnosticsDirectory);
      expect(entries).toEqual([]);
      // writeJsonAtomic still works if called
      await writeJsonAtomic(path.join(run.diagnosticsDirectory, "context-controls.json"), { a: 1 });
    });
  });

  it("diagnostico usa nome fixo quando habilitado", async () => {
    process.env.DRAKE_DIAGNOSTICS_ENABLED = "true";
    vi.resetModules();
    const { createDrakeRunFiles, runWithDrakeFiles, writeJsonAtomic } =
      await import("./drake-files.server");
    const run = await createDrakeRunFiles();
    await runWithDrakeFiles(run, async () => {
      const filePath = path.join(run.diagnosticsDirectory, "context-controls.json");
      await writeJsonAtomic(filePath, { version: 1 });
      expect(path.basename(filePath)).toBe("context-controls.json");
      expect(filePath).not.toMatch(/context-controls-\d/);
    });
  });

  it("novo diagnostico sobrescreve o anterior", async () => {
    process.env.DRAKE_KEEP_DIAGNOSTICS_ON_ERROR = "true";
    process.env.DRAKE_LAST_DIAGNOSTIC_DIR = path.join(testRoot, "last-error");
    vi.resetModules();
    const { saveLastErrorDiagnostic, getDrakeLastDiagnosticDir } =
      await import("./drake-files.server");
    await saveLastErrorDiagnostic({ "error-summary.json": { n: 1 } });
    await saveLastErrorDiagnostic({ "error-summary.json": { n: 2 } });
    const dir = getDrakeLastDiagnosticDir();
    const entries = await readdir(dir);
    expect(entries.filter((e) => e.startsWith("error-summary"))).toHaveLength(1);
    const raw = await readFile(path.join(dir, "error-summary.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ n: 2 });
  });

  it("run directory e criado por execucao e apagado no sucesso", async () => {
    const { createDrakeRunFiles, cleanupDrakeRunFiles } = await import("./drake-files.server");
    const run = await createDrakeRunFiles();
    expect(path.basename(run.rootDirectory).startsWith("run-")).toBe(true);
    await access(run.downloadsDirectory);
    await access(run.diagnosticsDirectory);
    await cleanupDrakeRunFiles(run);
    await expect(access(run.rootDirectory)).rejects.toThrow();
  });

  it("run directory e apagado no erro", async () => {
    const { createDrakeRunFiles, cleanupDrakeRunFiles, runWithDrakeFiles } =
      await import("./drake-files.server");
    const run = await createDrakeRunFiles();
    await expect(
      runWithDrakeFiles(run, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await cleanupDrakeRunFiles(run);
    await expect(access(run.rootDirectory)).rejects.toThrow();
  });

  it("limpeza rejeita caminho fora da raiz permitida", async () => {
    const { safeRm } = await import("./drake-files.server");
    await expect(safeRm(path.join(testRoot, "..", "outside"), testRoot)).rejects.toThrow(
      /DRAKE_TEMP_STORAGE_ERROR/,
    );
  });

  it("limpeza nao apaga source", async () => {
    const { safeRm, getDrakeTempRoot } = await import("./drake-files.server");
    const src = path.resolve("src");
    await expect(safeRm(src, getDrakeTempRoot())).rejects.toThrow();
  });

  it("execucoes antigas acima do TTL sao removidas e recentes nao", async () => {
    process.env.DRAKE_TEMP_MAX_AGE_MINUTES = "60";
    vi.resetModules();
    const { cleanupStaleDrakeRuns, getDrakeTempRoot } = await import("./drake-files.server");
    const root = getDrakeTempRoot();
    await mkdir(root, { recursive: true });
    const oldDir = path.join(root, "run-old");
    const newDir = path.join(root, "run-new");
    await mkdir(oldDir, { recursive: true });
    await mkdir(newDir, { recursive: true });
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const { utimes } = await import("node:fs/promises");
    await utimes(oldDir, oldTime, oldTime);
    await cleanupStaleDrakeRuns();
    await expect(access(oldDir)).rejects.toThrow();
    await access(newDir);
  });

  it("arquivo bloqueado usa retry no Windows (rm maxRetries)", async () => {
    const { createDrakeRunFiles, cleanupDrakeRunFiles } = await import("./drake-files.server");
    const run = await createDrakeRunFiles();
    await writeFile(path.join(run.downloadsDirectory, "a.xls"), Buffer.from([1, 2, 3]));
    await cleanupDrakeRunFiles(run);
    await expect(access(run.rootDirectory)).rejects.toThrow();
  });

  it("ENOENT vira DRAKE_TEMP_STORAGE_ERROR no mapper", async () => {
    const { mapDrakeError } = await import("./map-drake-error.server");
    const { DRAKE_TEMP_STORAGE_ERROR, DRAKE_ERROR_MESSAGES } = await import("./update-types");
    const mapped = mapDrakeError(
      Object.assign(
        new Error(
          "ENOENT: no such file or directory, open 'C:\\\\tmp\\\\drake\\\\diagnostics\\\\context-controls-x.json'",
        ),
        {
          code: "ENOENT",
        },
      ),
    );
    expect(mapped.code).toBe(DRAKE_TEMP_STORAGE_ERROR);
    expect(mapped.message).toBe(DRAKE_ERROR_MESSAGES[DRAKE_TEMP_STORAGE_ERROR]);
    expect(mapped.message).not.toMatch(/C:\\/);
    expect(mapped.message).not.toMatch(/context-controls/);
  });

  it("isTempStorageError detecta ENOENT", async () => {
    const { isTempStorageError } = await import("./drake-files.server");
    expect(isTempStorageError(new Error("no such file or directory, open ..."))).toBe(true);
  });
});

describe("cache de autenticacao", () => {
  it("nao acumula copias com timestamp", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/auth/session-cache.server.ts", "utf8");
    expect(src).toMatch(/rename\(tmp, filePath\)/);
    expect(src).not.toMatch(/withTimestamp/);
    expect(src).not.toMatch(/storage-state-\d/);
  });
});

describe("nenhuma tabela de job", () => {
  it("update-service nao consulta tabela", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/update-service.server.ts", "utf8");
    expect(src).not.toContain("drake_data_updates");
    expect(src).toMatch(/createDrakeRunFiles/);
    expect(src).toMatch(/cleanupDrakeRunFiles/);
    expect(src).toMatch(/downloaded\.buffer/);
  });
});
