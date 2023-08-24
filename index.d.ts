// Type definitions for dynamodb-lock-client 1.0

/// <reference types="node" />

import { EventEmitter } from "events";

export interface Lock extends EventEmitter {
    release(callback: (error: Error) => void): void;
}

interface GenericConfig {
    dynamodb: {
        delete: (...args: any[]) => any;
        get: (...args: any[]) => any;
        put: (...args: any[]) => any;
    };
    lockTable: string;
    partitionKey: string;
    sortKey?: string | undefined;
    ownerName?: string | undefined;
}

export interface FailClosedConfig extends GenericConfig {
    acquirePeriodMs: number;
}

export interface FailOpenConfig extends GenericConfig {
    heartbeatPeriodMs?: number | undefined;
    leaseDuration: number;
    leaseUnit: "milliseconds" | "seconds" | "minutes" | "hours" | "days";
    trustLocalTime?: boolean | undefined;
}

export class LockClient<PartitionTableKeyType extends string | number> {
    acquireLock(id: PartitionTableKeyType, callback: (error: Error, lock: Lock) => void): void;
}

export class FailClosed<PartitionTableKeyType extends string | number> extends LockClient<PartitionTableKeyType> {
    constructor(config: FailClosedConfig);
}

export class FailOpen<PartitionTableKeyType extends string | number> extends LockClient<PartitionTableKeyType> {
    constructor(config: FailOpenConfig);
}

// Disabled automatic exporting
export {};
