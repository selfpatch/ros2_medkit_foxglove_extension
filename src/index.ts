// Copyright 2024-2026 bburda. Apache-2.0 license.

/**
 * Foxglove extension entry point for ros2_medkit diagnostics panels.
 *
 * Registers four panels that connect to the ros2_medkit gateway HTTP API:
 *
 *   1. ros2_medkit Entity Browser - tree navigation of areas -> components -> apps
 *      with tabs for data, operations, configurations, and faults.
 *
 *   2. ros2_medkit Faults Dashboard - real-time monitoring with severity summary,
 *      SSE streaming, filtering, and fault clearing.
 *
 *   3. ros2_medkit Updates - SOVD update package catalog with Register / Prepare /
 *      Execute / Automated / Delete actions and live status polling.
 *
 *   4. ros2_medkit Server Info - gateway overview, supported capability badges,
 *      and API entry points from GET /.
 */

import { ExtensionContext } from "@foxglove/extension";

import { initEntityBrowserPanel } from "./EntityBrowserPanel";
import { initFaultsDashboardPanel } from "./FaultsDashboardPanel";
import { initUpdatesPanel } from "./UpdatesPanel";
import { initServerInfoPanel } from "./ServerInfoPanel";

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

  extensionContext.registerPanel({
    name: "ros2_medkit Server Info",
    initPanel: initServerInfoPanel,
  });
}
