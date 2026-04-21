import { query } from '../db/connection';
import { QueryHandler } from './index';

export const topNQuery: QueryHandler = {
  descriptor: {
    name: 'top_n',
    description: 'Top-N pivot tables — group by any dimension and correlate with status codes, URIs, IPs.',
    params: [
      { name: 'group_by', type: 'string', required: true, description: 'Dimension to group by: c_ip | uri_stem | user_agent | method | status | s_ip | referer' },
      { name: 'limit', type: 'number', required: false, default: 50, description: 'Number of top results to return' },
      { name: 'date_from', type: 'string', required: false, default: null, description: 'ISO date filter from (YYYY-MM-DD)' },
      { name: 'date_to', type: 'string', required: false, default: null, description: 'ISO date filter to (YYYY-MM-DD)' },
      { name: 'status_filter', type: 'number[]', required: false, default: null, description: 'Filter to specific HTTP status codes' },
      { name: 'method_filter', type: 'string', required: false, default: null, description: 'Filter to specific HTTP method' },
      { name: 'uri_filter', type: 'string', required: false, default: null, description: 'Filter to URI containing this string' },
      { name: 'c_ip_filter', type: 'string', required: false, default: null, description: 'Filter to specific client IP' },
    ],
  },

  async run(params) {
    const ALLOWED_DIMENSIONS = new Set([
      'c_ip', 'uri_stem', 'user_agent', 'method', 'status', 's_ip', 'referer'
    ]);

    const groupBy      = params.group_by as string;
    const limit        = Math.min(Number(params.limit ?? 50), 10_000);
    const dateFrom     = params.date_from as string | null ?? null;
    const dateTo       = params.date_to as string | null ?? null;
    const statusFilter = params.status_filter as number[] | null ?? null;
    const methodFilter = params.method_filter as string | null ?? null;
    const uriFilter    = params.uri_filter as string | null ?? null;
    const ipFilter     = params.c_ip_filter as string | null ?? null;

    if (!ALLOWED_DIMENSIONS.has(groupBy)) {
      throw new Error(`group_by must be one of: ${[...ALLOWED_DIMENSIONS].join(', ')}`);
    }

    const dateFromClause = dateFrom     ? `AND date >= '${dateFrom}'`                       : '';
    const dateToClause   = dateTo       ? `AND date <= '${dateTo}'`                         : '';
    const statusClause   = statusFilter ? `AND status IN (${statusFilter.join(',')})`       : '';
    const methodClause   = methodFilter ? `AND method = '${methodFilter.toUpperCase()}'`    : '';
    const uriClause      = uriFilter    ? `AND uri_stem ILIKE '%${uriFilter}%'`             : '';
    const ipClause       = ipFilter     ? `AND c_ip = '${ipFilter}'`                        : '';

    const sql = `
      SELECT
        ${groupBy}                              AS dimension_value,
        COUNT(*)                                AS total_requests,
        COUNT(DISTINCT c_ip)                    AS unique_ips,
        COUNT(DISTINCT uri_stem)                AS unique_uris,
        COUNT(DISTINCT user_agent)              AS unique_user_agents,
        SUM(CASE WHEN status BETWEEN 200 AND 299 THEN 1 ELSE 0 END) AS status_2xx,
        SUM(CASE WHEN status BETWEEN 300 AND 399 THEN 1 ELSE 0 END) AS status_3xx,
        SUM(CASE WHEN status BETWEEN 400 AND 499 THEN 1 ELSE 0 END) AS status_4xx,
        SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END)              AS status_5xx,
        ROUND(AVG(time_taken_ms), 2)            AS avg_time_taken_ms,
        MAX(time_taken_ms)                      AS max_time_taken_ms,
        MIN(datetime)                           AS first_seen,
        MAX(datetime)                           AS last_seen,
        LIST(DISTINCT source_file)[1:3]         AS source_files
      FROM logs
      WHERE ${groupBy} IS NOT NULL
        ${dateFromClause}
        ${dateToClause}
        ${statusClause}
        ${methodClause}
        ${uriClause}
        ${ipClause}
      GROUP BY ${groupBy}
      ORDER BY total_requests DESC
      LIMIT ${limit}
    `;

    return query(sql);
  },
};
