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
  total_rows: number;
  current_file: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  errors: string[];
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
