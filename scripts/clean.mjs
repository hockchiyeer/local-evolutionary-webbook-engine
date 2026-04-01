import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(process.cwd());
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

function ensureWithinRoot(targetPath) {
  const resolvedRoot = rootDir.endsWith(path.sep) ? rootDir : `${rootDir}${path.sep}`;
  const resolvedTarget = path.resolve(targetPath);

  if (resolvedTarget !== rootDir && !resolvedTarget.startsWith(resolvedRoot)) {
    throw new Error(`Refusing to delete outside workspace: ${resolvedTarget}`);
  }

  return resolvedTarget;
}

async function removeTarget(targetPath, removedPaths) {
  const safeTarget = ensureWithinRoot(targetPath);
  await rm(safeTarget, { recursive: true, force: true });
  removedPaths.add(path.relative(rootDir, safeTarget) || ".");
}

async function findGeneratedArtifacts(currentDir, foundPaths) {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }

    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (removableDirectoryNames.has(entry.name)) {
        foundPaths.add(fullPath);
        continue;
      }

      await findGeneratedArtifacts(fullPath, foundPaths);
      continue;
    }

    if (entry.isFile() && removableFilePatterns.some((pattern) => pattern.test(entry.name))) {
      foundPaths.add(fullPath);
    }
  }
}

async function main() {
  const removedPaths = new Set();

  for (const relativeTarget of topLevelTargets) {
    await removeTarget(path.join(rootDir, relativeTarget), removedPaths);
  }

  const discoveredTargets = new Set();
  await findGeneratedArtifacts(rootDir, discoveredTargets);

  for (const target of Array.from(discoveredTargets).sort()) {
    await removeTarget(target, removedPaths);
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
