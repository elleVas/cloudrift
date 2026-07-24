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
  moduleNameMapper: {
    '^shared-kernel$': '<rootDir>/../../shared/kernel/src/index.ts',
    '^shared-kernel/(.*)$': '<rootDir>/../../shared/kernel/src/$1',
    '^cloud-cost-domain$': '<rootDir>/../../cloud-cost/domain/src/index.ts',
    '^cloud-cost-domain/(.*)$': '<rootDir>/../../cloud-cost/domain/src/$1',
    '^cost-analytics-domain$': '<rootDir>/../../cost-analytics/domain/src/index.ts',
    '^cost-analytics-domain/(.*)$': '<rootDir>/../../cost-analytics/domain/src/$1',
    '^dead-resources-domain$': '<rootDir>/../../dead-resources/domain/src/index.ts',
    '^dead-resources-domain/(.*)$': '<rootDir>/../../dead-resources/domain/src/$1',
    '^resource-security-domain$': '<rootDir>/../../resource-security/domain/src/index.ts',
    '^resource-security-domain/(.*)$': '<rootDir>/../../resource-security/domain/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
