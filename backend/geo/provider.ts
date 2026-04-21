import axios from 'axios';

// ─────────────────────────────────────────────
// Geo-IP Provider
// Interface-first design — swap MaxMind in later
// without touching any other code.
// ─────────────────────────────────────────────

export interface GeoResult {
  ip: string;
  country: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  isp: string | null;
  org: string | null;
  as_number: string | null;         // e.g. "AS4134 Chinanet"
  is_datacenter: boolean;           // hosting/VPS ASN heuristic
  is_tor: boolean;
  error: string | null;
}

export interface GeoProvider {
  lookup(ip: string): Promise<GeoResult>;
  bulkLookup(ips: string[]): Promise<GeoResult[]>;
}

// ─────────────────────────────────────────────
// ip-api.com implementation
// Free, no account, 45 req/min limit
// Bulk endpoint handles up to 100 IPs per call
// ─────────────────────────────────────────────

const IP_API_BULK = 'http://ip-api.com/batch';
const FIELDS = 'status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,hosting,query';
const BATCH_SIZE = 100;
const RATE_LIMIT_MS = 1500; // ~40 req/min to stay under 45 limit

class IpApiProvider implements GeoProvider {
  private torExitIps: Set<string> = new Set();
  private torLoaded = false;

  async lookup(ip: string): Promise<GeoResult> {
    const results = await this.bulkLookup([ip]);
    return results[0];
  }

  async bulkLookup(ips: string[]): Promise<GeoResult[]> {
    if (!this.torLoaded) {
      await this.loadTorExits();
    }

    const results: GeoResult[] = [];

    // Process in batches of 100 (ip-api.com limit)
    for (let i = 0; i < ips.length; i += BATCH_SIZE) {
      const batch = ips.slice(i, i + BATCH_SIZE);

      try {
        const response = await axios.post(
          `${IP_API_BULK}?fields=${FIELDS}`,
          batch.map(ip => ({ query: ip })),
          { timeout: 10_000 }
        );

        const batchResults: GeoResult[] = (response.data as Record<string, unknown>[]).map((r) => ({
          ip: r.query as string,
          country: (r.country as string) ?? null,
          country_code: (r.countryCode as string) ?? null,
          region: (r.regionName as string) ?? null,
          city: (r.city as string) ?? null,
          lat: typeof r.lat === 'number' ? r.lat : null,
          lon: typeof r.lon === 'number' ? r.lon : null,
          isp: (r.isp as string) ?? null,
          org: (r.org as string) ?? null,
          as_number: (r.as as string) ?? null,
          is_datacenter: Boolean(r.hosting),
          is_tor: this.torExitIps.has(r.query as string),
          error: r.status === 'fail' ? (r.message as string) : null,
        }));

        results.push(...batchResults);

        // Rate limit between batches
        if (i + BATCH_SIZE < ips.length) {
          await sleep(RATE_LIMIT_MS);
        }
      } catch (err) {
        // On network error, push error entries for the whole batch
        batch.forEach(ip => results.push(errorResult(ip, String(err))));
      }
    }

    return results;
  }

  /** Load TOR exit node list from dan.me.uk — plain text, one IP per line */
  private async loadTorExits(): Promise<void> {
    try {
      const response = await axios.get('https://check.torproject.org/torbulkexitlist', {
        timeout: 10_000,
        responseType: 'text',
      });
      const ips = (response.data as string)
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
      this.torExitIps = new Set(ips);
      this.torLoaded = true;
      console.log(`[geo] TOR exit list loaded: ${this.torExitIps.size} exit nodes`);
    } catch (err) {
      console.warn('[geo] Failed to load TOR exit list:', err);
      this.torLoaded = true; // Don't retry every lookup
    }
  }
}

function errorResult(ip: string, error: string): GeoResult {
  return {
    ip, country: null, country_code: null, region: null,
    city: null, lat: null, lon: null, isp: null, org: null,
    as_number: null, is_datacenter: false, is_tor: false, error,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// Singleton export — swap provider here when
// MaxMind is added in the future
// ─────────────────────────────────────────────

export const geoProvider: GeoProvider = new IpApiProvider();
