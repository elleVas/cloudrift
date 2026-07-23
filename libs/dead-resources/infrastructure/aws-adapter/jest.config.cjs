/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  displayName: 'dead-resources-infrastructure-aws-adapter',
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
    '^shared-kernel$': '<rootDir>/../../../shared/kernel/src/index.ts',
    '^shared-kernel/(.*)$': '<rootDir>/../../../shared/kernel/src/$1',
    // dead-resources-domain re-exports AwsRegion from cloud-cost-domain, so
    // that source also needs to resolve here.
    '^cloud-cost-domain$': '<rootDir>/../../../cloud-cost/domain/src/index.ts',
    '^cloud-cost-domain/(.*)$': '<rootDir>/../../../cloud-cost/domain/src/$1',
    '^dead-resources-domain$': '<rootDir>/../../domain/src/index.ts',
    '^dead-resources-domain/(.*)$': '<rootDir>/../../domain/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
