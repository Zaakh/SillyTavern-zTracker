import { FC } from 'react';
import { STButton, STTextarea } from 'sillytavern-utils-lib/components/react';
import type { GenerationStatus, GenerationKind } from './useSchemaGeneration.js';

// Design brief, the two model-backed generation buttons and their inline status (openspec:
// add-llm-schema-generation). Purely presentational: all state and run binding live in
// useSchemaGeneration. Overwrites are announced inline, never through a confirm dialog.
export const SchemaGenerationControls: FC<{
  brief: string;
  onBriefChange: (brief: string) => void;
  activeConnectionLabel: string;
  canGenerateSchema: boolean;
  canGeneratePrompts: boolean;
  isRunning: boolean;
  runningKind?: GenerationKind;
  replacesDraft: boolean;
  replacesPrompts: boolean;
  status: GenerationStatus;
  onGenerateSchema: () => void;
  onGeneratePrompts: () => void;
  onCancel: () => void;
}> = ({
  brief,
  onBriefChange,
  activeConnectionLabel,
  canGenerateSchema,
  canGeneratePrompts,
  isRunning,
  runningKind,
  replacesDraft,
  replacesPrompts,
  status,
  onGenerateSchema,
  onGeneratePrompts,
  onCancel,
}) => (
  <div className="ztracker-schema-generation">
    <label title="Describe in plain language what this tracker should track. Saved with the Module; used by Generate schema and Generate prompts.">Design brief</label>
    <STTextarea
      value={brief}
      onChange={(event) => onBriefChange(event.target.value)}
      rows={3}
      placeholder="e.g. Track the weather, the mood of each present character, and what they are carrying."
    />
    <div className="ztracker-button-row">
      <STButton
        type="button"
        className="ztracker-btn-secondary"
        title="Generate schema: asks the active connection for a Schema JSON based on the Design brief. Replaces the Schema JSON draft (nothing is saved until you click Save). Does not touch the HTML or the prompts."
        onClick={onGenerateSchema}
        disabled={!canGenerateSchema}
      >
        <i className="fa-solid fa-diagram-project" aria-hidden="true"></i> Generate schema (draft)
      </STButton>
      <STButton
        type="button"
        title="Generate prompts: asks the active connection for a system prompt and a base prompt based on the Design brief and the current Schema JSON draft. Replaces this Module's prompts and its generated system-prompt preset, and applies immediately (not as a draft)."
        onClick={onGeneratePrompts}
        disabled={!canGeneratePrompts}
      >
        <i className="fa-solid fa-file-pen" aria-hidden="true"></i> Generate prompts (applies now)
      </STButton>
    </div>
    <div className="notes ztracker-schema-status">
      Generate schema and Generate prompts use the global active connection ({activeConnectionLabel}), not this Module&apos;s own connection settings.
    </div>
    {replacesDraft ? <div className="notes ztracker-schema-status">Generate schema will replace the current Schema JSON draft.</div> : null}
    {replacesPrompts ? (
      <div className="notes ztracker-schema-status">Generate prompts will overwrite this Module&apos;s prompt text and generated preset immediately.</div>
    ) : null}
    {isRunning ? (
      <div className="notes ztracker-schema-status">
        Generating {runningKind === 'prompts' ? 'prompts' : 'schema'}…{' '}
        <STButton type="button" className="ztracker-btn-secondary" title="Cancel this run; nothing is changed" onClick={onCancel}>
          <i className="fa-solid fa-stop" aria-hidden="true"></i> Cancel
        </STButton>
      </div>
    ) : null}
    {status.error ? <div className="notes ztracker-schema-error">{status.error}</div> : null}
    {status.info ? <div className="notes ztracker-schema-status">{status.info}</div> : null}
    {status.showHtmlHint ? (
      <div className="notes ztracker-schema-status">Schema changed: generate HTML next (Generate HTML from schema, below), then save both.</div>
    ) : null}
  </div>
);
