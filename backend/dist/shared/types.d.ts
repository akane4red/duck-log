/** Normalized IIS log row — unified schema regardless of source file field order */
export interface LogRow {
    date: string;
    time: string;
    datetime: string;
    s_ip: string;
    c_ip: string;
    method: string;
    uri_stem: string;
    uri_query: string | null;
    port: number;
    username: string | null;
    user_agent: string | null;
    referer: string | null;
    status: number;
    substatus: number;
    win32_status: number;
    time_taken_ms: number;
    source_file: string;
}
/** File info returned by GET /files */
export interface LogFileInfo {
    name: string;
    path: string;
    size_bytes: number;
    size_mb: number;
    modified_at: string;
    ingested: boolean;
}
/** POST /ingest request body */
export interface IngestRequest {
    file_paths: string[];
}
/** GET /ingest/status response */
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
/** Standard API response envelope */
export interface ApiResponse<T> {
    ok: boolean;
    data?: T;
    error?: string;
}
/** Standard query response envelope */
export interface QueryResponse<T = Record<string, unknown>> {
    query: string;
    params: Record<string, unknown>;
    duration_ms: number;
    row_count: number;
    rows: T[];
    rows_limited?: boolean;
    returned_rows?: number;
}
/** Query parameter descriptor — for /queries endpoint */
export interface QueryParam {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]';
    required: boolean;
    default?: unknown;
    description: string;
}
/** Query descriptor — for /queries endpoint */
export interface QueryDescriptor {
    name: string;
    description: string;
    params: QueryParam[];
}
//# sourceMappingURL=types.d.ts.map