import { geoProvider } from '../geo/provider';
import { QueryHandler } from './index';

export const geoIpQuery: QueryHandler = {
  descriptor: {
    name: 'geoip_enrich',
    description: 'Enrich a set of suspect IPs with geo location, ISP, datacenter flag, and TOR exit detection.',
    params: [
      { name: 'ips', type: 'string[]', required: false, default: null, description: 'Specific IPs to enrich. If null, auto-selects top IPs by request count.' },
      { name: 'auto_top_n', type: 'number', required: false, default: 50, description: 'When ips is null, enrich the top N IPs by request count' },
      { name: 'flag_countries', type: 'string[]', required: false, default: [], description: 'ISO country codes to flag as suspicious e.g. ["CN","RU","KP"]' },
      { name: 'datacenter_only', type: 'boolean', required: false, default: false, description: 'Only return datacenter/hosting IPs' },
      { name: 'tor_only', type: 'boolean', required: false, default: false, description: 'Only return TOR exit nodes' },
      { name: 'date_from', type: 'string', required: false, default: null, description: 'ISO date filter from (YYYY-MM-DD)' },
      { name: 'date_to', type: 'string', required: false, default: null, description: 'ISO date filter to (YYYY-MM-DD)' },
    ],
  },

  async run(params, ctx) {
    const manualIps    = params.ips as string[] | null ?? null;
    const autoTopN     = Math.min(Number(params.auto_top_n ?? 50), 200);
    const flagCountries = new Set((params.flag_countries as string[] | null ?? []).map(c => c.toUpperCase()));
    const datacenterOnly = Boolean(params.datacenter_only ?? false);
    const torOnly        = Boolean(params.tor_only ?? false);
    const dateFrom     = params.date_from as string | null ?? null;
    const dateTo       = params.date_to as string | null ?? null;

    let ipsToEnrich: string[];

    if (manualIps && manualIps.length > 0) {
      ipsToEnrich = manualIps;
    } else {
      // Auto-select top IPs from logs
      const dateFromClause = dateFrom ? `AND date >= '${dateFrom}'` : '';
      const dateToClause   = dateTo   ? `AND date <= '${dateTo}'`   : '';

      const topIps = await ctx.query<{ c_ip: string }>(`
        SELECT c_ip, COUNT(*) as cnt
        FROM logs
        WHERE c_ip IS NOT NULL AND c_ip != '-'
          ${dateFromClause}
          ${dateToClause}
        GROUP BY c_ip
        ORDER BY cnt DESC
        LIMIT ${autoTopN}
      `);

      ipsToEnrich = topIps.map(r => r.c_ip);
    }

    if (ipsToEnrich.length === 0) {
      return [];
    }

    // Enrich via geo provider
    const geoResults = await geoProvider.bulkLookup(ipsToEnrich);

    // Get request counts from logs for context
    const ipList = ipsToEnrich.map(ip => `'${ip}'`).join(',');
    const dateFromClause = dateFrom ? `AND date >= '${dateFrom}'` : '';
    const dateToClause   = dateTo   ? `AND date <= '${dateTo}'`   : '';

    const counts = await ctx.query<{
      c_ip: string;
      total_requests: number;
      status_4xx: number;
      status_5xx: number;
    }>(`
      SELECT
        c_ip,
        COUNT(*) AS total_requests,
        SUM(CASE WHEN status BETWEEN 400 AND 499 THEN 1 ELSE 0 END) AS status_4xx,
        SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS status_5xx
      FROM logs
      WHERE c_ip IN (${ipList})
        ${dateFromClause}
        ${dateToClause}
      GROUP BY c_ip
    `);

    const countMap = new Map(counts.map(c => [c.c_ip, c]));

    // Merge geo + log stats
    let enriched = geoResults.map(geo => {
      const logStats = countMap.get(geo.ip);
      return {
        ...geo,
        total_requests: logStats?.total_requests ?? 0,
        status_4xx:     logStats?.status_4xx ?? 0,
        status_5xx:     logStats?.status_5xx ?? 0,
        is_flagged_country: flagCountries.size > 0
          ? flagCountries.has(geo.country_code ?? '')
          : false,
      };
    });

    // Apply post-filters
    if (datacenterOnly) enriched = enriched.filter(r => r.is_datacenter);
    if (torOnly)        enriched = enriched.filter(r => r.is_tor);

    // Sort: TOR first, then datacenter, then flagged country, then by request count
    enriched.sort((a, b) => {
      if (a.is_tor !== b.is_tor)               return a.is_tor ? -1 : 1;
      if (a.is_datacenter !== b.is_datacenter) return a.is_datacenter ? -1 : 1;
      if (a.is_flagged_country !== b.is_flagged_country) return a.is_flagged_country ? -1 : 1;
      return b.total_requests - a.total_requests;
    });

    return enriched;
  },
};
