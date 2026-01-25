# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Added: More debug logging around tracker generation and allowlisted World Info injection.
- Fixed: Allowlisted World Info injection no longer adds extra headings/labels; only entry content is injected.

### Added
- zTracker setting to control World Info (lorebooks) usage during tracker generation: include all, exclude all, or allowlist by book name/entry UID.
- World Info allowlist now includes a book picker UI (refresh + search + add/remove) to avoid manual typing.
- Debug logging toggle plus a Diagnostics panel to quickly check extension template URLs when troubleshooting.

### Fixed
- Template rendering no longer depends on the extension folder being named `zTracker`; the install folder is now detected at runtime.
- Production build no longer fails by typechecking Jest test files.
- Tracker generation now fails gracefully when the selected connection profile/API mapping is missing or unsupported.
- Parser no longer logs raw model output on parse errors (reduces accidental leakage of chat content).
- Jest suite no longer emits expected parser error logs during tests.
- Extension HTML templates are now bundled into `dist/templates` to avoid 404s in SillyTavern installs that only serve packaged build artifacts.
- Template rendering no longer relies on a hardcoded `third-party/<name>` path (prevents 404s when the extension folder name differs).
- World Info allowlist “Refresh book list” now enumerates all lorebooks from SillyTavern’s World Info editor (not just currently active/loaded ones).
- World Info allowlist injection now fetches allowlisted lorebooks directly, so their entries appear in tracker prompts even if the books aren’t otherwise active.

## [1.0.0] - 2026-01-22

### Added
- Initial release of zTracker, forked from SillyTavern WTracker.

