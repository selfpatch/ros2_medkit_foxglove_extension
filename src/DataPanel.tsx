// Copyright 2026 bburda. Apache-2.0 license.
//
// Data tab: lists an entity's topics and lets the operator publish a message to
// one. Selecting a topic opens a publish form - a schema-driven form (reusing
// OperationRequestForm) when the gateway exposes the topic's input schema, or a
// raw JSON editor otherwise. Publishing PUTs { type, data } to the topic's data
// resource, which the gateway turns into a one-shot publisher.

import { type ReactElement, Fragment, useCallback, useState } from "react";

import { type MedkitApiClient } from "./medkit-api";
import { OperationRequestForm } from "./OperationRequestForm";
import { getSchemaDefaults } from "./schema-utils";
import type { ComponentTopic, SovdResourceEntityType } from "./types";
import * as S from "./styles";
import type { Theme } from "./styles";

export interface DataPanelProps {
  client: MedkitApiClient;
  entityType: SovdResourceEntityType;
  entityId: string;
  topics: ComponentTopic[];
  theme: Theme;
}

export function DataPanel({ client, entityType, entityId, topics, theme }: DataPanelProps): ReactElement {
  const c = S.colors(theme);

  const [selected, setSelected] = useState<string | null>(null);
  const [formValue, setFormValue] = useState<Record<string, unknown>>({});
  const [jsonText, setJsonText] = useState<string>("{}");
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedTopic = topics.find((t) => t.topic === selected) ?? null;

  const handleSelect = useCallback(
    (t: ComponentTopic) => {
      setResult(null);
      setError(null);
      if (selected === t.topic) {
        setSelected(null); // toggle the publish form closed
        return;
      }
      setSelected(t.topic);
      // Seed the form: schema defaults for a schema-driven topic, else empty JSON.
      if (t.schema) setFormValue(getSchemaDefaults(t.schema));
      else setJsonText("{}");
    },
    [selected],
  );

  const handlePublish = useCallback(async () => {
    if (selectedTopic == null || !selectedTopic.type) return;
    let data: unknown;
    if (selectedTopic.schema) {
      data = formValue;
    } else {
      try {
        data = JSON.parse(jsonText);
      } catch {
        setError("Message must be valid JSON");
        return;
      }
    }
    setPublishing(true);
    setError(null);
    setResult(null);
    try {
      await client.publishTopic(entityType, entityId, selectedTopic.topic, selectedTopic.type, data);
      setResult(`Published to ${selectedTopic.topic}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }, [client, entityType, entityId, selectedTopic, formValue, jsonText]);

  if (topics.length === 0) return <div style={S.emptyState(theme)}>No data items</div>;

  return (
    <table style={{ ...S.table(theme), tableLayout: "fixed" }}>
      <thead>
        <tr>
          <th style={S.th(theme)}>Topic</th>
          <th style={{ ...S.th(theme), width: 160 }}>Type</th>
          <th style={{ ...S.th(theme), width: 70 }}>Dir</th>
          <th style={{ ...S.th(theme), width: 90 }} />
        </tr>
      </thead>
      <tbody>
        {topics.map((t) => {
          const isSel = selected === t.topic;
          // The gateway needs a "pkg/msg/Type" type to construct the publisher;
          // a topic without a known type can't be published to.
          const canPublish = typeof t.type === "string" && t.type.length > 0;
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
                  {t.isPublisher && <span style={S.badge("#fff", c.success)}>pub</span>}
                  {t.isSubscriber && <span style={{ ...S.badge("#fff", c.info), marginLeft: 2 }}>sub</span>}
                </td>
                <td style={S.td(theme)}>
                  {canPublish && (
                    <button
                      style={{ ...S.btn(theme, "ghost"), fontSize: 11, padding: "2px 8px" }}
                      aria-label={`Publish to ${t.topic}`}
                      aria-expanded={isSel}
                      onClick={() => handleSelect(t)}
                    >
                      {isSel ? "Close" : "Publish"}
                    </button>
                  )}
                </td>
              </tr>
              {isSel && canPublish && (
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
                      {error != null && (
                        <div style={{ ...S.errorBox(theme), marginTop: 0, marginBottom: 0, fontSize: 11 }}>{error}</div>
                      )}
                      {result != null && (
                        <div style={{ fontSize: 11, color: c.success }}>{result}</div>
                      )}
                      <button
                        style={{ ...S.btn(theme, "primary"), alignSelf: "flex-start" }}
                        disabled={publishing}
                        aria-label={`Send ${t.topic}`}
                        onClick={() => void handlePublish()}
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
