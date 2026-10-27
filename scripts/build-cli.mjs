import * as esbuild from 'esbuild';
import { mkdirSync } from 'fs';

mkdirSync('dist/cli', { recursive: true });
await esbuild.build({
  entryPoints: ['src/local/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/cli/cli.js',
  packages: 'external',
  banner: {
    js: `import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);`,
  },
});
console.log('built dist/cli/cli.js');
