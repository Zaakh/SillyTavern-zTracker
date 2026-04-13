# Spec: Per-character auto-mode exclusion

Status: In Progress
Last updated: 2026-04-13

## Summary

Allow users to exclude specific characters from automatic tracker generation. When auto-mode is active, interactions tied to an excluded character are silently skipped. A toggle button on the character edit panel provides a visible, per-character on/off switch with dynamic color feedback.

## Motivation

Auto-mode (`autoMode` setting) triggers tracker generation for every new message via `CHARACTER_MESSAGE_RENDERED` / `USER_MESSAGE_RENDERED` events. In practice, not every character benefits from tracker generation — utility characters, narrator personas, OOC channels, or low-priority NPCs in a group chat add noise and waste LLM calls when tracked automatically.

There is currently no per-character configuration in zTracker. All settings are global or per-chat. Users who want selective auto-tracking must either:

- Disable auto-mode entirely and generate manually per message.
- Accept unnecessary LLM calls for characters that don't need tracking.

A per-character exclusion gives users fine-grained control without disrupting the auto-mode workflow for characters that do need it.

## Current behavior (baseline)

### Auto-mode trigger path

In `src/ui/ui-init.ts`:

```ts
const incomingTypes = [AutoModeOptions.RESPONSES, AutoModeOptions.BOTH];
const outgoingTypes = [AutoModeOptions.INPUT, AutoModeOptions.BOTH];

globalContext.eventSource.on(
  EventNames.CHARACTER_MESSAGE_RENDERED,
  (messageId: number) =>
    incomingTypes.includes(settings.autoMode) &&
    actions.generateTracker(messageId, { silent: true }),
);
globalContext.eventSource.on(
  EventNames.USER_MESSAGE_RENDERED,
  (messageId: number) =>
    outgoingTypes.includes(settings.autoMode) &&
    actions.generateTracker(messageId, { silent: true }),
);
```

No character identity check occurs before generation is dispatched.

### Character identification

In `src/ui/tracker-actions.ts`, the character is identified inside `generateTracker()`:

```ts
let characterId = characters.findIndex(
  (char: any) => char.avatar === message.original_avatar,
);
characterId = characterId !== -1 ? characterId : undefined;
```

This resolves the character array index from the message's avatar filename.

### Per-character storage

SillyTavern supports per-character extension data via `writeExtensionField(characterId, key, value)` from `getContext()`. This writes into the character card's `data.extensions` object and persists it through the character JSON/PNG metadata. This is the recommended storage for character-scoped extension state.

### Existing per-character setting

The only current per-character–adjacent setting is `skipCharacterCardInTrackerGeneration` (boolean), but it is global — it applies to all characters uniformly.

## Goals

- Add a per-character flag that tells auto-mode to skip tracker generation for that character.
- Expose the flag as a toggle button in the character edit panel so users can switch it without opening zTracker settings.
- Provide immediate visual feedback (button color) reflecting the current exclusion state.
- Reuse the existing zTracker truck icon for the character-level toggle so the feature stays visually associated with zTracker.
- The exclusion applies only to auto-mode. Manual per-message generation (clicking the truck icon) still works regardless of the flag.

## Non-goals

- Blocking manual tracker generation for excluded characters.
- Providing a centralized "manage all exclusions" UI (can be added later).
- Excluding characters from tracker *injection* (the `generate_interceptor` embedding path).
- Per-group-member exclusion logic (group chat exclusion follows the same per-character flag).

## Detailed design

### 1. Storage: character card extension field

Use `writeExtensionField` to persist the exclusion flag on the character card itself:

```ts
const { writeExtensionField } = SillyTavern.getContext();

// Exclude a character
writeExtensionField(characterId, `${EXTENSION_KEY}.autoModeExcluded`, true);

// Re-include a character
writeExtensionField(characterId, `${EXTENSION_KEY}.autoModeExcluded`, false);
```

**Why character card storage:**

- The flag is a property of the character, not the chat or the extension's global config.
- It survives across chats and profile changes.
- It travels with the character card on export/import (stored in `data.extensions`).
- It uses the stable `writeExtensionField` API from `getContext()` — no internal imports.

**Reading the flag:**

```ts
const characters = SillyTavern.getContext().characters;
const char = characters[characterId];
const excluded = char?.data?.extensions?.[EXTENSION_KEY]?.autoModeExcluded === true;
```

