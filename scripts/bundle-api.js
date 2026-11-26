/* Bundles the Vercel function entry (api/index.js) into one self-contained
 * CommonJS file so the runtime never has to require() ESM-only packages
 * (NestJS 12 ships "type": "module", which Vercel's loader rejects).
 *
 * On Vercel (VERCEL=1) the bundle overwrites api/index.js in the build
 * sandbox. Locally it writes api/.index.bundle.cjs for testing only. */
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  let esbuild;
  try {
    esbuild = require('esbuild');
  } catch {
    esbuild = require(path.resolve(__dirname, '..', 'packages', 'web', 'node_modules', 'esbuild'));
  }

  const root = path.resolve(__dirname, '..');
  const entry = path.join(root, 'api', 'index.js');
  const tmp = path.join(root, 'api', '.index.bundle.cjs');

  // Prisma stays external so the generated client and its engines load natively;
  // pg has optional native parts. Everything else (including ESM-only Nest 12)
  // is inlined to a single CJS file the Vercel runtime can load.
  const external = ['@prisma/client', '@prisma/engines', 'prisma'];
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        outfile: tmp,
        external,
        logLevel: 'warning',
      });
      break;
    } catch (err) {
      const missing = (err.errors || [])
        .map((e) => e && e.text)
        .filter((t) => typeof t === 'string')
        .map((t) => t.replace('Could not resolve ', '').replace(/[",]/g, '').trim())
        .filter(Boolean);
      if (!missing.length) throw err;
      console.log('[bundle-api] marking external (unused by app):', missing.join(', '));
      external.push(...missing);
    }
  }

  // Put Prisma's generated client + engines where the bundle resolves them:
  // the bundle sits at api/index.js, so api/node_modules is first in Node's
  // resolution path. On Vercel this dir is picked up via the traced require()
  // from the deployed api/index.js; locally the boot test resolves it too.
  const srcDir = path.join(root, 'packages', 'api', 'node_modules');
  const dstDir = path.join(root, 'api', 'node_modules');
  fs.mkdirSync(dstDir, { recursive: true });
  for (const name of ['@prisma', '.prisma']) {
    const src = path.join(srcDir, name);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(dstDir, name);
    if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(src, dst, { recursive: true });
    console.log('[bundle-api] copied', name, 'to', dst);
  }

  if (process.env.VERCEL) {
    fs.renameSync(tmp, entry);
    console.log('[bundle-api] wrote bundled api/index.js');
  } else {
    console.log('[bundle-api] wrote', tmp, '(set VERCEL=1 to overwrite api/index.js)');
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
