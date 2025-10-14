import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import dts from 'rollup-plugin-dts';

export default [
  // Main library bundle
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.js',
        format: 'cjs',
        sourcemap: 'inline',
      },
      {
        file: 'dist/index.esm.js',
        format: 'esm',
        sourcemap: 'inline',
      },
    ],
    external: ['livekit-client'],
    plugins: [
      nodeResolve(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        sourceMap: 'inline',
        target: 'ES2020',
      }),
    ],
  },

  // Worker bundle
  {
    input: 'src/worker/DeepFilterWorker.ts',
    output: {
      file: 'dist/DeepFilterWorker.js',
      format: 'iife',
      sourcemap: 'inline',
    },
    plugins: [
      nodeResolve(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        sourceMap: 'inline',
        target: 'ES2020',
      }),
    ],
  },

  // Worklet bundle
  {
    input: 'src/worklet/DeepFilterWorklet.ts',
    output: {
      file: 'dist/DeepFilterWorklet.js',
      format: 'iife',
      sourcemap: 'inline',
    },
    plugins: [
      nodeResolve(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.build.json',
        declaration: false,
        sourceMap: 'inline',
        target: 'ES2020',
      }),
    ],
  },

  // Single consolidated type definitions file
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