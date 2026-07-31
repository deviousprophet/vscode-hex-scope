---
name: update-changelog
description: "Prepare or revise release changelog entries synchronized with package versions from committed changes since latest release tag. Use when asked to update CHANGELOG.md, prepare release notes, choose next release version, bump release version, finalize untagged changelog draft, recheck changelog date/version before push."
---

# Update Changelog

Two modes:
- **update** (default) — append/overwrite `## [Unreleased]` section from `tag..HEAD`. Never touches versions or package.json.
- **release** — on explicit "release" request: replace current `[Unreleased]` with `## [X.Y.Z] - YYYY-MM-DD`, bump package versions, delete now-empty `[Unreleased]` heading. Release replaces `[Unreleased]` with the versioned section; no empty section left for next cycle.

## 1. Inspect Release State

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

Use latest reachable `v*` tag as exclusive base, `HEAD` as inclusive end. Stop if no reachable `v<semver>` tag exists; ask user for intended base tag/version. Read first `## [version]` section in `CHANGELOG.md`; check `git tag --list "v<version>"` to decide whether it's a tagged release or an editable draft. Snapshot `git status --short`. Never overwrite unrelated work. Candidate changes come only from committed `<latest-tag>..HEAD`; exclude uncommitted changes.

**Determine mode**: if user explicitly says release / cut release / set version, mode=`release`. Otherwise mode=`update` (default). In `update` mode: write to `[Unreleased]`, skip version inference, skip versioned heading, skip package.json bumps. In `release` mode: promote `[Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`, bump packages.

Inspect authoritative evidence:

```bash
git log --reverse --format="%H%x09%s" <tag>..HEAD
git diff --stat <tag>..HEAD
git diff --name-status <tag>..HEAD
git diff <tag>..HEAD -- <relevant paths>
```

Read changed code/tests only to understand observable behavior. Do not turn test implementation into release notes.

## 2. Enrich With PR Context

When GitHub access works, read descriptions of merged PRs represented in the range:

- Use PR numbers in commit subjects when present, then `gh pr view <number> --json title,body,files,mergeCommit`.
- Otherwise map commit with GitHub's commit-pulls endpoint, then read associated PR.
- Accept PR text for intent/context only. Actual diff/code is authoritative.

If GitHub metadata is unavailable, continue with local Git evidence and state this limitation in preview. Do not block.

## 3. Filter and Group

Include only observable user impact:

- New features or capabilities
- Changed behavior, performance, reliability, or compatibility
- Bug fixes
- Security fixes
- Breaking behavior/removals/deprecations

Exclude:

- Tests, fixtures, samples, or coverage-only work
- Docs-only, formatting, CI, tooling, dependency, version-bump, task, journal, or release bookkeeping
- Internal refactors with no observable impact
- Commit/PR chronology

Group related commits/PRs into one bullet per user-visible outcome. Deduplicate overlapping descriptions.

## 4. Infer Version (release mode only)

Use the latest tagged SemVer as base. Apply highest-impact precedence:

1. Any breaking change → major (`x+1.0.0`)
2. Otherwise any backward-compatible feature → minor (`x.y+1.0`)
3. Otherwise fixes only → patch (`x.y.z+1`)
4. No qualifying change since last tag → report no update; change no files

If newest changelog version has no matching Git tag, treat as draft. Reassess its version using every qualifying change since latest tag. Preserve good wording, but add omissions, remove noise/duplicates/stale claims, reclassify, correct version/date.

When user specifies an explicit version, use that instead of inferring.

Never modify a tagged release section.

## 5. Write Changelog

### update mode

```markdown
## [Unreleased]

### Added
- ...
### Changed
- ...
### Fixed
- ...
```

If no `[Unreleased]` section exists, create it with entries from `tag..HEAD`. If `[Unreleased]` section already exists (hand-written or from prior update), compare its topics with the new commit-derived entries:

- **Related** — existing entries cover the same features/areas as new commits → **replace** with authoritative commit-derived content (it's the source of truth).
- **Unrelated** — existing entries cover different features/areas than new commits → **merge**: keep existing entries and append new ones under appropriate sections.

If no qualifying changes since last tag → report "Nothing new to log." Change no files.

### release mode

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- ...
### Changed
- ...
### Fixed
- ...
```

Promote current `[Unreleased]` content. If `[Unreleased]` is empty, fill from tag..HEAD. Replace the `## [Unreleased]` heading with `## [X.Y.Z] - YYYY-MM-DD` and delete the now-empty section — the versioned section becomes topmost. No `[Unreleased]` heading is left behind; a future update run re-creates it.

After release, `[Unreleased]` stays empty until new commits arrive after the tag.

### Style rules (both modes)

- Section order: `Added`, `Changed`, `Fixed`; omit empty sections
- New capabilities → `Added`
- Behavior/performance/compatibility/breaking/removal/deprecation → `Changed`
- Bug/security corrections → `Fixed`
- Start bullets with a capitalized outcome phrase
- Use backticks for UI labels, commands, formats, and code identifiers
- No terminal periods
- No PR numbers, hashes, author names, or links
- Use current local date (`YYYY-MM-DD`) in release mode only

Keep `.github/scripts/extract-release-notes.mjs` compatibility: exact version heading, non-empty body, reverse chronology.

## 6. Preview and Wait

Before any mutation, show:

- Latest release tag and analyzed range
- Qualifying outcomes; note excluded ambiguous items when useful
- Proposed version and SemVer rationale (release mode only)
- Whether this is update (Unreleased) or release (new versioned section)
- Exact complete changelog section(s)
- `package.json` and `package-lock.json` version change (release mode only)
- Missing GitHub context, if any

Request one explicit approval. Do not edit before approval.

## 7. Apply Approved Update

### update mode

Replace/create `## [Unreleased]` section at top of `CHANGELOG.md`. No other file changes.

### release mode

1. Replace the `## [Unreleased]` heading with `## [X.Y.Z] - YYYY-MM-DD` (keep its content), then delete the now-empty `[Unreleased]` section so the versioned section is topmost.
2. Update package versions without scripts or tags:

   ```bash
   npm version <version> --no-git-tag-version --ignore-scripts
   ```

3. Ensure `package.json` changes only top-level `version`.
4. Ensure `package-lock.json` changes only top-level `version` and `packages[""].version`.
5. Do not change release automation.

Validate against the pre-edit `HEAD`:

```bash
git diff -- CHANGELOG.md package.json package-lock.json
git diff --unified=0 HEAD -- package.json package-lock.json
node -e "const p=require('./package.json');const l=require('./package-lock.json');if(p.version!==l.version||p.version!==l.packages[''].version)process.exit(1)"
node .github/scripts/extract-release-notes.mjs v<version>
```

Verify all succeed:

- Top heading exactly `## [<version>] - <today-local-YYYY-MM-DD>` (release) or `## [Unreleased]` (update)
- Top version matches all three package version fields (release mode)
- Package diffs change only `package.json.version`, `package-lock.json.version`, and `package-lock.json.packages[""].version`
- Sections are only `Added`, `Changed`, `Fixed`, in order, with no empty section
- Bullets have no terminal periods or PR/commit identifiers
- Release-note extractor returns intended non-empty section (release mode)

Fix validation failures only within skill-owned edits. Never discard pre-existing user changes.

## 8. Before Explicit Push

This skill never commits, tags, or pushes automatically. Requires a separate explicit request. Immediately before an explicitly requested push, repeat state commands. If the top untagged entry's date is not today's local date, preview a date-only correction, obtain approval, update it, rerun validation.
