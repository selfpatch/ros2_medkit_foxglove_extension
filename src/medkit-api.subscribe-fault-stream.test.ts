// Copyright 2024-2026 bburda. Apache-2.0 license.
//
// Focused unit tests for MedkitApiClient.subscribeFaultStream.
// Uses vi.mock("./gateway-client") to inject a stub SseStream so the tests
// are isolated from network and the real client internals.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SseEvent } from "@selfpatch/ros2-medkit-client-ts";

// ---------------------------------------------------------------------------
// gateway-client module mock
// ---------------------------------------------------------------------------
// vi.mock is hoisted before imports. Individual tests set `mockFaults` to
// control what stream the stub returns.

let mockFaults: (() => AsyncIterable<SseEvent> & { close: () => void }) | undefined;

vi.mock("./gateway-client", () => {
    return {
        MedkitApiError: class MedkitApiError extends Error {
            constructor(e: { message: string }) {
                super(e.message);
                this.name = "MedkitApiError";
            }
        },
        isMedkitError: () => false,
        normalizeBaseUrl: (url: string) => url,
        createGatewayClient: () => ({
            GET: vi.fn(async () => ({ data: { items: [] }, error: undefined })),
            streams: {
                faults: () => mockFaults!(),
                triggerEvents: vi.fn(),
                subscriptionEvents: vi.fn(),
            },
        }),
    };
});

import { MedkitApiClient } from "./medkit-api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal SseStream stub: yields events in order then terminates. */
function makeStreamStub(events: SseEvent[]): AsyncIterable<SseEvent> & { close: () => void } {
    let closed = false;
    return {
        close() { closed = true; },
        [Symbol.asyncIterator](): AsyncIterator<SseEvent> {
            let i = 0;
            return {
                async next() {
                    if (closed || i >= events.length) {
                        return { done: true, value: undefined as unknown as SseEvent };
                    }
                    return { done: false, value: events[i++]! };
                },
                async return() {
                    closed = true;
                    return { done: true, value: undefined as unknown as SseEvent };
                },
            };
        },
    };
}

/** Raw fault as the gateway sends it (matches wire shape, pre-transform). */
const RAW_FAULT = {
    fault_code: "LIDAR_FAIL",
    description: "Lidar disconnected",
    severity: 3,
    severity_label: "critical",
    status: "active",
    first_occurred: 1_700_000_000,
    occurrence_count: 5,
    reporting_sources: ["/sensors/lidar_node"],
};

