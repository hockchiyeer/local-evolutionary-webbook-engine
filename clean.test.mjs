import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const { main } = await import(pathToFileURL(path.join(repoRoot, "clean-safe.mjs")).href);

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "clean-script-"));

  try {
    await mkdir(path.join(workspace, "dist"), { recursive: true });
    await mkdir(path.join(workspace, "node_modules", "example"), { recursive: true });
    await mkdir(path.join(workspace, "src", "__pycache__"), { recursive: true });
    await mkdir(path.join(workspace, "tests", ".pytest_cache"), { recursive: true });
    await mkdir(path.join(workspace, "coverage"), { recursive: true });
    await mkdir(path.join(workspace, "data", "backups"), { recursive: true });
    await mkdir(path.join(workspace, "nested"), { recursive: true });

    await writeFile(path.join(workspace, "dist", "bundle.js"), "artifact");
    await writeFile(path.join(workspace, "node_modules", "example", "index.js"), "artifact");
    await writeFile(path.join(workspace, "src", "__pycache__", "module.pyc"), "artifact");
    await writeFile(path.join(workspace, "tests", ".pytest_cache", "state"), "artifact");
    await writeFile(path.join(workspace, "coverage", "coverage-final.json"), "artifact");
    await writeFile(path.join(workspace, "nested", "cache.tsbuildinfo"), "artifact");

    const legacyJsonPath = path.join(workspace, "data", "feedback-learning.json");
    const sqlitePath = path.join(workspace, "data", "feedback-learning.sqlite");
    const sqliteWalPath = path.join(workspace, "data", "feedback-learning.sqlite-wal");
    const sqliteShmPath = path.join(workspace, "data", "feedback-learning.sqlite-shm");
    const sqliteBackupPath = path.join(workspace, "data", "feedback-learning.sqlite.bak");
    const legacyBackupPath = path.join(
      workspace,
      "data",
      "backups",
      "feedback-learning-pre-sqlite-2026-04-07T08-15-24-055Z.json",
    );

    await writeFile(legacyJsonPath, "{\"records\":[]}");
    await writeFile(sqlitePath, "sqlite");
    await writeFile(sqliteWalPath, "wal");
    await writeFile(sqliteShmPath, "shm");
    await writeFile(sqliteBackupPath, "backup");
    await writeFile(legacyBackupPath, "{\"records\":[]}");

    await main(workspace);

    assert.equal(await exists(path.join(workspace, "dist")), false);
    assert.equal(await exists(path.join(workspace, "node_modules")), false);
    assert.equal(await exists(path.join(workspace, "src", "__pycache__")), false);
    assert.equal(await exists(path.join(workspace, "tests", ".pytest_cache")), false);
    assert.equal(await exists(path.join(workspace, "coverage")), false);
    assert.equal(await exists(path.join(workspace, "nested", "cache.tsbuildinfo")), false);

    assert.equal(await exists(legacyJsonPath), true);
    assert.equal(await exists(sqlitePath), true);
    assert.equal(await exists(sqliteWalPath), true);
    assert.equal(await exists(sqliteShmPath), true);
    assert.equal(await exists(sqliteBackupPath), true);
    assert.equal(await exists(legacyBackupPath), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
