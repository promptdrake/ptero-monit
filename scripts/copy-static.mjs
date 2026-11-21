import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const directory of ['views', 'assets']) {
  const source = join(root, 'src', directory);
  const target = join(root, 'dist', directory);

  if (!existsSync(source)) continue;

  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
}

console.log('Copied views and assets to dist.');
