import { FC, useEffect, useRef, useState } from 'react';
import { STButton, STTextarea } from 'sillytavern-utils-lib/components/react';
import {
  PLACEHOLDER_PROMPT,
  PLACEHOLDER_PROMPT_JSON,
  PLACEHOLDER_PROMPT_TOON,
  PLACEHOLDER_PROMPT_XML,
  PromptEngineeringMode,
} from '../../config.js';
import { SettingsSectionProps } from './settings-shared.js';

type GrammarTestResult = { supported: boolean; message: string };

const promptTemplateConfigs = [
  {
    key: 'prompt',
    label: 'Prompt',
    title: 'Main prompt template used during tracker generation.',
    defaultValue: PLACEHOLDER_PROMPT,
  },
  {
    key: 'promptJson',
    label: 'Prompt (JSON)',
    title: 'Prompt-engineering template used when Prompt Engineering is set to JSON.',
    defaultValue: PLACEHOLDER_PROMPT_JSON,
  },
  {
    key: 'promptXml',
    label: 'Prompt (XML)',
    title: 'Prompt-engineering template used when Prompt Engineering is set to XML.',
    defaultValue: PLACEHOLDER_PROMPT_XML,
  },
  {
    key: 'promptToon',
    label: 'Prompt (TOON)',
    title: 'Prompt-engineering template used when Prompt Engineering is set to TOON.',
    defaultValue: PLACEHOLDER_PROMPT_TOON,
  },
] as const;

const activeTemplateKey: Record<PromptEngineeringMode, (typeof promptTemplateConfigs)[number]['key']> = {
  [PromptEngineeringMode.NATIVE]: 'prompt',
  [PromptEngineeringMode.JSON]: 'promptJson',
  [PromptEngineeringMode.XML]: 'promptXml',
  [PromptEngineeringMode.TOON]: 'promptToon',
};

// Groups the editable prompt templates used by tracker generation and prompt-engineered output modes.
export const GenerationPromptTemplatesSection: FC<
  SettingsSectionProps & {
    moduleId: string;
    testGrammarSchemaEnforcement: (moduleId: string) => Promise<GrammarTestResult>;
  }
> = ({ settings, updateAndRefresh, moduleId, testGrammarSchemaEnforcement }) => {
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<GrammarTestResult | null>(null);
  // Tracks the currently selected Module so an in-flight Test request for a Module the user has
  // since switched away from can detect it's stale and avoid overwriting the new selection's state.
  const latestModuleIdRef = useRef(moduleId);

  // A stale pass/fail result or "Testing..." state from a previously selected Module would be
  // misleading here - switching Modules always resets both immediately.
  useEffect(() => {
    latestModuleIdRef.current = moduleId;
    setTestResult(null);
    setIsTesting(false);
  }, [moduleId]);

  const runGrammarSchemaEnforcementTest = async () => {
    const requestedModuleId = moduleId;
    setIsTesting(true);
    try {
      const result = await testGrammarSchemaEnforcement(requestedModuleId);
      if (latestModuleIdRef.current === requestedModuleId) {
        setTestResult(result);
      }
    } catch (error) {
      if (latestModuleIdRef.current === requestedModuleId) {
        setTestResult({ supported: false, message: error instanceof Error ? error.message : 'Test failed.' });
      }
    } finally {
      if (latestModuleIdRef.current === requestedModuleId) {
        setIsTesting(false);
      }
    }
  };

  // Only the template the selected mode actually sends is shown; the others keep their stored text.
  const activeTemplates = promptTemplateConfigs.filter((t) => t.key === activeTemplateKey[settings.promptEngineeringMode]);

  return (
    <>
      <div className="setting-row">
        <label title="Chooses how zTracker asks the model for structured output: use the native API format, or use JSON/XML/TOON prompt-engineering templates.">
          Prompt Engineering
        </label>
        <select
          className="text_pole"
          title="Chooses how zTracker asks the model for structured output: use the native API format, or use JSON/XML/TOON prompt-engineering templates."
          value={settings.promptEngineeringMode}
          onChange={(e) =>
            updateAndRefresh((s) => {
              s.promptEngineeringMode = e.target.value as PromptEngineeringMode;
            })
          }
        >
          <option value="native">Native API</option>
          <option value="json">Prompt Engineering (JSON)</option>
          <option value="xml">Prompt Engineering (XML)</option>
          <option value="toon">Prompt Engineering (TOON)</option>
        </select>
      </div>

      <small>Only the template for the selected mode is shown; other modes keep their own text.</small>

      {settings.promptEngineeringMode === PromptEngineeringMode.JSON && (
        <div className="setting-row ztracker-button-row">
          <label title="Sends this Module's JSON Schema as a json_schema request override, for backends that support constraining generation via grammar/schema sampling (llama.cpp, TabbyAPI, Chat Completion). Backends that don't forward this field silently ignore it - use Test to check your connection.">
            <input
              type="checkbox"
              checked={!!settings.grammarEnforcementEnabled}
              onChange={(e) =>
                updateAndRefresh((s) => {
                  s.grammarEnforcementEnabled = e.target.checked;
                })
              }
            />{' '}
            Enforce schema via grammar sampling
          </label>
          <STButton
            type="button"
            className="ztracker-btn-secondary"
            title="Check whether the current connection honors schema enforcement"
            disabled={isTesting}
            onClick={() => void runGrammarSchemaEnforcementTest()}
          >
            <i className="fa-solid fa-vial" aria-hidden="true"></i> {isTesting ? 'Testing…' : 'Test'}
          </STButton>
          {testResult && (
            <span className="notes">{testResult.supported ? `✅ ${testResult.message}` : `❌ ${testResult.message}`}</span>
          )}
        </div>
      )}

      {activeTemplates.map((template) => (
        <div key={template.key} className="setting-row">
          <div className="title_restorable">
            <span title={template.title}>{template.label}</span>
            <STButton
              className="fa-solid fa-undo"
              title={`Restore ${template.label} to default`}
              aria-label={`Restore ${template.label} to its default value`}
              onClick={() =>
                updateAndRefresh((s) => {
                  s[template.key] = template.defaultValue;
                })
              }
            />
          </div>
          <STTextarea
            value={settings[template.key]}
            onChange={(e) =>
              updateAndRefresh((s) => {
                s[template.key] = e.target.value;
              })
            }
            rows={4}
          />
        </div>
      ))}
    </>
  );
};