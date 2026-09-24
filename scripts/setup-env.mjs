import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../.env', import.meta.url));

if (existsSync(target)) {
  console.log('Existing .env preserved. No credentials were changed.');
} else {
  const password = randomBytes(24).toString('hex');
  const content = [
    `POSTGRES_PASSWORD=${password}`,
    `DATABASE_URL=postgresql://ark:${password}@127.0.0.1:5434/ark_dev`,
    '',
  ].join('\n');
  writeFileSync(target, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  console.log('Created ignored local .env for PostgreSQL at 127.0.0.1:5434.');
  console.log('Credential values were not printed. Keep this file private.');
}
