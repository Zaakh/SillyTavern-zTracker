# Spec: Built-in genre schema presets

Status: Open
Last updated: 2026-03-20

## Goal

Ship zTracker with additional built-in schema presets so new users can immediately pick a genre-appropriate tracker instead of building one from scratch. The default "Roleplay Scene" preset stays; four genre presets are added alongside it.

## Motivation

Currently the extension ships with a single `default` schema preset (general roleplay scene tracker). New users must manually author a JSON Schema and a Handlebars template before they can track genre-specific details. Providing curated presets for popular genres lowers the onboarding barrier and showcases what zTracker can do.

## Scope

- Add four new **read-only** built-in schema presets (same protection as `default`):
  1. **Space Opera** — galactic-scale sci-fi (think Star Wars, Dune).
  2. **Cyberpunk Detective** — neon-noir investigation in a cyberpunk megacity.
  3. **Fantasy Adventure** — classic high-fantasy questing (think D&D, Lord of the Rings).
  4. **Post-Apocalyptic Survival** — resource-scarce survival in a ruined world.
- Each preset consists of a JSON Schema (`value`), a Handlebars HTML template (`html`), and a display `name`.
- Register the presets in `defaultSettings.schemaPresets` alongside the existing `default` entry.
- Mark all built-in preset keys in `readOnlyValues` so users cannot delete them (same as `default` today).

## Open questions to clarify first

1. **Read-only vs. user-editable**: Should built-in presets be fully read-only (schema + template locked), or should users be able to edit the JSON/HTML while only preventing deletion? Current `default` behavior allows editing but prevents deletion — should we keep that?
2. **Key naming**: Proposed keys are `space_opera`, `cyberpunk_detective`, `fantasy_adventure`, `post_apocalyptic`. Any preference?
3. **Upgrade path**: When a user already has settings stored and we add new built-in presets in a future version, should we auto-inject missing built-in presets on load, or only include them for fresh installs?
4. **Template style**: Should the new preset templates reuse the same CSS class prefix (`ztracker_default_mes_template`) or use genre-specific classes (e.g., `ztracker_space_opera_template`)?

## Decisions (chosen)

_(to be filled after clarification)_

## Schema designs

### 1. Space Opera

**Key**: `space_opera`
**Display name**: `Space Opera`

