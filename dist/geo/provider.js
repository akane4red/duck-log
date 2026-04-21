"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.geoProvider = void 0;
const axios_1 = __importDefault(require("axios"));
// ─────────────────────────────────────────────
// ip-api.com implementation
// Free, no account, 45 req/min limit
// Bulk endpoint handles up to 100 IPs per call
// ─────────────────────────────────────────────
const IP_API_BULK = 'http://ip-api.com/batch';
const FIELDS = 'status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,hosting,query';
const BATCH_SIZE = 100;
const RATE_LIMIT_MS = 1500; // ~40 req/min to stay under 45 limit
class IpApiProvider {
    torExitIps = new Set();
    torLoaded = false;
    async lookup(ip) {
        const results = await this.bulkLookup([ip]);
        return results[0];
    }
    async bulkLookup(ips) {
        if (!this.torLoaded) {
            await this.loadTorExits();
        }
        const results = [];
        // Process in batches of 100 (ip-api.com limit)
        for (let i = 0; i < ips.length; i += BATCH_SIZE) {
            const batch = ips.slice(i, i + BATCH_SIZE);
            try {
                const response = await axios_1.default.post(`${IP_API_BULK}?fields=${FIELDS}`, batch.map(ip => ({ query: ip })), { timeout: 10_000 });
                const batchResults = response.data.map((r) => ({
                    ip: r.query,
                    country: r.country ?? null,
                    country_code: r.countryCode ?? null,
                    region: r.regionName ?? null,
                    city: r.city ?? null,
                    lat: typeof r.lat === 'number' ? r.lat : null,
                    lon: typeof r.lon === 'number' ? r.lon : null,
                    isp: r.isp ?? null,
                    org: r.org ?? null,
                    as_number: r.as ?? null,
                    is_datacenter: Boolean(r.hosting),
                    is_tor: this.torExitIps.has(r.query),
                    error: r.status === 'fail' ? r.message : null,
                }));
                results.push(...batchResults);
                // Rate limit between batches
                if (i + BATCH_SIZE < ips.length) {
                    await sleep(RATE_LIMIT_MS);
                }
            }
            catch (err) {
                // On network error, push error entries for the whole batch
                batch.forEach(ip => results.push(errorResult(ip, String(err))));
            }
        }
        return results;
    }
    /** Load TOR exit node list from dan.me.uk — plain text, one IP per line */
    async loadTorExits() {
        try {
            const response = await axios_1.default.get('https://check.torproject.org/torbulkexitlist', {
                timeout: 10_000,
                responseType: 'text',
            });
            const ips = response.data
                .split('\n')
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('#'));
            this.torExitIps = new Set(ips);
            this.torLoaded = true;
            console.log(`[geo] TOR exit list loaded: ${this.torExitIps.size} exit nodes`);
        }
        catch (err) {
            console.warn('[geo] Failed to load TOR exit list:', err);
            this.torLoaded = true; // Don't retry every lookup
        }
    }
}
function errorResult(ip, error) {
    return {
        ip, country: null, country_code: null, region: null,
        city: null, lat: null, lon: null, isp: null, org: null,
        as_number: null, is_datacenter: false, is_tor: false, error,
    };
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
// ─────────────────────────────────────────────
// Singleton export — swap provider here when
// MaxMind is added in the future
// ─────────────────────────────────────────────
exports.geoProvider = new IpApiProvider();
//# sourceMappingURL=provider.js.map