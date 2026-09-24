import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const guardSource = fileURLToPath(new URL('./check-staged.mjs', import.meta.url));
const fixturePrefix = 'ark-staged-guard-test-';

function fixture(t) {
  const tempRoot = resolve(tmpdir());
  const root = mkdtempSync(join(tempRoot, fixturePrefix));
  t.after(() => {
    // Delete only the temporary repository created by this test.
    assert.equal(dirname(resolve(root)), tempRoot);
    assert.ok(root.startsWith(join(tempRoot, fixturePrefix)));
    rmSync(root, { recursive: true, force: true });
  });

  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = join(root, 'unused-global-config');

  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  git('init', '--quiet', '--template=');
  mkdirSync(join(root, 'scripts'));
  copyFileSync(guardSource, join(root, 'scripts', 'check-staged.mjs'));

  return {
    write(path, content) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    },
    stage(...paths) {
      git('add', '--force', '--', ...paths);
    },
    check() {
      const result = spawnSync(process.execPath, ['scripts/check-staged.mjs'], {
        cwd: root,
        env,
        encoding: 'utf8',
        timeout: 20_000,
        windowsHide: true,
      });
      assert.equal(result.error, undefined, 'The isolated guard process must start');
      assert.equal(result.signal, null, 'The isolated guard process must finish');
      return result;
    },
  };
}

function assertBlocked(result, reason, withheldValue) {
  assert.equal(result.status, 1, 'Unsafe staged content must be rejected');
  assert.ok(result.stderr.includes('Commit blocked.'), 'Report the blocking result');
  assert.ok(result.stderr.includes(reason), 'Report the expected category');
  if (withheldValue) {
    assert.equal(
      `${result.stdout}${result.stderr}`.includes(withheldValue),
      false,
      'Matched credential values must never appear in output',
    );
  }
}

test('safe staged code and .env.example placeholders pass', (t) => {
  const repo = fixture(t);
  repo.write('src/example.mjs', 'export const answer = 42;\n');
  repo.write(
    '.env.example',
    [
      'POSTGRES_PASSWORD=REPLACE_WITH_PASSWORD',
      'DATABASE_URL=postgresql://example:REPLACE_WITH_PASSWORD@localhost:5432/example',
      '',
    ].join('\n'),
  );
  repo.stage('src/example.mjs', '.env.example');

  const result = repo.check();
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('passed for 2 file(s)'));
  assert.equal(result.stderr, '');
});

test('a force-staged ignored .env file is rejected', (t) => {
  const repo = fixture(t);
  repo.write('.gitignore', '.env\n');
  repo.write('.env', 'POSTGRES_PASSWORD=REPLACE_WITH_PASSWORD\n');
  repo.stage('.env');

  assertBlocked(repo.check(), '.env: private/local/generated file');
});

test('a local .env credential copied into a staged regular file is withheld', (t) => {
  const repo = fixture(t);
  const password = ['synthetic', 'local', 'password', '12345'].join('_');
  repo.write('.env', `POSTGRES_PASSWORD=${password}\n`);
  repo.write('notes.txt', `Accidentally copied value: ${password}\n`);
  repo.stage('notes.txt');

  assertBlocked(repo.check(), 'contains a local .env credential', password);
});

test('a credential-bearing URL is rejected without a local .env', (t) => {
  const repo = fixture(t);
  const password = ['synthetic', 'url', 'password', '12345'].join('_');
  const url = ['postgresql://fixture-user:', password, '@localhost:5432/fixture'].join('');
  repo.write('connection.txt', `${url}\n`);
  repo.stage('connection.txt');

  assertBlocked(repo.check(), 'credential-bearing URL', password);
});

test('the original private research document is rejected by filename', (t) => {
  const repo = fixture(t);
  const path = 'ark-research-refresh-2026-09-20.md';
  repo.write(path, '# Synthetic fixture only\n');
  repo.stage(path);

  assertBlocked(repo.check(), `${path}: private/local/generated file`);
});

test('a recognizable synthetic token is rejected and withheld', (t) => {
  const repo = fixture(t);
  // Assemble the test token so this test source itself remains publishable.
  const token = ['gh', 'p_', 'A'.repeat(36)].join('');
  repo.write('token.txt', `${token}\n`);
  repo.stage('token.txt');

  assertBlocked(repo.check(), 'possible GitHub token', token);
});

test('safe working-tree edits cannot hide unsafe content already in the index', (t) => {
  const repo = fixture(t);
  const password = ['synthetic', 'staged', 'password', '12345'].join('_');
  repo.write('.env', `POSTGRES_PASSWORD=${password}\n`);
  repo.write('notes.txt', `${password}\n`);
  repo.stage('notes.txt');
  repo.write('notes.txt', 'The working copy no longer contains a credential.\n');

  assertBlocked(repo.check(), 'contains a local .env credential', password);
});
