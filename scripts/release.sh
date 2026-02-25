#!/bin/bash
# NOTE 12/19/2025: haven't tested this script yet. Comment should be deleted once confirming this works on next release
# Usage: ./scripts/release.sh patch
set -e

VERSION_TYPE=${1:-patch}

# Validate version type
if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: ./scripts/release.sh [patch|minor|major]"
  echo "  patch - bug fixes (0.1.23 -> 0.1.24)"
  echo "  minor - new features (0.1.23 -> 0.2.0)"
  echo "  major - breaking changes (0.1.23 -> 1.0.0)"
  exit 1
fi

# Ensure we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "Error: Must be on main branch to release (currently on $CURRENT_BRANCH)"
  exit 1
fi

# Check for uncommitted tracked changes
if ! git diff --quiet || ! git diff --staged --quiet; then
  echo "Error: Tracked files have uncommitted changes. Commit or stash changes first."
  exit 1
fi

# Check for untracked files (warning only)
UNTRACKED=$(git ls-files --others --exclude-standard)
if [[ -n "$UNTRACKED" ]]; then
  echo "Warning: Untracked files present (continuing anyway):"
  echo "$UNTRACKED" | sed -n '1,5p'
fi

# Pull latest changes
echo "Pulling latest changes..."
git pull origin main

# Check if there are commits since last tag (previous release)
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [[ -n "$LAST_TAG" ]]; then
  COMMITS_SINCE_TAG=$(git rev-list "$LAST_TAG"..HEAD --count)
  if [[ "$COMMITS_SINCE_TAG" -eq 0 ]]; then
    echo "Error: No commits since last tag ($LAST_TAG). Nothing to release."
    exit 1
  fi
  echo "Commits since $LAST_TAG: $COMMITS_SINCE_TAG"
else
  echo "No previous tags found; this appears to be the first release."
fi

# Calculate the next version without tagging/committing yet
CURRENT_VERSION=$(node -p "require('./package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
if [[ -z "$MAJOR" || -z "$MINOR" || -z "$PATCH" ]]; then
  echo "Error: Failed to parse current version: $CURRENT_VERSION"
  exit 1
fi

case "$VERSION_TYPE" in
  patch)
    PATCH=$((PATCH + 1))
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
NEW_TAG="v$NEW_VERSION"

# Check if tag already exists
if git rev-parse "$NEW_TAG" &>/dev/null; then
  echo "Error: Tag $NEW_TAG already exists!"
  exit 1
fi

echo ""
echo "Ready to release: $NEW_VERSION"
echo "This will:"
echo "  1. Bump version ($CURRENT_VERSION -> $NEW_VERSION)"
echo "  2. Commit the version bump and create tag $NEW_TAG"
echo "  3. Push commit and tag to origin"
echo "  4. Create a GitHub release"
echo ""
read -p "Proceed? [y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# Bump version (this updates package.json, package-lock.json, commits, and tags)
echo "Bumping $VERSION_TYPE version..."
npm version "$VERSION_TYPE" -m "bump to v%s"

# Push commit and tag
echo "Pushing to origin..."
git push origin main
git push origin "v$NEW_VERSION"

# Create GitHub release (triggers publish.yml workflow)
echo "Creating GitHub release..."
gh release create "v$NEW_VERSION" --generate-notes

echo ""
echo "Release v$NEW_VERSION created successfully!"
echo "The publish workflow will now run: https://github.com/Use-Tusk/drift-node-sdk/actions"
