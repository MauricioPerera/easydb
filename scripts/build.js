#!/usr/bin/env node
/**
 * Build script — generates CDN bundles (ESM, UMD, IIFE) and tracks bundle sizes.
 */
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';

const DIST = 'dist';
if (!existsSync(DIST)) mkdirSync(DIST);

// Plugin to replace server-only adapters with stubs in browser builds
const stubServerAdapters = {
  name: 'stub-server-adapters',
  setup(b) {
    const stubPath = resolve('scripts/empty-adapter.js');
    b.onResolve({ filter: /adapters\/d1\.js$/ }, () => ({ path: stubPath }));
    b.onResolve({ filter: /adapters\/kv\.js$/ }, () => ({ path: stubPath }));
    b.onResolve({ filter: /adapters\/postgres\.js$/ }, () => ({ path: stubPath }));
    b.onResolve({ filter: /adapters\/redis\.js$/ }, () => ({ path: stubPath }));
    b.onResolve({ filter: /adapters\/turso\.js$/ }, () => ({ path: stubPath }));
    b.onResolve({ filter: /adapters\/sqlite\.js$/ }, () => ({ path: stubPath }));
  },
};

const BUNDLES = [
  // Browser bundle: core + IndexedDB adapter
  {
    entry: 'src/easydb.js',
    name: 'easydb',
    globalName: 'EasyDB',
    platform: 'browser',
    stubServer: true,
  },
  // Framework integrations
  { entry: 'src/react.js', name: 'easydb-react', external: ['react'] },
  { entry: 'src/vue.js', name: 'easydb-vue', external: ['vue'] },
  { entry: 'src/svelte.js', name: 'easydb-svelte', external: ['svelte/store'] },
  { entry: 'src/angular.js', name: 'easydb-angular', external: ['@angular/core'] },
  { entry: 'src/solid.js', name: 'easydb-solid', external: ['solid-js'] },
  { entry: 'src/preact.js', name: 'easydb-preact', external: ['preact/hooks'] },
  { entry: 'src/lit.js', name: 'easydb-lit', external: ['lit'] },
  // Sync engine
  { entry: 'src/sync.js', name: 'easydb-sync' },
];

const FORMATS = ['esm', 'iife'];

async function run() {
  const results = [];

  for (const bundle of BUNDLES) {
    for (const format of FORMATS) {
      // IIFE only for main bundle
      if (format === 'iife' && bundle.name !== 'easydb') continue;

      const outfile = join(DIST, `${bundle.name}.${format === 'esm' ? 'mjs' : format}.js`);

      await build({
        entryPoints: [bundle.entry],
        bundle: true,
        format,
        outfile,
        minify: true,
        sourcemap: true,
        target: 'es2018',
        platform: bundle.platform || 'neutral',
        globalName: format === 'iife' ? bundle.globalName : undefined,
        external: bundle.external || [],
        plugins: bundle.stubServer ? [stubServerAdapters] : [],
      });

      const raw = readFileSync(outfile);
      const gzipped = gzipSync(raw);

      results.push({
        file: basename(outfile),
        raw: raw.length,
        gzip: gzipped.length,
      });
    }
  }

  // UMD wrapper for main bundle
  await build({
    entryPoints: ['src/easydb.js'],
    bundle: true,
    format: 'iife',
    outfile: join(DIST, 'easydb.umd.js'),
    minify: true,
    sourcemap: true,
    target: 'es2018',
    platform: 'browser',
    globalName: 'EasyDB',
    plugins: [stubServerAdapters],
    banner: {
      js: '(function(root,factory){if(typeof define==="function"&&define.amd){define([],factory)}else if(typeof module==="object"&&module.exports){module.exports=factory()}else{Object.assign(root,factory())}})(typeof globalThis!=="undefined"?globalThis:typeof self!=="undefined"?self:this,function(){',
    },
    footer: { js: 'return EasyDB;});' },
  });

  const umdRaw = readFileSync(join(DIST, 'easydb.umd.js'));
  const umdGzip = gzipSync(umdRaw);
  results.push({ file: 'easydb.umd.js', raw: umdRaw.length, gzip: umdGzip.length });

  // Print size table
  console.log('\n  Bundle sizes:\n');
  console.log('File'.padEnd(28) + 'Raw'.padStart(10) + 'Gzip'.padStart(10));
  console.log('-'.repeat(48));
  for (const r of results) {
    const rawKB = (r.raw / 1024).toFixed(1) + ' KB';
    const gzipKB = (r.gzip / 1024).toFixed(1) + ' KB';
    console.log(r.file.padEnd(28) + rawKB.padStart(10) + gzipKB.padStart(10));
  }

  // Check target
  const mainESM = results.find(r => r.file === 'easydb.mjs.js');
  if (mainESM && mainESM.gzip > 5120) {
    console.log(`\n  WARNING: Core ESM exceeds 5KB gzip target (${(mainESM.gzip / 1024).toFixed(1)} KB)`);
    process.exit(1);
  } else if (mainESM) {
    console.log(`\n  OK: Core ESM within 5KB gzip target (${(mainESM.gzip / 1024).toFixed(1)} KB)`);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
