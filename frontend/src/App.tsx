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
import type { IngestStatus, LogFileInfo, QueryDescriptor, QueryParam, QueryResponse } from "./types";

type GenericRow = Record<string, unknown>;

const columnHelper = createColumnHelper<GenericRow>();
const defaultStatus: IngestStatus = {
  running: false,
  total_files: 0,
  processed_files: 0,
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

  const selectedQuery = useMemo(
    () => queries.find((q) => q.name === selectedQueryName) ?? null,
    [queries, selectedQueryName]
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

  const percent =
    ingestStatus.total_files > 0
      ? Math.round((ingestStatus.processed_files / ingestStatus.total_files) * 100)
      : 0;

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
                  <th>Modified</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                {pickedRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="emptyCell">
                      No files loaded.
                    </td>
                  </tr>
                ) : (
                  pickedRows.map((row) => (
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
                      <td>{formatDate(row.info.modified_at)}</td>
                      <td>{row.info.size_mb.toFixed(2)} MB</td>
                    </tr>
                  ))
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
          {ingestMessage ? <div className="notice">{ingestMessage}</div> : null}
          <div className="progressTrack">
            <div className="progressFill" style={{ width: `${percent}%` }} />
          </div>
          <div className="stats compact">
            <Stat label="Files" value={`${ingestStatus.processed_files}/${ingestStatus.total_files}`} />
            <Stat label="Rows" value={formatNumber(ingestStatus.total_rows)} />
            <Stat label="Current" value={ingestStatus.current_file ?? "-"} mono />
            <Stat label="Duration" value={`${formatNumber(ingestStatus.duration_ms)} ms`} />
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
    </main>
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
