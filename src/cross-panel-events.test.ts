// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.
import { afterEach, describe, expect, it, vi } from "vitest";

import { notifyEntityGraphChanged, onEntityGraphChanged } from "./cross-panel-events";

describe("cross-panel-events", () => {
    afterEach(() => {
        // Best-effort cleanup - tests register their own listeners but
        // forgetting one shouldn't poison sibling tests.
        vi.restoreAllMocks();
    });

    it("delivers notify -> handler in the same window", () => {
        const handler = vi.fn();
        const unsubscribe = onEntityGraphChanged(handler);
        notifyEntityGraphChanged();
        expect(handler).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it("supports multiple subscribers (every panel listens independently)", () => {
        const a = vi.fn();
        const b = vi.fn();
        const unsubA = onEntityGraphChanged(a);
        const unsubB = onEntityGraphChanged(b);
        notifyEntityGraphChanged();
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
        unsubA();
        unsubB();
    });

    it("unsubscribe stops further deliveries", () => {
        const handler = vi.fn();
        const unsubscribe = onEntityGraphChanged(handler);
        notifyEntityGraphChanged();
        unsubscribe();
        notifyEntityGraphChanged();
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("each notify fires a fresh event - no debounce, no coalescing", () => {
        const handler = vi.fn();
        const unsubscribe = onEntityGraphChanged(handler);
        notifyEntityGraphChanged();
        notifyEntityGraphChanged();
        notifyEntityGraphChanged();
        expect(handler).toHaveBeenCalledTimes(3);
        unsubscribe();
    });
});
