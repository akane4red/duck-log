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
  QueryResponse,
  SessionInfo
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

function describeIngest(status: IngestStatus, t: typeof translations["en"]) {
  if (status.running) {
    if (status.active_files > 0) {
      return t.descProcessing(status.active_files);
    }
    return t.descPreparing;
  }
  if (status.processed_files > 0 && status.processed_files === status.total_files) {
    return t.descCompleted(status.processed_files);
  }
  return t.descReady;
}

function formatFileStateLabel(fileStatus: IngestFileStatus | undefined, t: typeof translations["en"]) {
  switch (fileStatus?.status) {
    case "processing":
      return t.stateProcessing;
    case "done":
      return t.stateDone;
    case "error":
      return t.stateError;
    case "queued":
      return t.stateQueued;
    default:
      return t.stateSelected;
  }
}

type Lang = "en" | "th";
const translations = {
  en: {
    // Header
    workspaceTitle: "IIS Forensics Workspace",
    appTitle: "Duck Log",
    appDesc: "Built for W3C Extended Log Format analysis with large evidence sets.",
    online: "Online",
    offline: "Offline",
    idle: "Idle",

    // Sessions
    section0: "0. Sessions",
    reloadSessions: "Reload Sessions",
    noSessions: "No sessions",
    newSessionName: "New session name (case)",
    createSession: "Create Session",
    currentSessionHas: (n: number) => `Current session has ${n} parquet file(s).`,
    selectSessionToView: "Select a session to view or ingest evidence.",

    // Discover Files
    section1: "1. Discover Files",
    selectFiles: "Select Files",
    scanDefault: "Select one or more IIS .log files.",
    noFilesSelected: "No files selected.",
    noLogFilesFound: "No .log files found in selection.",
    loadedLogFiles: (n: number) => `Loaded ${n} .log file(s). Start ingestion uploads them to the backend (browser paths are not used on disk).`,
    colName: "Name",
    colStatus: "Status",
    colModified: "Modified",
    colSize: "Size",
    noFilesLoaded: "No files loaded.",

    // Ingest Progress
    section2: "2. Ingest Progress",
    startIngestion: "Start Ingestion",
    refreshStatus: "Refresh Status",
    statCompleted: "Completed",
    statActive: "Active",
    statRows: "Rows",
    statCurrent: "Current",
    statDuration: "Duration",
    errSelectSession: "Create or select a session first.",
    errSelectFile: "Select at least one file.",
    uploadAccepted: "Upload accepted — ingestion started.",
    descPreparing: "Preparing ingestion...",
    descProcessing: (n: number) => `Processing ${n} file(s) in parallel.`,
    descCompleted: (n: number) => `Completed ${n} file(s).`,
    descReady: "Ready to ingest selected files.",

    // States
    stateProcessing: "Processing",
    stateDone: "Done",
    stateError: "Error",
    stateQueued: "Queued",
    stateSelected: "Selected",
    unknown: "Unknown",

    // Forensic Queries (Existing)
    forensicQueries: "3. Forensic Queries",
    reloadQueries: "Reload Queries",
    runQuery: "Run Query",
    running: "Running...",
    noQueries: "No queries available.",
    selectQuery: "Select a query.",
    noParamsRequired: "This query requires no parameters. Click Run Query to execute.",
    rows: "Rows:",
    duration: "Duration:",
    useDefault: "Use default",
    filterQueries: "Filter queries by name...",
    true: "true",
    false: "false",

    // Results Grid
    filterVisible: "Filter visible results",
    noQueryRows: "No query rows.",

    // Forensic Overview
    section4: "4. Forensic Overview",
    refreshOverview: "Refresh Overview",
    loadingOverview: "Loading overview data...",
    ingestToUnlock: "Ingest data to unlock the overview.",
    statRequests: "Requests",
    statUniqueIPs: "Unique IPs",
    statUniqueURIs: "Unique URIs",
    statErrors: "Errors",
    statAvgLatency: "Avg Latency",
    statFirstSeen: "First Seen",
    statLastSeen: "Last Seen",
    statCharts: "Charts",
    lightweight: "Lightweight (no raw rows)",
    last48Hours: "Last 48 Hours",
    reqAndErrPerHour: "Requests and errors per hour",
    topStatus: "Top Status",
    mostFrequentHTTP: "Most frequent HTTP codes",
    topMethods: "Top Methods",
    getPostMix: "GET/POST mix",
    topClientIPs: "Top Client IPs",
    topURIs: "Top URIs",
    suspiciousIPs: "Suspicious IPs",
    highDistinctURI: "High distinct URI probing (scanner-like)",
    noRows: "No rows."
  },
  th: {
    // Header
    workspaceTitle: "พื้นที่ปฏิบัติงาน IIS Forensics",
    appTitle: "Duck Log",
    appDesc: "สร้างขึ้นสำหรับการวิเคราะห์ W3C Extended Log Format ที่มีข้อมูลหลักฐานขนาดใหญ่",
    online: "ออนไลน์",
    offline: "ออฟไลน์",
    idle: "ว่าง",

    // Sessions
    section0: "0. เซสชัน",
    reloadSessions: "โหลดเซสชันใหม่",
    noSessions: "ไม่มีเซสชัน",
    newSessionName: "ชื่อเซสชันใหม่ (ชื่อเคส)",
    createSession: "สร้างเซสชัน",
    currentSessionHas: (n: number) => `เซสชันปัจจุบันมีไฟล์ parquet ${n} ไฟล์`,
    selectSessionToView: "เลือกเซสชันเพื่อดูหรือนำเข้าหลักฐาน",

    // Discover Files
    section1: "1. ค้นหาไฟล์",
    selectFiles: "เลือกไฟล์",
    scanDefault: "เลือกไฟล์ IIS .log ตั้งแต่หนึ่งไฟล์ขึ้นไป",
    noFilesSelected: "ไม่ได้เลือกไฟล์",
    noLogFilesFound: "ไม่พบไฟล์ .log ในส่วนที่เลือก",
    loadedLogFiles: (n: number) => `โหลดไฟล์ .log จำนวน ${n} ไฟล์ เริ่มต้นการนำเข้าข้อมูลเพื่ออัปโหลดไปยังระบบหลังบ้าน (ไม่ใช้ path จากเบราว์เซอร์)`,
    colName: "ชื่อ",
    colStatus: "สถานะ",
    colModified: "แก้ไขล่าสุด",
    colSize: "ขนาด",
    noFilesLoaded: "ไม่มีไฟล์ถูกโหลด",

    // Ingest Progress
    section2: "2. ความคืบหน้าการนำเข้า",
    startIngestion: "เริ่มการนำเข้า",
    refreshStatus: "รีเฟรชสถานะ",
    statCompleted: "เสร็จสิ้น",
    statActive: "กำลังทำงาน",
    statRows: "จำนวนแถว",
    statCurrent: "ไฟล์ปัจจุบัน",
    statDuration: "ระยะเวลา",
    errSelectSession: "กรุณาสร้างหรือเลือกเซสชันก่อน",
    errSelectFile: "กรุณาเลือกอย่างน้อยหนึ่งไฟล์",
    uploadAccepted: "รับไฟล์แล้ว — เริ่มต้นการนำเข้า",
    descPreparing: "กำลังเตรียมการนำเข้า...",
    descProcessing: (n: number) => `กำลังประมวลผล ${n} ไฟล์พร้อมกัน`,
    descCompleted: (n: number) => `เสร็จสิ้น ${n} ไฟล์`,
    descReady: "พร้อมนำเข้าไฟล์ที่เลือก",

    // States
    stateProcessing: "กำลังประมวลผล",
    stateDone: "เสร็จสิ้น",
    stateError: "ข้อผิดพลาด",
    stateQueued: "เข้าคิว",
    stateSelected: "เลือกแล้ว",
    unknown: "ไม่ทราบ",

    // Forensic Queries (Existing)
    forensicQueries: "3. การค้นหาข้อมูลเชิงลึก (Forensic Queries)",
    reloadQueries: "โหลด Query ใหม่",
    runQuery: "รัน Query",
    running: "กำลังรัน...",
    noQueries: "ไม่มี Query ให้ใช้งาน",
    selectQuery: "กรุณาเลือก Query",
    noParamsRequired: "Query นี้ไม่ต้องการพารามิเตอร์ คลิก 'รัน Query' เพื่อทำงาน",
    rows: "จำนวนแถว:",
    duration: "ระยะเวลา:",
    useDefault: "ค่าเริ่มต้น",
    filterQueries: "ค้นหา Query...",
    true: "true",
    false: "false",

    // Results Grid
    filterVisible: "กรองผลลัพธ์",
    noQueryRows: "ไม่มีข้อมูลแถว",

    // Forensic Overview
    section4: "4. ภาพรวมการวิเคราะห์เชิงลึก (Forensic Overview)",
    refreshOverview: "รีเฟรชภาพรวม",
    loadingOverview: "กำลังโหลดข้อมูลภาพรวม...",
    ingestToUnlock: "นำเข้าข้อมูลเพื่อดูภาพรวม",
    statRequests: "จำนวนคำขอ",
    statUniqueIPs: "IP ที่ไม่ซ้ำ",
    statUniqueURIs: "URI ที่ไม่ซ้ำ",
    statErrors: "ข้อผิดพลาด",
    statAvgLatency: "ความหน่วงเฉลี่ย",
    statFirstSeen: "พบครั้งแรก",
    statLastSeen: "พบครั้งล่าสุด",
    statCharts: "กราฟ",
    lightweight: "แบบเบา (ไม่มีข้อมูลดิบ)",
    last48Hours: "48 ชั่วโมงล่าสุด",
    reqAndErrPerHour: "คำขอและข้อผิดพลาดต่อชั่วโมง",
    topStatus: "Status ยอดนิยม",
    mostFrequentHTTP: "รหัส HTTP ที่พบบ่อยที่สุด",
    topMethods: "Method ยอดนิยม",
    getPostMix: "สัดส่วน GET/POST",
    topClientIPs: "Client IP ยอดนิยม",
    topURIs: "URI ยอดนิยม",
    suspiciousIPs: "IP น่าสงสัย",
    highDistinctURI: "เข้าถึง URI หลากหลาย (พฤติกรรมคล้าย Scanner)",
    noRows: "ไม่มีข้อมูล"
  }
};

