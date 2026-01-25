# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- zTracker setting to control World Info (lorebooks) usage during tracker generation: include all, exclude all, or allowlist by book name/entry UID.

### Fixed
- Production build no longer fails by typechecking Jest test files.
- Tracker generation now fails gracefully when the selected connection profile/API mapping is missing or unsupported.
- Parser no longer logs raw model output on parse errors (reduces accidental leakage of chat content).
- Jest suite no longer emits expected parser error logs during tests.

## [1.0.0] - 2026-01-22

### Added
- Initial release of zTracker, forked from SillyTavern WTracker.

