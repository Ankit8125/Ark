// A targeted local guard, not a comprehensive secret scanner or security audit.
// Read the Git index, not just working-tree files; never print matched values.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const git = (args) => execFileSync('git', args, {
  cwd: root,
  maxBuffer: 32 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const privateDocs = new Set([
  'ark-cursor-handoff.md',
  'ark-final-versioned-implementation-plan.md',
  'ark-laptop-build-plan.md',
  'ark-research-refresh-2026-09-20.md',
]);
const placeholder = /^(?:REPLACE_[A-Z_]+|YOUR_[A-Z_]+|<[^>]+>|\$\{[^}]+\}|example|placeholder)$/i;
const patterns = [
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['provider token', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
];

try {
  const localSecrets = new Set();
  const envPath = join(root, '.env');
  if (existsSync(envPath)) {
    for (const [key, value] of Object.entries(parseEnv(readFileSync(envPath, 'utf8')))) {
      if (/password|secret|token|api.?key|database_url/i.test(key) && value.length >= 8 && !placeholder.test(value)) {
        localSecrets.add(value);
      }
      if (key === 'DATABASE_URL') {
        const password = decodeURIComponent(new URL(value).password);
        if (password.length >= 8 && !placeholder.test(password)) localSecrets.add(password);
      }
    }
  }

  const files = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .toString('utf8').split('\0').filter(Boolean);
  const failures = [];
  for (const path of files) {
    const basename = path.split('/').at(-1);
    if ((/^\.env(?:\..*)?$/.test(basename) && basename !== '.env.example') ||
        privateDocs.has(basename) || /\.(?:pem|key|p12|pfx)$/i.test(path) ||
        /(?:^|\/)(?:node_modules|dist|coverage|\.data|\.secrets)(?:\/|$)/.test(path)) {
      failures.push(`${path}: private/local/generated file must not be staged`);
      continue;
    }
    const content = git(['show', `:${path}`]).toString('utf8');
    if ([...localSecrets].some((secret) => content.includes(secret))) {
      failures.push(`${path}: contains a local .env credential (value withheld)`);
    }
    for (const [label, pattern] of patterns) {
      if (pattern.test(content)) failures.push(`${path}: possible ${label} (value withheld)`);
    }
    const urls = content.matchAll(/(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|https?):\/\/[^\s/:@]+:([^\s/@]+)@/gi);
    for (const match of urls) {
      if (!placeholder.test(match[1])) {
        failures.push(`${path}: credential-bearing URL (value withheld)`);
        break;
      }
    }
  }

  if (failures.length) {
    console.error('Commit blocked. Review these files; no secret values are shown:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`Staged-file guard passed for ${files.length} file(s). Review the staged diff before committing.`);
  }
} catch {
  console.error('Staged-file guard could not complete. Check Git and local .env syntax; details withheld to avoid exposing credentials.');
  process.exitCode = 1;
}