### 2. Auto-mode guard

Add a character-exclusion check in the auto-mode event handlers. The check must resolve the character *before* dispatching generation.

**Resolved scope:** exclusion should cover all auto-mode interactions associated with the excluded character.

- For `CHARACTER_MESSAGE_RENDERED`, skip when the rendered message belongs to an excluded character.
- For `USER_MESSAGE_RENDERED`, skip when the active chat target character is excluded.
- In one-on-one chats, this means both outgoing and incoming auto-generation are suppressed for the excluded character.
- In group chats, incoming character messages remain per-character. Outgoing user messages do not map cleanly to one specific member, so the first implementation should treat outgoing group-chat messages as out of scope unless SillyTavern exposes a stable target-character mapping.

**Option A — Check inside the event handler (preferred):**

```ts
globalContext.eventSource.on(
  EventNames.CHARACTER_MESSAGE_RENDERED,
  (messageId: number) => {
    if (!incomingTypes.includes(settings.autoMode)) return;
    if (isCharacterExcluded(messageId)) return;
    actions.generateTracker(messageId, { silent: true });
  },
);
```

The `isCharacterExcluded(messageId)` helper:

1. Reads the message from `globalContext.chat[messageId]`.
2. Resolves the character via `message.original_avatar` (same pattern as `tracker-actions.ts`).
3. Checks the character card's `data.extensions[EXTENSION_KEY].autoModeExcluded` flag.
4. Returns `true` if the character is excluded.

For `USER_MESSAGE_RENDERED`, use a companion helper such as `isCurrentChatCharacterExcluded()` that:

1. Reads the active character from `getContext().characterId`.
2. Returns `false` when there is no active solo character (for example, group-chat contexts).
3. Checks the same character-card extension field.

**Option B — Check inside `generateTracker` early-return:**

This would add the guard deeper in the call stack. Less preferred because `generateTracker` is also used for manual generation, and we explicitly do *not* want to block manual generation.

### 3. UI: toggle button on the character edit panel

#### Placement: character panel button row

SillyTavern's character edit panel (right-side panel, `#form_create`) contains a character info area with the avatar and several action buttons (export, duplicate, delete, favorites, etc.). This area is accessible to extensions via DOM manipulation.

**Target location:** The button row near the character avatar in the character edit panel. This area typically contains icon buttons for character-level actions (favorite, export, duplicate, delete, lore, stats). zTracker would append one more icon button here.

**Recommended approach:**

1. Listen to a character-panel-related event (e.g. `CHAT_CHANGED` or a DOM mutation observer on `#form_create`) or hook into initial render.
2. Find the existing button container in the character edit panel DOM.
3. Append a zTracker exclusion toggle button if not already present.
4. Update button state on character switch.

**Implementation sketch:**

```ts
function injectCharacterPanelButton() {
  // Find the character panel button area
  const buttonRow = document.querySelector('#form_create .panel_button_row')
    ?? document.querySelector('#form_create .avatar_button_row');
  if (!buttonRow) return;

  // Avoid duplicates
  if (buttonRow.querySelector('.ztracker-exclude-button')) return;

  const btn = document.createElement('div');
  btn.classList.add('ztracker-exclude-button', 'menu_button', 'fa-solid', 'fa-truck');
  btn.title = 'zTracker: Toggle auto-mode for this character';

  btn.addEventListener('click', () => toggleCharacterExclusion());
  buttonRow.appendChild(btn);
  updateExclusionButtonState(btn);
}
```

