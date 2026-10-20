import { FC, useCallback } from 'react';
import { STButton } from 'sillytavern-utils-lib/components/react';
import { getThirdPartyExtensionBasePath } from '../../extension-install.js';
import { ExtensionSettings, extensionName, getOrderedTrackerModules } from '../../config.js';
import { lintSchemaDialect } from '../../schema-dialect-lint.js';
import { formatTrackerRequestDebugSnapshot, getLastTrackerRequestDebugSnapshot } from '../../ui/debug.js';

/** Builds the advisory schema-dialect-findings section of the Diagnostics report (openspec: add-schema-dialect-lint). Reaches every Module and schema preset - including ones introduced by import, migration, or chat-scoped selection, all of which bypass the Schema editor's own save gate - without altering or removing anything. */
function formatDialectDiagnosticsReport(settings: ExtensionSettings): string[] {
  const lines: string[] = ['', 'Schema dialect findings:'];
  let foundAny = false;

  for (const module of getOrderedTrackerModules(settings, { includeDisabled: true })) {
    for (const [presetKey, preset] of Object.entries(module.schema.presets)) {
      const findings = lintSchemaDialect(preset.value, module.prompts.promptEngineeringMode, module.prompts.grammarEnforcementEnabled);
      if (findings.length === 0) {
        continue;
      }
      foundAny = true;
      lines.push(`module: ${module.name} (${module.id}), preset: ${preset.name} (${presetKey})`);
      for (const finding of findings) {
        lines.push(`  [${finding.severity}] ${finding.path}: ${finding.message}`);
      }
    }
  }

  if (!foundAny) {
    lines.push('No dialect findings were found.');
  }

  return lines;
}

export const DiagnosticsSection: FC<{
  settings: ExtensionSettings;
  debugLogging: boolean;
  setDebugLogging: (value: boolean) => void;
  diagnosticsText: string;
  setDiagnosticsText: (value: string) => void;
}> = ({ settings, debugLogging, setDebugLogging, diagnosticsText, setDiagnosticsText }) => {
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

    lines.push(...formatTrackerRequestDebugSnapshot(getLastTrackerRequestDebugSnapshot()));
    lines.push(...formatDialectDiagnosticsReport(settings));

    const text = lines.join('\n');
    setDiagnosticsText(text);
    // eslint-disable-next-line no-console
    console.debug(text);
  }, [debugLogging, setDiagnosticsText, settings]);

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
          <STButton type="button" className="ztracker-btn-secondary" title="Run diagnostics" onClick={runDiagnostics}>
            <i className="fa-solid fa-stethoscope" aria-hidden="true"></i> Run diagnostics
          </STButton>
        </div>
        <textarea
          className="text_pole"
          readOnly
          value={diagnosticsText}
          rows={6}
          placeholder="Click Run diagnostics to generate diagnostics (also prints to console.debug)."
        />
      </div>
    </>
  );
};
