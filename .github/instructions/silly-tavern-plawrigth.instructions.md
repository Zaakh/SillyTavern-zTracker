---
applyTo: '**'
---
# Playwright debugging instructions (SillyTavern + zTracker)

Use these instructions when debugging this repo’s UI extension (zTracker) against a real SillyTavern instance.

## Target instance
- Base URL: `http://127.0.0.1:8000/`
- zTracker settings location: **Extensions → zTracker**

## Version verification (required)

Always confirm you are debugging the intended zTracker build before interacting with the UI: **Extensions → Manage Extensions → zTracker** 

### Record repo version
- Ensure the changes are committed.
- Run `git rev-parse HEAD` and keep the hash in your notes.
- Record `package.json` version (example: `node -p "require('./package.json').version"`).
- Get Version info from SillyTavern:
	- Open Extensions panel/menu.
	- Select "Manage Extensions".
	- Find zTracker in the list and note its version and git hash (if shown).

### Confirm built artifacts match the repo
- Ensure `dist/index.js` and `dist/style.css` exist and were updated by the most recent build.
- Prefer `npm run dev` (watch build) while debugging to avoid stale `dist/*` assets.

### Confirm SillyTavern is loading the correct extension version
- Verify the extension is loaded with the correct version in the Extensions panel.

## Build and load the extension

### Confirm extension artifacts
- This extension is loaded by SillyTavern from `manifest.json` and expects built assets:
	- `dist/index.js`
	- `dist/style.css`

### Dev loop (recommended)
- In this repo, run `npm install` once.
- Start watch build: `npm run dev`
	- Keep it running while you debug.
- Ensure the repo folder is installed under SillyTavern’s extensions folder so the built `dist/*` files are what SillyTavern loads.
	- If you change TS/TSX and don’t see changes in the browser, verify `dist/index.js` is being updated.

### Reload behavior
- Prefer hard refresh in the browser (or reload the tab) after `dist/*` changes.
- If SillyTavern caches aggressively, restart the SillyTavern server.

## Playwright workflow (agent behavior)

### Navigation and stability
- Navigate to `http://127.0.0.1:8000/`.
- Wait for the UI to settle before interacting:
	- Use `browser_wait_for` for key text that indicates the page is ready (or a short time wait if there is no stable marker).
- If a modal/dialog is open (common on first load), dismiss it before proceeding:
	- Press `Escape`, or click the dialog close button, then take a fresh `browser_snapshot()`.
- If the app shows an `Initializing…` dialog on load, wait for it to disappear before opening side panels; early clicks often target hidden elements.
- Use accessibility snapshots (`browser_snapshot`) to find element refs; prefer stable labels and IDs over brittle CSS selectors.
- Take a fresh snapshot after each panel open/close action. Refs from the previous state become stale quickly in the Extensions sidebar.

### Opening zTracker settings
- Open the Extensions panel/menu.
- Select **zTracker**.
- Validate that zTracker’s settings UI is present (connection profile select, schema preset controls, etc.).
- Prefer opening Extensions from the visible main UI button first, then refresh the snapshot before targeting inner panel buttons such as `Manage extensions`.
- If the accessibility snapshot exposes the `Extensions` panel but not its inner buttons reliably, fall back to DOM-text verification with Playwright evaluation instead of repeatedly retrying stale refs.
- When verifying this settings refactor specifically, confirm the live DOM contains `Tracker Generation` and `Tracker Injection` in addition to existing labels such as `Connection Profile` and `Schema Preset`.

### Manage Extensions fallback
- Treat **Extensions → Manage Extensions → zTracker** as the primary build-version check.
- If the `Manage extensions` control is present but not interactable in the snapshot, record the repo commit + `package.json` version anyway and continue with a fallback verification:
	- confirm the expected new zTracker settings labels are present in the live DOM;
	- confirm `dist/index.js` and `dist/style.css` were rebuilt recently;
	- record that the metadata popup could not be read from the current Playwright session.
- Do not block the whole smoke pass on the metadata popup alone when the loaded UI clearly shows the newly shipped settings structure.

### Functional smoke checks to run during debugging
- Verify the zTracker button appears on chat messages.
- Generate a tracker for a message and confirm:
	- The tracker renders above the message as `.mes_ztracker` content.
	- Regenerate/edit/delete controls respond.
