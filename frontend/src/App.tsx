import { memo, type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable
} from "@tanstack/react-table";
import { api, apiBaseUrl, checkHealth, postMultipart } from "./api";
import type {
  ForensicOverview,
  IngestFileStatus,
  IngestStatus,
  LogFileInfo,
  QueryDescriptor,
  QueryParam,
  QueryResponse
} from "./types";

type GenericRow = Record<string, unknown>;

const columnHelper = createColumnHelper<GenericRow>();
const defaultStatus: IngestStatus = {
  running: false,
  total_files: 0,
  processed_files: 0,
  active_files: 0,
  current_files: [],
  file_statuses: [],
  total_rows: 0,
  current_file: null,
  started_at: null,
  finished_at: null,
  duration_ms: null,
  errors: []
};

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat().format(value ?? 0);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDuration(durationMs: number | null | undefined) {
  if (durationMs === null || durationMs === undefined) return "-";
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad2 = (n: number) => String(n).padStart(2, "0");

  if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
  return `${minutes}:${pad2(seconds)}`;
}

function parseParamValue(param: QueryParam, raw: string): unknown {
  if (param.type === "number") return Number(raw);
  if (param.type === "boolean") return raw === "true";
  if (param.type === "number[]") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number);
  }
  if (param.type === "string[]") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return raw;
}

function pickedRowKey(file: File) {
  return `${file.name}\0${file.size}\0${file.lastModified}`;
}

function describeIngest(status: IngestStatus) {
  if (status.running) {
    if (status.active_files > 0) {
      return `Processing ${status.active_files} file(s) in parallel.`;
    }
    return "Preparing ingestion...";
  }
  if (status.processed_files > 0 && status.processed_files === status.total_files) {
    return `Completed ${status.processed_files} file(s).`;
  }
  return "Ready to ingest selected files.";
}

function formatFileStateLabel(fileStatus: IngestFileStatus | undefined) {
  switch (fileStatus?.status) {
    case "processing":
      return "Processing";
    case "done":
      return "Done";
    case "error":
      return "Error";
    case "queued":
      return "Queued";
    default:
      return "Selected";
  }
}

