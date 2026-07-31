/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  displayName: 'mcp-server-application',
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
    '^shared-aws-infra-utils$': '<rootDir>/../../shared/aws-infra-utils/src/index.ts',
    '^shared-aws-infra-utils/(.*)$': '<rootDir>/../../shared/aws-infra-utils/src/$1',
    '^cloud-cost-domain$': '<rootDir>/../../cloud-cost/domain/src/index.ts',
    '^cloud-cost-domain/(.*)$': '<rootDir>/../../cloud-cost/domain/src/$1',
    '^cloud-cost-pricing$': '<rootDir>/../../shared/cloud-cost-pricing/src/index.ts',
    '^cloud-cost-pricing/(.*)$': '<rootDir>/../../shared/cloud-cost-pricing/src/$1',
    '^cost-analytics-domain$': '<rootDir>/../../cost-analytics/domain/src/index.ts',
    '^cost-analytics-domain/(.*)$': '<rootDir>/../../cost-analytics/domain/src/$1',
    '^dead-resources-domain$': '<rootDir>/../../dead-resources/domain/src/index.ts',
    '^dead-resources-domain/(.*)$': '<rootDir>/../../dead-resources/domain/src/$1',
    '^resource-security-domain$': '<rootDir>/../../resource-security/domain/src/index.ts',
    '^resource-security-domain/(.*)$': '<rootDir>/../../resource-security/domain/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
