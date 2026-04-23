import { FastifyInstance } from 'fastify';
import { ApiResponse, ForensicOverview } from '../shared/types';
import { ensureDefaultSession, loadSessionMeta } from '../sessions/store';
import { registerUnifiedViewForSession } from '../ingestion/converter';
import { sessionQuery } from '../db/sessionDb';

type NumericRow = Record<string, number | string | null>;

const OVERVIEW_CACHE_MS = Math.max(1_000, Number(process.env.DASHBOARD_CACHE_MS ?? 15_000));
const cachedOverviewBySession = new Map<string, { at: number; data: ForensicOverview }>();

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard/overview', async (req, reply) => {
    try {
      const sessionId = ensureDefaultSession().id;
      const force = (req.query as Record<string, unknown> | undefined)?.force === 'true';
      const now = Date.now();
      const cached = cachedOverviewBySession.get(sessionId) ?? null;
      if (!force && cached && now - cached.at < OVERVIEW_CACHE_MS) {
        return reply.send({
          ok: true,
          data: cached.data,
        } satisfies ApiResponse<ForensicOverview>);
      }
      await registerUnifiedViewForSession(sessionId);

      const totalsRows = await sessionQuery<NumericRow>(sessionId, `
        SELECT
          COUNT(*) AS requests,
          COUNT(DISTINCT c_ip) AS unique_ips,
          COUNT(DISTINCT uri_stem) AS unique_uris,
          SUM(CASE WHEN status BETWEEN 400 AND 499 THEN 1 ELSE 0 END) AS error_4xx,
          SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS error_5xx,
          ROUND(AVG(time_taken_ms), 2) AS avg_time_taken_ms,
          CAST(MIN(datetime) AS VARCHAR) AS first_seen,
          CAST(MAX(datetime) AS VARCHAR) AS last_seen
        FROM logs
      `);

      const statusBreakdown = await sessionQuery<NumericRow>(sessionId, `
        SELECT
          status,
          COUNT(*) AS requests
        FROM logs
        WHERE status IS NOT NULL
        GROUP BY status
        ORDER BY requests DESC
        LIMIT 8
      `);

      const methodBreakdown = await sessionQuery<NumericRow>(sessionId, `
        SELECT
          method,
          COUNT(*) AS requests
        FROM logs
        WHERE method IS NOT NULL AND method <> ''
        GROUP BY method
        ORDER BY requests DESC
        LIMIT 6
      `);

      const timeline = await sessionQuery<NumericRow>(sessionId, `
        WITH hourly AS (
          SELECT
            DATE_TRUNC('hour', datetime) AS bucket_time,
            COUNT(*) AS requests,
            COUNT(DISTINCT c_ip) AS unique_ips,
            SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors
          FROM logs
          WHERE datetime IS NOT NULL
          GROUP BY 1
          ORDER BY bucket_time DESC
          LIMIT 48
        )
        SELECT
          CAST(bucket_time AS VARCHAR) AS bucket_time,
          requests,
          unique_ips,
          errors
        FROM hourly
        ORDER BY bucket_time ASC
      `);

      const topClientIps = await sessionQuery<NumericRow>(sessionId, `
        SELECT
          c_ip,
          COUNT(*) AS requests,
          COUNT(DISTINCT uri_stem) AS distinct_uris,
          SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS error_requests
        FROM logs
        WHERE c_ip IS NOT NULL AND c_ip <> ''
        GROUP BY c_ip
        ORDER BY requests DESC
        LIMIT 10
      `);

      const topUris = await sessionQuery<NumericRow>(sessionId, `
        SELECT
          uri_stem,
          COUNT(*) AS requests,
          COUNT(DISTINCT c_ip) AS distinct_ips,
          ROUND(AVG(time_taken_ms), 2) AS avg_time_taken_ms
        FROM logs
        WHERE uri_stem IS NOT NULL AND uri_stem <> ''
        GROUP BY uri_stem
        ORDER BY requests DESC
        LIMIT 10
      `);

      const suspiciousIps = await sessionQuery<NumericRow>(sessionId, `
        SELECT
          c_ip,
          COUNT(*) AS requests,
          COUNT(DISTINCT uri_stem) AS distinct_uris,
          SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS error_requests,
          CAST(MIN(datetime) AS VARCHAR) AS first_seen,
          CAST(MAX(datetime) AS VARCHAR) AS last_seen
        FROM logs
        WHERE c_ip IS NOT NULL AND c_ip <> ''
        GROUP BY c_ip
        HAVING COUNT(DISTINCT uri_stem) >= 20
        ORDER BY distinct_uris DESC, error_requests DESC
        LIMIT 10
      `);

      const totals = totalsRows[0] ?? {};
      const data: ForensicOverview = {
        totals: {
          requests: Number(totals.requests ?? 0),
          unique_ips: Number(totals.unique_ips ?? 0),
          unique_uris: Number(totals.unique_uris ?? 0),
          error_4xx: Number(totals.error_4xx ?? 0),
          error_5xx: Number(totals.error_5xx ?? 0),
          avg_time_taken_ms: Number(totals.avg_time_taken_ms ?? 0),
          first_seen: (totals.first_seen as string | null) ?? null,
          last_seen: (totals.last_seen as string | null) ?? null,
        },
        status_breakdown: statusBreakdown.map((row) => ({
          status: Number(row.status ?? 0),
          requests: Number(row.requests ?? 0),
        })),
        method_breakdown: methodBreakdown.map((row) => ({
          method: String(row.method ?? '-'),
          requests: Number(row.requests ?? 0),
        })),
        timeline: timeline.map((row) => ({
          bucket_time: String(row.bucket_time ?? ''),
          requests: Number(row.requests ?? 0),
          unique_ips: Number(row.unique_ips ?? 0),
          errors: Number(row.errors ?? 0),
        })),
        top_client_ips: topClientIps.map((row) => ({
          c_ip: String(row.c_ip ?? '-'),
          requests: Number(row.requests ?? 0),
          distinct_uris: Number(row.distinct_uris ?? 0),
          error_requests: Number(row.error_requests ?? 0),
        })),
        top_uris: topUris.map((row) => ({
          uri_stem: String(row.uri_stem ?? '-'),
          requests: Number(row.requests ?? 0),
          distinct_ips: Number(row.distinct_ips ?? 0),
          avg_time_taken_ms: Number(row.avg_time_taken_ms ?? 0),
        })),
        suspicious_ips: suspiciousIps.map((row) => ({
          c_ip: String(row.c_ip ?? '-'),
          requests: Number(row.requests ?? 0),
          distinct_uris: Number(row.distinct_uris ?? 0),
          error_requests: Number(row.error_requests ?? 0),
          first_seen: (row.first_seen as string | null) ?? null,
          last_seen: (row.last_seen as string | null) ?? null,
        })),
      };

      cachedOverviewBySession.set(sessionId, { at: now, data });
      return reply.send({
        ok: true,
        data,
      } satisfies ApiResponse<ForensicOverview>);
    } catch (err) {
      return reply.code(500).send({
        ok: false,
        error: `Dashboard query failed: ${String(err)}`,
      } satisfies ApiResponse<never>);
    }
  });

  app.get<{ Params: { id: string } }>('/sessions/:id/dashboard/overview', async (req, reply) => {
    const sessionId = req.params.id;
    const meta = loadSessionMeta(sessionId);
    if (!meta) {
      return reply.code(404).send({
        ok: false,
        error: `Unknown session: '${sessionId}'`,
      } satisfies ApiResponse<never>);
    }

    const force = (req.query as Record<string, unknown> | undefined)?.force === 'true';
    const now = Date.now();
    const cached = cachedOverviewBySession.get(sessionId) ?? null;
    if (!force && cached && now - cached.at < OVERVIEW_CACHE_MS) {
      return reply.send({
        ok: true,
        data: cached.data,
      } satisfies ApiResponse<ForensicOverview>);
    }

    try {
      await registerUnifiedViewForSession(sessionId);

      const totalsRows = await sessionQuery<NumericRow>(sessionId, `
        SELECT
          COUNT(*) AS requests,
          COUNT(DISTINCT c_ip) AS unique_ips,
          COUNT(DISTINCT uri_stem) AS unique_uris,
          SUM(CASE WHEN status BETWEEN 400 AND 499 THEN 1 ELSE 0 END) AS error_4xx,
          SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS error_5xx,
          ROUND(AVG(time_taken_ms), 2) AS avg_time_taken_ms,
          CAST(MIN(datetime) AS VARCHAR) AS first_seen,
          CAST(MAX(datetime) AS VARCHAR) AS last_seen
        FROM logs
      `);

      const statusBreakdown = await sessionQuery<NumericRow>(sessionId, `
        SELECT
          status,
          COUNT(*) AS requests
        FROM logs
        WHERE status IS NOT NULL
        GROUP BY status
        ORDER BY requests DESC
        LIMIT 8
      `);

      const methodBreakdown = await sessionQuery<NumericRow>(sessionId, `
        SELECT
          method,
          COUNT(*) AS requests
        FROM logs
        WHERE method IS NOT NULL AND method <> ''
        GROUP BY method
        ORDER BY requests DESC
        LIMIT 6
      `);

      const timeline = await sessionQuery<NumericRow>(sessionId, `
        WITH hourly AS (
          SELECT
            DATE_TRUNC('hour', datetime) AS bucket_time,
            COUNT(*) AS requests,
            COUNT(DISTINCT c_ip) AS unique_ips,
            SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors
          FROM logs
          WHERE datetime IS NOT NULL
          GROUP BY 1
          ORDER BY bucket_time DESC
          LIMIT 48
        )
        SELECT
          CAST(bucket_time AS VARCHAR) AS bucket_time,
          requests,
          unique_ips,
          errors
        FROM hourly
        ORDER BY bucket_time ASC
      `);

      const topClientIps = await sessionQuery<NumericRow>(sessionId, `
        SELECT
          c_ip,
          COUNT(*) AS requests,
          COUNT(DISTINCT uri_stem) AS distinct_uris,
          SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS error_requests
        FROM logs
        WHERE c_ip IS NOT NULL AND c_ip <> ''
        GROUP BY c_ip
        ORDER BY requests DESC
        LIMIT 10
      `);

      const topUris = await sessionQuery<NumericRow>(sessionId, `
        SELECT
          uri_stem,
          COUNT(*) AS requests,
          COUNT(DISTINCT c_ip) AS distinct_ips,
          ROUND(AVG(time_taken_ms), 2) AS avg_time_taken_ms
        FROM logs
        WHERE uri_stem IS NOT NULL AND uri_stem <> ''
        GROUP BY uri_stem
        ORDER BY requests DESC
        LIMIT 10
      `);

      const suspiciousIps = await sessionQuery<NumericRow>(sessionId, `
        SELECT
          c_ip,
          COUNT(*) AS requests,
          COUNT(DISTINCT uri_stem) AS distinct_uris,
          SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS error_requests,
          CAST(MIN(datetime) AS VARCHAR) AS first_seen,
          CAST(MAX(datetime) AS VARCHAR) AS last_seen
        FROM logs
        WHERE c_ip IS NOT NULL AND c_ip <> ''
        GROUP BY c_ip
        HAVING COUNT(DISTINCT uri_stem) >= 20
        ORDER BY distinct_uris DESC, error_requests DESC
        LIMIT 10
      `);

      const totals = totalsRows[0] ?? {};
      const data: ForensicOverview = {
        totals: {
          requests: Number(totals.requests ?? 0),
          unique_ips: Number(totals.unique_ips ?? 0),
          unique_uris: Number(totals.unique_uris ?? 0),
          error_4xx: Number(totals.error_4xx ?? 0),
          error_5xx: Number(totals.error_5xx ?? 0),
          avg_time_taken_ms: Number(totals.avg_time_taken_ms ?? 0),
          first_seen: (totals.first_seen as string | null) ?? null,
          last_seen: (totals.last_seen as string | null) ?? null,
        },
        status_breakdown: statusBreakdown.map((row) => ({
          status: Number(row.status ?? 0),
          requests: Number(row.requests ?? 0),
        })),
        method_breakdown: methodBreakdown.map((row) => ({
          method: String(row.method ?? '-'),
          requests: Number(row.requests ?? 0),
        })),
        timeline: timeline.map((row) => ({
          bucket_time: String(row.bucket_time ?? ''),
          requests: Number(row.requests ?? 0),
          unique_ips: Number(row.unique_ips ?? 0),
          errors: Number(row.errors ?? 0),
        })),
        top_client_ips: topClientIps.map((row) => ({
          c_ip: String(row.c_ip ?? '-'),
          requests: Number(row.requests ?? 0),
          distinct_uris: Number(row.distinct_uris ?? 0),
          error_requests: Number(row.error_requests ?? 0),
        })),
        top_uris: topUris.map((row) => ({
          uri_stem: String(row.uri_stem ?? '-'),
          requests: Number(row.requests ?? 0),
          distinct_ips: Number(row.distinct_ips ?? 0),
          avg_time_taken_ms: Number(row.avg_time_taken_ms ?? 0),
        })),
        suspicious_ips: suspiciousIps.map((row) => ({
          c_ip: String(row.c_ip ?? '-'),
          requests: Number(row.requests ?? 0),
          distinct_uris: Number(row.distinct_uris ?? 0),
          error_requests: Number(row.error_requests ?? 0),
          first_seen: (row.first_seen as string | null) ?? null,
          last_seen: (row.last_seen as string | null) ?? null,
        })),
      };

      cachedOverviewBySession.set(sessionId, { at: now, data });
      return reply.send({
        ok: true,
        data,
      } satisfies ApiResponse<ForensicOverview>);
    } catch (err) {
      return reply.code(500).send({
        ok: false,
        error: `Dashboard query failed: ${String(err)}`,
      } satisfies ApiResponse<never>);
    }
  });
}
