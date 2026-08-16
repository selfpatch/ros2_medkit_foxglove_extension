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
 * and a snapshot whose URI the gateway could not build must not take the panel
 * down when clicked.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { MedkitApiClient } from "./medkit-api";
import { SnapshotList } from "./EntityBrowserPanel";
import type { RosbagSnapshot } from "./types";

describe("getBulkDataDownloadUrl", () => {
    const api = new MedkitApiClient("http://box.local:8080");

    it("builds the download URL from a recording id", () => {
        expect(api.getBulkDataDownloadUrl("/apps/motor/bulk-data/rosbags/fault_MOTOR_OVERHEAT_1738664999000")).toBe(
            "http://box.local:8080/api/v1/apps/motor/bulk-data/rosbags/fault_MOTOR_OVERHEAT_1738664999000",
        );
    });

    it("still resolves a pre-#620 fault-code URL", () => {
        // The gateway keeps serving these: an id that names no recording is
        // retried as a fault code and answers with that fault's newest bag.
        expect(api.getBulkDataDownloadUrl("/apps/motor/bulk-data/rosbags/MOTOR_OVERHEAT")).toBe(
            "http://box.local:8080/api/v1/apps/motor/bulk-data/rosbags/MOTOR_OVERHEAT",
        );
    });

    it("throws a named error instead of a TypeError when the snapshot has no URI", () => {
        // The click handlers pass `snap.bulk_data_uri` straight in. A snapshot
        // that arrives without one used to reach `.replace` as undefined and
        // throw out of the handler, unmounting the panel; the message here says
        // what actually went wrong.
        expect(() => api.getBulkDataDownloadUrl(undefined as unknown as string)).toThrow(/no bulk_data_uri/);
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

    const recordings = [bag("fault_MOTOR_OVERHEAT_200"), bag("fault_MOTOR_OVERHEAT_100")];

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
        expect(screen.getByText("rosbag_fault_MOTOR_OVERHEAT_200")).toBeInTheDocument();
        expect(screen.getByText("rosbag_fault_MOTOR_OVERHEAT_100")).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: /download/i })).toHaveLength(2);
    });

    it("downloads the recording of the button that was clicked", () => {
        const onDownload = renderList(null);

        screen.getAllByRole("button", { name: /download/i })[1]!.click();

        expect(onDownload).toHaveBeenCalledWith("/apps/motor/bulk-data/rosbags/fault_MOTOR_OVERHEAT_100");
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
