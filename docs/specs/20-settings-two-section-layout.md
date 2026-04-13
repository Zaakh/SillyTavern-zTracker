# Spec: Reorganize extension settings into two sections

Status: Completed
Last updated: 2026-04-13

## Summary

Split the zTracker settings panel into two clearly separated areas:

1. **Tracker Generation** — everything that controls *how tracker data is created*.
2. **Tracker Injection** — everything that controls *how tracker data is embedded* into normal (non-tracker) generations.

Each section is a collapsible sub-drawer inside the existing zTracker inline-drawer, reusing SillyTavern's `inline-drawer` styling while keeping the open/closed state in React so both sections can default to open reliably.

## Motivation

Today all settings live in a single flat list inside one scrollable container. Users must scroll through ~20 controls to find what they need, and there is no visual cue about which settings affect generation vs. injection. This makes the UI harder to learn and increases the risk of misconfiguration (e.g. changing a generation prompt when the user intended to change the injection role).

Grouping settings by concern:

- Reduces cognitive load — users who only want to tune injection don't have to parse generation controls.
- Makes the two distinct data flows explicit (generate tracker → render; inject tracker → normal generation).
- Prepares the UI for future growth (e.g. more injection targets, virtual-character injection from spec 19).

## Current layout (flat)

All settings render as sequential `.setting-row` elements inside a single `.ztracker-container`:

```
zTracker (inline-drawer)
└─ Connection Profile
   Auto Mode
   Sequential generation
   Prompt Engineering
  Schema Preset / Schema JSON / Schema HTML
   System Prompt Source (+ conditional sub-controls)
   Prompt (main)
   Prompt (JSON)
   Prompt (XML)
   Prompt (TOON)
   Max Response Tokens
   Skip First X Messages
   Include Last X Messages
   Skip character card
   Include Last X zTracker Messages        ← injection
   Embed zTracker snapshots as (role)       ← injection
   EmbedSnapshotTransformSection            ← injection
   WorldInfoPolicySection                   ← generation
   DiagnosticsSection
```

Note: World Info Policy is a generation concern but currently sits between injection settings. The Diagnostics section applies globally.

## Proposed layout (two sub-drawers + shared)

```
zTracker (top-level inline-drawer)
│
├─ Connection Profile          ← shared (used by both flows)
│
├─ ▸ Tracker Generation        ← collapsible sub-drawer, open by default
│    Auto Mode
│    Sequential generation
│    Prompt Engineering
│    Schema Preset / Schema JSON / Schema HTML
│    System Prompt Source (+ conditional sub-controls)
│    Prompt (main)
│    Prompt (JSON / XML / TOON)
│    Max Response Tokens
│    Skip First X Messages
│    Include Last X Messages
│    Skip character card
│    World Info Policy
│
├─ ▸ Tracker Injection         ← collapsible sub-drawer, open by default
│    Include Last X zTracker Messages
│    Embed zTracker snapshots as (role)
│    Embed snapshot header
│    EmbedSnapshotTransformSection (preset + regex config)
│
└─ Diagnostics                 ← shared (global concern)
     Debug logging
     Diagnostics button + output
```

### Visual design

```
┌──────────────────────────────────────────┐
│ ▾ zTracker                               │ ← existing top-level drawer
├──────────────────────────────────────────┤
│  Connection Profile  [▾ dropdown      ]  │
│                                          │
│  ┌─ ▾ Tracker Generation ──────────────┐ │
│  │  Auto Mode        [▾ None         ] │ │
│  │  ☐ Sequential generation            │ │
│  │  Prompt Eng.      [▾ Native API   ] │ │
│  │  Schema Preset    [▾ default   ⊕✎🗑]│ │
│  │  ┌ Schema JSON ─────────────────┐   │ │
│  │  │ { ... }                      │   │ │
│  │  └──────────────────────────────┘   │ │
│  │  ┌ Schema HTML ─────────────────┐   │ │
│  │  │ <div>...</div>               │   │ │
│  │  └──────────────────────────────┘   │ │
│  │  System Prompt    [▾ profile    ]   │ │
│  │  ┌ Prompt ──────────────── ↺ ───┐   │ │
│  │  │ You are a Scene Tracker ...  │   │ │
│  │  └──────────────────────────────┘   │ │
│  │  Prompt (JSON/XML/TOON)   ↺         │ │
│  │  Max Response Tokens  [16000]       │ │
│  │  Skip First X Messages [0]          │ │
│  │  Include Last X Msgs   [0]          │ │
│  │  ☐ Skip character card              │ │
│  │  World Info Policy [▾ include_all ] │ │
│  └──────────────────────────────────────┘ │
│                                          │
│  ┌─ ▾ Tracker Injection ───────────────┐ │
│  │  Include Last X zTracker Msgs [1]   │ │
│  │  Embed snapshots as  [▾ User    ]   │ │
│  │  Embed snapshot header [Tracker:]   │ │
│  │  Transform Preset [▾ default ⊕✎🗑]  │ │
│  │  Input type / Pattern / Replacement │ │
│  │  Code fence lang / ☐ Wrap in fence  │ │
│  └──────────────────────────────────────┘ │
│                                          │
│  Debug logging ☐                         │
│  [🩺 Diagnostics]                        │
│  ┌ Output ─────────────────────────┐     │
│  │                                 │     │
│  └─────────────────────────────────┘     │
└──────────────────────────────────────────┘
```

#### Sub-drawer styling

Reuse SillyTavern's existing `inline-drawer` / `inline-drawer-toggle` / `inline-drawer-content` classes for the sub-drawers so they inherit the host app's drawer styling and chevron treatment.

Each sub-drawer header should:

