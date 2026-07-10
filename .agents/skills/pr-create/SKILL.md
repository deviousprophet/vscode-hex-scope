---
name: pr-create
description: "Project-wide pull request creation rules. Use whenever creating, publishing, drafting, or updating a PR for this repository."
---

# PR Creation

Apply these rules to every pull request in this repository.

## Preflight

1. Inspect branch, worktree, commits, remote, default base branch, and existing PRs.
2. Never stage or commit unrelated user changes.
3. Require authenticated GitHub access before pushing or creating the PR.
4. Push the existing feature branch; do not create a replacement branch unless currently on the default branch.
5. Create a draft PR unless the user explicitly requests ready-for-review.

## Title

- Use Conventional Commits style.
- Use the exact main work commit subject when one commit represents the PR.
- Ignore Trellis bookkeeping commits such as task archive and session journal commits when choosing the title.
- If no single commit represents the full diff, write one concise commit-style title.
- A user-supplied title overrides these defaults.

## Body

Body has exactly these sections:

```markdown
## Summary

<one short paragraph describing purpose and impact>

## Main changes

- <main change>
- <main change>
```

Rules:

- Include only summary and primary changes.
- Do not add Testing, Validation, Checks, Checklist, or test-result text.
- Do not mention Trellis task, archive, journal, or workflow bookkeeping unless that bookkeeping is the PR's main product change.
- Do not dump commit lists, implementation chronology, or low-level file inventories.

## Publish

1. Preview exact title/body before creation when the user has not already approved them.
2. Push with upstream tracking when needed.
3. Create the PR against the repository default branch unless the user specifies another base.
4. Read back PR title, body, head, base, URL, and draft state after creation.