export default function App() {
  const [healthOnline, setHealthOnline] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanMessage, setScanMessage] = useState<string>(
    "Select one or more IIS .log files."
  );
  const [pickedRows, setPickedRows] = useState<Array<{ info: LogFileInfo; file: File }>>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const [ingestStatus, setIngestStatus] = useState<IngestStatus>(defaultStatus);
  const [ingestMessage, setIngestMessage] = useState<string>("");

  const [queries, setQueries] = useState<QueryDescriptor[]>([]);
  const [selectedQueryName, setSelectedQueryName] = useState<string>("");
  const [queryParams, setQueryParams] = useState<Record<string, string>>({});
  const [queryMessage, setQueryMessage] = useState<string>("Run a query to display forensic results.");
  const [queryResult, setQueryResult] = useState<QueryResponse<GenericRow> | null>(null);
  const [overview, setOverview] = useState<ForensicOverview | null>(null);
  const [overviewMessage, setOverviewMessage] = useState<string>("");

  const selectedQuery = useMemo(
    () => queries.find((q) => q.name === selectedQueryName) ?? null,
    [queries, selectedQueryName]
  );
  const fileStatusByName = useMemo(
    () => new Map(ingestStatus.file_statuses.map((fileStatus) => [fileStatus.name, fileStatus])),
    [ingestStatus.file_statuses]
  );

  useEffect(() => {
    const run = async () => {
      setHealthOnline(await checkHealth());
      void loadIngestStatus();
      void loadQueries();
    };
    void run();
  }, []);

  useEffect(() => {
    if (!ingestStatus.running) return;
    const handle = window.setInterval(() => {
      void loadIngestStatus();
    }, 1500);
    return () => window.clearInterval(handle);
  }, [ingestStatus.running]);

  useEffect(() => {
    if (ingestStatus.running) return;
    if (ingestStatus.total_files === 0) return;
    void loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingestStatus.running, ingestStatus.total_files, ingestStatus.processed_files]);

  async function loadQueries() {
    try {
      const data = await api<QueryDescriptor[]>("/queries");
      setQueries(data);
      if (!data.length) return;
      setSelectedQueryName((prev) => prev || data[0].name);
    } catch (error) {
      setQueryMessage((error as Error).message);
    }
  }

  async function loadIngestStatus() {
    try {
      const status = await api<IngestStatus>("/ingest/status");
      setIngestStatus(status);
    } catch (error) {
      setIngestMessage((error as Error).message);
    }
  }

  async function loadOverview(force = false) {
    setOverviewMessage("");
    try {
      const data = await api<ForensicOverview>(`/dashboard/overview${force ? "?force=true" : ""}`);
      setOverview(data);
    } catch (error) {
      setOverview(null);
      setOverviewMessage((error as Error).message);
    }
  }

  function onSelectFiles() {
    fileInputRef.current?.click();
  }

  function onFilesPicked(event: ChangeEvent<HTMLInputElement>) {
    const inputFiles = event.target.files;
    if (!inputFiles || inputFiles.length === 0) {
      setScanMessage("No files selected.");
      return;
    }

    const fileList = Array.from(inputFiles).filter((file) => file.name.toLowerCase().endsWith(".log"));
    const rows = fileList.map((file) => {
      const unsafePath = (file as File & { path?: string }).path;
      const resolvedPath = unsafePath && unsafePath.trim().length > 0 ? unsafePath : file.name;
      const info: LogFileInfo = {
        name: file.name,
        path: resolvedPath,
        size_bytes: file.size,
        size_mb: file.size / 1024 / 1024,
        modified_at: new Date(file.lastModified).toISOString(),
        ingested: false
      };
      return { info, file };
    });

    setPickedRows(rows);
    setSelectedKeys(new Set(rows.map((r) => pickedRowKey(r.file))));

    if (rows.length === 0) {
      setScanMessage("No .log files found in selection.");
    } else {
      setScanMessage(
        `Loaded ${rows.length} .log file(s). Start ingestion uploads them to the backend (browser paths are not used on disk).`
      );
    }
  }

  async function startIngestion() {
    const selected = pickedRows.filter((r) => selectedKeys.has(pickedRowKey(r.file)));
    if (!selected.length) {
      setIngestMessage("Select at least one file.");
      return;
    }
    setIngestMessage("");
    try {
      const formData = new FormData();
      for (const row of selected) {
        formData.append("logs", row.file, row.file.name);
      }
      await postMultipart<unknown>("/ingest/upload", formData);
      setIngestMessage("Upload accepted — ingestion started.");
      await loadIngestStatus();
    } catch (error) {
      setIngestMessage((error as Error).message);
    }
  }

  async function runQuery() {
    if (!selectedQuery) return;
    const payload: Record<string, unknown> = {};

    for (const param of selectedQuery.params) {
      const raw = queryParams[param.name];
      if (!raw || raw.trim() === "") continue;
      payload[param.name] = parseParamValue(param, raw);
    }

    setQueryMessage(`Running ${selectedQuery.name}...`);
    try {
      const data = await api<QueryResponse<GenericRow>>(
        `/query/${encodeURIComponent(selectedQuery.name)}`,
        {
          method: "POST",
          body: JSON.stringify(payload)
        }
      );
      setQueryResult(data);
      setQueryMessage(`${data.query} completed.`);
    } catch (error) {
      setQueryResult(null);
      setQueryMessage((error as Error).message);
    }
  }

  return (
    <main className="page">
      <header className="hero card">
        <div>
          <div className="muted">IIS Forensics Workspace</div>
          <h1>Duck Log</h1>
          <p className="muted">
            Built for W3C Extended Log Format analysis with large evidence sets.
          </p>
        </div>
        <div className="stats">
          <Stat label="API" value={healthOnline ? "Online" : "Offline"} />
          <Stat label="Queries" value={String(queries.length)} />
          <Stat label="Ingest" value={ingestStatus.running ? "Running" : "Idle"} />
          <Stat label="API Base" value={apiBaseUrl} mono />
        </div>
      </header>

      <section className="layout">
        <article className="card">
          <h2>1. Discover Files</h2>
          <div className="row">
            <button onClick={onSelectFiles}>Select Files</button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".log"
              multiple
              onChange={onFilesPicked}
              style={{ display: "none" }}
            />
          </div>
          <div className="muted">{scanMessage}</div>

          <div className="tableBox">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={
                        pickedRows.length > 0 && selectedKeys.size === pickedRows.length
                      }
                      onChange={(e) => {
                        if (!e.target.checked) {
                          setSelectedKeys(new Set());
                          return;
                        }
                        setSelectedKeys(new Set(pickedRows.map((r) => pickedRowKey(r.file))));
                      }}
                    />
                  </th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Modified</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                {pickedRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="emptyCell">
                      No files loaded.
                    </td>
                  </tr>
                ) : (
                  pickedRows.map((row) => {
                    const fileStatus = fileStatusByName.get(row.info.name);
                    return (
                    <tr key={pickedRowKey(row.file)}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(pickedRowKey(row.file))}
                          onChange={(e) => {
                            const key = pickedRowKey(row.file);
                            setSelectedKeys((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(key);
                              else next.delete(key);
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td>{row.info.name}</td>
                      <td>
                        <span className={`pill ${fileStatus?.status ?? "selected"}`}>
                          {formatFileStateLabel(fileStatus)}
                        </span>
                      </td>
                      <td>{formatDate(row.info.modified_at)}</td>
                      <td>{row.info.size_mb.toFixed(2)} MB</td>
                    </tr>
                  );
                  })
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="card">
          <h2>2. Ingest Progress</h2>
          <div className="row">
            <button onClick={startIngestion}>Start Ingestion</button>
            <button onClick={() => void loadIngestStatus()} className="ghost">
              Refresh Status
            </button>
          </div>
          <div className="muted">{describeIngest(ingestStatus)}</div>
          {ingestMessage ? <div className="notice">{ingestMessage}</div> : null}
          <div className="stats compact">
            <Stat
              label="Completed"
              value={`${ingestStatus.processed_files}/${ingestStatus.total_files}`}
            />
            <Stat label="Active" value={String(ingestStatus.active_files)} />
            <Stat label="Rows" value={formatNumber(ingestStatus.total_rows)} />
            <Stat
              label="Current"
              value={ingestStatus.current_files.length > 0 ? ingestStatus.current_files.join(", ") : "-"}
              mono
            />
            <Stat label="Duration" value={formatDuration(ingestStatus.duration_ms)} />
          </div>
          {ingestStatus.errors.length > 0 && (
            <div className="errorBox">
              {ingestStatus.errors.map((err) => (
                <div key={err}>{err}</div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="card">
        <div className="splitHeader">
          <h2>3. Forensic Queries</h2>
          <div className="row">
            <button onClick={() => void loadQueries()} className="ghost">
              Reload Queries
            </button>
            <button onClick={runQuery} disabled={!selectedQuery}>
              Run Query
            </button>
          </div>
        </div>

        <div className="queries">
          <aside className="queryList">
            {queries.length === 0 ? (
              <div className="emptyCell">No queries available.</div>
            ) : (
              queries.map((query) => (
                <button
                  key={query.name}
                  className={selectedQueryName === query.name ? "queryItem active" : "queryItem"}
                  onClick={() => {
                    setSelectedQueryName(query.name);
                    setQueryParams({});
                  }}
                >
                  <strong>{query.name}</strong>
                  <span>{query.description}</span>
                </button>
              ))
            )}
          </aside>

          <div>
            {!selectedQuery ? (
              <div className="emptyCell">Select a query.</div>
            ) : (
              <div className="formGrid">
                {selectedQuery.params.map((param) => (
                  <label key={param.name}>
                    <span>
                      {param.name} ({param.type})
                    </span>
                    {param.type === "boolean" ? (
                      <select
                        value={queryParams[param.name] ?? ""}
                        onChange={(e) =>
                          setQueryParams((prev) => ({ ...prev, [param.name]: e.target.value }))
                        }
                      >
                        <option value="">Use default</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <input
                        value={queryParams[param.name] ?? ""}
                        placeholder={param.description}
                        onChange={(e) =>
                          setQueryParams((prev) => ({ ...prev, [param.name]: e.target.value }))
                        }
                      />
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="resultMeta">
          <div>{queryMessage}</div>
          <div className="row">
            <div>
              Rows: <strong>{formatNumber(queryResult?.row_count ?? 0)}</strong>
            </div>
            <div>
              Duration: <strong>{formatNumber(queryResult?.duration_ms ?? 0)} ms</strong>
            </div>
          </div>
        </div>

        <ResultsGrid queryResult={queryResult} />
      </section>

      <section className="card">
        <div className="splitHeader">
          <h2>4. Forensic Overview</h2>
          <div className="row">
            <button onClick={() => void loadOverview(true)} className="ghost">
              Refresh Overview
            </button>
          </div>
        </div>
        {overviewMessage ? <div className="errorBox">{overviewMessage}</div> : null}
        {!overview ? (
          <div className="muted">Ingest data to unlock the overview.</div>
        ) : (
          <>
            <div className="stats dashboard">
              <Stat label="Requests" value={formatNumber(overview.totals.requests)} />
              <Stat label="Unique IPs" value={formatNumber(overview.totals.unique_ips)} />
              <Stat label="Unique URIs" value={formatNumber(overview.totals.unique_uris)} />
              <Stat
                label="Errors"
                value={`${formatNumber(overview.totals.error_4xx)} 4xx / ${formatNumber(overview.totals.error_5xx)} 5xx`}
              />
              <Stat label="Avg Latency" value={`${formatNumber(overview.totals.avg_time_taken_ms)} ms`} />
              <Stat label="First Seen" value={formatDate(overview.totals.first_seen)} mono />
              <Stat label="Last Seen" value={formatDate(overview.totals.last_seen)} mono />
              <Stat label="Charts" value="Lightweight (no raw rows)" />
            </div>

            <div className="dashboardGrid">
              <div className="card chartCard">
                <div className="splitHeader">
                  <h3>Last 48 Hours</h3>
                  <div className="muted">Requests and errors per hour</div>
                </div>
                <MiniLineChart
                  series={[
                    { name: "Requests", values: overview.timeline.map((p) => p.requests) },
                    { name: "Errors", values: overview.timeline.map((p) => p.errors) }
                  ]}
                  labels={overview.timeline.map((p) => p.bucket_time)}
                />
              </div>

              <div className="card chartCard">
                <div className="splitHeader">
                  <h3>Top Status</h3>
                  <div className="muted">Most frequent HTTP codes</div>
                </div>
                <MiniBarChart
                  items={overview.status_breakdown.map((r) => ({
                    label: String(r.status),
                    value: r.requests
                  }))}
                />
              </div>

              <div className="card chartCard">
                <div className="splitHeader">
                  <h3>Top Methods</h3>
                  <div className="muted">GET/POST mix</div>
                </div>
                <MiniBarChart
                  items={overview.method_breakdown.map((r) => ({
                    label: r.method,
                    value: r.requests
                  }))}
                />
              </div>
            </div>

            <div className="layout three">
              <article className="card">
                <h3>Top Client IPs</h3>
                <SmallTable
                  columns={["c_ip", "requests", "distinct_uris", "error_requests"]}
                  rows={overview.top_client_ips}
                />
              </article>
              <article className="card">
                <h3>Top URIs</h3>
                <SmallTable
                  columns={["uri_stem", "requests", "distinct_ips", "avg_time_taken_ms"]}
                  rows={overview.top_uris}
                />
              </article>
              <article className="card">
                <h3>Suspicious IPs</h3>
                <div className="muted">High distinct URI probing (scanner-like)</div>
                <SmallTable
                  columns={["c_ip", "distinct_uris", "error_requests", "first_seen", "last_seen"]}
                  rows={overview.suspicious_ips}
                />
              </article>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function clamp01(value: number) {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function MiniLineChart({
  series,
  labels
}: {
  series: Array<{ name: string; values: number[] }>;
  labels: string[];
}) {
  const width = 680;
  const height = 160;
  const pad = 12;
  const allValues = series.flatMap((s) => s.values);
  const maxValue = Math.max(1, ...allValues);
  const pointCount = Math.max(1, labels.length);

  const xForIndex = (idx: number) => {
    if (pointCount === 1) return pad;
    return pad + (idx / (pointCount - 1)) * (width - pad * 2);
  };
  const yForValue = (value: number) => {
    const ratio = clamp01(value / maxValue);
    return height - pad - ratio * (height - pad * 2);
  };

  const colors = ["#79b8ff", "#35d0af", "#ffb8b8"];

  return (
    <div className="chartWrap">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" role="img">
        <rect x="0" y="0" width={width} height={height} rx="12" fill="#0f1929" />
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#4c638340" />
        {series.map((s, seriesIndex) => {
          const d = s.values
            .map((v, idx) => `${idx === 0 ? "M" : "L"} ${xForIndex(idx)} ${yForValue(v)}`)
            .join(" ");
          return (
            <path
              key={s.name}
              d={d}
              fill="none"
              stroke={colors[seriesIndex % colors.length]}
              strokeWidth="2.5"
              opacity={0.95}
            />
          );
        })}
      </svg>
      <div className="legend">
        {series.map((s, i) => (
          <div key={s.name} className="legendItem">
            <span className="legendSwatch" style={{ background: colors[i % colors.length] }} />
            {s.name}
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniBarChart({ items }: { items: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="barList">
      {items.map((item) => (
        <div key={item.label} className="barRow">
          <div className="barLabel mono">{item.label}</div>
          <div className="barTrack">
            <div className="barFill" style={{ width: `${Math.round((item.value / max) * 100)}%` }} />
          </div>
          <div className="barValue">{formatNumber(item.value)}</div>
        </div>
      ))}
    </div>
  );
}

function SmallTable({
  columns,
  rows
}: {
  columns: string[];
  rows: Array<Record<string, unknown>>;
}) {
  return (
    <div className="tableBox compact">
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="emptyCell">
                No rows.
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr key={idx}>
                {columns.map((col) => (
                  <td key={col} className={col.includes("time") || col.includes("seen") ? "mono" : undefined}>
                    {formatValue(row[col])}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

const ResultsGrid = memo(function ResultsGrid({
  queryResult
}: {
  queryResult: QueryResponse<GenericRow> | null;
}) {
  const [resultFilter, setResultFilter] = useState<string>("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const data = queryResult?.rows ?? [];
  const columns = useMemo(() => {
    if (data.length === 0) return [];
    const keys = Array.from(new Set(data.flatMap((row) => Object.keys(row))));
    return keys.map((key) =>
      columnHelper.accessor((row) => row[key], {
        id: key,
        header: key,
        cell: (ctx) => formatValue(ctx.getValue())
      })
    );
  }, [data]);

  const table = useReactTable({
    data,
    columns,
    state: { globalFilter: resultFilter, sorting },
    onGlobalFilterChange: setResultFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      if (!filterValue) return true;
      const text = String(filterValue).toLowerCase();
      return Object.values(row.original).some((value) =>
        formatValue(value).toLowerCase().includes(text)
      );
    }
  });

  const rows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 36,
    overscan: 24
  });

  return (
    <>
      <div className="resultMeta">
        <div className="row">
          <input
            value={resultFilter}
            onChange={(e) => setResultFilter(e.target.value)}
            placeholder="Filter visible results"
          />
        </div>
      </div>
      <div ref={containerRef} className="virtualWrap">
        <table className="resultTable">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className="sortable"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === "asc"
                      ? " ▲"
                      : header.column.getIsSorted() === "desc"
                        ? " ▼"
                        : ""}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative"
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              return (
                <tr
                  key={row.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    transform: `translateY(${virtualRow.start}px)`,
                    width: "100%"
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="emptyOverlay">No query rows.</div>}
      </div>
    </>
  );
});

function Stat({
  label,
  value,
  mono
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="statCard">
      <span>{label}</span>
      <strong className={mono ? "mono" : undefined}>{value}</strong>
    </div>
  );
}
