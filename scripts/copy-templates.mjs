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

/** Copies every file matching `filter` from `srcDir` into `destDir` (non-recursive) and returns the count copied. */
async function copyDirFiles(srcDir, destDir, filter) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  const names = entries.filter((ent) => ent.isFile() && filter(ent.name)).map((ent) => ent.name);
  await Promise.all(names.map((name) => copyFile(path.join(srcDir, name), path.join(destDir, name))));
  return names.length;
}

async function main() {
  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(thisFile), '..');
  const templatesDir = path.join(repoRoot, 'templates');
  const outDir = path.join(repoRoot, 'dist', 'templates');

  await ensureDir(outDir);

  const htmlCount = await copyDirFiles(templatesDir, outDir, (name) => name.toLowerCase().endsWith('.html'));

  // Pre-made Module templates (importable via the Settings "Import" button) ship as JSON files
  // under templates/modules/ and are bundled the same way, so they sit on disk next to any built
  // copy of the extension instead of only being retrievable from the GitHub repo.
  const modulesSrcDir = path.join(templatesDir, 'modules');
  const modulesOutDir = path.join(outDir, 'modules');
  await ensureDir(modulesOutDir);
  const moduleCount = await copyDirFiles(modulesSrcDir, modulesOutDir, (name) => name.toLowerCase().endsWith('.json'));

  // eslint-disable-next-line no-console
  console.log(`Copied ${htmlCount} template(s) to dist/templates and ${moduleCount} Module template(s) to dist/templates/modules`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to copy templates:', error);
  process.exitCode = 1;
});
