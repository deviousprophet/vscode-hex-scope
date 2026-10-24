---
name: update-changelog
description: "Prepare or revise release changelog entries synchronized with package versions from committed changes since latest release tag. Follows Keep a Changelog. Use when asked to update CHANGELOG.md, prepare release notes, choose next release version, bump release version, finalize untagged changelog draft, recheck changelog date/version before push."
---

# Update Changelog

Maintained as a [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) file for a project that follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Keep a Changelog rules (apply to every edit)

- A changelog is for humans: a curated list of notable, **user-observable** changes per version — not a git log, not a development diary.
- The unit of an entry is the **net difference a user experiences when upgrading from the previous release**. Work that was introduced and then fixed, reworked, or refined inside the same unreleased range produces ONE entry describing the final behavior; the interim fixes/refinements produce no separate entries. **Never log internal development changes between the latest code and the last release tag.**
- One dated section per release: `## [X.Y.Z] - YYYY-MM-DD` (ISO 8601). Latest version first. Every section has a non-empty body.
- Keep `## [Unreleased]` at the top for upcoming changes.
- Group entries under these types, in this order, omitting empty sections:
  - `Added` — new features
  - `Changed` — changes in existing functionality
  - `Deprecated` — soon-to-be-removed features
  - `Removed` — now-removed features
  - `Fixed` — bug fixes
  - `Security` — vulnerabilities
- Deprecations, removals, and breaking changes must always be listed — they matter most to upgrading users.
- Entries describe outcomes, not implementation: one user-visible outcome per bullet, one crisp sentence, written for an end user.

### File header

`CHANGELOG.md` opens with exactly:

```markdown
# Changelog

All notable changes to the Hex Scope extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
```

If the header is missing, names a different project, or is a foreign scaffold (an extension name that is not Hex Scope), repair it as part of the next approved edit — surface the repair in the preview. Never change the header silently.

## Modes

- **update** (default) — rewrite `## [Unreleased]` from the net diff `<latest-tag>..HEAD`. Never touches versions or package files.
- **release** — only on an explicit release / cut-version request: promote `[Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and bump package versions.

Determine the mode from the request; when in doubt use `update`.

## 1. Inspect release state

Resolve state with repository-native commands:

```bash
git status --short
git describe --tags --abbrev=0 --match "v*" HEAD
git rev-parse HEAD
git log --reverse --format="%H%x09%s" <latest-tag>..HEAD
node -p "require('./package.json').version"
node -p "require('./package-lock.json').version"
node -p "require('./package-lock.json').packages[''].version"
```

Use the latest reachable `v*` tag as the exclusive base and `HEAD` as the inclusive end. Stop and ask for the intended base if no reachable `v<semver>` tag exists. Snapshot `git status --short`; never overwrite unrelated work. Candidate changes come only from committed `<latest-tag>..HEAD` — uncommitted changes are out of scope.

Read the first `## [version]` section and `git tag --list "v<version>"` to decide whether it is a tagged release (untouchable) or an editable untagged draft.

## 2. Evidence: classify against the last release

A candidate outcome belongs in the changelog only if a user upgrading from `<latest-tag>` observes it. Classify every candidate:

- **new-in-range** — the feature/capability does not exist at the tag → `Added` entry.
- **changed-from-release** — behavior exists at the tag and differs now → `Changed` (or `Deprecated`/`Removed`).
- **fix-to-release-behavior** — a bug that exists at the tag is fixed → `Fixed` (or `Security`).
- **dev-noise** — a fix, rename, or rework of something introduced in this same range, or a fix whose trigger is only created by in-range work (no released flow produces the situation) → **fold into the introducing entry or drop**; never list it.

Verify presence at the tag instead of assuming:

```bash
git show <latest-tag>:<path>
git cat-file -e <latest-tag>:<path>
git grep <pattern> <latest-tag> -- <paths>
git diff <latest-tag>..HEAD -- <user-facing docs or entry points>
```

Changed code is authoritative. Tests, CI, tooling, and refactors are not user-visible and only help you understand behavior. User-facing docs and entry points help enumerate outcomes; they are not entries by themselves.

## 3. Enrich with PR context

