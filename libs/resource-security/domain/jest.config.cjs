/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  displayName: 'resource-security-domain',
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
    '^shared-kernel$': '<rootDir>/../../shared/kernel/src/index.ts',
    '^shared-kernel/(.*)$': '<rootDir>/../../shared/kernel/src/$1',
    '^cloud-cost-domain$': '<rootDir>/../../cloud-cost/domain/src/index.ts',
    '^cloud-cost-domain/(.*)$': '<rootDir>/../../cloud-cost/domain/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
