import { IngestStatus } from '../shared/types';
export declare function getIngestStatus(): IngestStatus;
export type IngestFilesOptions = {
    /** Remove each source file after processing (e.g. browser upload temp files). */
    deleteSourcesAfter?: boolean;
};
/**
 * Ingest a list of .log file paths.
 * Parses each file, writes to Parquet, registers a unified DuckDB view.
 * Non-blocking — returns immediately, progress via getIngestStatus().
 */
export declare function ingestFiles(filePaths: string[], options?: IngestFilesOptions): Promise<void>;
/**
 * Register a unified DuckDB view over ALL parquet files.
 * This is the view all forensic queries run against.
 */
export declare function registerUnifiedView(): Promise<void>;
/** Check if parquet data already exists (for /files endpoint) */
export declare function parquetExistsFor(logFileName: string): boolean;
//# sourceMappingURL=converter.d.ts.map