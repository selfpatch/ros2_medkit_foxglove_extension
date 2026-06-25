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

function makeClient(
  publishTopic = vi.fn().mockResolvedValue(undefined),
  getTopicData = vi.fn().mockResolvedValue({ topic: "/chatter", data: { data: "hi" } }),
): MedkitApiClient {
  return { publishTopic, getTopicData } as unknown as MedkitApiClient;
}

function renderPanel(client: MedkitApiClient, topics: ComponentTopic[]) {
  return render(
    <DataPanel client={client} entityType="apps" entityId="talker" topics={topics} theme={THEME} />,
  );
}

// Output-only: the entity publishes /chatter. Readable, but not a publish target.
const PLAIN_TOPIC: ComponentTopic = {
  topic: "/chatter",
  timestamp: 0,
  data: null,
  type: "std_msgs/msg/String",
  isPublisher: true,
};

// The entity subscribes to /cmd, so publishing to it is the intended use.
const SUB_TOPIC: ComponentTopic = {
  topic: "/cmd",
  timestamp: 0,
  data: null,
  type: "std_msgs/msg/String",
  isSubscriber: true,
};

describe("DataPanel - publish affordance", () => {
  it("offers Publish for a subscribed topic with a known type", () => {
    renderPanel(makeClient(), [SUB_TOPIC]);
    expect(screen.getByRole("button", { name: "Publish to /cmd" })).toBeInTheDocument();
  });

  it("withholds Publish for an output-only (publisher) topic, but still offers Read", () => {
    renderPanel(makeClient(), [PLAIN_TOPIC]);
    expect(screen.queryByRole("button", { name: "Publish to /chatter" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read /chatter" })).toBeInTheDocument();
  });

  it("withholds Publish for a topic with no known type", () => {
    renderPanel(makeClient(), [{ topic: "/no_type", timestamp: 0, data: null, isSubscriber: true }]);
    expect(screen.queryByRole("button", { name: "Publish to /no_type" })).not.toBeInTheDocument();
  });

  it("offers Publish for a topic whose direction the gateway does not report", () => {
    // Neither isPublisher nor isSubscriber set: don't over-restrict, allow Publish.
    renderPanel(makeClient(), [{ topic: "/x", timestamp: 0, data: null, type: "std_msgs/msg/String" }]);
    expect(screen.getByRole("button", { name: "Publish to /x" })).toBeInTheDocument();
  });

  it("publishes the JSON message to the topic with its type, after confirmation", async () => {
    const publishTopic = vi.fn().mockResolvedValue(undefined);
    renderPanel(makeClient(publishTopic), [SUB_TOPIC]);

    fireEvent.click(screen.getByRole("button", { name: "Publish to /cmd" }));
    fireEvent.change(screen.getByLabelText("message JSON for /cmd"), { target: { value: '{"data":"hello"}' } });
    fireEvent.click(screen.getByRole("button", { name: "Send /cmd" }));
    // Two-step: nothing goes to the wire until Confirm.
    expect(publishTopic).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm publish to /cmd" }));

    await waitFor(() =>
      expect(publishTopic).toHaveBeenCalledWith("apps", "talker", "/cmd", "std_msgs/msg/String", {
        data: "hello",
      }),
    );
    await waitFor(() => expect(screen.getByText(/Published to \/cmd/)).toBeInTheDocument());
  });

  it("rejects invalid JSON without arming the confirmation or publishing", async () => {
    const publishTopic = vi.fn().mockResolvedValue(undefined);
    renderPanel(makeClient(publishTopic), [SUB_TOPIC]);
    fireEvent.click(screen.getByRole("button", { name: "Publish to /cmd" }));
    fireEvent.change(screen.getByLabelText("message JSON for /cmd"), { target: { value: "{not json" } });
    fireEvent.click(screen.getByRole("button", { name: "Send /cmd" }));
    expect(await screen.findByText(/must be valid JSON/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm publish to /cmd" })).not.toBeInTheDocument();
    expect(publishTopic).not.toHaveBeenCalled();
  });

  it("surfaces a publish failure", async () => {
    const publishTopic = vi.fn().mockRejectedValue(new Error("no publisher"));
    renderPanel(makeClient(publishTopic), [SUB_TOPIC]);
    fireEvent.click(screen.getByRole("button", { name: "Publish to /cmd" }));
    fireEvent.click(screen.getByRole("button", { name: "Send /cmd" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm publish to /cmd" }));
    expect(await screen.findByText(/no publisher/)).toBeInTheDocument();
  });

  it("renders a schema-driven form when the topic carries a schema", () => {
    const schemaTopic: ComponentTopic = {
      topic: "/twist",
      timestamp: 0,
      data: null,
      type: "geometry_msgs/msg/Twist",
      isSubscriber: true,
      schema: { linear_x: { type: "float64" } },
    };
    renderPanel(makeClient(), [schemaTopic]);
    fireEvent.click(screen.getByRole("button", { name: "Publish to /twist" }));
    // The schema field is rendered (not a raw JSON textarea).
    expect(screen.getByLabelText("linear_x")).toBeInTheDocument();
    expect(screen.queryByLabelText("message JSON for /twist")).not.toBeInTheDocument();
  });

  it("publishes the structured value from the schema form (after confirmation)", async () => {
    const publishTopic = vi.fn().mockResolvedValue(undefined);
    const schemaTopic: ComponentTopic = {
      topic: "/twist",
      timestamp: 0,
      data: null,
      type: "geometry_msgs/msg/Twist",
      isSubscriber: true,
      schema: { linear_x: { type: "float64" } },
    };
    renderPanel(makeClient(publishTopic), [schemaTopic]);
    fireEvent.click(screen.getByRole("button", { name: "Publish to /twist" }));
    fireEvent.change(screen.getByLabelText("linear_x"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Send /twist" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm publish to /twist" }));
    await waitFor(() =>
      expect(publishTopic).toHaveBeenCalledWith("apps", "talker", "/twist", "geometry_msgs/msg/Twist", {
        linear_x: 1.5,
      }),
    );
  });
});

describe("DataPanel - read", () => {
  it("offers Read for every topic and shows the fetched value", async () => {
    const getTopicData = vi.fn().mockResolvedValue({ topic: "/chatter", data: { data: "hello world" } });
    const client = makeClient(vi.fn(), getTopicData);
    renderPanel(client, [PLAIN_TOPIC]);

    fireEvent.click(screen.getByRole("button", { name: "Read /chatter" }));
    await waitFor(() => expect(getTopicData).toHaveBeenCalledWith("apps", "talker", "/chatter"));
    await waitFor(() => expect(screen.getByText(/hello world/)).toBeInTheDocument());
  });

  it("shows the no-sample state when the gateway reports metadata_only", async () => {
    // The gateway returns an empty body with status "metadata_only" for an
    // unsampled topic; that must read as "no data", not an empty object.
    const getTopicData = vi.fn().mockResolvedValue({ topic: "/chatter", data: {}, status: "metadata_only" });
    const client = makeClient(vi.fn(), getTopicData);
    renderPanel(client, [PLAIN_TOPIC]);
    fireEvent.click(screen.getByRole("button", { name: "Read /chatter" }));
    expect(await screen.findByText(/No data sampled/i)).toBeInTheDocument();
  });

  it("shows a read error when the fetch fails", async () => {
    const getTopicData = vi.fn().mockRejectedValue(new Error("no sample"));
    const client = makeClient(vi.fn(), getTopicData);
    renderPanel(client, [PLAIN_TOPIC]);
    fireEvent.click(screen.getByRole("button", { name: "Read /chatter" }));
    expect(await screen.findByText(/no sample/)).toBeInTheDocument();
  });
});
