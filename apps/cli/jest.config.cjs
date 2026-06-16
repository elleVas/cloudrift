/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  displayName: 'cli',
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
    '^shared-kernel$': '<rootDir>/../../libs/shared/kernel/src/index.ts',
    '^shared-kernel/(.*)$': '<rootDir>/../../libs/shared/kernel/src/$1',
    '^cloud-cost-domain$': '<rootDir>/../../libs/cloud-cost/domain/src/index.ts',
    '^cloud-cost-domain/(.*)$': '<rootDir>/../../libs/cloud-cost/domain/src/$1',
    '^cloud-cost-application$': '<rootDir>/../../libs/cloud-cost/application/src/index.ts',
    '^cloud-cost-application/(.*)$': '<rootDir>/../../libs/cloud-cost/application/src/$1',
    '^cloud-cost-infrastructure-aws-adapter$': '<rootDir>/../../libs/cloud-cost/infrastructure/aws-adapter/src/index.ts',
    '^cloud-cost-infrastructure-aws-adapter/(.*)$': '<rootDir>/../../libs/cloud-cost/infrastructure/aws-adapter/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
