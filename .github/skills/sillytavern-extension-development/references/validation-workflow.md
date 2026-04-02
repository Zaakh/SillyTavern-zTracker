# SillyTavern extension validation workflow

Maintenance: Last reviewed 2026-04-02. Update when common SillyTavern extension testing, build, or smoke-test practices change.

Use this reference when a task needs validation guidance but should stay repository-agnostic.

General validation rules:
- Run the repository's existing automated tests after executable source changes.
- Run the repository's build step after changes that affect shipped extension assets, manifest-adjacent behavior, templates, or styles.
- Do not invent new validation commands when the repository already defines them.

Design-for-test guidance:
- Keep new logic in import-safe helpers when possible.
- Avoid pushing more behavior into side-effect-heavy extension entrypoints.
- Prefer narrow mocks or lightweight context objects over a full fake host runtime when a helper only depends on a small slice of state.
- Keep DOM-oriented behavior separable from host bootstrapping so it can be tested in jsdom or equivalent browser-like test environments.

Smoke-test guidance for live SillyTavern verification:
- Build the extension before smoke testing.
- Confirm SillyTavern is loading the intended extension folder and fresh built assets.
- Verify the extension version shown in SillyTavern matches the code being tested when the UI exposes that information.
- If the host restores chat state imperfectly after reload, it is acceptable to continue with a short fresh message as long as the verification notes mention that the chat was extended.

What to verify in a browser-side extension:
- The extension loads without console errors.
- Core controls appear in the expected host UI location.
- The primary extension action completes end-to-end.
- Persisted extension data survives the expected host save/reload path.
- Error handling remains intelligible when host prerequisites are missing.

Decision rules:
- Prefer the smallest validation that can prove the change.
- Use a live SillyTavern smoke test only when automated coverage cannot verify the host interaction.
- If the behavior depends on a specific upstream version feature, pair smoke testing with an explicit compatibility check.