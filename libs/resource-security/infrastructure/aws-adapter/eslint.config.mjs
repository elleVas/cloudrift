import baseConfig from '../../../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      // Global-scope scanners (IAM/S3/CloudTrail, mirroring ADR-0078) must
      // still accept a `region` param to satisfy ResourceSecurityScannerPort,
      // but ignore it. `_`-prefixed is the signal.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
