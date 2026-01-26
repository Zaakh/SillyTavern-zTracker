# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Add setting to choose the role used when embedding zTracker snapshots into normal generations (user/system/assistant).
- Add named, savable regex transform presets for embedded zTracker snapshots (default JSON + minimal top-level formatting).
- Add setting to customize (or remove) the embedded snapshot header line.
- Rename the default World Info policy label from "Include all" to "Allow all".

## [1.0.0] - Unreleased

### Added
- World Info policy for tracker generation: include all, exclude all, or allowlist by lorebook name / entry UID.
- Allowlist picker UI (refresh + search + add/remove) to avoid manual entry.
- Debug logging toggle and Diagnostics tool for quickly verifying extension template URLs.

### Changed
- Extension template bundling now uses `dist/templates` to match SillyTavern’s packaged artifact expectations.
- Extension install folder is detected at runtime for template rendering (no hardcoded third-party folder name).

