---
name: update-changelog
description: "Prepare or revise Hex Scope release changelog entries and synchronized package versions from committed changes since the latest release tag. Use when asked to update CHANGELOG.md, prepare release notes, choose the next release version, bump the release version, finalize an untagged changelog draft, or recheck changelog date/version before a push."
---

# Update Changelog

Build concise user-impact release notes from committed repository evidence. Edit only after preview approval.

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

Use the latest reachable `v*` tag as exclusive base and `HEAD` as inclusive end. Stop if no reachable `v<semver>` tag exists; ask for the intended base tag/version. Read the first `## [version]` section in `CHANGELOG.md`; check `git tag --list "v<version>"` to decide whether it is tagged or an editable draft.

Snapshot `git status --short`. Never overwrite unrelated work. Candidate changes come only from committed `<latest-tag>..HEAD`; exclude uncommitted changes.

Inspect authoritative evidence:

```bash
git log --reverse --format="%H%x09%s" <tag>..HEAD
git diff --stat <tag>..HEAD
git diff --name-status <tag>..HEAD
git diff <tag>..HEAD -- <relevant paths>
```

Read changed code/tests only to understand observable behavior. Do not turn test implementation into release notes.

## 2. Enrich With PR Context

When GitHub access works, read descriptions for merged PRs represented in the range:

- Use PR numbers in commit subjects when present, then `gh pr view <number> --json title,body,files,mergeCommit`.
- Otherwise map a commit with GitHub's commit-pulls endpoint, then read the associated PR.
- Accept PR text as intent/context only. Actual diff/code is authoritative.

If GitHub metadata is unavailable, continue from local Git evidence and state this limitation in the preview. Do not block.

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

## 4. Infer Version

Use the latest tagged SemVer as base. Apply highest-impact precedence:

1. Any breaking change -> major (`x+1.0.0`)
2. Otherwise any backward-compatible feature -> minor (`x.y+1.0`)
3. Otherwise fixes only -> patch (`x.y.z+1`)
4. No qualifying change -> report no update; change no files

If the newest changelog version has no matching Git tag, treat it as a draft. Reassess its version using every qualifying change since the latest tag. Preserve good wording, but add omissions, remove noise/duplicates/stale claims, reclassify, and correct version/date. Never modify a tagged release section.

## 5. Write Repo Style

Use direct version sections only; never add `[Unreleased]`.

```markdown
## [2.12.0] - 2026-07-10

### Added

- Added user-visible capability with `TechnicalIdentifier`

### Changed

- Improved observable behavior or performance

### Fixed

- Fixed user-visible defect
```

Rules:

- Section order: `Added`, `Changed`, `Fixed`; omit empty sections
- New capabilities -> `Added`
- Behavior/performance/compatibility/breaking/removal/deprecation -> `Changed`
- Bug/security corrections -> `Fixed`
- Start bullets with a capitalized outcome phrase
- Use backticks for UI labels, commands, formats, and code identifiers
- No terminal periods
- No PR numbers, hashes, author names, or links
- Use current local date (`YYYY-MM-DD`), not commit/PR/tag date

Keep `.github/scripts/extract-release-notes.mjs` compatibility: exact version heading, non-empty body, reverse chronology.

## 6. Preview and Wait

Before any mutation, show:

- Latest release tag and analyzed range
- Qualifying outcomes; excluded ambiguous items when useful
- Proposed version and SemVer rationale
- Whether inserting a new section or rewriting an untagged draft
- Exact complete changelog section
- `package.json` and `package-lock.json` version change
- Missing GitHub context, if any

Request one explicit approval. Do not edit before approval.

## 7. Apply Approved Update

After approval:

1. Update only the top/new changelog section. Leave tagged sections byte-for-byte unchanged.
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

Verify all of these before reporting success:

- Top heading is exactly `## [<version>] - <today-local-YYYY-MM-DD>`
- Top version matches all three package version fields
- Package diffs change only `package.json.version`, `package-lock.json.version`, and `package-lock.json.packages[""].version`
- Sections are only `Added`, `Changed`, `Fixed`, in order, with no empty section
- Bullets have no terminal periods or PR/commit identifiers
- Release-note extractor returns the intended non-empty section

Fix validation failures only within skill-owned edits. Never discard pre-existing user changes.

## 8. Before an Explicit Push

This skill never commits, tags, or pushes automatically. Those require a separate explicit request.

Immediately before an explicitly requested push, repeat the state commands. If the top untagged entry date is not today's local date, preview the date-only correction, obtain approval, update it, and rerun validation.
