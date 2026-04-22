export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface LogFileInfo {
  name: string;
  path: string;
  size_bytes: number;
  size_mb: number;
  modified_at: string;
  ingested: boolean;
}

export interface IngestStatus {
  running: boolean;
  total_files: number;
  processed_files: number;
  active_files: number;
  current_files: string[];
  file_statuses: IngestFileStatus[];
  total_rows: number;
  current_file: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  errors: string[];
}

export interface IngestFileStatus {
  name: string;
  status: "queued" | "processing" | "done" | "error";
  error?: string;
}

export interface ForensicOverview {
  totals: {
    requests: number;
    unique_ips: number;
    unique_uris: number;
    error_4xx: number;
    error_5xx: number;
    avg_time_taken_ms: number;
    first_seen: string | null;
    last_seen: string | null;
  };
  status_breakdown: Array<{
    status: number;
    requests: number;
  }>;
  method_breakdown: Array<{
    method: string;
    requests: number;
  }>;
  timeline: Array<{
    bucket_time: string;
    requests: number;
    unique_ips: number;
    errors: number;
  }>;
  top_client_ips: Array<{
    c_ip: string;
    requests: number;
    distinct_uris: number;
    error_requests: number;
  }>;
  top_uris: Array<{
    uri_stem: string;
    requests: number;
    distinct_ips: number;
    avg_time_taken_ms: number;
  }>;
  suspicious_ips: Array<{
    c_ip: string;
    requests: number;
    distinct_uris: number;
    error_requests: number;
    first_seen: string | null;
    last_seen: string | null;
  }>;
}

export type QueryParamType = "string" | "number" | "boolean" | "string[]" | "number[]";

export interface QueryParam {
  name: string;
  type: QueryParamType;
  required: boolean;
  default?: unknown;
  description: string;
}

export interface QueryDescriptor {
  name: string;
  description: string;
  params: QueryParam[];
}

export interface QueryResponse<T = Record<string, unknown>> {
  query: string;
  params: Record<string, unknown>;
  duration_ms: number;
  row_count: number;
  rows: T[];
}
