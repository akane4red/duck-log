import { QueryHandler } from './index';

export const scannerQuery: QueryHandler = {
  descriptor: {
    name: 'scanner_probe',
    description: 'Fingerprint IPs probing many distinct URIs — vulnerability scanners, crawlers, recon tools.',
    params: [
      { name: 'uri_threshold', type: 'number', required: false, default: 20, description: 'Minimum distinct URIs to flag as scanner' },
      { name: 'time_window_minutes', type: 'number', required: false, default: 60, description: 'Rolling time window in minutes' },
      { name: 'include_404_only', type: 'boolean', required: false, default: false, description: 'Only count 404 responses (pure probing pattern)' },
      { name: 'date_from', type: 'string', required: false, default: null, description: 'ISO date filter from (YYYY-MM-DD)' },
      { name: 'date_to', type: 'string', required: false, default: null, description: 'ISO date filter to (YYYY-MM-DD)' },
      { name: 'limit', type: 'number', required: false, default: 100, description: 'Max rows returned' },
    ],
  },

  async run(params, ctx) {
    const uriThreshold  = Number(params.uri_threshold ?? 20);
    const windowMins    = Number(params.time_window_minutes ?? 60);
    const only404       = Boolean(params.include_404_only ?? false);
    const dateFrom      = params.date_from as string | null ?? null;
    const dateTo        = params.date_to as string | null ?? null;
    const limit         = Math.min(Number(params.limit ?? 100), 10_000);

    const statusClause   = only404 ? 'AND status = 404' : '';
    const dateFromClause = dateFrom ? `AND date >= '${dateFrom}'` : '';
    const dateToClause   = dateTo   ? `AND date <= '${dateTo}'`   : '';

    // Known scanner User-Agent patterns
    const scannerUaPattern = `(
      user_agent ILIKE '%nmap%' OR
      user_agent ILIKE '%nikto%' OR
      user_agent ILIKE '%sqlmap%' OR
      user_agent ILIKE '%masscan%' OR
      user_agent ILIKE '%zgrab%' OR
      user_agent ILIKE '%nuclei%' OR
      user_agent ILIKE '%gobuster%' OR
      user_agent ILIKE '%dirbuster%' OR
      user_agent ILIKE '%wfuzz%' OR
      user_agent ILIKE '%burpsuite%' OR
      user_agent ILIKE '%python-requests%' OR
      user_agent ILIKE '%go-http-client%' OR
      user_agent ILIKE '%curl/%'
    )`;

    const sql = `
      WITH probe_activity AS (
        SELECT
          c_ip,
          uri_stem,
          datetime,
          status,
          method,
          user_agent,
          source_file,
          COUNT(DISTINCT uri_stem) OVER (
            PARTITION BY c_ip
            ORDER BY datetime
            RANGE BETWEEN INTERVAL '${windowMins} minutes' PRECEDING AND CURRENT ROW
          ) AS distinct_uris_in_window
        FROM logs
        WHERE 1=1
          ${statusClause}
          ${dateFromClause}
          ${dateToClause}
      ),
      flagged AS (
        SELECT
          c_ip,
          COUNT(*)                              AS total_requests,
          COUNT(DISTINCT uri_stem)              AS distinct_uris,
          COUNT(DISTINCT method)                AS distinct_methods,
          COUNT(DISTINCT status)                AS distinct_statuses,
          COUNT(DISTINCT user_agent)            AS distinct_user_agents,
          MAX(distinct_uris_in_window)          AS peak_uris_in_window,
          MIN(datetime)                         AS first_seen,
          MAX(datetime)                         AS last_seen,
          -- known scanner UA flag
          BOOL_OR(${scannerUaPattern})          AS known_scanner_ua,
          LIST(DISTINCT uri_stem)[1:10]         AS sample_uris,
          LIST(DISTINCT user_agent)[1:3]        AS user_agents,
          MODE(status)                          AS most_common_status,
          LIST(DISTINCT source_file)[1:3]       AS source_files
        FROM probe_activity
        GROUP BY c_ip
        HAVING MAX(distinct_uris_in_window) >= ${uriThreshold}
      )
      SELECT *
      FROM flagged
      ORDER BY distinct_uris DESC
      LIMIT ${limit}
    `;

    return ctx.query(sql);
  },
};
