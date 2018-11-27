import { DynamoDB } from 'aws-sdk'
import { EventEmitter } from 'events'


export interface ILock extends EventEmitter {
    // Releases previously acquired lock.
    // Fail closed lock is deleted, so that it can be acquired again.
    // Fail open lock heartbeats stop, and its leaseDurationMs is set to 1 millisecond so that it expires immediately. The datastructure is left in the datastore in order to provide continuity of fencingToken monotonicity guarantee.
    release(cb: (error: Error) => void)

    // Integer fail open locks only Integer monotonically incremented with every "fail open" lock acquisition to be used for fencing. Heartbeats do not increment fencingToken.
    fencingToken: number
}

export interface IFailClosedConfig {
    // AWS.DynamoDB.DocumentClient Instance of AWS DynamoDB DocumentClient.
    dynamodb: DynamoDB.DocumentClient

    // String Name of lock table to use.
    lockTable: string

    // String Name of table partition key (hash key) to use.
    partitionKey: string

    // Number How long to wait for the lock before giving up. Whatever operation this lock is protecting should take less time than acquirePeriodMs.
    acquirePeriodMs: number

    // String Customize owner name for lock (optional).
    owner?: string
}

export interface FailOpenConfig {
    // AWS.DynamoDB.DocumentClient Instance of AWS DynamoDB DocumentClient.
    dynamodb: DynamoDB.DocumentClient

    // String Name of lock table to use.
    lockTable: string

    // String Name of table partition key (hash key) to use.
    partitionKey: string

    // Number (Default: undefined) Optional period at which to send heartbeats in order to keep the lock locked. Providing this option will cause heartbeats to be sent.
    heartbeatPeriodMs?: number

    // Number The length of lock lease duration. If the lock is not renewed via a heartbeat within leaseDurationMs it will be automatically released.
    leaseDurationMs: number

    // String Customize owner name for lock (optional).
    owner?: string

    // Boolean (Default: false) If set to true, when the client retrieves an existing lock, it will use local time to determine if leaseDurationMs has elapsed (and shorten its wait time accordingly) instead of always waiting the full leaseDurationMs milliseconds before making an acquisition attempt.
    trustLocalTime?: boolean
}

declare class LockClient<PartitionTableKeyType> {
    // Attempts to acquire a lock. If lock acquisition fails, callback will be called with an error and lock will be falsy. If lock acquisition succeeds, callback will be called with lock, and error will be falsy.
    // Fail closed client will attempt to acquire a lock. On failure, client will retry after acquirePeriodMs. On another failure, client will fail lock acquisition. On successful acquisition, lock will be locked until lock.release() is called successfuly.
    // Fail open client will attempt to acquire a lock. On failure, if trustLocalTime is false (the default), client will retry after leaseDurationMs. If trustLocalTime is true, the client will retry after Math.max(0, leaseDurationMs - (localTimeMs - lockAcquiredTimeMs)) where localTimeMs is "now" and lockAcquiredTimeMs is the lock acquisition time recorded in the retrieved lock. On another failure, client will fail lock acquisition. On successful acquisition, if heartbeatPeriodMs option is not specified (heartbeats off), lock will expire after leaseDurartionMs. If heartbeatPeriodMs option is specified, lock will be renewed at heartbeatPeriodMs intervals until lock.release() is called successfuly. Additionally, if heartbeatPeriodMs option is specified, lock may emit an error event if it fails a heartbeat operation.
    acquireLock(id: PartitionTableKeyType, cb: (error: Error, lock: ILock) => void);
}

export declare class FailClosed<PartitionTableKeyType = String | Buffer | Number> extends LockClient<PartitionTableKeyType> {
    constructor(config: IFailClosedConfig);
}

export declare class FailOpen<PartitionTableKeyType = String | Buffer | Number> extends LockClient<PartitionTableKeyType> {
    constructor(config: FailOpenConfig);
}
