import { FC } from 'react';
import type { TrackerModule } from '../../config.js';

/**
 * Dedicated, module-collection-wide view of generation order. Chained include-list entries can
 * only reference a Module listed earlier here, so this view makes that ordering dependency
 * visible and editable without opening each Module's detail editor.
 */
export const GenerationOrderSection: FC<{
  orderedModules: TrackerModule[];
  moveModule: (moduleId: string, direction: -1 | 1) => void;
}> = ({ orderedModules, moveModule }) => {
  return (
    <div className="ztracker-generation-order">
      <p className="notes">
        Modules generate in this order for each message. A Module can only chain in another Module&apos;s tracker
        history (via its Include Module History list) if that Module is listed earlier here.
      </p>
      <ol className="ztracker-generation-order-list">
        {orderedModules.map((module, index) => (
          <li
            key={module.id}
            className={`ztracker-generation-order-row ${module.enabled ? '' : 'is-disabled'}`}
          >
            <span className="ztracker-generation-order-index">{index + 1}.</span>
            <span className="ztracker-generation-order-name">{module.name}</span>
            {!module.enabled && <span className="ztracker-module-badge is-off">Disabled</span>}
            <div className="ztracker-generation-order-controls">
              <button
                type="button"
                className="menu_button"
                disabled={index === 0}
                onClick={() => moveModule(module.id, -1)}
              >
                Up
              </button>
              <button
                type="button"
                className="menu_button"
                disabled={index === orderedModules.length - 1}
                onClick={() => moveModule(module.id, 1)}
              >
                Down
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
};
