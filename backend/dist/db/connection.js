"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.getConnection = getConnection;
exports.createConnection = createConnection;
exports.query = query;
exports.execute = execute;
exports.closeDb = closeDb;
const node_api_1 = require("@duckdb/node-api");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
// ─────────────────────────────────────────────
// DuckDB singleton
// Single persistent connection per process
// ─────────────────────────────────────────────
const DB_PATH = path.resolve(process.env.DB_PATH ?? './data/forensics.duckdb');
let _instancePromise = null;
let _connPromise = null;
function getDb() {
    if (!_instancePromise) {
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
        _instancePromise = node_api_1.DuckDBInstance.create(DB_PATH);
    }
    return _instancePromise;
}
function getConnection() {
    if (!_connPromise) {
        _connPromise = getDb().then((db) => db.connect());
    }
    return _connPromise;
}
function createConnection() {
    return getDb().then((db) => db.connect());
}
/**
 * Run a query and return all rows as plain objects.
 * Wraps the callback-based DuckDB API in a Promise.
 */
function query(sql) {
    return getConnection().then(async (conn) => {
        const reader = await conn.runAndReadAll(sql);
        const rows = reader.getRowObjectsJS();
        return rows.map((row) => makeJsonSafe(row));
    });
}
/**
 * Run a statement that returns no rows (CREATE, INSERT, etc.)
 */
function execute(sql) {
    return getConnection().then(async (conn) => {
        await conn.run(sql);
    });
}
function makeJsonSafe(value) {
    if (typeof value === 'bigint') {
        const abs = value < 0n ? -value : value;
        if (abs <= BigInt(Number.MAX_SAFE_INTEGER))
            return Number(value);
        return value.toString();
    }
    if (Array.isArray(value)) {
        return value.map((item) => makeJsonSafe(item));
    }
    if (value && typeof value === 'object') {
        const obj = value;
        const out = {};
        for (const [key, item] of Object.entries(obj)) {
            out[key] = makeJsonSafe(item);
        }
        return out;
    }
    return value;
}
async function closeDb() {
    try {
        if (_connPromise) {
            const conn = await _connPromise;
            conn.closeSync();
        }
    }
    finally {
        _connPromise = null;
        _instancePromise = null;
    }
}
//# sourceMappingURL=connection.js.map