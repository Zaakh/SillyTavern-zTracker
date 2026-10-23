import { FC, useEffect, useState } from 'react';
import { STButton, STTextarea } from 'sillytavern-utils-lib/components/react';
import { formatElapsed, startRunTimer } from '../../run-timer.js';
import type { GenerationStatus } from './useSchemaGeneration.js';

/** Ticking m:ss counted from mount; it is only mounted while a run is in flight, so mount time is the run start. */
const ElapsedTime: FC = () => {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => startRunTimer(setElapsedMs), []);
  return <>{formatElapsed(elapsedMs)}</>;
};

// Design brief, the model-backed generation buttons and their inline status (openspec:
// add-llm-schema-generation, add-llm-action-dialog). Purely presentational: all state and run
// binding live in useSchemaGeneration. Generate schema has Quick (fills the draft) and Advanced
// (dialog with preview); Generate prompts is Advanced-only and applies only from its dialog.
export const SchemaGenerationControls: FC<{
  brief: string;
  onBriefChange: (brief: string) => void;
  activeConnectionLabel: string;
  canGenerateSchema: boolean;
  canGeneratePrompts: boolean;
  isRunning: boolean;
  replacesDraft: boolean;
  status: GenerationStatus;
  onGenerateSchema: () => void;
  onGenerateSchemaAdvanced: () => void;
  onGeneratePromptsAdvanced: () => void;
  onCancel: () => void;
}> = ({
  brief,
  onBriefChange,
  activeConnectionLabel,
  canGenerateSchema,
  canGeneratePrompts,
  isRunning,
  replacesDraft,
  status,
  onGenerateSchema,
  onGenerateSchemaAdvanced,
  onGeneratePromptsAdvanced,
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
        title="Generate schema: asks the active connection for a Schema JSON based on the Design brief and fills the Schema JSON draft (nothing is saved until you click Save). Does not touch the HTML or the prompts."
        onClick={onGenerateSchema}
        disabled={!canGenerateSchema}
      >
        <i className="fa-solid fa-diagram-project" aria-hidden="true"></i> Generate schema
      </STButton>
      <STButton
        type="button"
        className="ztracker-btn-secondary"
        title="Generate schema (advanced): opens a dialog to edit the system prompt, generate, review and edit the schema, and apply it to the Schema JSON draft only when you press Apply."
        onClick={onGenerateSchemaAdvanced}
        disabled={!canGenerateSchema}
      >
        <i className="fa-solid fa-sliders" aria-hidden="true"></i> Advanced...
      </STButton>
      <STButton
        type="button"
        className="ztracker-btn-secondary"
        title="Generate prompts: opens a dialog to edit the system prompts, generate a system prompt and a base prompt from the Design brief and the current Schema JSON draft, and review them. Pressing Apply then replaces this Module's prompts and its generated system-prompt preset immediately."
        onClick={onGeneratePromptsAdvanced}
        disabled={!canGeneratePrompts}
      >
        <i className="fa-solid fa-file-pen" aria-hidden="true"></i> Generate prompts...
      </STButton>
    </div>
    <div className="notes ztracker-schema-status">
      Generate schema and Generate prompts use the global active connection ({activeConnectionLabel}), not this Module&apos;s own connection settings.
    </div>
    {replacesDraft ? (
      <div className="notes ztracker-schema-status">Generate schema (Quick) will replace the current Schema JSON draft.</div>
    ) : null}
    {isRunning ? (
      <div className="notes ztracker-schema-status">
        Generating schema… <ElapsedTime />{' '}
        <STButton type="button" className="ztracker-btn-secondary" title="Cancel this run; nothing is changed" onClick={onCancel}>
          <i className="fa-solid fa-stop" aria-hidden="true"></i> Cancel
        </STButton>
      </div>
    ) : null}
    {status.error ? <div className="notes ztracker-schema-error">{status.error}</div> : null}
    {status.info ? <div className="notes ztracker-schema-status">{status.info}</div> : null}
    {status.showHtmlHint ? (
      <div className="notes ztracker-schema-status">Schema changed: generate HTML next (Generate HTML, below), then save both.</div>
    ) : null}
  </div>
);
