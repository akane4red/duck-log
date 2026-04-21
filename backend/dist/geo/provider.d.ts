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
    as_number: string | null;
    is_datacenter: boolean;
    is_tor: boolean;
    error: string | null;
}
export interface GeoProvider {
    lookup(ip: string): Promise<GeoResult>;
    bulkLookup(ips: string[]): Promise<GeoResult[]>;
}
export declare const geoProvider: GeoProvider;
//# sourceMappingURL=provider.d.ts.map