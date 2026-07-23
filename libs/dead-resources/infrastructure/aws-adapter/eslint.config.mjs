import baseConfig from '../../../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      // Global-scope scanners (IAM, ADR-0078) must still accept a `region`
      // param to satisfy DeadResourceScannerPort, but ignore it — a global
      // AWS service has no per-region data. `_`-prefixed is the signal.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
