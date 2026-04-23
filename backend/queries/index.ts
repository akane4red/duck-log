import { QueryDescriptor } from '../shared/types';
import { bruteForceQuery } from './bruteForce';
import { scannerQuery } from './scanner';
import { anomalyTimelineQuery } from './anomalyTimeline';
import { slowRequestsQuery } from './slowRequests';
import { sessionReconstructQuery } from './sessionReconstruct';
import { topNQuery } from './topN';
import { geoIpQuery } from './geoip';

// ─────────────────────────────────────────────
// Query Registry
// All named forensic queries registered here
// ─────────────────────────────────────────────

export interface QueryHandler {
  descriptor: QueryDescriptor;
  run: (params: Record<string, unknown>, ctx: QueryContext) => Promise<Record<string, unknown>[]>;
}

export interface QueryContext {
  query: <T = Record<string, unknown>>(sql: string) => Promise<T[]>;
}

class QueryRegistry {
  private handlers = new Map<string, QueryHandler>();

  register(handler: QueryHandler): void {
    this.handlers.set(handler.descriptor.name, handler);
  }

  get(name: string): QueryHandler | undefined {
    return this.handlers.get(name);
  }

  list(): QueryDescriptor[] {
    return Array.from(this.handlers.values()).map(h => h.descriptor);
  }
}

let _registry: QueryRegistry | null = null;

export function getRegistry(): QueryRegistry {
  if (!_registry) {
    _registry = new QueryRegistry();
    _registry.register(bruteForceQuery);
    _registry.register(scannerQuery);
    _registry.register(anomalyTimelineQuery);
    _registry.register(slowRequestsQuery);
    _registry.register(sessionReconstructQuery);
    _registry.register(topNQuery);
    _registry.register(geoIpQuery);
  }
  return _registry;
}
