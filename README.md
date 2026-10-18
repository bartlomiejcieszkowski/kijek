# Kijek

> **Pronunciation:** /ˈki.jɛk/ (KYEK)
>
> **Meaning:** Polish for "small stick" — a tool to nudge the LLM out of loops.

Kijek is a Pi extension that detects when the LLM gets stuck in repetitive behavior patterns and applies configurable nudges to break the cycle.

```
╰( ･~･)つ── 🤖💬
╰( °□°)つ───🤖💬
```

## Problem

LLMs can get stuck in loops — repeating the same tool calls, reasoning steps, or output patterns — without realizing it. The user sees the loop immediately, but the LLM doesn't. Kijek detects these loops automatically and applies a nudge to help the LLM recover.

## Detection Types

Kijek monitors four types of loops from each user message until the LLM yields:

| Type | What it detects |
|------|----------------|
| **Tool loop** | Same tool called N+ times in one message |
| **Chain loop** | Same sequence of tool calls repeated N+ times across messages |
| **Reasoning loop** | Similar reasoning blocks repeated N+ times |
| **Output loop** | Similar output text repeated N+ times |

Detection uses n-gram (5-gram) Jaccard similarity for text comparison.

## Nudge Modes

When a loop is detected, Kijek applies one of three strategies:

| Mode | Behavior |
|------|----------|
| **silent** | Appends a custom entry (not sent to the LLM) — transparent, no UI |
| **alert** | Shows a visible notification to the user |
| **interrupt** | Sends a steering message (`deliverAs: "steer"`) to interrupt mid-stream |

## Nudge Prompts

Kijek includes preset nudge prompts:

| Preset | Text |
|--------|------|
| `simple` | "Are you stuck?" |
| `subtle` | "You've been approaching this from the same angle. Consider a different strategy." |
| `moderate` | "You've repeated the same pattern multiple times without progress. Try a different approach." |
| `direct` | "You're in a loop. Stop what you're doing and start fresh." |
| `technical` | "You've executed the same tool/reasoning 5+ times. Pivot to a different approach." |
| `custom` | User-defined prompt |

## Sensitivity Levels

Adjust detection sensitivity to control false positives:

| Level | Tool | Chain | Reasoning | Output Similarity |
|-------|------|-------|-----------|-------------------|
| `conservative` | 10 | 10 | 10 | 0.95 |
| `balanced` (default) | 4 | 4 | 4 | 0.85 |
| `aggressive` | 3 | 3 | 3 | 0.70 |

## Installation

1. Copy the extension to your Pi extensions directory:

```bash
mkdir -p ~/.pi/agent/extensions
cp -r kijek ~/.pi/agent/extensions/kijek
```

2. Restart Pi or run `/reload` to load the extension.

3. Configure with `/kijek` commands (see below).

## Configuration

All configuration is stored in `~/.pi/agent/extensions/kijek.json` and managed via slash commands.
The config file is created automatically on first run with default values.

### Commands

| Command | Description |
|---------|-------------|
| `/kijek` | Manually nudge the LLM (hit it with a stick) |
| `/kijek [message]` | Same as above, with optional custom message |
| `/kijek-config` | Show current configuration |
| `/kijek-config status` | Alias for showing current config |
| `/kijek-config mode <silent\|alert\|interrupt>` | Set nudge mode |
| `/kijek-config prompt <simple\|subtle\|moderate\|direct\|technical\|custom>` | Set nudge prompt |
| `/kijek-config sensitivity <conservative\|balanced\|aggressive>` | Set sensitivity level |
| `/kijek-config thresholds [type <value>]` | Show or set thresholds (tool, chain, reasoning, output) |
| `/kijek-config toggle <tool\|chain\|reasoning\|output>` | Toggle detection type on/off |
| `/kijek-log` | Toggle overlay showing last 20 log entries |
| `/kijek-debug` | Toggle overlay showing live detector state |
| `/kijek-dump` | Dump current message state as a debug fixture |

### Example

```
/kijek-config sensitivity aggressive
/kijek-config mode alert
/kijek-config toggle reasoning off
/kijek "try a different approach"
/kijek-dump
```

## Testing with Debug Dumps

Use `/kijek-dump` to capture the current message state as a debug fixture. The dump is saved to `~/.pi/agent/extensions/kijek/debug/` with an auto-generated timestamp.

You can then copy the dump to `tests/fixtures/` in the project to replay it in tests:

```bash
cp ~/.pi/agent/extensions/kijek/debug/dump-*.json tests/fixtures/
```

The fixture test (`tests/fixtures.test.ts`) automatically discovers and replays all `.json` files in `tests/fixtures/`, verifying the detector correctly processes each captured scenario.

## Logging

Kijek logs all detections to an overlay (toggleable via `/kijek-log`). Each log entry shows:

- Timestamp
- Detection type
- Details (what was detected)
- Action taken (silent redirect, alert, or auto-interrupt)

Log entries persist across turns and branches via custom session entries.

### Debug Overlay

Use `/kijek-debug` to view the current detector state in real time:

- Tool call count with names and input parameters
- Reasoning block count with text snippets
- Output block count with text snippets

## Testing with Debug Dumps

## Architecture

```
src/
├── kijek.ts      # Main extension — event hooks, commands, overlays
├── detector.ts   # Detection engine — n-gram similarity, loop detection
├── nudge.ts      # Nudge strategies — silent / alert / interrupt
├── config.ts     # Configuration — loading, validation, presets
└── log.ts        # Log management — overlay, session persistence
```

## Development

```bash
# Run tests
npx vitest run

# Type check
npx tsc --noEmit

# Build (if needed)
npx tsc
```

## License

MIT
