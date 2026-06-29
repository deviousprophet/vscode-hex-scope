#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const BUMPERS = {
  major: ({ major }) => `${major + 1}.0.0`,
  minor: ({ major, minor }) => `${major}.${minor + 1}.0`,
  bugfix: ({ major, minor, patch }) => `${major}.${minor}.${patch + 1}`,
};

export function nextReleaseVersion(currentVersion, releaseType) {
  const bump = BUMPERS[releaseType];
  if (!bump) {
    throw new Error('release type must be major, minor, or bugfix');
  }

  return bump(parseVersion(currentVersion));
}

function parseVersion(currentVersion) {
  const match = currentVersion?.match(/^(\d+)\.(\d+)\.(\d+)$/);

  if (!match) {
    throw new Error(`current version must be plain semver x.y.z; got ${currentVersion ?? ''}`);
  }

  const [, major, minor, patch] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(nextReleaseVersion(process.argv[2], process.argv[3]));
  } catch (error) {
    console.error(`next-release-version: ${error.message}`);
    process.exit(1);
  }
}
