# SillyTavern character info panel buttons

Maintenance: Last reviewed 2026-04-14. Update when SillyTavern changes the character editor DOM, button row classes, or active-character context fields.

Use this reference when a task adds, moves, debugs, or smoke-tests buttons in the character info panel.

Current SillyTavern 1.17 findings from live verification:
- The character editor root is `#form_create`.
- The avatar and character action buttons live under `#avatar_div` and `#avatar_controls`.
- The main icon-button row for character-level actions currently uses `.form_create_bottom_buttons_block.buttons_block`.
- Existing buttons in that row include back, favorite, lore/settings, persona connections, export, duplicate, create, and delete.
- Do not assume older selectors like `.panel_button_row` or `.avatar_button_row` exist in current builds.

Runtime behavior notes:
- Re-read `SillyTavern.getContext()` when syncing panel state; the host context is live and changes under navigation.
- `getContext().characterId` may be a numeric string like `"2"`, not a number.
- Group chats can still leave `characterId` undefined; keep no-active-character behavior safe.

Recommended workflow for info panel buttons:
1. Find `#form_create` first.
2. Prefer explicit, live-verified selectors for the button row.
3. Keep injection idempotent by using a stable element id and re-syncing state instead of appending duplicates.
4. Fail silently when the expected row is absent instead of guessing a generic container.
5. When debugging a missing button, inspect the live DOM before broadening selectors.

Smoke-test checklist:
- Confirm the button exists under `#form_create` after the character panel opens.
- Confirm the button has visible dimensions and the expected title/state attributes.
- Click the button and verify the related character-card extension data changes.
- Switch to another character and confirm the same button re-syncs instead of duplicating.
