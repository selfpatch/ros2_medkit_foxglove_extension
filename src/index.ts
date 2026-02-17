// Copyright 2024–2026 Selfpatch GmbH. Apache-2.0 license.

/**
 * Foxglove extension entry point for SOVD Diagnostics panels.
 *
 * Registers two panels that connect to the ros2_medkit SOVD gateway HTTP API:
 *
 *   1. SOVD Entity Tree — tree navigation of areas → components → apps
 *      with tabs for data, operations, configurations, and faults.
 *
 *   2. SOVD Faults Dashboard — real-time monitoring with severity summary,
 *      SSE streaming, filtering, and fault clearing.
 */

import { ExtensionContext } from "@foxglove/extension";

import { initEntityBrowserPanel } from "./EntityBrowserPanel";
import { initFaultsDashboardPanel } from "./FaultsDashboardPanel";

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({
    name: "SOVD Entity Tree",
    initPanel: initEntityBrowserPanel,
  });

  extensionContext.registerPanel({
    name: "SOVD Faults Dashboard",
    initPanel: initFaultsDashboardPanel,
  });
}
