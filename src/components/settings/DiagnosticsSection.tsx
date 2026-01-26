import { FC, useCallback } from 'react';
import { STButton } from 'sillytavern-utils-lib/components/react';
import { getThirdPartyExtensionBasePath } from '../../extension-install.js';
import { extensionName } from '../../config.js';

export const DiagnosticsSection: FC<{
  debugLogging: boolean;
  setDebugLogging: (value: boolean) => void;
  diagnosticsText: string;
  setDiagnosticsText: (value: string) => void;
}> = ({ debugLogging, setDebugLogging, diagnosticsText, setDiagnosticsText }) => {
  const runDiagnostics = useCallback(async () => {
    const basePath = getThirdPartyExtensionBasePath({
      importMetaUrl: import.meta.url,
      fallbackFolderName: extensionName,
    });
    const templatePaths = ['dist/templates/buttons', 'dist/templates/modify_schema_popup'];

    const results: Array<{ template: string; url: string; status: number | null; ok: boolean; error?: string }> = [];
    for (const template of templatePaths) {
      const url = new URL(`${basePath}/${template}.html`, window.location.origin).toString();
      try {
        const response = await fetch(url, { cache: 'no-store' });
        results.push({ template, url, status: response.status, ok: response.ok });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ template, url, status: null, ok: false, error: message });
      }
    }

    const lines: string[] = [];
    lines.push(`zTracker diagnostics`);
    lines.push(`time: ${new Date().toISOString()}`);
    lines.push(`origin: ${window.location.origin}`);
    lines.push(`resolvedBasePath: ${basePath}`);
    lines.push(`debugLogging: ${String(debugLogging)}`);
    lines.push('');
    for (const r of results) {
      lines.push(`template: ${r.template}`);
      lines.push(`url: ${r.url}`);
      lines.push(
        `ok: ${String(r.ok)}${r.status !== null ? ` (status ${r.status})` : ''}${r.error ? ` (error: ${r.error})` : ''}`,
      );
      lines.push('');
    }

    const text = lines.join('\n');
    setDiagnosticsText(text);
    // eslint-disable-next-line no-console
    console.debug(text);
  }, [debugLogging, setDiagnosticsText]);

  return (
    <>
      <div className="setting-row">
        <label title="Enables extra console logging and exposes a diagnostics helper for template URLs.">Debug logging</label>
        <input
          type="checkbox"
          title="Enables extra console logging and exposes a diagnostics helper for template URLs."
          checked={!!debugLogging}
          onChange={(e) => setDebugLogging(e.target.checked)}
        />
        <div className="notes">Enables extra console logging and a diagnostics helper. Avoid enabling unless troubleshooting.</div>
      </div>

      <div className="setting-row">
        <div className="title_restorable">
          <span title="Checks whether required zTracker HTML templates are reachable from SillyTavern (helps debug 404s).">Diagnostics</span>
          <STButton className="fa-solid fa-stethoscope" title="Run diagnostics" onClick={runDiagnostics} />
        </div>
        <textarea
          className="text_pole"
          readOnly
          value={diagnosticsText}
          rows={6}
          placeholder="Click the stethoscope button to generate diagnostics (also prints to console.debug)."
        />
      </div>
    </>
  );
};
