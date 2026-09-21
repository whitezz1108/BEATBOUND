#!/usr/bin/env bash
# Publish dist/ to the gh-pages branch.
#
# The built site is committed as a flat snapshot: gh-pages contains exactly the
# files inside dist/, with no build sources and no history from evan-branch. The
# tree is rebuilt from scratch on every deploy so files dropped from the library
# (retired levels, old hashed bundles) do not linger on the live site.
#
# Run `npm run build` first. Requires push access to origin.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

BRANCH=gh-pages
SRC=dist

[ -f "$SRC/index.html" ] || { echo "error: $SRC/index.html missing -- run 'npm run build' first" >&2; exit 1; }

# Jekyll would otherwise ignore any future file starting with an underscore.
: > "$SRC/.nojekyll"

WT=$(mktemp -d)
cleanup() { git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"; }
trap cleanup EXIT

echo "==> checking out origin/$BRANCH into a scratch worktree"
# Fetch into an explicit ref: this repo's fetch refspec is narrowed to
# evan-branch, so `origin/$BRANCH` is not maintained locally.
git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH"
git worktree add --detach "$WT" "origin/$BRANCH" >/dev/null

# Replace the previous snapshot wholesale. `.git` is excluded because in a
# linked worktree it is a file pointing back at the main repository.
echo "==> replacing branch contents with $SRC/"
find "$WT" -mindepth 1 -maxdepth 1 -not -name .git -exec rm -rf {} +
cp -R "$SRC"/. "$WT"/

cd "$WT"
git add -A
if git diff --cached --quiet; then
  echo "==> nothing changed; $BRANCH is already up to date"
  exit 0
fi

git commit -q -m "Deploy: $1"
echo "==> committing $(git diff --cached --name-only | wc -l) file(s)"
git push origin "HEAD:refs/heads/$BRANCH"
echo "==> pushed to $BRANCH"
