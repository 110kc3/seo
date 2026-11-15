import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

export function checkAssetSize(size, limit = MAX_ASSET_BYTES) {
  if (typeof size !== 'number' || size < 0 || !Number.isFinite(size)) {
    return { ok: false, error: 'asset size must be a non-negative number' };
  }
  if (size > limit) {
    return {
      ok: false,
      error: `asset size (${size} bytes) exceeds limit of ${limit} bytes`,
    };
  }
  return { ok: true };
}

export function getIgnoredPatterns(rootDir) {
  const ignoreFile = join(rootDir, '.assetsignore');
  if (!existsSync(ignoreFile)) return new Set();
  const lines = readFileSync(ignoreFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  return new Set(lines);
}

export function findOversizedAssets(rootDir, limit = MAX_ASSET_BYTES) {
  const ignored = getIgnoredPatterns(rootDir);
  const oversized = [];

  function isIgnored(relPath, isDir) {
    const anchored = `/${relPath}`;
    const base = relPath.split('/')[0];
    if (ignored.has(anchored) || ignored.has(`/${base}`) || ignored.has(base)) return true;
    if (isDir && (ignored.has(`${anchored}/`) || ignored.has(`/${base}/`))) return true;
    return false;
  }

  function walk(currentDir, relPrefix) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (isIgnored(relPath, entry.isDirectory())) continue;
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        const size = statSync(fullPath).size;
        if (size > limit) {
          oversized.push({ path: relPath, size, limit });
        }
      }
    }
  }

  walk(rootDir, '');
  return oversized;
}

export function assertPublishedAssetSizes(rootDir, limit = MAX_ASSET_BYTES) {
  const oversized = findOversizedAssets(rootDir, limit);
  if (oversized.length > 0) {
    const details = oversized.map((o) => `${o.path} (${o.size} bytes > ${o.limit} bytes)`).join('; ');
    throw new Error(`published static asset exceeds ${limit} bytes limit: ${details}`);
  }
}
