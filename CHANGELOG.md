# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-10-18

### Added

- Loop detection engine with four detection types:
  - Tool loop — same tool called N+ times in one message
  - Chain loop — same sequence of tool calls repeated across messages
  - Reasoning loop — similar reasoning blocks repeated
  - Output loop — similar output text repeated
- Three nudge modes: silent, alert, interrupt
- Configurable nudge prompts with presets
- Sensitivity presets: conservative, balanced, aggressive
- Sidebar log widget showing last 20 detection entries
- Session persistence — log entries survive branch changes
- `/kijek` — manual nudge (hit the LLM with a stick)
- `/kijek-config` — show and modify configuration
- `/kijek-log` — toggle sidebar widget
- `/kijek-dump` — dump current message state as a debug fixture
- `replay()` helper — replay debug dumps through the detector
- Fixture test — auto-discovers and replays `.json` files from `tests/fixtures/`
- Dynamic version read from `package.json`
- Emoji art on all command notifications (stick poking robot)
- Emoji art on log widget borders
- GitHub Actions CI workflow (Node 22 & 24, type check, verify package)
- Commented-out release workflow (NPM_TOKEN auth, ready for npm publishing)
- `build` and `dev` npm scripts
- `@vitest/coverage-v8` dev dependency
- `pi.extensions` field in package.json
- Full repository metadata (bugs, homepage, author)

### Changed

- Excluded tests from TypeScript build output
- Updated command help text to include all subcommands

### Notes

- No external dependencies — all Pi types defined locally
- MIT license

[0.1.0]: https://github.com/kijek/kijek/releases/tag/v0.1.0
