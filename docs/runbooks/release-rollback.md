# Bad release rollback

Users pin `knanao/factory-action@v0` (the major tag) or an exact `vX.Y.Z` tag.
The **Release** workflow (`.github/workflows/release.yml`) moves the major tag
to each new release, so a bad release reaches every `@v0` user at once.

## Roll back the major tag

1. Find the last good release: `git tag --list 'v0.*' --sort=-v:refname`.
2. Point the major tag back at it and push (needs maintainer rights; this
   rewrites a published tag, so announce it):

   ```sh
   git fetch --tags --force origin
   git tag --force v0 'v0.1.0^{commit}'
   git push origin refs/tags/v0 --force
   ```

3. Mark the bad GitHub release as a pre-release or edit its notes to say it was
   withdrawn. Keep the bad `vX.Y.Z` tag itself so pinned workflows keep
   resolving; do not delete published tags.

## Fix forward

1. Fix the problem on a branch and merge it through a PR.
2. Wait for the required checks on the merge commit in `main`, then run
   **Release** > **Run workflow** with the next patch version. It moves `v0` to
   the new release.
3. If the bad release changed state stored in tracking comments, check that the
   fixed version still reads it (see `src/state.ts`).

## When the Release workflow fails

- **Before Create Release** (version, required checks, `dist/`): nothing was
  published. Fix the cause (wait for the checks, or merge a rebuilt `dist/`) and
  run the workflow again with the same version.
- **In Move Major Tag**: the `vX.Y.Z` release exists but `v0` still points to
  the previous one. Do not run the workflow again with the same version (the tag
  exists); move `v0` by hand with the commands above, using the new version.

## Confirm the fix

Run a workflow that uses `knanao/factory-action@v0`, check that the
`Download action repository 'knanao/factory-action@v0' (SHA:...)` line in the
**Set up job** step shows the good release's commit, then confirm the run
succeeds.
