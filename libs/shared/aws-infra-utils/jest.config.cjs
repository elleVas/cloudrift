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
  moduleNameMapper: {
    '^shared-kernel$': '<rootDir>/../kernel/src/index.ts',
    '^shared-kernel/(.*)$': '<rootDir>/../kernel/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
