# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Sequential per-part tracker generation mode (dependency-aware via current tracker snapshot) and per-part/per-array-item regenerate menu on messages.
- Schema annotations for part ordering and array identity: `x-ztracker-dependsOn` and `x-ztracker-idKey`.

### Fixed

- Parts menu usability: array submenus show item previews (instead of generic "items") and render above chat content.
- Parts menu styling is theme-aware and avoids transparent backgrounds.


### Changed

### Fixed

## [1.0.2] - 2026-01-26

### Added
- Hover tooltips for zTracker settings to explain what options do.

## [1.0.1] - 2026-01-26

### Fixed
- Fix HTML template loading when installed under the default SillyTavern folder name (`SillyTavern-zTracker`) to avoid 404s like `/third-party/zTracker/dist/templates/*.html`.

## [1.0.0] - 2026-01-26

### Added
- World Info policy for tracker generation: include all, exclude all, or allowlist by lorebook name / entry UID.
- Allowlist picker UI (refresh + search + add/remove) to avoid manual entry.
- Debug logging toggle and Diagnostics tool for quickly verifying extension template URLs.
- Setting to choose the role used when embedding zTracker snapshots into normal generations (user/system/assistant).
- Named, savable regex transform presets for embedded zTracker snapshots (default JSON + minimal top-level formatting).
- Setting to customize (or remove) the embedded snapshot header line.

### Changed
- Extension template bundling now uses `dist/templates` to match SillyTavern’s packaged artifact expectations.
- Extension install folder is detected at runtime for template rendering (no hardcoded third-party folder name).

