// Flat config. It is .eslintrc.json translated rule for rule (no `extends`,
// so only the rules named here run), with `@typescript-eslint/semi`, which
// typescript-eslint 8 removed, replaced by `@stylistic/semi`.
import { defineConfig, globalIgnores } from 'eslint/config';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import stylistic from '@stylistic/eslint-plugin';

export default defineConfig([
  // node_modules is ignored by default.
  globalIgnores(['out/**', '.vscode-test/**']),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 6,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      '@stylistic': stylistic,
    },
    rules: {
      '@typescript-eslint/naming-convention': 'warn',
      '@stylistic/semi': 'warn',
      curly: 'warn',
      eqeqeq: 'warn',
      'no-throw-literal': 'warn',
    },
  },
]);
