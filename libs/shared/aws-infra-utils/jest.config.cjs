/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  displayName: 'shared-aws-infra-utils',
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
    global: { statements: 60, branches: 60, functions: 60, lines: 60 },
  },
  moduleNameMapper: {
    '^shared-kernel$': '<rootDir>/../kernel/src/index.ts',
    '^shared-kernel/(.*)$': '<rootDir>/../kernel/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
