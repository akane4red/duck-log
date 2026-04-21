import { query } from '../db/connection';
import { QueryHandler } from './index';

export const slowRequestsQuery: QueryHandler = {
  descriptor: {
    name: 'slow_requests',
    description: 'Detect slow request outliers — potential DoS, data exfiltration, or backend stress signals.',
    params: [
      { name: 'threshold_ms', type: 'number', required: false, default: null, description: 'Absolute threshold in ms. If null, uses percentile instead.' },
      { name: 'percentile', type: 'number', required: false, default: 95, description: 'Flag requests above this percentile (1-99). Used when threshold_ms is null.' },
      { name: 'uri_filter', type: 'string', required: false, default: null, description: 'Optional URI stem filter' },
      { name: 'method_filter', type: 'string', required: false, default: null, description: 'Optional HTTP method filter e.g. GET' },
      { name: 'date_from', type: 'string', required: false, default: null, description: 'ISO date filter from (YYYY-MM-DD)' },
      { name: 'date_to', type: 'string', required: false, default: null, description: 'ISO date filter to (YYYY-MM-DD)' },
      { name: 'limit', type: 'number', required: false, default: 500, description: 'Max rows returned' },
    ],
  },

  async run(params) {
    const thresholdMs  = params.threshold_ms != null ? Number(params.threshold_ms) : null;
    const percentile   = Math.min(99, Math.max(1, Number(params.percentile ?? 95)));
    const uriFilter    = params.uri_filter as string | null ?? null;
    const methodFilter = params.method_filter as string | null ?? null;
    const dateFrom     = params.date_from as string | null ?? null;
    const dateTo       = params.date_to as string | null ?? null;
    const limit        = Math.min(Number(params.limit ?? 500), 10_000);

    const uriClause    = uriFilter    ? `AND uri_stem ILIKE '%${uriFilter}%'`    : '';
    const methodClause = methodFilter ? `AND method = '${methodFilter.toUpperCase()}'` : '';
    const dateFromClause = dateFrom   ? `AND date >= '${dateFrom}'` : '';
    const dateToClause   = dateTo     ? `AND date <= '${dateTo}'`   : '';

    // If no absolute threshold, compute percentile cutoff first
    let cutoffSql: string;
    if (thresholdMs !== null) {
      cutoffSql = `${thresholdMs}`;
    } else {
      cutoffSql = `(
        SELECT PERCENTILE_CONT(${percentile / 100}) WITHIN GROUP (ORDER BY time_taken_ms)
        FROM logs
        WHERE time_taken_ms > 0
          ${uriClause} ${methodClause} ${dateFromClause} ${dateToClause}
      )`;
    }

    const sql = `
      WITH cutoff AS (
        SELECT ${cutoffSql} AS threshold_ms
      ),
      outliers AS (
        SELECT
          l.datetime,
          l.c_ip,
          l.method,
          l.uri_stem,
          l.uri_query,
          l.status,
          l.time_taken_ms,
          l.user_agent,
          l.source_file,
          c.threshold_ms,
          ROUND(l.time_taken_ms::DOUBLE / NULLIF(c.threshold_ms, 0), 2) AS times_over_threshold
        FROM logs l
        CROSS JOIN cutoff c
        WHERE l.time_taken_ms >= c.threshold_ms
          AND l.time_taken_ms > 0
          ${uriClause}
          ${methodClause}
          ${dateFromClause}
          ${dateToClause}
      )
      SELECT *
      FROM outliers
      ORDER BY time_taken_ms DESC
      LIMIT ${limit}
    `;

    return query(sql);
  },
};
