// Copyright 2024-2026 bburda. Apache-2.0 license.
//
// Webpack configuration override for the Foxglove extension build.
// Required to resolve ESM-only packages (exports with "import" condition)
// such as @selfpatch/ros2-medkit-client-ts and openapi-fetch.

import type { Configuration } from "webpack";

export function webpack(config: Configuration): Configuration {
    return {
        ...config,
        resolve: {
            ...config.resolve,
            conditionNames: ["import", "require", "module", "browser", "default"],
        },
    };
}
