import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    fileParallelism: false,
    testTimeout: 180000,
    hookTimeout: 60000,
    env: {
      MYSQL_HOST: "127.0.0.1",
      MYSQL_PORT: "3307",
      REDIS_HOST: "127.0.0.1",
      REDIS_PORT: "6380",
    },
  },
});
