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
  collectCoverageFrom: ['<rootDir>/src/**/*.ts', '!<rootDir>/src/**/*.spec.ts', '!<rootDir>/src/index.ts'],
  coverageThreshold: {
    global: { statements: 60, branches: 60, functions: 60, lines: 60 },
  },
  moduleNameMapper: {
    '^shared-kernel$': '<rootDir>/../../../shared/kernel/src/index.ts',
    '^shared-kernel/(.*)$': '<rootDir>/../../../shared/kernel/src/$1',
    '^shared-aws-infra-utils$': '<rootDir>/../../../shared/aws-infra-utils/src/index.ts',
    '^shared-aws-infra-utils/(.*)$': '<rootDir>/../../../shared/aws-infra-utils/src/$1',
    // dead-resources-domain re-exports AwsRegion from cloud-cost-domain, so
    // that source also needs to resolve here.
    '^cloud-cost-domain$': '<rootDir>/../../../cloud-cost/domain/src/index.ts',
    '^cloud-cost-domain/(.*)$': '<rootDir>/../../../cloud-cost/domain/src/$1',
    '^cloud-cost-pricing$': '<rootDir>/../../../shared/cloud-cost-pricing/src/index.ts',
    '^cloud-cost-pricing/(.*)$': '<rootDir>/../../../shared/cloud-cost-pricing/src/$1',
    '^dead-resources-domain$': '<rootDir>/../../domain/src/index.ts',
    '^dead-resources-domain/(.*)$': '<rootDir>/../../domain/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
