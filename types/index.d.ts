// Type definitions for dynamodb-lock-client 1.0
// TODO Move dynamodb-lock-client to central npm registry

declare module 'dynamodb-lock-client' {

  import { DynamoDB } from '@aws-sdk/client-dynamodb'
  import { EventEmitter } from 'events'

  export interface Lock extends EventEmitter {
    release: (callback: (error: Error) => void) => void
    fencingToken: number
  }

  interface GenericConfig {
    dynamodb?: DynamoDB
    lockTable: string
    partitionKey: string
    sortKey?: string | undefined
    owner?: string | undefined
    retryCount?: number | undefined
  }

  export interface FailClosedConfig extends GenericConfig {
    acquirePeriodMs: number
  }

  export interface FailOpenConfig extends GenericConfig {
    heartbeatPeriodMs?: number | undefined
    leaseDurationMs: number
    trustLocalTime?: boolean | undefined
  }

  export class LockClient<PartitionTableKeyType extends string | number> {
    acquireLock (id: PartitionTableKeyType | unknown, callback: (error: Error, lock: Lock) => unknown): unknown;
  }

  export class FailClosed<PartitionTableKeyType extends string | number> extends LockClient<PartitionTableKeyType> {
    constructor (config: FailClosedConfig);
  }

  export class FailOpen<PartitionTableKeyType extends string | number> extends LockClient<PartitionTableKeyType> {
    constructor (config: FailOpenConfig);
  }
}
