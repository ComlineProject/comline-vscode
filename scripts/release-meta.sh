#!/usr/bin/env bash
# Decide what a release-workflow run is, from the event that started it.
#
#   GITHUB_EVENT_NAME=push GITHUB_REF_TYPE=tag GITHUB_REF_NAME=v0.2.0 scripts/release-meta.sh
#
# Prints `key=value` lines (append them to $GITHUB_OUTPUT) and writes notes.md:
#
#   channel     stable | pre | dev | dry | skip
#   version     what goes into package.json for this build
#   tag         the release's tag (empty for a dry run)
#   prerelease  true | false
#
# The channels:
#
#   stable  a pushed `vX.Y.Z`. Must equal package.json's version and have a
#           `## [X.Y.Z]` section in CHANGELOG.md, which becomes the notes.
#           Published to Open VSX.
#   pre     a pushed `vX.Y.Z-<anything>` (rc.1, beta.2, ...). X.Y.Z must not
#           already be released. A GitHub prerelease, never published.
#   dev     a push to main. CI makes the tag itself: a prerelease of the next
#           unreleased version, `vX.Y.Z-dev.N`, where N counts the commits since
#           the last stable tag. N only grows along main, and the version sorts
#           below the release it leads up to. Never published.
#   dry     a manual dispatch: build and package only.
#   skip    a push to main of a commit that already carries a stable tag:
#           nothing to build.
#
# Needs full history and tags (actions/checkout with fetch-depth: 0).

set -euo pipefail

die() {
  echo "::error::$*" >&2
  exit 1
}

pkg=$(node -p "require('./package.json').version")

# The body of `## [<name>]` in CHANGELOG.md, up to the next `## [` heading.
section() {
  awk -v v="$1" '
    index($0, "## [" v "]") == 1 { on = 1; next }
    on && index($0, "## [") == 1 { exit }
    on { print }
  ' CHANGELOG.md
}
blank() { [ -z "$(tr -d '[:space:]' <<<"$1")" ]; }
tag_exists() { git rev-parse -q --verify "refs/tags/$1" >/dev/null; }

semver='^v([0-9]+)\.([0-9]+)\.([0-9]+)(-([0-9A-Za-z.-]+))?$'

if [ "${GITHUB_REF_TYPE:-}" = tag ]; then
  tag=$GITHUB_REF_NAME
  [[ $tag =~ $semver ]] || die "tag $tag is not vX.Y.Z or vX.Y.Z-<pre>"
  base="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.${BASH_REMATCH[3]}"
  pre=${BASH_REMATCH[5]}

  if [ -z "$pre" ]; then
    channel=stable
    [ "$base" = "$pkg" ] || die "tag $tag does not match package.json version (expected v$pkg)"
    version=$pkg
    notes=$(section "$version")
    blank "$notes" && die "CHANGELOG.md has no '## [$version]' section — cut one in the release PR"
  else
    channel=pre
    [[ $pre == dev.* ]] && die "-dev.N tags are made by CI on pushes to main; use -rc.N, -beta.N, ..."
    tag_exists "v$base" && die "$base is already released; a prerelease must lead up to an unreleased version"
    version=${tag#v}
    notes=$(section "$base")
    blank "$notes" && notes=$(section Unreleased)
    blank "$notes" && notes="Prerelease of $base."
  fi

elif [ "${GITHUB_EVENT_NAME:-}" = push ]; then
  channel=dev
  # The last stable release on this line of history, if there is one.
  last=$(git tag --merged HEAD -l 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n1 || true)
  if [ -n "$last" ] && [ "$(git rev-parse "$last^{commit}")" = "$(git rev-parse HEAD)" ]; then
    # This commit *is* a release; a dev build of it would be the same bytes
    # under a misleading `-dev.0` name.
    echo "$last already releases $(git rev-parse --short HEAD); no dev build" >&2
    printf 'channel=skip\nversion=\ntag=\nprerelease=false\n'
    exit 0
  fi
  if [ -n "$last" ]; then
    n=$(git rev-list --count "$last..HEAD")
  else
    n=$(git rev-list --count HEAD)
  fi
  # A dev build leads up to the next unreleased version: package.json's own
  # until that is tagged, then the patch after it.
  if tag_exists "v$pkg"; then
    IFS=. read -r major minor patch <<<"$pkg"
    base="$major.$minor.$((patch + 1))"
  else
    base=$pkg
  fi
  version="$base-dev.$n"
  tag="v$version"
  if tag_exists "$tag" && [ "$(git rev-parse "$tag^{commit}")" != "$(git rev-parse HEAD)" ]; then
    die "$tag already exists on another commit"
  fi

  since=$(git tag --merged HEAD -l 'v*' --sort=-creatordate | grep -v "^$tag\$" | head -n1 || true)
  range=${since:+$since..}HEAD
  notes="Development build of $(git rev-parse --short HEAD) on \`main\`. **Not published to Open VSX** — install a \`.vsix\` below by hand.

Changes since ${since:-the first commit}:

$(git log --no-merges -n 30 --format='- %s (%h)' "$range")"

else
  channel=dry
  version=$pkg
  tag=
  notes=$(section "$version")
  blank "$notes" && notes="(dry run: CHANGELOG.md has no '## [$version]' section)"
fi

prerelease=false
case $channel in pre | dev) prerelease=true ;; esac

printf '%s\n' "$notes" >notes.md
echo "channel=$channel"
echo "version=$version"
echo "tag=$tag"
echo "prerelease=$prerelease"