export default function App() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionId, setSessionId] = useState<string>(() => {
    return window.localStorage.getItem("duck-log-session-id") ?? "";
  });
  const [newSessionName, setNewSessionName] = useState<string>("");
  const [sessionMessage, setSessionMessage] = useState<string>("");

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
  const [overviewLoading, setOverviewLoading] = useState<boolean>(false);

  const [lang, setLang] = useState<Lang>("en");
  const t = translations[lang];

  const [isQueryRunning, setIsQueryRunning] = useState<boolean>(false);
  const [querySearch, setQuerySearch] = useState<string>("");

  const filteredQueries = useMemo(() => {
    if (!querySearch) return queries;
    const lower = querySearch.toLowerCase();
    return queries.filter((q) => q.name.toLowerCase().includes(lower) || q.description.toLowerCase().includes(lower));
  }, [queries, querySearch]);

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
      void loadSessions();
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

  useEffect(() => {
    if (!sessionId) return;
    window.localStorage.setItem("duck-log-session-id", sessionId);
    void loadIngestStatus();
    void loadOverview(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function loadSessions() {
    setSessionMessage("");
    try {
      const data = await api<SessionInfo[]>("/sessions");
      setSessions(data);
      if (!sessionId && data.length > 0) {
        setSessionId(data[0].id);
      }
    } catch (error) {
      setSessionMessage((error as Error).message);
    }
  }

  async function createSession() {
    const name = newSessionName.trim();
    if (!name) {
      setSessionMessage("Enter a session name.");
      return;
    }
    setSessionMessage("");
    try {
      const created = await api<SessionInfo>("/sessions", {
        method: "POST",
        body: JSON.stringify({ name })
      });
      setNewSessionName("");
      await loadSessions();
      setSessionId(created.id);
    } catch (error) {
      setSessionMessage((error as Error).message);
    }
  }

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
      if (!sessionId) return;
      const status = await api<IngestStatus>(`/sessions/${encodeURIComponent(sessionId)}/ingest/status`);
      setIngestStatus(status);
    } catch (error) {
      setIngestMessage((error as Error).message);
    }
  }

  async function loadOverview(force = false) {
    if (!sessionId) return;
    setOverviewMessage("");
    setOverviewLoading(true);
    try {
      const data = await api<ForensicOverview>(
        `/sessions/${encodeURIComponent(sessionId)}/dashboard/overview${force ? "?force=true" : ""}`
      );
      setOverview(data);
    } catch (error) {
      setOverview(null);
      setOverviewMessage((error as Error).message);
    } finally {
      setOverviewLoading(false);
    }
  }

  function onSelectFiles() {
    fileInputRef.current?.click();
  }

  function onFilesPicked(event: ChangeEvent<HTMLInputElement>) {
    const inputFiles = event.target.files;
    if (!inputFiles || inputFiles.length === 0) {
      setScanMessage(t.noFilesSelected);
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
      setScanMessage(t.noLogFilesFound);
    } else {
      setScanMessage(t.loadedLogFiles(rows.length));
    }
  }

  async function startIngestion() {
    if (!sessionId) {
      setIngestMessage(t.errSelectSession);
      return;
    }
    const selected = pickedRows.filter((r) => selectedKeys.has(pickedRowKey(r.file)));
    if (!selected.length) {
      setIngestMessage(t.errSelectFile);
      return;
    }
    setIngestMessage("");
    try {
      const formData = new FormData();
      for (const row of selected) {
        formData.append("logs", row.file, row.file.name);
      }
      await postMultipart<unknown>(`/sessions/${encodeURIComponent(sessionId)}/ingest/upload`, formData);
      setIngestMessage(t.uploadAccepted);
      await loadIngestStatus();
    } catch (error) {
      setIngestMessage((error as Error).message);
    }
  }

  async function runQuery() {
    if (!selectedQuery) return;
    if (!sessionId) {
      setQueryMessage("Create or select a session first.");
      return;
    }
    const payload: Record<string, unknown> = {};

    for (const param of selectedQuery.params) {
      const raw = queryParams[param.name];
      if (!raw || raw.trim() === "") continue;
      payload[param.name] = parseParamValue(param, raw);
    }

    setQueryMessage(`Running ${selectedQuery.name}...`);
    setIsQueryRunning(true);
    try {
      const data = await api<QueryResponse<GenericRow>>(
        `/sessions/${encodeURIComponent(sessionId)}/query/${encodeURIComponent(selectedQuery.name)}`,
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
    } finally {
      setIsQueryRunning(false);
    }
  }

  function handleQueryKeyDown(e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void runQuery();
    }
  }

  return (
    <main className="page">
      <header className="hero card">
        <div className="splitHeader">
          <div>
            <div className="muted">{t.workspaceTitle}</div>
            <h1>{t.appTitle}</h1>
            <p className="muted">
              {t.appDesc}
            </p>
          </div>
          <div>
            <button onClick={() => setLang(lang === "en" ? "th" : "en")} className="ghost">
              {lang === "en" ? "🇹🇭 TH" : "🇬🇧 EN"}
            </button>
          </div>
        </div>
        <div className="stats">
          <Stat label="API" value={healthOnline ? t.online : t.offline} />
          <Stat label="Queries" value={String(queries.length)} />
          <Stat label="Ingest" value={ingestStatus.running ? t.running : t.idle} />
          <Stat label="API Base" value={apiBaseUrl} mono />
        </div>
      </header>

      <section className="card">
        <div className="splitHeader">
          <h2>{t.section0}</h2>
          <div className="row">
            <button onClick={() => void loadSessions()} className="ghost">
              {t.reloadSessions}
            </button>
          </div>
        </div>
        {sessionMessage ? <div className="errorBox">{sessionMessage}</div> : null}
        <div className="row">
          <select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            disabled={sessions.length === 0}
          >
            {sessions.length === 0 ? (
              <option value="">{t.noSessions}</option>
            ) : (
              sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.parquet_files} parquet)
                </option>
              ))
            )}
          </select>
          <input
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value)}
            placeholder={t.newSessionName}
          />
          <button onClick={createSession}>{t.createSession}</button>
        </div>
        <div className="muted">
          {sessions.find((s) => s.id === sessionId)
            ? t.currentSessionHas(sessions.find((s) => s.id === sessionId)!.parquet_files)
            : t.selectSessionToView}
        </div>
      </section>

      <section className="layout">
        <article className="card">
          <h2>{t.section1}</h2>
          <div className="row">
            <button onClick={onSelectFiles}>{t.selectFiles}</button>
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
                  <th>{t.colName}</th>
                  <th>{t.colStatus}</th>
                  <th>{t.colModified}</th>
                  <th>{t.colSize}</th>
                </tr>
              </thead>
              <tbody>
                {pickedRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="emptyCell">
                      {t.noFilesLoaded}
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
                            {formatFileStateLabel(fileStatus, t)}
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
          <h2>{t.section2}</h2>
          <div className="row">
            <button onClick={startIngestion}>{t.startIngestion}</button>
            <button onClick={() => void loadIngestStatus()} className="ghost">
              {t.refreshStatus}
            </button>
          </div>
          <div className="muted">{describeIngest(ingestStatus, t)}</div>
          {ingestMessage ? <div className="notice">{ingestMessage}</div> : null}
          <div className="stats compact">
            <Stat
              label={t.statCompleted}
              value={`${ingestStatus.processed_files}/${ingestStatus.total_files}`}
            />
            <Stat label={t.statActive} value={String(ingestStatus.active_files)} />
            <Stat label={t.statRows} value={formatNumber(ingestStatus.total_rows)} />
            <Stat
              label={t.statCurrent}
              value={ingestStatus.current_files.length > 0 ? ingestStatus.current_files.join(", ") : "-"}
              mono
            />
            <Stat label={t.statDuration} value={formatDuration(ingestStatus.duration_ms)} />
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
          <h2>{t.forensicQueries}</h2>
          <div className="row">
            <button onClick={() => void loadQueries()} className="ghost">
              {t.reloadQueries}
            </button>
          </div>
        </div>

        <div className="queries">
          <aside className="queryList">
            <input
              type="text"
              placeholder={t.filterQueries}
              value={querySearch}
              onChange={(e) => setQuerySearch(e.target.value)}
              style={{ marginBottom: "8px", width: "100%" }}
            />
            {filteredQueries.length === 0 ? (
              <div className="emptyCell">{t.noQueries}</div>
            ) : (
              filteredQueries.map((query) => (
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
              <div className="emptyCell">{t.selectQuery}</div>
            ) : (
              <div className="formGrid">
                {selectedQuery.params.length === 0 && (
                  <div className="muted" style={{ gridColumn: "1 / -1" }}>
                    {t.noParamsRequired}
                  </div>
                )}
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
                        onKeyDown={handleQueryKeyDown}
                        disabled={isQueryRunning}
                      >
                        <option value="">{t.useDefault}</option>
                        <option value="true">{t.true}</option>
                        <option value="false">{t.false}</option>
                      </select>
                    ) : (
                      <input
                        value={queryParams[param.name] ?? ""}
                        placeholder={param.description}
                        onChange={(e) =>
                          setQueryParams((prev) => ({ ...prev, [param.name]: e.target.value }))
                        }
                        onKeyDown={handleQueryKeyDown}
                        disabled={isQueryRunning}
                      />
                    )}
                  </label>
                ))}
                <div style={{ gridColumn: "1 / -1", marginTop: "10px" }}>
                  <button onClick={runQuery} disabled={isQueryRunning}>
                    {isQueryRunning ? (
                      <div className="row">
                        <span className="spinner"></span> {t.running}
                      </div>
                    ) : (
                      t.runQuery
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="resultMeta">
          <div>{queryMessage}</div>
          <div className="row">
            <div>
              {t.rows} <strong>{formatNumber(queryResult?.row_count ?? 0)}</strong>
            </div>
            <div>
              {t.duration} <strong>{formatNumber(queryResult?.duration_ms ?? 0)} ms</strong>
            </div>
          </div>
        </div>

        <ResultsGrid queryResult={queryResult} t={t} />
      </section>

      <section className="card">
        <div className="splitHeader">
          <h2>{t.section4}</h2>
          <div className="row">
            <button onClick={() => void loadOverview(true)} className="ghost" disabled={overviewLoading}>
              {overviewLoading ? (
                <div className="row">
                  <span className="spinner"></span> {t.loadingOverview}
                </div>
              ) : (
                t.refreshOverview
              )}
            </button>
          </div>
        </div>
        {overviewMessage ? <div className="errorBox">{overviewMessage}</div> : null}
        {overviewLoading && !overview ? (
          <div className="muted row">
            <span className="spinner"></span> {t.loadingOverview}
          </div>
        ) : !overview ? (
          <div className="muted">{t.ingestToUnlock}</div>
        ) : (
          <>
            <div className="stats dashboard">
              <Stat label={t.statRequests} value={formatNumber(overview.totals.requests)} />
              <Stat label={t.statUniqueIPs} value={formatNumber(overview.totals.unique_ips)} />
              <Stat label={t.statUniqueURIs} value={formatNumber(overview.totals.unique_uris)} />
              <Stat
                label={t.statErrors}
                value={`${formatNumber(overview.totals.error_4xx)} 4xx / ${formatNumber(overview.totals.error_5xx)} 5xx`}
              />
              <Stat label={t.statAvgLatency} value={`${formatNumber(overview.totals.avg_time_taken_ms)} ms`} />
              <Stat label={t.statFirstSeen} value={formatDate(overview.totals.first_seen)} mono />
              <Stat label={t.statLastSeen} value={formatDate(overview.totals.last_seen)} mono />
              <Stat label={t.statCharts} value={t.lightweight} />
            </div>

            <div className="dashboardGrid">
              <div className="card chartCard">
                <div className="splitHeader">
                  <h3>{t.last48Hours}</h3>
                  <div className="muted">{t.reqAndErrPerHour}</div>
                </div>
                <MiniLineChart
                  series={[
                    { name: t.statRequests, values: overview.timeline.map((p) => p.requests) },
                    { name: t.statErrors, values: overview.timeline.map((p) => p.errors) }
                  ]}
                  labels={overview.timeline.map((p) => p.bucket_time)}
                />
              </div>

              <div className="card chartCard">
                <div className="splitHeader">
                  <h3>{t.topStatus}</h3>
                  <div className="muted">{t.mostFrequentHTTP}</div>
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
                  <h3>{t.topMethods}</h3>
                  <div className="muted">{t.getPostMix}</div>
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
                <h3>{t.topClientIPs}</h3>
                <SmallTable
                  columns={["c_ip", "requests", "distinct_uris", "error_requests"]}
                  rows={overview.top_client_ips}
                  t={t}
                />
              </article>
              <article className="card">
                <h3>{t.topURIs}</h3>
                <SmallTable
                  columns={["uri_stem", "requests", "distinct_ips", "avg_time_taken_ms"]}
                  rows={overview.top_uris}
                  t={t}
                />
              </article>
              <article className="card">
                <h3>{t.suspiciousIPs}</h3>
                <div className="muted">{t.highDistinctURI}</div>
                <SmallTable
                  columns={["c_ip", "distinct_uris", "error_requests", "first_seen", "last_seen"]}
                  rows={overview.suspicious_ips}
                  t={t}
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
  rows,
  t
}: {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  t: typeof translations["en"];
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
                {t.noRows}
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

const ResultsGrid = memo(
  function ResultsGrid({
    queryResult,
    t
  }: {
    queryResult: QueryResponse<GenericRow> | null;
    t: typeof translations["en"];
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
          cell: (ctx) => {
            const text = formatValue(ctx.getValue());
            return (
              <span className="cellText" title={text}>
                {text}
              </span>
            );
          }
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
              placeholder={t.filterVisible}
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
          {rows.length === 0 && <div className="emptyOverlay">{t.noQueryRows}</div>}
        </div>
      </>
    );
  },
  (prevProps, nextProps) => {
    // Only re-render if queryResult changes, ignore t changes to prevent language switch freeze
    return prevProps.queryResult === nextProps.queryResult;
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