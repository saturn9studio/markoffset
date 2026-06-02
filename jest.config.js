module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        rootDir: '.',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
      }
    }]
  }
};
