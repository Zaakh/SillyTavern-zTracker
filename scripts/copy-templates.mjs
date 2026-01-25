import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

async function main() {
  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(thisFile), '..');
  const templatesDir = path.join(repoRoot, 'templates');
  const outDir = path.join(repoRoot, 'dist', 'templates');

  await ensureDir(outDir);

  const entries = await fs.readdir(templatesDir, { withFileTypes: true });
  const htmlFiles = entries
    .filter((ent) => ent.isFile() && ent.name.toLowerCase().endsWith('.html'))
    .map((ent) => ent.name);

  await Promise.all(
    htmlFiles.map((name) => copyFile(path.join(templatesDir, name), path.join(outDir, name))),
  );

  // eslint-disable-next-line no-console
  console.log(`Copied ${htmlFiles.length} template(s) to dist/templates`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to copy templates:', error);
  process.exitCode = 1;
});
