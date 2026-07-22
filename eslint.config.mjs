import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // Hexagonal layering (ADR-0013): domain has zero infra knowledge,
            // application only knows domain ports, infrastructure implements
            // those ports directly (not via application), and the app is the
            // only composition root allowed to see every layer.
            { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
            { sourceTag: 'scope:domain', onlyDependOnLibsWithTags: ['scope:shared', 'scope:domain'] },
            {
              sourceTag: 'scope:application',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:domain', 'scope:application'],
            },
            {
              sourceTag: 'scope:infrastructure',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:domain', 'scope:infrastructure'],
            },
            {
              sourceTag: 'scope:app',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:domain', 'scope:application', 'scope:infrastructure', 'scope:app'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
