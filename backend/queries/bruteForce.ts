import { QueryHandler } from './index';

export const bruteForceQuery: QueryHandler = {
  descriptor: {
    name: 'brute_force',
    description: 'Detect IPs making repeated failed auth attempts — brute force and credential stuffing patterns.',
    params: [
      { name: 'attempt_threshold', type: 'number', required: false, default: 10, description: 'Minimum failed attempts to flag an IP' },
      { name: 'time_window_minutes', type: 'number', required: false, default: 60, description: 'Rolling time window in minutes' },
      { name: 'status_codes', type: 'number[]', required: false, default: [401, 403], description: 'HTTP status codes considered as failures' },
      { name: 'uri_filter', type: 'string', required: false, default: null, description: 'Optional URI stem filter e.g. /login' },
      { name: 'date_from', type: 'string', required: false, default: null, description: 'ISO date filter from (YYYY-MM-DD)' },
      { name: 'date_to', type: 'string', required: false, default: null, description: 'ISO date filter to (YYYY-MM-DD)' },
      { name: 'limit', type: 'number', required: false, default: 100, description: 'Max rows returned' },
    ],
  },

  async run(params, ctx) {
    const threshold    = Number(params.attempt_threshold ?? 10);
    const windowMins   = Number(params.time_window_minutes ?? 60);
    const statusCodes  = (params.status_codes as number[] | undefined) ?? [401, 403];
    const uriFilter    = params.uri_filter as string | null ?? null;
    const dateFrom     = params.date_from as string | null ?? null;
    const dateTo       = params.date_to as string | null ?? null;
    const limit        = Math.min(Number(params.limit ?? 100), 10_000);

    const statusList = statusCodes.join(', ');

    const uriClause   = uriFilter  ? `AND uri_stem ILIKE '%${uriFilter}%'` : '';
    const dateFromClause = dateFrom ? `AND date >= '${dateFrom}'` : '';
    const dateToClause   = dateTo   ? `AND date <= '${dateTo}'`   : '';

    const sql = `
      WITH failed_attempts AS (
        SELECT
          c_ip,
          uri_stem,
          datetime,
          status,
          user_agent,
          source_file,
          COUNT(*) OVER (
            PARTITION BY c_ip
            ORDER BY datetime
            RANGE BETWEEN INTERVAL '${windowMins} minutes' PRECEDING AND CURRENT ROW
          ) AS attempts_in_window
        FROM logs
        WHERE status IN (${statusList})
          ${uriClause}
          ${dateFromClause}
          ${dateToClause}
      ),
      flagged AS (
        SELECT
          c_ip,
          COUNT(*)                            AS total_failed_attempts,
          COUNT(DISTINCT uri_stem)            AS distinct_uris_targeted,
          COUNT(DISTINCT user_agent)          AS distinct_user_agents,
          MIN(datetime)                       AS first_seen,
          MAX(datetime)                       AS last_seen,
          MAX(attempts_in_window)             AS peak_attempts_in_window,
          LIST(DISTINCT uri_stem)[1:5]        AS top_uris,
          MODE(status)                        AS most_common_status,
          LIST(DISTINCT source_file)[1:3]     AS source_files
        FROM failed_attempts
        GROUP BY c_ip
        HAVING MAX(attempts_in_window) >= ${threshold}
      )
      SELECT *,
        epoch_ms(last_seen::TIMESTAMP) - epoch_ms(first_seen::TIMESTAMP) AS attack_duration_ms
      FROM flagged
      ORDER BY total_failed_attempts DESC
      LIMIT ${limit}
    `;

    return ctx.query(sql);
  },
};
