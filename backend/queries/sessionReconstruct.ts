import { QueryHandler } from './index';

export const sessionReconstructQuery: QueryHandler = {
  descriptor: {
    name: 'session_reconstruct',
    description: 'Reconstruct the full request journey for a specific IP (and optional UA). Orders all requests chronologically.',
    params: [
      { name: 'c_ip', type: 'string', required: true, description: 'Client IP to reconstruct' },
      { name: 'user_agent', type: 'string', required: false, default: null, description: 'Optional user agent filter to isolate a specific client' },
      { name: 'date_from', type: 'string', required: false, default: null, description: 'ISO date filter from (YYYY-MM-DD)' },
      { name: 'date_to', type: 'string', required: false, default: null, description: 'ISO date filter to (YYYY-MM-DD)' },
      { name: 'session_gap_minutes', type: 'number', required: false, default: 30, description: 'Minutes of inactivity that define a new session' },
      { name: 'limit', type: 'number', required: false, default: 2000, description: 'Max rows returned' },
    ],
  },

  async run(params, ctx) {
    const ip          = params.c_ip as string;
    const ua          = params.user_agent as string | null ?? null;
    const dateFrom    = params.date_from as string | null ?? null;
    const dateTo      = params.date_to as string | null ?? null;
    const gapMinutes  = Number(params.session_gap_minutes ?? 30);
    const limit       = Math.min(Number(params.limit ?? 2000), 50_000);

    if (!ip) throw new Error('c_ip is required');

    const uaClause       = ua      ? `AND user_agent ILIKE '%${ua}%'` : '';
    const dateFromClause = dateFrom ? `AND date >= '${dateFrom}'` : '';
    const dateToClause   = dateTo   ? `AND date <= '${dateTo}'`   : '';

    const sql = `
      WITH ip_requests AS (
        SELECT
          datetime,
          method,
          uri_stem,
          uri_query,
          status,
          time_taken_ms,
          user_agent,
          referer,
          s_ip,
          source_file,
          -- Time delta from previous request (same IP)
          LAG(datetime) OVER (ORDER BY datetime) AS prev_datetime
        FROM logs
        WHERE c_ip = '${ip}'
          ${uaClause}
          ${dateFromClause}
          ${dateToClause}
        ORDER BY datetime ASC
        LIMIT ${limit}
      ),
      with_sessions AS (
        SELECT *,
          -- New session when gap > session_gap_minutes
          CASE
            WHEN prev_datetime IS NULL THEN 1
            WHEN datetime - prev_datetime > INTERVAL '${gapMinutes} minutes' THEN 1
            ELSE 0
          END AS is_new_session
        FROM ip_requests
      ),
      with_session_id AS (
        SELECT *,
          SUM(is_new_session) OVER (ORDER BY datetime ROWS UNBOUNDED PRECEDING) AS session_id
        FROM with_sessions
      )
      SELECT
        session_id,
        datetime,
        method,
        uri_stem,
        uri_query,
        status,
        time_taken_ms,
        user_agent,
        referer,
        s_ip,
        source_file,
        -- Time since previous request in this session
        CASE
          WHEN is_new_session = 1 THEN NULL
          ELSE DATEDIFF('second', prev_datetime, datetime)
        END AS seconds_since_prev
      FROM with_session_id
      ORDER BY session_id, datetime ASC
    `;

    return ctx.query(sql);
  },
};
