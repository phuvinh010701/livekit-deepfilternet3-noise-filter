import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import dts from 'rollup-plugin-dts';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Custom plugin to import worker/worklet files as strings
function workerAsString() {
  return {
    name: 'worker-as-string',
    resolveId(id) {
      if (id.includes('?worker-code') || id.includes('?worklet-code')) {
        return id;
      }
      return null;
    },
    load(id) {
      if (id.includes('?worker-code') || id.includes('?worklet-code')) {
        const filePath = id.split('?')[0];
        const fullPath = resolve(__dirname, filePath);

        // For worker/worklet code, we need to compile it first to JS
        // We'll reference the already-built version from dist
        const isWorker = id.includes('?worker-code');
        const distFile = isWorker ? 'dist/DeepFilterWorker.js' : 'dist/DeepFilterWorklet.js';
        const distPath = resolve(__dirname, distFile);

        try {
          const code = readFileSync(distPath, 'utf-8');
          // Return the code as a string export
          return `export default ${JSON.stringify(code)};`;
        } catch (e) {
          // During initial build, the dist files don't exist yet
          // Return a placeholder that will be updated in a second build pass
          console.warn(`Warning: ${distFile} not found. You may need to run build twice.`);
          return `export default '';`;
        }
      }
      return null;
    }
  };
}

export default [
  // Worker bundle - Build this first
  {
    input: 'src/worker/DeepFilterWorker.ts',
    output: {
      file: 'dist/DeepFilterWorker.js',
      format: 'iife',
      sourcemap: false,
    },
    plugins: [
      nodeResolve(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        sourceMap: false,
        target: 'ES2020',
      }),
    ],
  },

  // Worklet bundle - Build this second
  {
    input: 'src/worklet/DeepFilterWorklet.ts',
    output: {
      file: 'dist/DeepFilterWorklet.js',
      format: 'iife',
      sourcemap: false,
    },
    plugins: [
      nodeResolve(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.build.json',
        declaration: false,
        sourceMap: false,
        target: 'ES2020',
      }),
    ],
  },

  // Main library bundle - Build this third (after worker files exist)
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.js',
        format: 'cjs',
        sourcemap: false,
      },
      {
        file: 'dist/index.esm.js',
        format: 'esm',
        sourcemap: false,
      },
    ],
    external: ['livekit-client'],
    plugins: [
      workerAsString(), // Load worker/worklet files as strings
      nodeResolve(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        sourceMap: false,
        target: 'ES2020',
      }),
    ],
  },

  // Type definitions - Build this last
  {
    input: 'src/index.ts',
    output: [{ file: 'dist/index.d.ts', format: 'es' }],
    plugins: [
      dts({
        respectExternal: true,
        compilerOptions: {
          declaration: true,
          declarationMap: false,
        }
      })
    ],
    external: ['livekit-client'],
  },
];