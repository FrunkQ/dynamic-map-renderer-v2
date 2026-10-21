#!/usr/bin/env node
/**
 * update-vamper — move the Vamper engine to the latest commit on its
 * main branch (or a commit / branch given as the argument).
 *
 * Vamper (https://github.com/FrunkQ/vamper) is installed from GitHub,
 * pinned to a commit in package.json, so Mappadux plays exactly the
 * engine that was tested there. This resolves the ref to a commit and
 * re-pins it; commit package.json + package-lock.json afterwards.
 *
 * Usage:
 *   npm run vamper:update            # latest main
 *   npm run vamper:update -- <ref>   # a branch, tag or commit
 */
import { execFileSync } from 'node:child_process';

const ref = process.argv[2] ?? 'main';
let sha = ref;
if (!/^[0-9a-f]{40}$/.test(ref)) {
  const out = execFileSync('git', ['ls-remote', 'https://github.com/FrunkQ/vamper', ref], { encoding: 'utf8' });
  sha = out.split(/\s+/)[0] ?? '';
  if (!/^[0-9a-f]{40}$/.test(sha)) { console.error(`No commit found for "${ref}".`); process.exit(1); }
}
console.log(`Pinning vamper to ${sha} (${ref})`);
execFileSync('npm', ['install', '--save', `github:FrunkQ/vamper#${sha}`], { stdio: 'inherit', shell: process.platform === 'win32' });
