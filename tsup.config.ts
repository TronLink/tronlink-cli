import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['bin/cli.ts'],
    format: ['esm'],
    outDir: 'dist/bin',
    clean: true,
    splitting: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    outDir: 'dist',
    clean: false,
    splitting: false,
  },
]);
