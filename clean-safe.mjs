import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const topLevelTargets = [
  "dist",
  "node_modules",
  ".pytest_cache",
  "__pycache__",
];
const removableDirectoryNames = new Set([
  "__pycache__",
  ".pytest_cache",
  "coverage",
]);
const removableFilePatterns = [
  /\.pyc$/i,
  /\.pyo$/i,
  /\.tsbuildinfo$/i,
];
const protectedDirectoryPatterns = [
  /^data\/backups(?:\/.*)?$/i,
];
const protectedExactRelativePaths = new Set([
  "data",
  "data/feedback-learning.json",
  "data/feedback-learning.sqlite",
  "data/feedback-learning.sqlite-shm",
  "data/feedback-learning.sqlite-wal",
  "data/feedback-learning.sqlite.bak",
]);

function toRelativePosix(rootDir, targetPath) {
  return path.relative(rootDir, path.resolve(targetPath)).split(path.sep).join("/");
}

function isProtectedPath(rootDir, targetPath) {
  const relativePath = toRelativePosix(rootDir, targetPath);
  return protectedExactRelativePaths.has(relativePath)
    || protectedDirectoryPatterns.some((pattern) => pattern.test(relativePath));
}

function ensureWithinRoot(rootDir, targetPath) {
  const resolvedRoot = rootDir.endsWith(path.sep) ? rootDir : `${rootDir}${path.sep}`;
  const resolvedTarget = path.resolve(targetPath);

  if (resolvedTarget !== rootDir && !resolvedTarget.startsWith(resolvedRoot)) {
    throw new Error(`Refusing to delete outside workspace: ${resolvedTarget}`);
  }

  return resolvedTarget;
}

async function removeTarget(rootDir, targetPath, removedPaths) {
  const safeTarget = ensureWithinRoot(rootDir, targetPath);
  if (isProtectedPath(rootDir, safeTarget)) {
    return;
  }

  await rm(safeTarget, { recursive: true, force: true });
  removedPaths.add(path.relative(rootDir, safeTarget) || ".");
}

async function findGeneratedArtifacts(rootDir, currentDir, foundPaths) {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }

    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (isProtectedPath(rootDir, fullPath)) {
        continue;
      }

      if (removableDirectoryNames.has(entry.name)) {
        foundPaths.add(fullPath);
        continue;
      }

      await findGeneratedArtifacts(rootDir, fullPath, foundPaths);
      continue;
    }

    if (entry.isFile() && removableFilePatterns.some((pattern) => pattern.test(entry.name))) {
      foundPaths.add(fullPath);
    }
  }
}

export async function main(targetRoot = process.cwd()) {
  const rootDir = path.resolve(targetRoot);
  const removedPaths = new Set();

  for (const relativeTarget of topLevelTargets) {
    await removeTarget(rootDir, path.join(rootDir, relativeTarget), removedPaths);
  }

  const discoveredTargets = new Set();
  await findGeneratedArtifacts(rootDir, rootDir, discoveredTargets);

  for (const target of Array.from(discoveredTargets).sort()) {
    await removeTarget(rootDir, target, removedPaths);
  }

  const removedList = Array.from(removedPaths).sort();

  if (removedList.length === 0) {
    console.log("No generated artifacts found.");
    return;
  }

  console.log("Removed generated artifacts:");
  for (const removedPath of removedList) {
    console.log(`- ${removedPath}`);
  }
}

const directInvocationPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;

if (directInvocationPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
