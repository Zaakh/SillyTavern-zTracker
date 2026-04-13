import { FC } from 'react';
import { STButton, STTextarea } from 'sillytavern-utils-lib/components/react';
import {
  DEFAULT_PROMPT,
  DEFAULT_PROMPT_JSON,
  DEFAULT_PROMPT_TOON,
  DEFAULT_PROMPT_XML,
  PromptEngineeringMode,
} from '../../config.js';
import { SettingsSectionProps } from './settings-shared.js';

const promptTemplateConfigs = [
  {
    key: 'prompt',
    label: 'Prompt',
    title: 'Main prompt template used during tracker generation.',
    defaultValue: DEFAULT_PROMPT,
  },
  {
    key: 'promptJson',
    label: 'Prompt (JSON)',
    title: 'Prompt-engineering template used when Prompt Engineering is set to JSON.',
    defaultValue: DEFAULT_PROMPT_JSON,
  },
  {
    key: 'promptXml',
    label: 'Prompt (XML)',
    title: 'Prompt-engineering template used when Prompt Engineering is set to XML.',
    defaultValue: DEFAULT_PROMPT_XML,
  },
  {
    key: 'promptToon',
    label: 'Prompt (TOON)',
    title: 'Prompt-engineering template used when Prompt Engineering is set to TOON.',
    defaultValue: DEFAULT_PROMPT_TOON,
  },
] as const;

// Groups the editable prompt templates used by tracker generation and prompt-engineered output modes.
export const GenerationPromptTemplatesSection: FC<SettingsSectionProps> = ({ settings, updateAndRefresh }) => {
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

      {promptTemplateConfigs.map((template) => (
        <div key={template.key} className="setting-row">
          <div className="title_restorable">
            <span title={template.title}>{template.label}</span>
            <STButton
              className="fa-solid fa-undo"
              title={`Restore ${template.label} to default`}
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