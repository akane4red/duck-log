import { LogFileInfo } from '../shared/types';
/**
 * Scan a directory (recursively) for IIS .log files.
 * Returns metadata for each file including ingestion status.
 */
export declare function scanDirectory(dirPath: string): Promise<LogFileInfo[]>;
/**
 * Validate that a list of file paths are accessible .log files.
 * Returns { valid, invalid } lists.
 */
export declare function validateFilePaths(filePaths: string[]): {
    valid: string[];
    invalid: Array<{
        path: string;
        reason: string;
    }>;
};
//# sourceMappingURL=watcher.d.ts.map