When GitHub access works, read descriptions of merged PRs represented in the range for intent and context (`gh pr view <number> --json title,body,files,mergeCommit`; otherwise map commits with GitHub's commit-pulls endpoint). PR text is context only — diff and tag evidence decide. If GitHub metadata is unavailable, continue from local evidence and note the limitation in the preview.

## 4. Filter and group

Include only observable user impact:

- New features/capabilities → `Added`
- Changed behavior, performance, reliability, compatibility → `Changed`
- Deprecations → `Deprecated`; removals → `Removed`
- Bug fixes → `Fixed`; vulnerabilities → `Security`

Exclude:

- Tests, fixtures, samples, coverage-only work
- CI, tooling, dependencies, version bumps, task/journal/release bookkeeping
- Internal refactors and renames with no observable impact
- In-range fixes/refinements of in-range features (fold per section 2)
- Commit/PR chronology and implementation detail

Group related candidates into one bullet per user-visible outcome and deduplicate overlapping descriptions. Split bullets that stack several outcomes — one outcome per line.

## 5. Infer version (release mode only)

Base = latest tagged SemVer; precedence:

1. breaking change → major (`x+1.0.0`)
2. otherwise backward-compatible feature → minor (`x.y+1.0`)
3. otherwise fixes only → patch (`x.y.z+1`)
4. nothing qualifying → report "Nothing new to log."; change no files

If the newest changelog version has no matching tag, treat it as a draft and reassess it from every qualifying change since the latest tag: preserve good wording; add omissions; remove noise/duplicates/stale claims; reclassify; correct version/date. An explicit user-specified version wins. Never modify a tagged release section.

## 6. Write

### update mode

```markdown
## [Unreleased]

### Added
- ...
### Changed
- ...
### Deprecated
- ...
### Removed
- ...
### Fixed
- ...
### Security
- ...
```

Only non-empty sections appear. If `[Unreleased]` already exists, compare its topics with the new net-diff entries: overlapping topics are **replaced** by the net-diff content; distinct topics merge.

### release mode

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- ...
```

Promote the `[Unreleased]` content (fill from the range if empty), replace the `[Unreleased]` heading, and leave no empty `[Unreleased]` section — a future update run re-creates it.

### Release packaging

Release builds keep `[Unreleased]` out of what users see:

- `package.yml` runs `.github/scripts/strip-unreleased-changelog.mjs` before `vsce package`, so the VSIX changelog starts at the newest dated release section.
- `extract-release-notes.mjs` only accepts a dated `## [X.Y.Z] - YYYY-MM-DD` section and refuses `Unreleased`; tagging without a promoted section fails the Release job.

### Style rules

- One user-visible outcome per bullet; a single crisp sentence; split run-ons.
- Start bullets with a capitalized outcome phrase.
- Use backticks for UI labels, commands, formats, and code identifiers.
- No terminal periods; no PR numbers, hashes, author names, or links; no implementation detail.
- Use the current local date (`YYYY-MM-DD`) in release mode only.

### Release-note extractor compatibility

`.github/scripts/extract-release-notes.mjs` requires: an exact `## [<version>] - <date>` heading, a non-empty body, and reverse chronology. Keep all three.

## 7. Preview and wait

Before any mutation, show:

- Latest release tag and analyzed range
- The evidence-backed entry table: every surviving entry, and every candidate dropped or folded with its classification and why
- Header repair, if any (exact before/after)
- Whether this is update (`[Unreleased]`) or release, plus proposed version and SemVer rationale (release mode only)
- Exact complete changelog section(s)
- Package version change (release mode only)
- Missing GitHub context, if any

Request one explicit approval. Do not edit before approval.

## 8. Apply approved update

### update mode

Replace/create the `## [Unreleased]` section and apply the approved header repair. No other file changes.

### release mode

1. Replace the `## [Unreleased]` heading with `## [X.Y.Z] - YYYY-MM-DD` (keep its content), then delete the now-empty `[Unreleased]` section so the versioned section is topmost.
2. Update package versions without scripts or tags:

   ```bash
   npm version <version> --no-git-tag-version --ignore-scripts
   ```

3. `package.json` changes only the top-level `version`; `package-lock.json` only the top-level `version` and `packages[""].version`.
4. Do not change release automation.

Validate against the pre-edit `HEAD`:

```bash
git diff -- CHANGELOG.md package.json package-lock.json
git diff --unified=0 HEAD -- package.json package-lock.json
node -e "const p=require('./package.json');const l=require('./package-lock.json');if(p.version!==l.version||p.version!==l.packages[''].version)process.exit(1)"
node .github/scripts/extract-release-notes.mjs v<version>
```

Verify:

- Top heading is exactly `## [<version>] - <today-local-YYYY-MM-DD>` (release) or `## [Unreleased]` (update); the header block above it is intact
- Sections are only `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, in that order, with no empty section
- Every bullet is a user-visible outcome: single sentence, no terminal period, no PR/commit identifiers, no in-range development history
- Top version matches all three package version fields (release mode); package diffs touch only the allowed fields
- Release-note extractor returns the intended non-empty section (release mode)

Fix validation failures only within skill-owned edits. Never discard pre-existing user changes.

## 9. Never commit, tag, or push on your own

This skill never commits, tags, or pushes automatically — that needs a separate explicit request. Immediately before an explicitly requested push, repeat the state commands. If the top untagged entry's date is not today's local date, preview a date-only correction, obtain approval, update it, and rerun validation.
