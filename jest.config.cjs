/** @type {import('@ts-jest/dist/types').InitialOptionsTsJest} */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  coverageProvider: "v8",
  globals: {
    "ts-jest": {
      isolatedModules: true,
    },
  },
};

module.exports = config;
