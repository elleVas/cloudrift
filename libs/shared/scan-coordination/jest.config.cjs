/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  displayName: 'shared-scan-coordination',
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
  coverageThreshold: {
    global: { statements: 80, branches: 80, functions: 80, lines: 80 },
  },
  moduleNameMapper: {
    '^shared-kernel$': '<rootDir>/../kernel/src/index.ts',
    '^shared-kernel/(.*)$': '<rootDir>/../kernel/src/$1',
    '^shared-aws-infra-utils$': '<rootDir>/../aws-infra-utils/src/index.ts',
    '^shared-aws-infra-utils/(.*)$': '<rootDir>/../aws-infra-utils/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
