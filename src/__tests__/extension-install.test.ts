import {
  getInstalledExtensionFolderName,
  getThirdPartyExtensionBasePath,
  getThirdPartyExtensionRoot,
  resolveThirdPartyFolderNameFromUrl,
} from '../extension-install.js';

describe('extension install path resolver', () => {
  test('resolveThirdPartyFolderNameFromUrl extracts folder name', () => {
    const url = 'http://127.0.0.1:8000/scripts/extensions/third-party/SillyTavern-zTracker/dist/index.js';
    expect(resolveThirdPartyFolderNameFromUrl(url)).toBe('SillyTavern-zTracker');
  });

  test('resolveThirdPartyFolderNameFromUrl returns null when missing', () => {
    const url = 'http://127.0.0.1:8000/dist/index.js';
    expect(resolveThirdPartyFolderNameFromUrl(url)).toBeNull();
  });

  test('getInstalledExtensionFolderName falls back when parsing fails', () => {
    expect(
      getInstalledExtensionFolderName({
        importMetaUrl: 'not a url',
        fallbackFolderName: 'zTracker',
      }),
    ).toBe('zTracker');
  });

  test('root/basePath use resolved folder', () => {
    const importMetaUrl =
      'http://127.0.0.1:8000/scripts/extensions/third-party/MyFork/dist/index.js?cachebust=1';

    expect(getThirdPartyExtensionRoot({ importMetaUrl, fallbackFolderName: 'zTracker' })).toBe(
      'third-party/MyFork',
    );
    expect(getThirdPartyExtensionBasePath({ importMetaUrl, fallbackFolderName: 'zTracker' })).toBe(
      '/scripts/extensions/third-party/MyFork',
    );
  });
});
