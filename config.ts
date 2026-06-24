// Copyright 2024-2026 bburda. Apache-2.0 license.
//
// Webpack configuration override for the Foxglove extension build.
// Required to resolve ESM-only packages (exports with "import" condition)
// such as @selfpatch/ros2-medkit-client-ts and openapi-fetch.

// Plain JS (JSDoc types only): create-foxglove-extension loads this file via
// native require, and CI's Node does not strip TypeScript syntax, so this
// file must contain no TS-only tokens (no `import type`, no type annotations).

/**
 * @param {import("webpack").Configuration} config
 * @returns {import("webpack").Configuration}
 */
export function webpack(config) {
    return {
        ...config,
        resolve: {
            ...config.resolve,
            conditionNames: ["import", "require", "module", "browser", "default"],
        },
    };
}
