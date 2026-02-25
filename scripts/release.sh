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

# Bump version (this updates package.json, package-lock.json, commits, and tags)
echo "Bumping $VERSION_TYPE version..."
npm version "$VERSION_TYPE" -m "bump to v%s"

# Get the new version
NEW_VERSION=$(node -p "require('./package.json').version")

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
