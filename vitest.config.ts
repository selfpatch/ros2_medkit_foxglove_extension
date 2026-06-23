// Copyright 2024-2026 bburda. Apache-2.0 license.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: [],
    globals: true,
  },
});
