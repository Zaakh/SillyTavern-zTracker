import { getInstalledExtensionFolderName, getThirdPartyExtensionRoot } from '../extension-install.js';

export function getTemplateUrl(options: {
  importMetaUrl: string;
  fallbackFolderName: string;
  templatePathNoExt: string;
}): string {
  const folderName = getInstalledExtensionFolderName({
    importMetaUrl: options.importMetaUrl,
    fallbackFolderName: options.fallbackFolderName,
  });
  const basePath = `/scripts/extensions/third-party/${folderName}`;
  return new URL(`${basePath}/${options.templatePathNoExt}.html`, window.location.origin).toString();
}

export async function checkTemplateUrl(options: {
  importMetaUrl: string;
  fallbackFolderName: string;
  templatePathNoExt: string;
}): Promise<{ templatePathNoExt: string; url: string; ok: boolean; status: number | null; error?: string }> {
  const url = getTemplateUrl(options);
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return { templatePathNoExt: options.templatePathNoExt, url, ok: response.ok, status: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { templatePathNoExt: options.templatePathNoExt, url, ok: false, status: null, error: message };
  }
}

export function getExtensionRoot(options: { importMetaUrl: string; fallbackFolderName: string }): string {
  return getThirdPartyExtensionRoot({
    importMetaUrl: options.importMetaUrl,
    fallbackFolderName: options.fallbackFolderName,
  });
}