#### JSON Schema (`value`)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SpaceOperaTracker",
  "description": "Schema for tracking space opera / sci-fi scene details",
  "type": "object",
  "properties": {
    "stardate": {
      "type": "string",
      "description": "In-universe date/time. Format: stardate or galactic standard, e.g. 'Cycle 7, Rotation 14 — 08:42 GST'"
    },
    "location": {
      "type": "object",
      "properties": {
        "system": {
          "type": "string",
          "description": "Star system or sector name"
        },
        "place": {
          "type": "string",
          "description": "Specific place: planet surface, space station, ship interior, etc."
        }
      },
      "required": ["system", "place"]
    },
    "environment": {
      "type": "object",
      "properties": {
        "atmosphere": {
          "type": "string",
          "description": "Breathable, toxic, vacuum, artificial, etc."
        },
        "gravity": {
          "type": "string",
          "description": "Standard, low, zero-G, heavy, etc."
        },
        "conditions": {
          "type": "string",
          "description": "Ambient conditions: sandstorm, battle damage, calm hyperspace, etc."
        }
      },
      "required": ["atmosphere", "gravity", "conditions"]
    },
    "mission": {
      "type": "object",
      "properties": {
        "objective": {
          "type": "string",
          "description": "Current primary mission objective in 1-2 sentences"
        },
        "tension": {
          "type": "string",
          "description": "Dominant source of conflict or tension"
        },
        "faction": {
          "type": "string",
          "description": "Dominant political faction or group driving events"
        }
      },
      "required": ["objective", "tension", "faction"]
    },
    "shipStatus": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "Name/class of current vessel or 'N/A' if planet-side"
        },
        "condition": {
          "type": "string",
          "description": "Hull integrity, shields, damage status"
        }
      },
      "required": ["name", "condition"]
    },
    "charactersPresent": {
      "type": "array",
      "items": { "type": "string", "description": "Character names" },
      "description": "List of character names present in scene"
    },
    "characters": {
      "type": "array",
      "x-ztracker-dependsOn": ["charactersPresent"],
      "x-ztracker-idKey": "name",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "Character name" },
          "species": { "type": "string", "description": "Species or origin" },
          "role": { "type": "string", "description": "Role: pilot, Jedi, smuggler, officer, etc." },
          "gear": { "type": "string", "description": "Weapons, tools, or notable equipment" },
          "attire": { "type": "string", "description": "Clothing or armor description" },
          "demeanor": { "type": "string", "description": "Current attitude or emotional state" }
        },
        "required": ["name", "species", "role", "gear", "attire", "demeanor"]
      },
      "description": "Array of character objects"
    }
  },
  "required": ["stardate", "location", "environment", "mission", "shipStatus", "charactersPresent", "characters"]
}
```

#### Handlebars template (`html`)

```html
<div class="ztracker_default_mes_template">
    <table>
        <tbody>
            <tr><td>Stardate:</td><td>{{data.stardate}}</td></tr>
            <tr><td>Location:</td><td>{{data.location.system}} — {{data.location.place}}</td></tr>
            <tr><td>Environment:</td><td>{{data.environment.atmosphere}}, {{data.environment.gravity}}, {{data.environment.conditions}}</td></tr>
            <tr><td>Ship:</td><td>{{data.shipStatus.name}} ({{data.shipStatus.condition}})</td></tr>
        </tbody>
    </table>
    <details>
        <summary><span>Tracker Details</span></summary>
        <table>
            <tbody>
                <tr><td>Mission:</td><td>{{data.mission.objective}}</td></tr>
                <tr><td>Tension:</td><td>{{data.mission.tension}}</td></tr>
                <tr><td>Faction:</td><td>{{data.mission.faction}}</td></tr>
                <tr><td>Present:</td><td>{{join data.charactersPresent ', '}}</td></tr>
            </tbody>
        </table>
        <div class="mes_ztracker_characters">
            {{#each data.characters as |character|}}
            <hr>
            <strong>{{character.name}}</strong> ({{character.species}}, {{character.role}})<br>
            <table>
                <tbody>
                    <tr><td>Gear:</td><td>{{character.gear}}</td></tr>
                    <tr><td>Attire:</td><td>{{character.attire}}</td></tr>
                    <tr><td>Demeanor:</td><td>{{character.demeanor}}</td></tr>
                </tbody>
            </table>
            {{/each}}
        </div>
    </details>
</div>
<hr>
```

---

### 2. Cyberpunk Detective

**Key**: `cyberpunk_detective`
**Display name**: `Cyberpunk Detective`

#### JSON Schema (`value`)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CyberpunkDetectiveTracker",
  "description": "Schema for tracking cyberpunk noir detective scene details",
  "type": "object",
  "properties": {
    "time": {
      "type": "string",
      "description": "Format: HH:MM; day/night cycle indicator, e.g. '02:47 — Night Shift, Day 3'"
    },
    "location": {
      "type": "object",
      "properties": {
        "district": {
          "type": "string",
          "description": "City district or sector name"
        },
        "level": {
          "type": "string",
          "description": "Vertical level: street, sublevel, rooftop, corporate tower floor, etc."
        },
        "venue": {
          "type": "string",
          "description": "Specific venue: bar, alley, precinct, netrunner den, etc."
        }
      },
      "required": ["district", "level", "venue"]
    },
    "atmosphere": {
      "type": "object",
      "properties": {
        "lighting": {
          "type": "string",
          "description": "Neon-lit, dim, fluorescent, holographic haze, etc."
        },
        "noise": {
          "type": "string",
          "description": "Ambient noise: rain on chrome, synth-bass, sirens, silence, etc."
        },
        "crowdDensity": {
          "type": "string",
          "description": "Empty, sparse, packed, shoulder-to-shoulder, etc."
        }
      },
      "required": ["lighting", "noise", "crowdDensity"]
    },
    "caseFile": {
      "type": "object",
      "properties": {
        "caseName": {
          "type": "string",
          "description": "Short case title or codename"
        },
        "activeLead": {
          "type": "string",
          "description": "Current investigative lead being pursued"
        },
        "evidence": {
          "type": "string",
          "description": "Key evidence discovered or referenced in this scene"
        },
        "suspectStatus": {
          "type": "string",
          "description": "Current suspect pool status: narrowing, widening, confirmed, etc."
        }
      },
      "required": ["caseName", "activeLead", "evidence", "suspectStatus"]
    },
    "threatLevel": {
      "type": "string",
      "description": "Current danger level: low, moderate, high, critical"
    },
    "charactersPresent": {
      "type": "array",
      "items": { "type": "string", "description": "Character names" },
      "description": "List of character names present in scene"
    },
    "characters": {
      "type": "array",
      "x-ztracker-dependsOn": ["charactersPresent"],
      "x-ztracker-idKey": "name",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "Character name or alias" },
          "cybernetics": { "type": "string", "description": "Visible cyberware: optic implants, chrome arm, neural jack, etc. or 'None'" },
          "affiliation": { "type": "string", "description": "Corp, gang, NCPD, freelancer, unknown, etc." },
          "weapon": { "type": "string", "description": "Visible weapon or 'Concealed' or 'Unarmed'" },
          "attire": { "type": "string", "description": "Clothing description: trenchcoat, corpo suit, street armor, etc." },
          "demeanor": { "type": "string", "description": "Cooperative, hostile, nervous, calculated, etc." }
        },
        "required": ["name", "cybernetics", "affiliation", "weapon", "attire", "demeanor"]
      },
      "description": "Array of character objects"
    }
  },
  "required": ["time", "location", "atmosphere", "caseFile", "threatLevel", "charactersPresent", "characters"]
}
```

#### Handlebars template (`html`)

```html
<div class="ztracker_default_mes_template">
    <table>
        <tbody>
            <tr><td>Time:</td><td>{{data.time}}</td></tr>
            <tr><td>Location:</td><td>{{data.location.district}} / {{data.location.level}} — {{data.location.venue}}</td></tr>
            <tr><td>Atmosphere:</td><td>{{data.atmosphere.lighting}}, {{data.atmosphere.noise}}, {{data.atmosphere.crowdDensity}}</td></tr>
            <tr><td>Threat:</td><td>{{data.threatLevel}}</td></tr>
        </tbody>
    </table>
    <details>
        <summary><span>Case File & Details</span></summary>
        <table>
            <tbody>
                <tr><td>Case:</td><td>{{data.caseFile.caseName}}</td></tr>
                <tr><td>Lead:</td><td>{{data.caseFile.activeLead}}</td></tr>
                <tr><td>Evidence:</td><td>{{data.caseFile.evidence}}</td></tr>
                <tr><td>Suspects:</td><td>{{data.caseFile.suspectStatus}}</td></tr>
                <tr><td>Present:</td><td>{{join data.charactersPresent ', '}}</td></tr>
            </tbody>
        </table>
        <div class="mes_ztracker_characters">
            {{#each data.characters as |character|}}
            <hr>
            <strong>{{character.name}}</strong> ({{character.affiliation}})<br>
            <table>
                <tbody>
                    <tr><td>Cyberware:</td><td>{{character.cybernetics}}</td></tr>
                    <tr><td>Weapon:</td><td>{{character.weapon}}</td></tr>
                    <tr><td>Attire:</td><td>{{character.attire}}</td></tr>
                    <tr><td>Demeanor:</td><td>{{character.demeanor}}</td></tr>
                </tbody>
            </table>
            {{/each}}
        </div>
    </details>
</div>
<hr>
```

---

### 3. Fantasy Adventure

**Key**: `fantasy_adventure`
**Display name**: `Fantasy Adventure`

#### JSON Schema (`value`)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "FantasyAdventureTracker",
  "description": "Schema for tracking high-fantasy adventure scene details",
  "type": "object",
  "properties": {
    "time": {
      "type": "string",
      "description": "Time of day, season, and moon phase, e.g. 'Late afternoon, Autumn — Waning Crescent'"
    },
    "location": {
      "type": "object",
      "properties": {
        "region": {
          "type": "string",
          "description": "Kingdom, realm, or wilderness region"
        },
        "terrain": {
          "type": "string",
          "description": "Forest, mountain pass, dungeon, tavern, castle, etc."
        },
        "landmark": {
          "type": "string",
          "description": "Nearest notable landmark or settlement"
        }
      },
      "required": ["region", "terrain", "landmark"]
    },
    "weather": {
      "type": "string",
      "description": "Weather conditions including magical anomalies if present"
    },
    "quest": {
      "type": "object",
      "properties": {
        "objective": {
          "type": "string",
          "description": "Current quest objective in 1-2 sentences"
        },
        "progress": {
          "type": "string",
          "description": "Quest progress: just started, midway, nearing completion, etc."
        },
        "immediateGoal": {
          "type": "string",
          "description": "What the party is trying to accomplish right now"
        }
      },
      "required": ["objective", "progress", "immediateGoal"]
    },
    "partyResources": {
      "type": "object",
      "properties": {
        "supplies": {
          "type": "string",
          "description": "Food/water/camping status: well-stocked, dwindling, depleted"
        },
        "morale": {
          "type": "string",
          "description": "Party morale: high, steady, low, fractured"
        },
        "threats": {
          "type": "string",
          "description": "Known nearby dangers: monsters, rival faction, curse, etc."
        }
      },
      "required": ["supplies", "morale", "threats"]
    },
    "charactersPresent": {
      "type": "array",
      "items": { "type": "string", "description": "Character names" },
      "description": "List of character names present in scene"
    },
    "characters": {
      "type": "array",
      "x-ztracker-dependsOn": ["charactersPresent"],
      "x-ztracker-idKey": "name",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "Character name" },
          "race": { "type": "string", "description": "Species or ancestry: human, elf, dwarf, etc." },
          "class": { "type": "string", "description": "Class or archetype: warrior, mage, rogue, cleric, etc." },
          "equipment": { "type": "string", "description": "Primary weapon and armor" },
          "condition": { "type": "string", "description": "Physical state: healthy, wounded, exhausted, cursed, etc." },
          "stance": { "type": "string", "description": "Current posture or action: scouting, resting, casting, on guard, etc." }
        },
        "required": ["name", "race", "class", "equipment", "condition", "stance"]
      },
      "description": "Array of character objects"
    }
  },
  "required": ["time", "location", "weather", "quest", "partyResources", "charactersPresent", "characters"]
}
```

#### Handlebars template (`html`)

```html
<div class="ztracker_default_mes_template">
    <table>
        <tbody>
            <tr><td>Time:</td><td>{{data.time}}</td></tr>
            <tr><td>Location:</td><td>{{data.location.region}} — {{data.location.terrain}} (near {{data.location.landmark}})</td></tr>
            <tr><td>Weather:</td><td>{{data.weather}}</td></tr>
        </tbody>
    </table>
    <details>
        <summary><span>Quest & Party Details</span></summary>
        <table>
            <tbody>
                <tr><td>Quest:</td><td>{{data.quest.objective}}</td></tr>
                <tr><td>Progress:</td><td>{{data.quest.progress}}</td></tr>
                <tr><td>Goal:</td><td>{{data.quest.immediateGoal}}</td></tr>
                <tr><td>Supplies:</td><td>{{data.partyResources.supplies}}</td></tr>
                <tr><td>Morale:</td><td>{{data.partyResources.morale}}</td></tr>
                <tr><td>Threats:</td><td>{{data.partyResources.threats}}</td></tr>
                <tr><td>Present:</td><td>{{join data.charactersPresent ', '}}</td></tr>
            </tbody>
        </table>
        <div class="mes_ztracker_characters">
            {{#each data.characters as |character|}}
            <hr>
            <strong>{{character.name}}</strong> ({{character.race}} {{character.class}})<br>
            <table>
                <tbody>
                    <tr><td>Equipment:</td><td>{{character.equipment}}</td></tr>
                    <tr><td>Condition:</td><td>{{character.condition}}</td></tr>
                    <tr><td>Stance:</td><td>{{character.stance}}</td></tr>
                </tbody>
            </table>
            {{/each}}
        </div>
    </details>
</div>
<hr>
```

---

### 4. Post-Apocalyptic Survival

**Key**: `post_apocalyptic`
**Display name**: `Post-Apocalyptic Survival`

#### JSON Schema (`value`)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PostApocalypticTracker",
  "description": "Schema for tracking post-apocalyptic survival scene details",
  "type": "object",
  "properties": {
    "time": {
      "type": "string",
      "description": "Days since the collapse and time of day, e.g. 'Day 142 — Dusk'"
    },
    "location": {
      "type": "object",
      "properties": {
        "zone": {
          "type": "string",
          "description": "Named zone, settlement, or grid reference"
        },
        "terrain": {
          "type": "string",
          "description": "Ruins, wasteland, overgrown suburb, underground bunker, etc."
        },
        "shelterStatus": {
          "type": "string",
          "description": "Current shelter: fortified, makeshift, exposed, mobile, etc."
        }
      },
      "required": ["zone", "terrain", "shelterStatus"]
    },
    "environment": {
      "type": "object",
      "properties": {
        "radiation": {
          "type": "string",
          "description": "Radiation level: clear, low, moderate, hazardous, lethal"
        },
        "weather": {
          "type": "string",
          "description": "Weather conditions including fallout, acid rain, dust storms, etc."
        },
        "threatLevel": {
          "type": "string",
          "description": "Immediate area threat: safe, uneasy, hostile, warzone"
        }
      },
      "required": ["radiation", "weather", "threatLevel"]
    },
    "resources": {
      "type": "object",
      "properties": {
        "food": {
          "type": "string",
          "description": "Food supply status: abundant, adequate, rationed, critical, depleted"
        },
        "water": {
          "type": "string",
          "description": "Clean water status: abundant, adequate, rationed, critical, depleted"
        },
        "ammo": {
          "type": "string",
          "description": "Ammunition status: stocked, moderate, low, last mag, melee only"
        },
        "medical": {
          "type": "string",
          "description": "Medical supplies: well-stocked, some supplies, improvised only, none"
        }
      },
      "required": ["food", "water", "ammo", "medical"]
    },
    "charactersPresent": {
      "type": "array",
      "items": { "type": "string", "description": "Character names or callsigns" },
      "description": "List of character names present in scene"
    },
    "characters": {
      "type": "array",
      "x-ztracker-dependsOn": ["charactersPresent"],
      "x-ztracker-idKey": "name",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "Character name or callsign" },
          "health": { "type": "string", "description": "Physical state: healthy, injured, irradiated, infected, critical" },
          "gear": { "type": "string", "description": "Primary weapon and notable equipment" },
          "skill": { "type": "string", "description": "Key survival skill: scavenging, medic, mechanic, marksman, etc." },
          "attire": { "type": "string", "description": "Clothing or armor: hazmat suit, scrap armor, ragged civvies, etc." },
          "morale": { "type": "string", "description": "Mental state: determined, shaken, hopeful, desperate, numb" }
        },
        "required": ["name", "health", "gear", "skill", "attire", "morale"]
      },
      "description": "Array of character objects"
    }
  },
  "required": ["time", "location", "environment", "resources", "charactersPresent", "characters"]
}
```

#### Handlebars template (`html`)

```html
<div class="ztracker_default_mes_template">
    <table>
        <tbody>
            <tr><td>Time:</td><td>{{data.time}}</td></tr>
            <tr><td>Zone:</td><td>{{data.location.zone}} — {{data.location.terrain}}</td></tr>
            <tr><td>Shelter:</td><td>{{data.location.shelterStatus}}</td></tr>
            <tr><td>Hazards:</td><td>Rad: {{data.environment.radiation}} | {{data.environment.weather}} | Threat: {{data.environment.threatLevel}}</td></tr>
        </tbody>
    </table>
    <details>
        <summary><span>Resources & Survivors</span></summary>
        <table>
            <tbody>
                <tr><td>Food:</td><td>{{data.resources.food}}</td></tr>
                <tr><td>Water:</td><td>{{data.resources.water}}</td></tr>
                <tr><td>Ammo:</td><td>{{data.resources.ammo}}</td></tr>
                <tr><td>Medical:</td><td>{{data.resources.medical}}</td></tr>
                <tr><td>Present:</td><td>{{join data.charactersPresent ', '}}</td></tr>
            </tbody>
        </table>
        <div class="mes_ztracker_characters">
            {{#each data.characters as |character|}}
            <hr>
            <strong>{{character.name}}</strong> [{{character.health}}]<br>
            <table>
                <tbody>
                    <tr><td>Gear:</td><td>{{character.gear}}</td></tr>
                    <tr><td>Skill:</td><td>{{character.skill}}</td></tr>
                    <tr><td>Attire:</td><td>{{character.attire}}</td></tr>
                    <tr><td>Morale:</td><td>{{character.morale}}</td></tr>
                </tbody>
            </table>
            {{/each}}
        </div>
    </details>
</div>
<hr>
```

---

## Design rationale

### Consistent structure across presets
All four schemas follow the same structural pattern as the existing `default` preset:
- **Top-level scalar fields** for at-a-glance scene info (time, location summary).
- **Nested objects** for grouped details (mission, case file, quest, resources).
- **`charactersPresent`** string array → **`characters`** object array with `x-ztracker-dependsOn` and `x-ztracker-idKey`, enabling sequential part generation (spec 08).
- **Handlebars templates** reuse the existing `ztracker_default_mes_template` class and the table + collapsible `<details>` layout.

### Genre-specific field choices
Each schema tracks the details that matter for its genre:
| Genre | Unique fields | Why |
|-------|---------------|-----|
| Space Opera | `stardate`, `shipStatus`, `environment.gravity` | Vessels and alien environments are central to the genre |
| Cyberpunk Detective | `caseFile`, `threatLevel`, `atmosphere.noise` | Investigation progress and noir ambience drive the story |
| Fantasy Adventure | `quest`, `partyResources`, `characters[].race/class` | Questing, resource management, and party composition define high fantasy |
| Post-Apocalyptic | `resources` (food/water/ammo/medical), `environment.radiation` | Scarcity and environmental hazards are the core tension |

### Token cost
Each schema has ~7 top-level properties plus a character array — comparable to the existing `default` preset. The embed snapshot transform (spec 09, 12) will compress them the same way.

## Implementation plan (high level)

1. Define the four schema constants (`value` + `html`) in `src/config.ts` alongside `DEFAULT_SCHEMA_VALUE` / `DEFAULT_SCHEMA_HTML`.
2. Add the four preset entries to `defaultSettings.schemaPresets`.
3. Add the four keys to `readOnlyValues` in `Settings.tsx` `<STPresetSelect>`.
4. Handle upgrade path: on settings load, inject any missing built-in preset keys that don't yet exist in the user's stored presets (same pattern as adding `default` today).
5. Add tests verifying the new schemas produce valid example output via `schemaToExample()`.

## Acceptance criteria

- [ ] Extension ships with five built-in presets: `default`, `space_opera`, `cyberpunk_detective`, `fantasy_adventure`, `post_apocalyptic`.
- [ ] All five appear in the Schema Preset dropdown on a fresh install.
- [ ] Built-in presets cannot be deleted by the user.
- [ ] Each preset's HTML template renders without errors (Handlebars strict mode).
- [ ] Sequential part generation works for all presets (character array depends on `charactersPresent`).
- [ ] Existing users who upgrade receive the new presets without losing their custom presets.

## Tasks checklist

- [ ] Define schema constants in `src/config.ts`
- [ ] Register presets in `defaultSettings.schemaPresets`
- [ ] Protect preset keys in Settings UI (`readOnlyValues`)
- [ ] Implement upgrade-path injection of missing built-in presets
- [ ] Add `schemaToExample()` tests for each new schema
- [ ] Add Handlebars render tests for each new template
- [ ] Verify in SillyTavern (smoke test)
- [ ] Update CHANGELOG.md
- [ ] Update readme.md

## Notes

- Templates reuse the existing CSS class (`ztracker_default_mes_template`) so they inherit the same styling without additional CSS. The open question about genre-specific classes should be resolved before implementation — custom classes would allow per-genre theming but add CSS maintenance burden.
- The `x-ztracker-dependsOn` / `x-ztracker-idKey` annotations follow the conventions established in spec 08.
