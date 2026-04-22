import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
export declare function getDb(): Promise<DuckDBInstance>;
export declare function getConnection(): Promise<DuckDBConnection>;
export declare function createConnection(): Promise<DuckDBConnection>;
/**
 * Run a query and return all rows as plain objects.
 * Wraps the callback-based DuckDB API in a Promise.
 */
export declare function query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
/**
 * Run a statement that returns no rows (CREATE, INSERT, etc.)
 */
export declare function execute(sql: string): Promise<void>;
export declare function closeDb(): Promise<void>;
//# sourceMappingURL=connection.d.ts.map