> **Open question:** The exact CSS selector for the button row needs to be confirmed via a live Playwright smoke test against SillyTavern 1.17. The character edit panel DOM has been refactored in recent versions (see issue #3863). A fallback strategy should be documented.
>
> **Resolved product choice:** prefer the avatar action row as the intended placement. If no stable matching container is found at runtime, fail silently and do not render an alternative fallback UI.

#### Dynamic button color

The button color reflects the exclusion state:

| State | Visual | Meaning |
|---|---|---|
| Auto-mode active for character | Default theme color (or green tint) | Tracker generation will run automatically |
| Character excluded from auto-mode | Red / muted tint | Auto-mode skips this character |
| Auto-mode globally disabled | Grey / dimmed | Button is visible but non-functional info |

**Color approach — inline style override:**

```ts
function updateExclusionButtonState(btn: HTMLElement) {
  const excluded = isCurrentCharacterExcluded();
  btn.style.color = excluded ? 'var(--SmartThemeQuoteColor, #e74c3c)' : '';
  btn.title = excluded
    ? 'zTracker: Auto-mode EXCLUDED for this character (click to include)'
    : 'zTracker: Auto-mode active for this character (click to exclude)';
}
```

Using CSS custom properties from SillyTavern's Smart Theme system keeps the colors consistent with the user's theme.

**Resolved icon choice:** use the existing zTracker truck icon (`fa-truck`) and rely on color + title text to communicate the exclusion state rather than switching to a different semantic icon.

#### Character switch handling

When the user switches characters (navigates to a different character in the panel), the button state must update. Listen to `CHAT_CHANGED` or use a `MutationObserver` on the character panel to detect navigation and re-read the flag.

### 4. Group chat behavior

In group chats, each member is a separate character. Auto-mode fires `CHARACTER_MESSAGE_RENDERED` for each character's message. The exclusion flag on each character card applies independently — excluded group members are skipped, non-excluded members are tracked.

No additional group-specific logic is needed because the exclusion check resolves per-message via `message.original_avatar`.

## Resolved decisions

1. **Primary placement:** target the avatar action row in the character edit panel.
2. **Icon:** use the zTracker truck icon with dynamic color and title updates.
3. **DOM failure behavior:** fail silently if the character panel button cannot be injected; do not add a fallback UI elsewhere.
4. **Interaction scope:** exclusion applies to all auto-mode interactions associated with that character. In solo chats, that includes both incoming and outgoing auto-generation. In group chats, outgoing user-message behavior remains implementation-limited unless a stable member-target mapping exists.

## Remaining verification

1. **Exact DOM selector:** confirm the concrete SillyTavern 1.17 selector for the avatar action row with a live Playwright smoke test before implementation.

## Verification

- Added import-safe helper coverage for per-character exclusion state, message-to-character resolution, outgoing/incoming auto-mode guard decisions, and character-panel button toggling.
- Added `ui-init` integration coverage confirming `CHARACTER_MESSAGE_RENDERED` and `USER_MESSAGE_RENDERED` auto-mode handlers skip excluded characters.
- Ran `npm test` successfully on the final code: 23 suites passed, 138 tests passed.
- Ran `npm run build` successfully, updating the shipped bundle under `dist/`.
- Live SillyTavern smoke verification has not been run yet. The remaining host-side risk is the exact character-panel selector used for button injection.

## Testing strategy

### Unit tests

- `isCharacterExcluded(messageId)` — returns `true` when the flag is set, `false` when absent or `false`.
- `isCurrentChatCharacterExcluded()` — returns `true` for excluded solo-chat characters and `false` when there is no active character binding.
- Auto-mode handler with mocked event — confirms generation is not called for excluded characters.
- Auto-mode handler without exclusion — confirms generation proceeds normally.
- `USER_MESSAGE_RENDERED` handler in solo chat — confirms generation is skipped when the active chat character is excluded.

### Smoke test (Playwright)

- Open a character's edit panel and confirm the zTracker button appears.
- Click the button and verify:
  - The exclusion flag is written to the character card.
  - The button color updates.
- Send a message in auto-mode and confirm the excluded character's message is skipped.
- Switch to a non-excluded character and confirm auto-mode generates normally.

## Implementation notes

- Keep the exclusion-check helper in a small, testable module (e.g. `src/character-exclusion.ts`).
- The DOM injection code should be in `src/ui/` alongside existing UI wiring.
- The button injection should be idempotent — safe to re-run on DOM changes.
- Consider debouncing the character-switch update to avoid flicker.

## Codebase references

| File | Relevance |
|---|---|
| `src/ui/ui-init.ts` | Auto-mode event handlers that need the exclusion guard |
| `src/ui/tracker-actions.ts` | Character resolution via `message.original_avatar` |
| `src/config.ts` | `ExtensionSettings` interface, `EXTENSION_KEY` |
| `src/components/Settings.tsx` | Settings UI (potential fallback location for exclusion control) |
| `.github/skills/.../extension-basics.md` | Documents `writeExtensionField` API |
