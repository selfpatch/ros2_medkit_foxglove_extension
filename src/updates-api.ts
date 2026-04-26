// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.

/**
 * Tiny HTTP client wrapping the four SOVD `/updates*` endpoints exposed by
 * the ros2_medkit gateway. Designed for dependency injection in tests via
 * the `fetchImpl` parameter.
 */

export interface UpdateListItem {
  id: string;
  name?: string;
  version?: string;
  updated_components?: string[];
  added_components?: string[];
  removed_components?: string[];
  status?: string;
}

export interface UpdateStatus {
  status: string;
  progress?: number;
}

export interface UpdatesApi {
  listUpdates(): Promise<UpdateListItem[]>;
  getStatus(id: string): Promise<UpdateStatus>;
  prepare(id: string): Promise<void>;
  execute(id: string): Promise<void>;
}

export function createUpdatesApi(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): UpdatesApi {
  const base = baseUrl.replace(/\/$/, "");
  return {
    async listUpdates() {
      const res = await fetchImpl(`${base}/updates`);
      if (!res.ok) throw new Error(`listUpdates ${res.status}`);
      return (await res.json()) as UpdateListItem[];
    },
    async getStatus(id) {
      const res = await fetchImpl(`${base}/updates/${id}/status`);
      if (!res.ok) throw new Error(`getStatus ${res.status}`);
      return (await res.json()) as UpdateStatus;
    },
    async prepare(id) {
      const res = await fetchImpl(`${base}/updates/${id}/prepare`, { method: "PUT" });
      if (!res.ok) throw new Error(`prepare ${res.status}`);
    },
    async execute(id) {
      const res = await fetchImpl(`${base}/updates/${id}/execute`, { method: "PUT" });
      if (!res.ok) throw new Error(`execute ${res.status}`);
    },
  };
}
