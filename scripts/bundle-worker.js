/* Bundles the Cloudflare Worker entry (worker.js) with esbuild.
 * Output: worker-bundle.mjs (ESM, bundled) for Wrangler.
 * Prisma engine is avoided via the Neon serverless adapter. */
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
  const outfile = path.join(root, 'worker-bundle.mjs');
  const external = []; // bundle everything

  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await esbuild.build({
        entryPoints: [path.join(root, 'worker.js')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: ['es2022'],
        outfile,
        external,
        logLevel: 'warning',
        define: {
          'process.env.NODE_ENV': '"production"',
          global: 'globalThis',
        },
        mainFields: ['browser', 'module', 'main'],
        conditions: ['worker', 'browser', 'import'],
      });
      console.log('[bundle-worker] wrote worker-bundle.mjs');
      break;
    } catch (err) {
      const missing = (err.errors || [])
        .map((e) => e && e.text)
        .filter((t) => typeof t === 'string')
        .map((t) => t.replace('Could not resolve ', '').replace(/[",]/g, '').trim())
        .filter(Boolean);
      if (!missing.length) throw err;
      console.log('[bundle-worker] marking external:', missing.join(', '));
      external.push(...missing);
    }
  }
})().catch((err) => { console.error(err); process.exit(1); });
