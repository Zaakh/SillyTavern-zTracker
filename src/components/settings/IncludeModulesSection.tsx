import { FC } from 'react';
import type { TrackerModule } from '../../config.js';
import { getEligibleChainableModules, resolveTrackerModuleIncludeEntries } from '../../tracker-module-chaining.js';
import { sanitizeIntegerSetting } from '../../settings-numeric.js';
import type { SettingsSectionProps } from './settings-shared.js';

/**
 * Editor for a Module's generation include list: the mandatory self-history entry plus any
 * chained Modules whose past tracker snapshots feed this Module's own generation context.
 * Dormant chained entries (target disabled, or no longer earlier in generation order) stay
 * listed with their stored count but are visually flagged and contribute nothing until fixed.
 */
export const IncludeModulesSection: FC<SettingsSectionProps & { selectedModule: TrackerModule }> = ({
  settings,
  selectedModule,
  updateAndRefresh,
}) => {
  const allModules = settings.modules ?? [];
  const resolvedEntries = resolveTrackerModuleIncludeEntries(selectedModule, allModules);
  const chainedTargetIds = new Set(
    (selectedModule.generation.includeModules ?? [])
      .filter((entry) => entry.target !== 'self')
      .map((entry) => entry.target),
  );
  const addableModules = getEligibleChainableModules(selectedModule, allModules).filter(
    (module) => !chainedTargetIds.has(module.id),
  );

  const updateEntryCount = (index: number, count: number) => {
    updateAndRefresh((s) => {
      s.includeModules[index].count = count;
    });
  };

  const removeEntry = (index: number) => {
    updateAndRefresh((s) => {
      s.includeModules.splice(index, 1);
    });
  };

  const addEntry = (targetModuleId: string) => {
    updateAndRefresh((s) => {
      s.includeModules.push({ target: targetModuleId, count: 1 });
    });
  };

  return (
    <div className="setting-row ztracker-include-modules">
      <label title="Which Modules' past tracker snapshots this Module reads into its own generation context, independent of the raw message window and of downstream tracker-snapshot injection. 0 disables an entry.">
        Include Module History
      </label>
      <div className="ztracker-include-modules-body">
        <div className="ztracker-include-modules-list">
          {resolvedEntries.map((resolved, index) => {
            const label = resolved.isSelf ? 'Self (this module)' : resolved.targetModule?.name ?? resolved.entry.target;
            return (
              <div
                key={`${resolved.entry.target}-${index}`}
                className={`ztracker-include-module-row ${resolved.eligible ? '' : 'is-dormant'}`}
              >
                <span className="ztracker-include-module-name">{label}</span>
                {!resolved.eligible && (
                  <span
                    className="ztracker-include-module-dormant-flag fa-solid fa-triangle-exclamation"
                    title="Dormant: the referenced Module is disabled or is no longer ordered before this Module. Its stored count is preserved and will resume once fixed."
                  ></span>
                )}
                <input
                  type="number"
                  className="text_pole"
                  min="0"
                  step="1"
                  title="How many of this Module's past tracker snapshots to include. 0 disables this entry."
                  value={resolved.entry.count}
                  onChange={(e) =>
                    updateEntryCount(index, sanitizeIntegerSetting(e.target.value, { fallback: 0, min: 0 }))
                  }
                />
                {!resolved.isSelf && (
                  <button type="button" className="menu_button" onClick={() => removeEntry(index)}>
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {addableModules.length > 0 && (
          <select
            className="text_pole"
            value=""
            title="Add another Module (must be enabled and generate earlier than this Module) as a chained include-list entry."
            onChange={(e) => {
              if (e.target.value) {
                addEntry(e.target.value);
              }
            }}
          >
            <option value="" disabled>
              Add chained Module…
            </option>
            {addableModules.map((module) => (
              <option key={module.id} value={module.id}>
                {module.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
};
