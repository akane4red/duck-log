"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRegistry = getRegistry;
const bruteForce_1 = require("./bruteForce");
const scanner_1 = require("./scanner");
const anomalyTimeline_1 = require("./anomalyTimeline");
const slowRequests_1 = require("./slowRequests");
const sessionReconstruct_1 = require("./sessionReconstruct");
const topN_1 = require("./topN");
const geoip_1 = require("./geoip");
class QueryRegistry {
    handlers = new Map();
    register(handler) {
        this.handlers.set(handler.descriptor.name, handler);
    }
    get(name) {
        return this.handlers.get(name);
    }
    list() {
        return Array.from(this.handlers.values()).map(h => h.descriptor);
    }
}
let _registry = null;
function getRegistry() {
    if (!_registry) {
        _registry = new QueryRegistry();
        _registry.register(bruteForce_1.bruteForceQuery);
        _registry.register(scanner_1.scannerQuery);
        _registry.register(anomalyTimeline_1.anomalyTimelineQuery);
        _registry.register(slowRequests_1.slowRequestsQuery);
        _registry.register(sessionReconstruct_1.sessionReconstructQuery);
        _registry.register(topN_1.topNQuery);
        _registry.register(geoip_1.geoIpQuery);
    }
    return _registry;
}
//# sourceMappingURL=index.js.map