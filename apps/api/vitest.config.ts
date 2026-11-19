import { defineConfig } from "vitest/config";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: { UPLOAD_DIR: join(tmpdir(), "ironline-test-uploads") },
  },
});
