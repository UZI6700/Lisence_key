/* Copy the built React dashboard into the API's public/ directory so NestJS
   serves the UI and API from a single Wasmer Edge app. */
const { cpSync, mkdirSync, rmSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const from = join(root, 'packages', 'web', 'dist');
const to = join(root, 'packages', 'api', 'public');

if (!existsSync(from)) {
  console.error('packages/web/dist not found — run the web build first');
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`Copied dashboard build to ${to}`);
