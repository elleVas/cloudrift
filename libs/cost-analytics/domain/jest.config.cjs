/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  displayName: 'cost-analytics-domain',
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
  moduleNameMapper: {
    '^shared-kernel$': '<rootDir>/../../shared/kernel/src/index.ts',
    '^shared-kernel/(.*)$': '<rootDir>/../../shared/kernel/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