afterEach(() => {
    vi.unstubAllGlobals();
    mockFaults = undefined;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MedkitApiClient.subscribeFaultStream", () => {
    it("fault_confirmed event calls onConfirmed with transformed Fault", async () => {
        mockFaults = () => makeStreamStub([
            { event: "fault_confirmed", data: RAW_FAULT },
        ]);
        const client = new MedkitApiClient("http://gw", "api/v1");
        const confirmed: unknown[] = [];

        const unsub = client.subscribeFaultStream(
            (f) => confirmed.push(f),
            () => { /* onCleared */ },
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        unsub();

        expect(confirmed).toHaveLength(1);
        expect(confirmed[0]).toMatchObject({
            code: "LIDAR_FAIL",
            message: "Lidar disconnected",
            severity: "critical",
            status: "active",
        });
    });

    it("fault_cleared event calls onCleared with transformed Fault", async () => {
        const clearedRaw = { ...RAW_FAULT, status: "cleared" };
        mockFaults = () => makeStreamStub([
            { event: "fault_cleared", data: clearedRaw },
        ]);
        const client = new MedkitApiClient("http://gw", "api/v1");
        const cleared: unknown[] = [];

        const unsub = client.subscribeFaultStream(
            () => { /* onConfirmed */ },
            (f) => cleared.push(f),
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        unsub();

        expect(cleared).toHaveLength(1);
        expect(cleared[0]).toMatchObject({ code: "LIDAR_FAIL", status: "cleared" });
    });

    it("unsubscribe stops further callbacks - no call after unsub()", async () => {
        // Two events; the second is held behind a promise so we can unsub first.
        let releaseSecond!: () => void;
        const secondGate = new Promise<void>((r) => { releaseSecond = r; });

        const events: SseEvent[] = [
            { event: "fault_confirmed", data: RAW_FAULT },
            { event: "fault_confirmed", data: { ...RAW_FAULT, fault_code: "SECOND" } },
        ];

        let streamClosed = false;
        const slowStream: AsyncIterable<SseEvent> & { close: () => void } = {
            close() { streamClosed = true; },
            [Symbol.asyncIterator](): AsyncIterator<SseEvent> {
                let i = 0;
                return {
                    async next() {
                        if (streamClosed || i >= events.length) {
                            return { done: true, value: undefined as unknown as SseEvent };
                        }
                        if (i === 1) await secondGate;
                        return { done: false, value: events[i++]! };
                    },
                    async return() {
                        streamClosed = true;
                        return { done: true, value: undefined as unknown as SseEvent };
                    },
                };
            },
        };
        mockFaults = () => slowStream;

        const client = new MedkitApiClient("http://gw", "api/v1");
        const confirmed: unknown[] = [];

        const unsub = client.subscribeFaultStream(
            (f) => confirmed.push(f),
            () => { /* onCleared */ },
        );

        // Let first event fire.
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        expect(confirmed).toHaveLength(1);

        // Unsubscribe before releasing the second event.
        unsub();

        // Release: the loop must not call onConfirmed again.
        releaseSecond();
        await new Promise<void>((resolve) => setTimeout(resolve, 20));

        expect(confirmed).toHaveLength(1);
    });

    it("stream iterator error calls onError", async () => {
        const boom = new Error("stream connection lost");
        mockFaults = () => ({
            close() { /* noop */ },
            [Symbol.asyncIterator](): AsyncIterator<SseEvent> {
                return {
                    async next() { throw boom; },
                    async return() {
                        return { done: true, value: undefined as unknown as SseEvent };
                    },
                };
            },
        });

        const client = new MedkitApiClient("http://gw", "api/v1");
        const errors: unknown[] = [];

        const unsub = client.subscribeFaultStream(
            () => { /* onConfirmed */ },
            () => { /* onCleared */ },
            (e) => errors.push(e),
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        unsub();

        expect(errors).toHaveLength(1);
        expect(errors[0]).toBe(boom);
    });

    it("onError is NOT called when unsub() fires before the iterator throws", async () => {
        // Gate the throw behind a promise; unsub() fires before we resolve it.
        let releaseThrow!: () => void;
        const throwGate = new Promise<void>((r) => { releaseThrow = r; });

        let streamClosed = false;
        mockFaults = () => ({
            close() { streamClosed = true; },
            [Symbol.asyncIterator](): AsyncIterator<SseEvent> {
                return {
                    async next() {
                        await throwGate;
                        if (streamClosed) {
                            return { done: true, value: undefined as unknown as SseEvent };
                        }
                        throw new Error("late error after unsub");
                    },
                    async return() {
                        streamClosed = true;
                        return { done: true, value: undefined as unknown as SseEvent };
                    },
                };
            },
        });

        const client = new MedkitApiClient("http://gw", "api/v1");
        const errors: unknown[] = [];

        const unsub = client.subscribeFaultStream(
            () => { /* onConfirmed */ },
            () => { /* onCleared */ },
            (e) => errors.push(e),
        );

        // Unsubscribe BEFORE the iterator throws.
        unsub();

        // Now release the throw; the guard must suppress onError.
        releaseThrow();
        await new Promise<void>((resolve) => setTimeout(resolve, 20));

        expect(errors).toHaveLength(0);
    });

    it("fault data wrapped in .fault envelope is unwrapped before transform", async () => {
        mockFaults = () => makeStreamStub([
            { event: "fault_confirmed", data: { fault: RAW_FAULT } },
        ]);
        const client = new MedkitApiClient("http://gw", "api/v1");
        const confirmed: unknown[] = [];

        const unsub = client.subscribeFaultStream(
            (f) => confirmed.push(f),
            () => { /* onCleared */ },
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        unsub();

        expect(confirmed).toHaveLength(1);
        expect(confirmed[0]).toMatchObject({ code: "LIDAR_FAIL" });
    });
});
