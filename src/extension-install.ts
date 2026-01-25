export function resolveThirdPartyFolderNameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const thirdPartyIndex = parts.findIndex((p) => p === 'third-party');
    if (thirdPartyIndex === -1) return null;
    const folder = parts[thirdPartyIndex + 1];
    if (!folder) return null;
    return decodeURIComponent(folder);
  } catch {
    return null;
  }
}

export function getInstalledExtensionFolderName(options: {
  importMetaUrl: string;
  fallbackFolderName: string;
}): string {
  return resolveThirdPartyFolderNameFromUrl(options.importMetaUrl) ?? options.fallbackFolderName;
}

export function getThirdPartyExtensionRoot(options: {
  importMetaUrl: string;
  fallbackFolderName: string;
}): string {
  const folderName = getInstalledExtensionFolderName(options);
  return `third-party/${folderName}`;
}

export function getThirdPartyExtensionBasePath(options: {
  importMetaUrl: string;
  fallbackFolderName: string;
}): string {
  const folderName = getInstalledExtensionFolderName(options);
  return `/scripts/extensions/third-party/${folderName}`;
}