- Use a descriptive label (bold) matching the section name.
- Include the standard chevron icon (`fa-circle-chevron-down`).
- Default to **open** so first-time users see all settings.

The implementation adds only minor spacing helpers for the nested section containers.

## Setting classification rationale

| Setting | Section | Reason |
|---|---|---|
| Connection Profile | Shared (top) | Used by tracker generation but will also apply to injection if virtual-character injection (spec 19) lands. Keeping it top-level avoids duplication. |
| Auto Mode | Generation | Controls *when* trackers are generated. |
| Sequential generation | Generation | Controls *how* tracker fields are generated. |
| Prompt Engineering | Generation | Selects the output format the LLM is asked to produce. |
| Schema Preset + JSON + HTML | Generation | Defines tracker structure and rendering. |
| System Prompt Source | Generation | Selects the system prompt for tracker generation. |
| Prompt templates (main/JSON/XML/TOON) | Generation | Prompt text sent during tracker generation. |
| Max Response Tokens | Generation | Token budget for tracker generation responses. |
| Skip First X Messages | Generation | Guard that controls when generation activates. |
| Include Last X Messages | Generation | Context window for tracker generation. |
| Skip character card | Generation | Omits character-card fields from generation prompt. |
| World Info Policy | Generation | Controls World Info inclusion during tracker generation. |
| Include Last X zTracker Messages | Injection | Controls *how many* snapshots are injected. |
| Embed zTracker snapshots as (role) | Injection | Controls the role of injected messages. |
| Embed snapshot header | Injection | Header text for injected snapshot messages. |
| EmbedSnapshotTransformSection | Injection | Regex transform and code-fence settings for injection. |
| Debug logging + Diagnostics | Shared (bottom) | Global diagnostic concern, not specific to either flow. |

## Implementation notes

### Component structure

Extract the two section groups into a lightweight wrapper component inside `Settings.tsx`. No new files are strictly needed — the change is primarily a JSX restructuring.

Implemented approach in `Settings.tsx`:

```tsx
{/* Shared: Connection Profile */}
<div className="setting-row">...</div>

{/* Section: Tracker Generation */}
<div className="inline-drawer">
  <div className="inline-drawer-toggle inline-drawer-header">
    <b>Tracker Generation</b>
    <div className="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
  </div>
  <div className="inline-drawer-content">
    {/* Auto Mode, Sequential gen, Prompt Eng, Schema, System Prompt,
        Prompts, Max Tokens, Skip First X, Include Last X, Skip char card,
        World Info Policy */}
  </div>
</div>

{/* Section: Tracker Injection */}
<div className="inline-drawer">
  <div className="inline-drawer-toggle inline-drawer-header">
    <b>Tracker Injection</b>
    <div className="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
  </div>
  <div className="inline-drawer-content">
    {/* Include Last X zTracker, Embed role, EmbedSnapshotTransformSection */}
  </div>
</div>

{/* Shared: Diagnostics */}
<DiagnosticsSection ... />
```

### Drawer behavior

The shipped implementation uses React state for the two nested section drawers while still reusing SillyTavern's `inline-drawer` classes for visual consistency. This keeps both sections open by default and avoids relying on host-level click delegation for nested drawers.

### Migration

This is a **UI-only** change. No settings keys, defaults, or storage format change. No data migration is required. Existing saved settings load identically.

### World Info Policy relocation

Move `WorldInfoPolicySection` from its current position (below injection settings) up into the Generation sub-drawer, after "Skip character card". This groups all generation-context controls together.

## Codebase verification

### Files that need changes

| File | Change |
|---|---|
| [src/components/Settings.tsx](../../src/components/Settings.tsx) | Added a reusable nested section drawer, moved generation-only settings into Tracker Generation, and moved injection-only settings into Tracker Injection. |
| [src/styles/main.scss](../../src/styles/main.scss) | Added small spacing/layout helpers for the nested section containers. |

### Files verified — no changes needed

| File | Reason |
|---|---|
| `src/config.ts` | Settings interface and defaults are unchanged. |
| `src/components/settings/DiagnosticsSection.tsx` | Receives the same props, just rendered outside sub-drawers. |
| `src/components/settings/WorldInfoPolicySection.tsx` | Same props, just moved to a different render position. |
| `src/components/settings/EmbedSnapshotTransformSection.tsx` | Same props, just rendered inside the Injection sub-drawer. |
| `templates/buttons.html` | Unrelated (message button template). |
| `templates/modify_schema_popup.html` | Unrelated (schema popup). |
| `src/tracker.ts` | Runtime injection logic, unrelated to settings UI layout. |
| Tests (`src/__tests__/*`) | No tests import or render `Settings.tsx` (it wires browser/SillyTavern side effects). UI layout changes don't affect unit tests. |

### Risk assessment

- **Low risk**: This is a JSX reorder + wrapping change with only local UI state added for the nested drawer open/close controls.
- **Inline-drawer nesting**: The implementation keeps SillyTavern's visual drawer classes but owns the nested toggle state locally, so it does not depend on undocumented host click behavior for nested sections.
- **Default open state**: Implemented with local React state so the nested sections render open consistently.


## Testing

- **Smoke test**: Open SillyTavern → Extensions → zTracker. Verify both sub-drawers render and collapse/expand correctly. Verify all settings are present and functional.
- **No new unit tests required**: Layout-only change with no logic.
- **Regression**: Confirm changing a setting in either section persists correctly after page reload.

## Verification

Implemented in [src/components/Settings.tsx](../../src/components/Settings.tsx) and [src/styles/main.scss](../../src/styles/main.scss).

Validated with:

- `npm test`
- `npm run build`

Not yet validated with a live SillyTavern smoke test.
