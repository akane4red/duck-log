import { LogRow } from '../shared/types';
export interface ParseResult {
    rows: LogRow[];
    field_count: number;
    line_count: number;
    error_count: number;
    errors: string[];
}
/**
 * Parse a single IIS .log file into normalized LogRow array.
 * Streams line-by-line so large files never fully load into memory.
 */
export declare function parseLogFile(filePath: string, onProgress?: (linesRead: number) => void): Promise<ParseResult>;
//# sourceMappingURL=parser.d.ts.map