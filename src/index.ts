// Copyright 2024–2026 Selfpatch GmbH. Apache-2.0 license.

/**
 * Foxglove extension entry point for ros2_medkit diagnostics panels.
 *
 * Registers three panels that connect to the ros2_medkit gateway HTTP API:
 *
 *   1. ros2_medkit Entity Browser — tree navigation of areas → components → apps
 *      with tabs for data, operations, configurations, and faults.
 *
 *   2. ros2_medkit Faults Dashboard — real-time monitoring with severity summary,
 *      SSE streaming, filtering, and fault clearing.
 *
 *   3. ros2_medkit Updates — SOVD update package catalog with Prepare / Execute
 *      action buttons and live status polling.
 */

import { ExtensionContext } from "@foxglove/extension";

import { initEntityBrowserPanel } from "./EntityBrowserPanel";
import { initFaultsDashboardPanel } from "./FaultsDashboardPanel";
import { initUpdatesPanel } from "./UpdatesPanel";

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({
    name: "ros2_medkit Entity Browser",
    initPanel: initEntityBrowserPanel,
  });

  extensionContext.registerPanel({
    name: "ros2_medkit Faults Dashboard",
    initPanel: initFaultsDashboardPanel,
  });

  extensionContext.registerPanel({
    name: "ros2_medkit Updates",
    initPanel: initUpdatesPanel,
  });
}
