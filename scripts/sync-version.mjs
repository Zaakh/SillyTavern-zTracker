import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'manifest.json');

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));
const writeJson = async (filePath, data) => writeFile(filePath, `${JSON.stringify(data, null, 4)}\n`);

const ensureSemver = (value, label) => {
    const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;
    if (!value) {
        throw new Error(`${label} is missing a version`);
    }
    if (!semverPattern.test(value)) {
        throw new Error(`${label} version "${value}" is not valid SemVer`);
    }
    return value;
};

const pkg = await readJson(packagePath);
const canonicalVersion = ensureSemver(pkg.version, 'package.json');

const targets = [
    {
        label: 'manifest.json',
        path: manifestPath,
        getVersion: (data) => data.version,
        setVersion: (data, version) => {
            data.version = version;
            return data;
        },
    },
];

let totalUpdates = 0;

for (const target of targets) {
    const data = await readJson(target.path);
    const currentVersion = target.getVersion(data);

    if (!currentVersion) {
        const message = `${target.label} is missing a version field`;
        if (checkOnly) {
            throw new Error(message);
        }
        target.setVersion(data, canonicalVersion);
        await writeJson(target.path, data);
        totalUpdates += 1;
        continue;
    }

    ensureSemver(currentVersion, target.label);

    if (currentVersion === canonicalVersion) {
        continue;
    }

    const message = `${target.label} version (${currentVersion}) does not match canonical version (${canonicalVersion})`;
    if (checkOnly) {
        throw new Error(message);
    }

    target.setVersion(data, canonicalVersion);
    await writeJson(target.path, data);
    totalUpdates += 1;
}

if (checkOnly) {
    console.log(`Versions are in sync (version ${canonicalVersion})`);
    process.exit(0);
}

if (totalUpdates > 0) {
    console.log(`Synced ${totalUpdates} file(s) to version ${canonicalVersion}`);
} else {
    console.log(`No changes needed; version already ${canonicalVersion}`);
}
