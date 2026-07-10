# Task Naming and PR Creation Code-Spec

## Scenario: Create ordered tasks and concise pull requests

### 1. Scope / Trigger

Applies whenever code creates/resolves a Trellis task directory or an agent creates/updates a GitHub pull request for this repository.

Owners:

- Task runtime: `.trellis/scripts/common/task_store.py` and `task_utils.py`.
- User-facing task contract: `.trellis/workflow.md` and `.trellis/scripts/task.py` help.
- PR execution rule: `.agents/skills/pr-create/SKILL.md`.

### 2. Signatures

```text
python ./.trellis/scripts/task.py create "<title>" --slug <short-name>
-> .trellis/tasks/<NN>-<short-name>/
```

`NN` is allocated by `_next_task_number_prefix(tasks_dir)`. Callers never supply the numeric prefix.

PR interface:

```text
head: current feature branch
base: user-specified branch, otherwise repository default
title: main work commit subject, unless user overrides
body sections: Summary, Main changes
state: draft, unless user requests ready-for-review
```

### 3. Contracts

- Task numbering scans active directories plus `.trellis/tasks/archive/<year-month>/` task directories.
- Parse only a leading decimal number followed by `-`.
- Next number is `max(existing) + 1`; empty history starts at `00`; format uses at least two digits and grows beyond `99`.
- `task.json.id` and `name` remain the short slug. Directory name owns ordering.
- Exact and `-<slug>` suffix lookup remain supported.
- PR title uses Conventional Commits form and ignores Trellis archive/journal bookkeeping when identifying the main work commit.
- PR body contains exactly `## Summary` and `## Main changes`.
- PR body never contains Testing, Validation, Checks, Checklist, test results, task/archive/journal details, commit chronology, or low-level file dumps unless that item is the main product change.
- Always check for an existing PR before creating another.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| No active or archived numbered tasks | Allocate `00`. |
| Highest task is `09` in archive | Allocate `10`. |
| Highest task is `100` | Allocate `101`; do not truncate. |
| Non-numbered legacy directory | Ignore for allocation; retain lookup compatibility. |
| Exact destination already exists/archive collision | Preserve existing create error/collision handling. |
| Worktree contains unrelated changes | Do not stage them; clarify scope. |
| Existing PR for head branch | Update/report it; do not create duplicate. |
| No authenticated GitHub access | Stop before push/PR mutation. |
| User supplies title/base/draft state | User choice overrides default. |

### 5. Good/Base/Bad Cases

- Base: only `00-pr-create` exists -> next task is `01-feature-name`.
- Good: active numbers `00`, `02` and archived `07` -> allocate `08`.
- Good: PR title `docs: bootstrap Hex Scope Trellis specs`; body has one purpose paragraph and main-change bullets only.
- Bad: create `07-10-feature` from current date.
- Bad: add `## Testing` or `Tests pass` to PR body.
- Bad: title PR after latest bookkeeping commit such as `chore: record journal`.

### 6. Tests Required

- Empty, active-only, archive-only, mixed, gaps, legacy names, and >99 allocator cases.
- Python compilation for task runtime files.
- Search workflow/help/runtime for stale date-based task naming instructions.
- Before PR creation, preview exact title/body; after creation, read back title/body/head/base/draft/URL.

### 7. Wrong vs Correct

#### Wrong

```text
.trellis/tasks/07-10-add-search/

PR body:
## Summary
...
## Testing
- 419 tests passed
```

#### Correct

```text
.trellis/tasks/01-add-search/

PR body:
## Summary
...
## Main changes
- ...
```
