import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  use: { baseURL: "http://127.0.0.1:2244", trace: "retain-on-failure" },
  webServer: [
    { command: "pnpm --filter @studio/server start", url: "http://127.0.0.1:4310/api/health", reuseExistingServer: true },
    { command: "pnpm --filter @studio/web dev", url: "http://127.0.0.1:2244", reuseExistingServer: true },
  ],
});
