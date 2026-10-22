import { FC, useEffect, useState } from 'react';
import { EventNames } from 'sillytavern-utils-lib/types';
import { DEFAULT_EMBED_SNAPSHOT_HEADER, TrackerModuleSettings } from '../../config.js';
import { deriveEmbeddedTrackerSpeakerName } from '../../tracker.js';
import { buildStandaloneSnapshotContent, formatEmbeddedTrackerSnapshot } from '../../embed-snapshot-transform.js';
import { listStoredSnapshots, resolvePreviewSnapshot } from '../../snapshot-preview-source.js';

/** Reads the live chat; the settings tree has no chat subscription, so callers re-read on refresh. */
function readChat(): unknown {
  try {
    return SillyTavern.getContext().chat;
  } catch {
    return undefined;
  }
}

/**
 * Read-only preview of the standalone snapshot block a normal generation would embed, staged as
 * raw → formatted → after regex → final. Text Completion inline/terminal wrappers are not shown.
 */
export const SnapshotInjectionPreview: FC<{ settings: TrackerModuleSettings; moduleId: string }> = ({
  settings,
  moduleId,
}) => {
  const [pickedIndex, setPickedIndex] = useState<number | undefined>();
  const [, setTick] = useState(0);
  const refresh = () => setTick((tick) => tick + 1);

  useEffect(() => setPickedIndex(undefined), [moduleId]);
  useEffect(() => {
    let eventSource: any;
    try {
      eventSource = SillyTavern.getContext().eventSource;
    } catch {
      return undefined;
    }
    const onChatChanged = () => {
      setPickedIndex(undefined);
      refresh();
    };
    eventSource?.on?.(EventNames.CHAT_CHANGED, onChatChanged);
    eventSource?.on?.(EventNames.MESSAGE_EDITED, refresh);
    return () => {
      eventSource?.removeListener?.(EventNames.CHAT_CHANGED, onChatChanged);
      eventSource?.removeListener?.(EventNames.MESSAGE_EDITED, refresh);
    };
  }, []);

  const entries = listStoredSnapshots(readChat(), moduleId);
  const schema = settings.schemaPresets?.[settings.schemaPreset]?.value;
  const source = resolvePreviewSnapshot(entries, pickedIndex, schema);

  let stages:
    | { raw: string; formatted: string; regexed: string; final: string; regexError?: string; speaker?: string }
    | undefined;
  let formatError: string | undefined;
  if (source.kind !== 'none') {
    // A formatter that throws must not unmount the settings tree.
    try {
      const snapshot = formatEmbeddedTrackerSnapshot(source.value, settings, {
        moduleName: settings.modules?.find((module) => module.id === moduleId)?.name,
      });
      stages = {
        raw: JSON.stringify(source.value, null, 2),
        formatted: snapshot.formattedText,
        regexed: snapshot.text,
        final: buildStandaloneSnapshotContent(
          snapshot,
          settings.embedZTrackerSnapshotHeader ?? DEFAULT_EMBED_SNAPSHOT_HEADER,
          settings.embedZTrackerAsCharacter ?? false,
        ),
        regexError: snapshot.regexError,
        speaker: settings.embedZTrackerAsCharacter ? deriveEmbeddedTrackerSpeakerName(settings) : undefined,
      };
    } catch (error) {
      formatError = error instanceof Error ? error.message : String(error);
    }
  }

  const stage = (title: string, text: string, primary = false) => (
    <div key={title}>
      <div className="notes">{title}</div>
      <pre
        className="text_pole"
        data-testid={`injection-preview-${title.toLowerCase().replace(/\s+/g, '-')}`}
        style={{
          whiteSpace: 'pre-wrap',
          overflow: 'auto',
          maxHeight: primary ? '20em' : '8em',
          ...(primary ? { borderColor: 'var(--SmartThemeQuoteColor)' } : {}),
        }}
      >
        {text}
      </pre>
    </div>
  );

  return (
    <div className="setting-row" style={{ marginTop: '0.5em' }}>
      <label title="Read-only preview of the snapshot block embedded into normal generations, using the settings above.">
        Injection preview
      </label>
      {entries.length > 0 && (
        <select
          className="text_pole"
          title="Which stored snapshot to preview."
          value={source.kind === 'stored' ? source.index : ''}
          onChange={(e) => setPickedIndex(Number(e.target.value))}
        >
          {[...entries].reverse().map((entry) => (
            <option key={entry.index} value={entry.index}>
              #{entry.index} {entry.speaker} — {entry.snippet}
            </option>
          ))}
        </select>
      )}
      <button type="button" className="menu_button" onClick={refresh} title="Re-read the chat for new snapshots.">
        Refresh
      </button>
      {source.kind === 'example' && (
        <div className="notes">No stored snapshot in this chat: showing an example built from the schema.</div>
      )}
      {!stages ? (
        <div className="notes">{formatError ? `Preview failed: ${formatError}` : 'No preview available.'}</div>
      ) : (
        <>
          {stages.regexError && (
            <div className="notes" role="alert" style={{ color: 'var(--SmartThemeQuoteColor)' }}>
              Invalid regex: {stages.regexError}. The untransformed text is injected.
            </div>
          )}
          {stage('Raw snapshot', stages.raw)}
          {stage('After input formatting', stages.formatted)}
          {stage('After regex', stages.regexed)}
          {stage('Final block', stages.final, true)}
          {stages.speaker && (
            <div className="notes">
              Sent as a message from the speaker “{stages.speaker}”; the header is not part of the content.
            </div>
          )}
          <div className="notes">
            Shows the standalone message. In Text Completion, inline and terminal-assistant injections add wrapper text
            (a speaker prefix or reply cue) that is not shown here.
          </div>
        </>
      )}
    </div>
  );
};
