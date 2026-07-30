/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  displayName: 'shared-trend-store',
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  collectCoverageFrom: ['<rootDir>/src/**/*.ts', '!<rootDir>/src/**/*.spec.ts', '!<rootDir>/src/index.ts'],
  // 60%, not the usual 80% (ADR-0090): this package's only branches worth
  // noting are OS/filesystem-facing defaults (home directory resolution),
  // same reasoning as the infrastructure-layer threshold, not 80%'s
  // domain/application bar.
  coverageThreshold: {
    global: { statements: 60, branches: 60, functions: 60, lines: 60 },
  },
  moduleNameMapper: {
    '^shared-kernel$': '<rootDir>/../kernel/src/index.ts',
    '^shared-kernel/(.*)$': '<rootDir>/../kernel/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
