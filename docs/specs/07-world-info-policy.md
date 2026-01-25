# 07 - World Info policy during tracker generation

Status: **Completed**

## Summary
Add a zTracker setting that controls whether **World Info (lorebooks)** are included when generating a tracker.

User goals:
- Reduce noise/latency in tracker generation by excluding World Info entirely.
- Optionally include only specific World Info books during tracker generation.

Non-goal:
- Changing how normal (non-tracker) SillyTavern generations include World Info.

## UX
New settings under **Extensions → zTracker**:

1) **World Info during tracker generation** (select)
- Include all (default)
- Exclude all
- Allow only specified books

2) **Allowed World Info book names** (textarea, shown only when allowlist mode)
- One book name per line
- Matching is case-insensitive

3) **Allowed World Info entry IDs (UIDs)** (textarea, shown only when allowlist mode)
- One per line (or comma/space separated)
- Matches explicit entry `uid` values regardless of which book they are in

Notes:
- If allowlist is empty, tracker generation behaves like “Exclude all”.

## Behavior
During tracker generation (`generateTracker`):

- **Include all**
  - zTracker uses `buildPrompt(...)` normally.
  - All World Info that SillyTavern would normally include is included.

- **Exclude all**
  - zTracker calls `buildPrompt(..., { ignoreWorldInfo: true })`.
  - No World Info is included.

- **Allowlist**
  - zTracker calls `buildPrompt(..., { ignoreWorldInfo: true })`.
  - zTracker loads relevant World Info books for the current context and injects a single `system` message containing only:
    - entries from allowlisted books, and/or
    - entries whose `uid` is allowlisted

### What “relevant World Info books” means
zTracker gathers World Info books from the same major sources SillyTavern commonly uses:
- Global selected world info books
- Chat metadata world info book
- Character world info books (character card + extra books)
- Persona lorebook

Then it filters that set by the allowlist.

## Implementation notes
- New settings fields live in `ExtensionSettings`:
  - `trackerWorldInfoPolicyMode`: `include_all | exclude_all | allowlist`
  - `trackerWorldInfoAllowlistBookNames`: `string[]`
  - `trackerWorldInfoAllowlistEntryIds`: `number[]`

- Prompt building uses the `ignoreWorldInfo` flag in `sillytavern-utils-lib` `buildPrompt`.

- Allowlist injection uses `getWorldInfos(...)` to load entries, then formats them into a single string.

## Testing
- Unit tests cover:
  - Mode → `ignoreWorldInfo` behavior.
  - Allowlist formatting filters by book name and skips disabled entries.

## Open questions
- Should allowlist matching be exact-only or support wildcards/regex?
- Should the injected World Info preserve SillyTavern’s before/after placement, or is a single system block sufficient?
- Should we expose a UI helper to pick from currently available book names?

## Verification
- Unit tests: `npm test`
- Manual: Extensions → zTracker
  - Set “World Info during tracker generation” to “Exclude all”, generate a tracker, and confirm World Info is not present.
  - Set it to “Allow only specified…”, then:
    - Add one known lorebook name and confirm only that book’s entries are injected.
    - Add a known entry `uid` and confirm only that entry is injected (even if its book is not allowlisted).
