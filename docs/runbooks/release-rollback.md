# Bad release rollback

Users pin `knanao/factory-action@v0` (the major tag) or an exact `vX.Y.Z` tag.
`script/release` moves the major tag to each new release, so a bad release
reaches every `@v0` user at once.

## Roll back the major tag

1. Find the last good release: `git tag --list 'v0.*' --sort=-v:refname`.
2. Point the major tag back at it and push (needs maintainer rights; this
   rewrites a published tag, so announce it):

   ```sh
   git tag --force --annotate v0 v0.1.0^{} --message "Roll back v0 to v0.1.0"
   git push origin v0 --force
   ```

3. Mark the bad GitHub release as a pre-release or edit its notes to say it was
   withdrawn. Keep the bad `vX.Y.Z` tag itself so pinned workflows keep
   resolving; do not delete published tags.

## Fix forward

1. Fix the problem on a branch, merge it through a PR and cut a new patch
   release with `script/release`, which moves `v0` to it.
2. If the bad release changed state stored in tracking comments, check that the
   fixed version still reads it (see `src/state.ts`).

## Confirm the fix

Run a workflow that uses `knanao/factory-action@v0`, check that the
`Download action repository 'knanao/factory-action@v0' (SHA:...)` line in the
**Set up job** step shows the good release's commit, then confirm the run
succeeds.
