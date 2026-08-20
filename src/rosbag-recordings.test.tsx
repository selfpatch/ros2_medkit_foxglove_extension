// Copyright 2026 mfaferek93
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * A fault holding several black-box recordings (ros2_medkit#620).
 *
 * Until that change a fault's newest recording overwrote the previous one, so
 * every panel here only ever rendered a single rosbag row. Now there can be
 * several, and three things that were harmless with one stop being harmless:
 * the rows have to be tellable apart, one download must not disable the others,
 * and a snapshot whose URI the gateway could not build must not turn the click
 * into a silent no-op that looks exactly like a successful download.
 */

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { MedkitApiClient } from "./medkit-api";
import { SnapshotList } from "./EntityBrowserPanel";
import { FaultCard } from "./FaultsDashboardPanel";
import type { FaultResponse, RosbagSnapshot } from "./types";

describe("getBulkDataDownloadUrl", () => {
  const api = new MedkitApiClient("http://box.local:8080");

  it("builds the download URL from a recording id", () => {
    expect(
      api.getBulkDataDownloadUrl(
        "/apps/motor/bulk-data/rosbags/fault_MOTOR_OVERHEAT_1738664999000",
      ),
    ).toBe(
      "http://box.local:8080/api/v1/apps/motor/bulk-data/rosbags/fault_MOTOR_OVERHEAT_1738664999000",
    );
  });

  it("still resolves a pre-#620 fault-code URL", () => {
    // The gateway keeps serving these: an id that names no recording is
    // retried as a fault code and answers with that fault's newest bag.
    expect(
      api.getBulkDataDownloadUrl(
        "/apps/motor/bulk-data/rosbags/MOTOR_OVERHEAT",
      ),
    ).toBe(
      "http://box.local:8080/api/v1/apps/motor/bulk-data/rosbags/MOTOR_OVERHEAT",
    );
  });

  it("throws a named error instead of a TypeError when the snapshot has no URI", () => {
    // The click handlers pass `snap.bulk_data_uri` straight in. A snapshot
    // that arrives without one used to reach `.replace` as undefined and
    // throw a bare TypeError out of the handler (the panel survives - React
    // rethrows to window.onerror); the named message is what makes the
    // failure findable, and the callers now surface it on screen.
    expect(() =>
      api.getBulkDataDownloadUrl(undefined as unknown as string),
    ).toThrow(/no bulk_data_uri/);
    expect(() => api.getBulkDataDownloadUrl("")).toThrow(/no bulk_data_uri/);
  });
});

describe("SnapshotList with several recordings", () => {
  const bag = (recordingId: string, sizeBytes = 2048): RosbagSnapshot => ({
    type: "rosbag",
    name: `rosbag_${recordingId}`,
    bulk_data_uri: `/apps/motor/bulk-data/rosbags/${recordingId}`,
    size_bytes: sizeBytes,
    duration_sec: 5,
    format: "mcap",
  });

  const recordings = [
    bag("fault_MOTOR_OVERHEAT_200"),
    bag("fault_MOTOR_OVERHEAT_100"),
  ];

  function renderList(downloading: string | null, onDownload = vi.fn()) {
    render(
      <SnapshotList
        snapshots={recordings}
        theme="dark"
        onDownload={onDownload}
        downloading={downloading}
        faultCode="MOTOR_OVERHEAT"
      />,
    );
    return onDownload;
  }

  it("renders one row per recording, each naming the bag it serves", () => {
    renderList(null);

    // Same size and duration, so the name is the only thing that tells the
    // technician which occurrence a row is.
    expect(
      screen.getByText("rosbag_fault_MOTOR_OVERHEAT_200"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("rosbag_fault_MOTOR_OVERHEAT_100"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /download/i })).toHaveLength(
      2,
    );
  });

  it("downloads the recording of the button that was clicked", () => {
    const onDownload = renderList(null);

    screen.getAllByRole("button", { name: /download/i })[1]!.click();

    expect(onDownload).toHaveBeenCalledWith(
      "/apps/motor/bulk-data/rosbags/fault_MOTOR_OVERHEAT_100",
    );
  });

  it("only disables the recording being downloaded, not its siblings", () => {
    // Keyed by fault code this disabled every button of the fault at once,
    // so a technician pulling one bag could not start the next.
    renderList("/apps/motor/bulk-data/rosbags/fault_MOTOR_OVERHEAT_200");

    const buttons = screen.getAllByRole("button", { name: /download/i });
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeEnabled();
  });
});

describe("FaultCard with several recordings", () => {
  // Renders through a real useState parent, the same wiring the panel uses:
  // clicking must prove the setDownloading(uri) WRITE, not only the
  // comparison a pre-set prop would exercise.
  function Harness({ snapshots }: { snapshots: RosbagSnapshot[] }) {
    const [downloading, setDownloading] = useState<string | null>(null);
    return (
      <FaultCard
        fault={{
          code: "MOTOR_OVERHEAT",
          message: "hot",
          severity: "error",
          status: "active",
          timestamp: "2026-08-20T10:00:00Z",
          entity_id: "motor",
          entity_type: "app",
        }}
        theme="dark"
        client={null}
        expandedFault="MOTOR_OVERHEAT"
        faultDetail={
          { environment_data: { snapshots } } as unknown as FaultResponse
        }
        detailLoading={false}
        downloading={downloading}
        onExpand={() => {}}
        onDownload={(uri) => setDownloading(uri)}
      />
    );
  }

  const bag = (recordingId: string): RosbagSnapshot => ({
    type: "rosbag",
    name: `rosbag_${recordingId}`,
    bulk_data_uri: `/apps/motor/bulk-data/rosbags/${recordingId}`,
    size_bytes: 2048,
    duration_sec: 5,
    format: "mcap",
  });

  it("disables only the clicked recording, through the real state write", () => {
    render(
      <Harness
        snapshots={[
          bag("fault_MOTOR_OVERHEAT_200"),
          bag("fault_MOTOR_OVERHEAT_100"),
        ]}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: /download/i });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]!);

    expect(buttons[0]).toBeDisabled();
    // Keyed by fault code, this sibling spun too - the regression this PR
    // removes, now pinned on the dashboard panel as well.
    expect(buttons[1]).toBeEnabled();
  });

  it("names each recording so the occurrences are tellable apart", () => {
    render(
      <Harness
        snapshots={[
          bag("fault_MOTOR_OVERHEAT_200"),
          bag("fault_MOTOR_OVERHEAT_100"),
        ]}
      />,
    );
    expect(
      screen.getByText("rosbag_fault_MOTOR_OVERHEAT_200"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("rosbag_fault_MOTOR_OVERHEAT_100"),
    ).toBeInTheDocument();
  });
});

describe("SnapshotList with a recording the gateway could not address", () => {
  it("renders no enabled Download button for a snapshot without a URI", () => {
    const noUri = {
      type: "rosbag",
      name: "rosbag_orphan",
      size_bytes: 2048,
      duration_sec: 5,
      format: "mcap",
    } as unknown as RosbagSnapshot;
    const onDownload = vi.fn();
    render(
      <SnapshotList
        snapshots={[noUri]}
        theme="dark"
        onDownload={onDownload}
        downloading={null}
        faultCode="X"
      />,
    );

    expect(
      screen.queryByRole("button", { name: /download/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/no download path/i)).toBeInTheDocument();
  });
});
