import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const nodeGlobals = {
  AbortController: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  process: 'readonly',
  require: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  structuredClone: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  module: 'readonly',
};

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', '**/coverage/**', '**/cpanel/**'],
  },
  {
    ...js.configs.recommended,
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: nodeGlobals,
    },
  },
  ...tseslint.configs.recommended,
);
