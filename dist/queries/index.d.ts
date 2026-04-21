import { QueryDescriptor } from '../shared/types';
export interface QueryHandler {
    descriptor: QueryDescriptor;
    run: (params: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
}
declare class QueryRegistry {
    private handlers;
    register(handler: QueryHandler): void;
    get(name: string): QueryHandler | undefined;
    list(): QueryDescriptor[];
}
export declare function getRegistry(): QueryRegistry;
export {};
//# sourceMappingURL=index.d.ts.map