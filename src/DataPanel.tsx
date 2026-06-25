// Copyright 2026 bburda. Apache-2.0 license.
//
// Data tab: lists an entity's topics and lets the operator READ a topic's
// current value or PUBLISH a message to it. Read fetches GET /{entity}/data/{id}
// and shows the sampled value; Publish opens a form - a schema-driven form
// (reusing OperationRequestForm) when the gateway exposes the topic's input
// schema, or a raw JSON editor otherwise - and PUTs { type, data }, which the
// gateway turns into a one-shot publisher.

import { type ReactElement, Fragment, useCallback, useState } from "react";

import { type MedkitApiClient } from "./medkit-api";
import { OperationRequestForm } from "./OperationRequestForm";
import { getSchemaDefaults } from "./schema-utils";
import type { ComponentTopic, SovdResourceEntityType } from "./types";
import * as S from "./styles";
import type { Theme } from "./styles";

type Mode = "read" | "publish";

export interface DataPanelProps {
  client: MedkitApiClient;
  entityType: SovdResourceEntityType;
  entityId: string;
  topics: ComponentTopic[];
  theme: Theme;
}

export function DataPanel({ client, entityType, entityId, topics, theme }: DataPanelProps): ReactElement {
  const c = S.colors(theme);

  // Which topic+mode is expanded; only one at a time.
  const [open, setOpen] = useState<{ topic: string; mode: Mode } | null>(null);

  // Publish state
  const [formValue, setFormValue] = useState<Record<string, unknown>>({});
  const [jsonText, setJsonText] = useState<string>("{}");
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Read state
  const [readValue, setReadValue] = useState<unknown>(undefined);
  const [readLoading, setReadLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const readTopic = useCallback(
    async (topic: string) => {
      setReadLoading(true);
      setReadError(null);
      setReadValue(undefined);
      try {
        const res = await client.getTopicData(entityType, entityId, topic);
        setReadValue(res.data);
      } catch (err) {
        setReadError(err instanceof Error ? err.message : "Read failed");
      } finally {
        setReadLoading(false);
      }
    },
    [client, entityType, entityId],
  );

  const toggle = useCallback(
    (t: ComponentTopic, mode: Mode) => {
      setPublishResult(null);
      setPublishError(null);
      if (open?.topic === t.topic && open.mode === mode) {
        setOpen(null); // toggle closed
        return;
      }
      setOpen({ topic: t.topic, mode });
      if (mode === "publish") {
        if (t.schema) setFormValue(getSchemaDefaults(t.schema));
        else setJsonText("{}");
      } else {
        void readTopic(t.topic);
      }
    },
    [open, readTopic],
  );

  const handlePublish = useCallback(
    async (t: ComponentTopic) => {
      if (!t.type) return;
      let data: unknown;
      if (t.schema) {
        data = formValue;
      } else {
        try {
          data = JSON.parse(jsonText);
        } catch {
          setPublishError("Message must be valid JSON");
          return;
        }
      }
      setPublishing(true);
      setPublishError(null);
      setPublishResult(null);
      try {
        await client.publishTopic(entityType, entityId, t.topic, t.type, data);
        setPublishResult(`Published to ${t.topic}`);
      } catch (err) {
        setPublishError(err instanceof Error ? err.message : "Publish failed");
      } finally {
        setPublishing(false);
      }
    },
    [client, entityType, entityId, formValue, jsonText],
  );

  if (topics.length === 0) return <div style={S.emptyState(theme)}>No data items</div>;

  const preStyle = {
    margin: 0,
    padding: 6,
    background: c.bg,
    borderRadius: 4,
    fontSize: 11,
    fontFamily: "ui-monospace, monospace",
    overflow: "auto" as const,
    maxHeight: 200,
    whiteSpace: "pre-wrap" as const,
  };

  return (
    <table style={{ ...S.table(theme), tableLayout: "fixed", width: "100%" }}>
      <thead>
        <tr>
          <th style={S.th(theme)}>Topic</th>
          <th style={{ ...S.th(theme), width: 150 }}>Type</th>
          <th style={{ ...S.th(theme), width: 84 }}>Dir</th>
          <th style={{ ...S.th(theme), width: 150 }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {topics.map((t) => {
          // The gateway needs a "pkg/msg/Type" type to construct the publisher;
          // a topic without a known type can't be published to.
          const canPublish = typeof t.type === "string" && t.type.length > 0;
          const isOpen = open?.topic === t.topic;
          return (
            <Fragment key={t.topic}>
              <tr>
                <td style={{ ...S.td(theme), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.topic}>
                  {t.topic}
                </td>
                <td style={{ ...S.td(theme), color: c.textMuted, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.type}>
                  {t.type || "—"}
                </td>
                <td style={S.td(theme)}>
                  {/* Flex row so pub/sub badges never overlap. */}
                  <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                    {t.isPublisher && <span style={S.badge("#fff", c.success)}>pub</span>}
                    {t.isSubscriber && <span style={S.badge("#fff", c.info)}>sub</span>}
                    {!t.isPublisher && !t.isSubscriber && <span style={{ color: c.textMuted }}>—</span>}
                  </div>
                </td>
                <td style={S.td(theme)}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      style={{ ...S.btn(theme, "ghost"), fontSize: 11, padding: "2px 8px" }}
                      aria-label={`Read ${t.topic}`}
                      aria-expanded={isOpen && open?.mode === "read"}
                      onClick={() => toggle(t, "read")}
                    >
                      Read
                    </button>
                    {canPublish && (
                      <button
                        style={{ ...S.btn(theme, "ghost"), fontSize: 11, padding: "2px 8px" }}
                        aria-label={`Publish to ${t.topic}`}
                        aria-expanded={isOpen && open?.mode === "publish"}
                        onClick={() => toggle(t, "publish")}
                      >
                        Publish
                      </button>
                    )}
                  </div>
                </td>
              </tr>

              {isOpen && open?.mode === "read" && (
                <tr>
                  <td colSpan={4} style={{ ...S.td(theme), background: c.bgAlt }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11, color: c.textMuted }}>Latest value</span>
                        <button
                          style={{ ...S.btn(theme, "ghost"), fontSize: 11, padding: "2px 8px" }}
                          disabled={readLoading}
                          aria-label={`Refresh ${t.topic}`}
                          onClick={() => void readTopic(t.topic)}
                        >
                          {readLoading ? "Reading..." : "Refresh"}
                        </button>
                      </div>
                      {readError != null ? (
                        <div style={{ ...S.errorBox(theme), marginTop: 0, marginBottom: 0, fontSize: 11 }}>{readError}</div>
                      ) : readLoading ? (
                        <div style={{ fontSize: 12, color: c.textMuted }}>Reading...</div>
                      ) : readValue == null ? (
                        <div style={{ fontSize: 12, color: c.textMuted }}>No data sampled for this topic.</div>
                      ) : (
                        <pre style={preStyle}>{JSON.stringify(readValue, null, 2)}</pre>
                      )}
                    </div>
                  </td>
                </tr>
              )}

              {isOpen && open?.mode === "publish" && canPublish && (
                <tr>
                  <td colSpan={4} style={{ ...S.td(theme), background: c.bgAlt }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 4 }}>
                      <div style={{ fontSize: 11, color: c.textMuted }}>
                        Publish a <code style={{ color: c.accent }}>{t.type}</code> message
                      </div>
                      {t.schema ? (
                        <OperationRequestForm schema={t.schema} value={formValue} onChange={setFormValue} theme={theme} />
                      ) : (
                        <textarea
                          aria-label={`message JSON for ${t.topic}`}
                          style={{
                            ...S.input(theme),
                            minHeight: 80,
                            fontFamily: "ui-monospace, monospace",
                            fontSize: 11,
                            resize: "vertical",
                          }}
                          value={jsonText}
                          onChange={(e) => setJsonText(e.target.value)}
                        />
                      )}
                      {publishError != null && (
                        <div style={{ ...S.errorBox(theme), marginTop: 0, marginBottom: 0, fontSize: 11 }}>{publishError}</div>
                      )}
                      {publishResult != null && (
                        <div style={{ fontSize: 11, color: c.success }}>{publishResult}</div>
                      )}
                      <button
                        style={{ ...S.btn(theme, "primary"), alignSelf: "flex-start" }}
                        disabled={publishing}
                        aria-label={`Send ${t.topic}`}
                        onClick={() => void handlePublish(t)}
                      >
                        {publishing ? "Publishing..." : "Publish"}
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
