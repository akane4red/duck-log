"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.anomalyTimelineQuery = void 0;
const connection_1 = require("../db/connection");
exports.anomalyTimelineQuery = {
    descriptor: {
        name: 'anomaly_timeline',
        description: 'Traffic volume by time bucket with spike detection and off-hours flagging.',
        params: [
            { name: 'bucket', type: 'string', required: false, default: 'hour', description: 'Time bucket: minute | hour | day' },
            { name: 'spike_multiplier', type: 'number', required: false, default: 3, description: 'Flag buckets exceeding avg * this multiplier' },
            { name: 'business_hours_start', type: 'number', required: false, default: 8, description: 'Business hours start (0-23)' },
            { name: 'business_hours_end', type: 'number', required: false, default: 18, description: 'Business hours end (0-23)' },
            { name: 'date_from', type: 'string', required: false, default: null, description: 'ISO date filter from (YYYY-MM-DD)' },
            { name: 'date_to', type: 'string', required: false, default: null, description: 'ISO date filter to (YYYY-MM-DD)' },
            { name: 'c_ip', type: 'string', required: false, default: null, description: 'Filter to a specific client IP' },
            { name: 'status_filter', type: 'number[]', required: false, default: null, description: 'Filter to specific HTTP status codes' },
        ],
    },
    async run(params) {
        const bucket = ['minute', 'hour', 'day'].includes(params.bucket)
            ? params.bucket
            : 'hour';
        const multiplier = Number(params.spike_multiplier ?? 3);
        const bizStart = Number(params.business_hours_start ?? 8);
        const bizEnd = Number(params.business_hours_end ?? 18);
        const dateFrom = params.date_from ?? null;
        const dateTo = params.date_to ?? null;
        const ipFilter = params.c_ip ?? null;
        const statusFilter = params.status_filter ?? null;
        const dateFromClause = dateFrom ? `AND date >= '${dateFrom}'` : '';
        const dateToClause = dateTo ? `AND date <= '${dateTo}'` : '';
        const ipClause = ipFilter ? `AND c_ip = '${ipFilter}'` : '';
        const statusClause = statusFilter ? `AND status IN (${statusFilter.join(',')})` : '';
        // Time truncation expression per bucket
        const truncExpr = bucket === 'minute'
            ? `DATE_TRUNC('minute', datetime)`
            : bucket === 'hour'
                ? `DATE_TRUNC('hour', datetime)`
                : `DATE_TRUNC('day', datetime)`;
        const hourExpr = bucket === 'minute' || bucket === 'hour'
            ? `HOUR(datetime)`
            : `0`;
        const sql = `
      WITH bucketed AS (
        SELECT
          ${truncExpr}                        AS bucket_time,
          ${hourExpr}                         AS hour_of_day,
          COUNT(*)                            AS request_count,
          COUNT(DISTINCT c_ip)                AS unique_ips,
          COUNT(DISTINCT uri_stem)            AS unique_uris,
          SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END) AS client_errors,
          SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END)                  AS server_errors,
          SUM(CASE WHEN status = 200 THEN 1 ELSE 0 END)                   AS success_200,
          AVG(time_taken_ms)                  AS avg_time_taken_ms,
          MAX(time_taken_ms)                  AS max_time_taken_ms
        FROM logs
        WHERE datetime IS NOT NULL
          ${dateFromClause}
          ${dateToClause}
          ${ipClause}
          ${statusClause}
        GROUP BY 1, 2
      ),
      with_stats AS (
        SELECT *,
          AVG(request_count) OVER ()          AS global_avg,
          STDDEV(request_count) OVER ()       AS global_stddev
        FROM bucketed
      )
      SELECT
        bucket_time,
        hour_of_day,
        request_count,
        unique_ips,
        unique_uris,
        client_errors,
        server_errors,
        success_200,
        ROUND(avg_time_taken_ms, 2)           AS avg_time_taken_ms,
        max_time_taken_ms,
        ROUND(global_avg, 2)                  AS baseline_avg,
        ROUND(request_count / NULLIF(global_avg, 0), 2) AS spike_ratio,
        request_count > global_avg * ${multiplier}      AS is_spike,
        (hour_of_day < ${bizStart} OR hour_of_day >= ${bizEnd}) AS is_off_hours
      FROM with_stats
      ORDER BY bucket_time ASC
    `;
        return (0, connection_1.query)(sql);
    },
};
//# sourceMappingURL=anomalyTimeline.js.map