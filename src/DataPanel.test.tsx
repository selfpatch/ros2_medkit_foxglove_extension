// Copyright 2026 bburda. Apache-2.0 license.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { DataPanel } from "./DataPanel";
import type { MedkitApiClient } from "./medkit-api";
import type { ComponentTopic } from "./types";

const THEME = "dark" as const;

afterEach(() => {
  vi.restoreAllMocks();
});

function makeClient(publishTopic = vi.fn().mockResolvedValue(undefined)): MedkitApiClient {
  return { publishTopic } as unknown as MedkitApiClient;
}

function renderPanel(client: MedkitApiClient, topics: ComponentTopic[]) {
  return render(
    <DataPanel client={client} entityType="apps" entityId="talker" topics={topics} theme={THEME} />,
  );
}

const PLAIN_TOPIC: ComponentTopic = {
  topic: "/chatter",
  timestamp: 0,
  data: null,
  type: "std_msgs/msg/String",
  isPublisher: true,
};

describe("DataPanel - publish affordance", () => {
  it("shows a Publish button only for topics with a known type", () => {
    renderPanel(makeClient(), [
      PLAIN_TOPIC,
      { topic: "/no_type", timestamp: 0, data: null, isSubscriber: true },
    ]);
    expect(screen.getByRole("button", { name: "Publish to /chatter" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish to /no_type" })).not.toBeInTheDocument();
  });

  it("publishes the JSON message to the topic with its type", async () => {
    const publishTopic = vi.fn().mockResolvedValue(undefined);
    renderPanel(makeClient(publishTopic), [PLAIN_TOPIC]);

    fireEvent.click(screen.getByRole("button", { name: "Publish to /chatter" }));
    const textarea = screen.getByLabelText("message JSON for /chatter");
    fireEvent.change(textarea, { target: { value: '{"data":"hello"}' } });
    fireEvent.click(screen.getByRole("button", { name: "Send /chatter" }));

    await waitFor(() =>
      expect(publishTopic).toHaveBeenCalledWith("apps", "talker", "/chatter", "std_msgs/msg/String", {
        data: "hello",
      }),
    );
    await waitFor(() => expect(screen.getByText(/Published to \/chatter/)).toBeInTheDocument());
  });

  it("rejects invalid JSON without calling publish", async () => {
    const publishTopic = vi.fn().mockResolvedValue(undefined);
    renderPanel(makeClient(publishTopic), [PLAIN_TOPIC]);
    fireEvent.click(screen.getByRole("button", { name: "Publish to /chatter" }));
    fireEvent.change(screen.getByLabelText("message JSON for /chatter"), { target: { value: "{not json" } });
    fireEvent.click(screen.getByRole("button", { name: "Send /chatter" }));
    expect(await screen.findByText(/must be valid JSON/i)).toBeInTheDocument();
    expect(publishTopic).not.toHaveBeenCalled();
  });

  it("surfaces a publish failure", async () => {
    const publishTopic = vi.fn().mockRejectedValue(new Error("no publisher"));
    renderPanel(makeClient(publishTopic), [PLAIN_TOPIC]);
    fireEvent.click(screen.getByRole("button", { name: "Publish to /chatter" }));
    fireEvent.click(screen.getByRole("button", { name: "Send /chatter" }));
    expect(await screen.findByText(/no publisher/)).toBeInTheDocument();
  });

  it("renders a schema-driven form when the topic carries a schema", () => {
    const schemaTopic: ComponentTopic = {
      topic: "/cmd",
      timestamp: 0,
      data: null,
      type: "geometry_msgs/msg/Twist",
      schema: { linear_x: { type: "float64" } },
    };
    renderPanel(makeClient(), [schemaTopic]);
    fireEvent.click(screen.getByRole("button", { name: "Publish to /cmd" }));
    // The schema field is rendered (not a raw JSON textarea).
    expect(screen.getByLabelText("linear_x")).toBeInTheDocument();
    expect(screen.queryByLabelText("message JSON for /cmd")).not.toBeInTheDocument();
  });
});
