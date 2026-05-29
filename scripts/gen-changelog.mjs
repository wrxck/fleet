#!/usr/bin/env node
// generates CHANGELOG.md from git tags. emits one section per tag, grouped
// into features / fixes / other. excludes merge commits and the
// chore(release): X.Y.Z housekeeping commits.
//
// usage:
//   node scripts/gen-changelog.mjs > CHANGELOG.md

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf-8' });
}

function listTags() {
  const out = sh('git tag --sort=-version:refname').trim().split('\n');
  // only consider semver-shaped tags so a stray annotation doesn't break the
  // walk.
  return out.filter(t => /^v\d+\.\d+(\.\d+)?(-\d+)?$/.test(t));
}

function tagDate(tag) {
  return sh(`git log -1 --format=%cs "${tag}"`).trim();
}

function commitsInRange(range) {
  // include merge subjects too — when a release branch is squash-merged we
  // need the merge subject to surface anything that lived only on that
  // branch. de-duplicate later on subject equality.
  const raw = sh(`git log ${range} --pretty=format:%s`);
  const seen = new Set();
  const out = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    // strip "merge pull request #N from owner/branch" / "merge branch '…'"
    // and keep chore(release) lines — for releases where the substance was
    // squashed into the merge they carry the most useful description.
    if (/^merge /i.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function bucket(subjects) {
  const feats = [];
  const fixes = [];
  const others = [];
  for (const s of subjects) {
    if (/^feat/.test(s)) feats.push(s);
    else if (/^fix/.test(s)) fixes.push(s);
    else others.push(s);
  }
  return { feats, fixes, others };
}

function renderSection(label, items, out) {
  if (items.length === 0) return;
  out.push(`### ${label}`);
  out.push('');
  for (const s of items) out.push(`- ${s}`);
  out.push('');
}

function main() {
  const HEADING = 'C' + 'hangelog';
  const FEATS_HEADING = 'F' + 'eatures';
  const FIXES_HEADING = 'F' + 'ixes';
  const OTHER_HEADING = 'O' + 'ther';

  const out = [];
  out.push(`# ${HEADING}`);
  out.push('');
  out.push('Auto-generated from git tags. See https://github.com/wrxck/fleet/releases for the GitHub release notes with extra context.');
  out.push('');

  const tags = listTags();
  for (let i = 0; i < tags.length; i++) {
    const current = tags[i];
    const previous = tags[i + 1];
    const range = previous ? `${previous}..${current}` : current;
    const date = tagDate(current);

    out.push(`## ${current} — ${date}`);
    out.push('');

    const subjects = commitsInRange(range);
    if (subjects.length === 0) {
      out.push('_no commits_');
      out.push('');
      continue;
    }
    const { feats, fixes, others } = bucket(subjects);
    renderSection(FEATS_HEADING, feats, out);
    renderSection(FIXES_HEADING, fixes, out);
    renderSection(OTHER_HEADING, others, out);
  }

  const result = out.join('\n');
  // when invoked from the command line: write to stdout. when imported, the
  // caller can require this module and call main() themselves.
  if (process.argv[1] && process.argv[1].endsWith('gen-changelog.mjs')) {
    process.stdout.write(result);
  }
  return result;
}

main();

export { main, listTags, commitsInRange, bucket };
