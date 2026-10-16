import { createDefaultTrackerModule } from '../config.js';
import { applyModuleActivation, getModuleActivation } from '../components/settings/module-activation.js';

describe('module activation state', () => {
  it('maps flags to Off / Manual / Auto, with Off winning over a stored auto flag', () => {
    const module = createDefaultTrackerModule({ id: 'm', name: 'M', order: 0 });
    module.enabled = true;
    module.auto.enabled = false;
    expect(getModuleActivation(module)).toBe('manual');
    module.auto.enabled = true;
    expect(getModuleActivation(module)).toBe('auto');
    module.enabled = false;
    expect(getModuleActivation(module)).toBe('off');
  });

  it('applies each state, leaving auto.enabled untouched for Off', () => {
    const module = createDefaultTrackerModule({ id: 'm', name: 'M', order: 0 });
    applyModuleActivation(module, 'auto');
    expect([module.enabled, module.auto.enabled]).toEqual([true, true]);
    applyModuleActivation(module, 'off');
    expect([module.enabled, module.auto.enabled]).toEqual([false, true]);
    applyModuleActivation(module, 'manual');
    expect([module.enabled, module.auto.enabled]).toEqual([true, false]);
  });
});
