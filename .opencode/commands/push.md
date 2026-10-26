---
description: Stage all changes, commit, and push to the remote repository
---

Ensure every local change is committed and pushed to the remote:

1. Run `git status --short`. If there is nothing to commit, skip to step 4.
2. Stage everything with `git add -A`.
3. Commit with a concise message that summarizes the staged changes (inspect `git diff --cached --stat` and a sample of the diff to write it). Do not amend existing commits.
4. Push the current branch to `origin` with `git push origin HEAD`.
5. Report the commit hash and push result. If push fails (auth, rejected, etc.), stop and explain the error instead of retrying blindly.