- If generation depends on a connection profile, select one in settings first.
- If the refreshed page does not restore the exact prior chat state, it is acceptable to continue in the target chat with a short fresh user message so tracker generation can be tested end-to-end. Record that the chat was extended for the smoke pass.

### Playwright quick script (tool-call sequence)
Use this when you want a deterministic “click-through” run. Element `ref` values must be obtained from the latest `browser_snapshot`.

0. Verify version (required)
	- Confirm the git hash + `package.json` version you recorded match the code you expect.
	- Confirm `dist/*` was rebuilt recently.

1. Navigate and stabilize
	- `mcp_playwright_browser_navigate({ url: "http://127.0.0.1:8000/" })`
	- `mcp_playwright_browser_wait_for({ time: 2 })` (or wait for a stable text marker)
	- `mcp_playwright_browser_snapshot()`

2. Open zTracker settings (Extensions → zTracker)
	- From the snapshot tree, locate the Extensions UI entry (button/tab/menu; often a left navigation item titled “Extensions”).
	- `mcp_playwright_browser_click({ element: "Open Extensions", ref: "<ref-from-snapshot>" })`
	- `mcp_playwright_browser_snapshot()`
	- If the Extensions panel opens successfully, take a fresh snapshot before trying `Manage extensions` or the `zTracker` entry; do not reuse the pre-open refs.
	- In the Extensions list, find the collapsible entry named “zTracker” and click it to expand its settings.
	- `mcp_playwright_browser_click({ element: "Select zTracker", ref: "<ref-from-snapshot>" })`
	- `mcp_playwright_browser_wait_for({ time: 0.5 })`
	- `mcp_playwright_browser_snapshot()`
	- Verify settings UI exists by checking for expected labels like “Connection Profile” and “Schema Preset” in the snapshot.
	- For the reorganized settings UI, also verify `Tracker Generation` and `Tracker Injection` are present.

3. (Optional) Select a connection profile
	- If no profile is selected, use the snapshot to find the connection profile dropdown.
	- Use `mcp_playwright_browser_select_option(...)` when it’s a real `<select>`.
	- If it’s a custom combobox, use `mcp_playwright_browser_click(...)` + `mcp_playwright_browser_type(...)` to search + select.

4. Generate a tracker on a chat message
	- Navigate back to the chat view if needed (use snapshot + click).
	- `mcp_playwright_browser_snapshot()`
	- Find a message row and click the zTracker per-message button (truck icon).
	- `mcp_playwright_browser_click({ element: "zTracker message button", ref: "<ref-from-snapshot>" })`
	- Wait for generation to finish (watch UI state or wait briefly): `mcp_playwright_browser_wait_for({ time: 3 })`
	- `mcp_playwright_browser_snapshot()` and confirm a `.mes_ztracker` block is present above the message.

5. If anything fails
	- `mcp_playwright_browser_console_messages({ onlyErrors: true })`
	- `mcp_playwright_browser_network_requests()`

## Debugging tactics

### Console and network
- When a UI action “does nothing”, immediately:
	- Check console errors via `browser_console_messages(onlyErrors: true)`.
	- Check network activity via `browser_network_requests()`.
- Capture a screenshot only when it adds value; prefer `browser_snapshot` for actionable structure.
- If `browser_snapshot` is incomplete for a custom panel, use a targeted Playwright DOM-text query to confirm that expected labels are present before assuming the UI failed to load.

### DOM / rendering issues
- Rendering is strict (Handlebars `strict: true`); missing schema fields can throw and prevent tracker rendering.
- If a tracker fails to appear after generation, check for:
	- A thrown render error and any fallback behavior that removes invalid tracker data.
	- Mismatched schema vs HTML template fields.

### Interceptor / prompt-context behavior
- This extension can modify outgoing generation chat arrays via SillyTavern’s `generate_interceptor` hook.
- If testing prompt injection effects, validate with:
	- zTracker setting `includeLastXZTrackerMessages` (0 disables injection).
	- Generations from outside zTracker flows (the interceptor path).

## Safety and etiquette
- Do not input or store secrets in extension settings while debugging.
- Do not paste private chat logs into issues or docs.
- Keep Playwright interactions deterministic: explicit waits, minimal reliance on timing.

## Maintenance
IMPORTANT: Keep this file up to date. Whenever you discover or learn something about how to use playwrigh to test/debug the extension, update this instruction file accordingly. This is a living document that should evolve with the project and capture the most effective debugging practices for future maintainers.