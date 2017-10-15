# dynamodb-lock-client

_Stability: 1 - [Experimental](https://github.com/tristanls/stability-index#stability-1---experimental)_

[![NPM version](https://badge.fury.io/js/dynamodb-lock-client.png)](http://npmjs.org/package/dynamodb-lock-client)

A general purpose distributed locking library built for AWS DynamoDB.

## Contributors

[@tristanls](https://github.com/tristanls)

## Contents

  * [Installation](#installation)
  * [Usage](#usage)
  * [Tests](#tests)
  * [Documentation](#documentation)
    * [DynamoDBLockClient](#dynamodblockclient)
  * [Releases](#releases)

## Installation

    npm install dynamodb-lock-client

## Usage

To run the below example, run:

    npm run readme

```javascript
"use strict";

const AWS = require("aws-sdk");
const DynamoDBLockClient = require("../index.js");

const dynamodb = new AWS.DynamoDB.DocumentClient(
    {
        region: "us-east-1"
    }
);

// "fail closed": if process crashes and lock is not released, lock will
//                never be released (requires human intervention)
const failClosedClient = new DynamoDBLockClient.FailClosed(
    {
        dynamodb,
        lockTable: "my-lock-table-name",
        partitionKey: "mylocks",
        acquirePeriodMs: 1e4
    }
);

failClosedClient.acquireLock("my-fail-closed-lock", (error, lock) =>
    {
        if (error)
        {
            return console.error(error)
        }
        console.log("acquired fail closed lock");
        // do stuff
        lock.release(error => error ? console.error(error) : console.log("released fail closed lock"));
    }
);

// "fail open": if process crashes and lock is not released, lock will
//              eventually expire after leaseDurationMs from last heartbeat
//              sent
const failOpenClient = new DynamoDBLockClient.FailOpen(
    {
        dynamodb,
        lockTable: "my-lock-table-name",
        partitionKey: "mylocks",
        heartbeatPeriodMs: 3e3,
        leaseDurationMs: 1e4
    }
);

failOpenClient.acquireLock("my-fail-open-lock", (error, lock) =>
    {
        if (error)
        {
            return console.error(error)
        }
        console.log("acquired fail open lock");
        lock.on("error", error => console.error("failed to heartbeat!"));
        // do stuff
        lock.release(error => error ? console.error(error) : console.log("released fail open lock"));
    }
);

```

## Tests

No tests at this time.

## Documentation

  * [DynamoDBLockClient](#dynamodblockclient)

### DynamoDBLockClient

**Public API**

  * [new DynamoDBLockClient.FailClosed(config)](#new-dynamodblockclientfailclosedconfig)
  * [new DynamoDBLockClient.FailOpen(config)](#new-dynamodblockclientfailopenconfig)
  * [client.acquireLock(id, callback)](#clientacquirelockid-callback)
  * [lock.release(callback)](#lockreleasecallback)

### new DynamoDBLockClient.FailClosed(config)

  * `config`: _Object_
    * `dynamodb`: _AWS.DynamoDB.DocumentClient_ Instance of AWS DynamoDB DocumentClient.
    * `lockTable`: _String_ Name of lock table to use.
    * `partitionKey`: _String_ Name of table partition key (hash key) to use.
    * `acquirePeriodMs`: _Number_ How long to wait for the lock before giving up. Whatever operation this lock is protecting should take less time than `acquirePeriodMs`.
  * Return: _Object_ Fail closed client.

Creates a "fail closed" client that acquires "fail closed" locks. If process crashes and lock is not released, lock will never be released. This means that some sort of intervention will be required to put the system back into operational state if lock is held and a process crashes while holding the lock.

### new DynamoDBLockClient.FailOpen(config)

  * `config`: _Object_
    * `dynamodb`: _AWS.DynamoDB.DocumentClient_ Instance of AWS DynamoDB DocumentClient.
    * `lockTable`: _String_ Name of lock table to use.
    * `partitionKey`: _String_ Name of table partition key (hash key) to use.
    * `heartbeatPeriodMs`: _Number_ _(Default: undefined)_ Optional period at which to send heartbeats in order to keep the lock locked. Providing this option will cause heartbeats to be sent.
    * `leaseDurationMs`: _Number_ The length of lock lease duration. If the lock is not renewed via a heartbeat within `leaseDurationMs` it will be automatically released.
  * Return: _Object_ Fail open client.

Creates a "fail open" client that acquires "fail open" locks. If process crashes and lock is not released, lock will eventually expire after `leaseDurationMs` from last heartbeat sent (if any). This means that if process acquires a lock, goes to sleep for more than `leaseDurationMs`, and then wakes up assuming it still has a lock, then it can perform an operation ignoring other processes that may assume they have a lock on the operation.

### client.acquireLock(id, callback)

  * `id`: _String\|Buffer\|Number_ Unique identifier for the lock. The type must correspond to lock table's partition key type.
  * `callback`: _Function_ `(error, lock) => {}`
    * `error`: _Error_ Error, if any.
    * `lock`: _DynamoDBLockClient.Lock_ Successfully acquired lock object. Lock object is an instance of `EventEmitter`. If the `lock` is acquired via a fail open `client` configured to heartbeat, then the returned `lock` may emit an `error` event if a `heartbeat` operation fails.

Attempts to acquire a lock. If lock acquisition fails, callback will be called with an `error` and `lock` will be falsy. If lock acquisition succeeds, callback will be called with `lock`, and `error` will be falsy.

Fail closed client will attempt to acquire a lock. On failure, client will retry after `acquirePeriodMs`. On another failure, client will fail lock acquisition. On successful acquisition, lock will be locked until `lock.release()` is called successfuly.

Fail open client will attempt to acquire a lock. On failure, client will retry after `leaseDurationMs`. On another failure, client will fail lock acquisition. On successful acquisition, if `heartbeatPeriodMs` option is not specified (heartbeats off), lock will expire after `leaseDurartionMs`. If `heartbeatPeriodMs` option is specified, lock will be renewed at `heartbeatPeriodMs` intervals until `lock.release()` is called successfuly. Additionally, if `heartbeatPeriodMs` option is specified, lock may emit an `error` event if it fails a heartbeat operation.

### lock.release(callback)

  * `callback`: _Function_ `error => {}`
    * `error`: _Error_ Error, if any. No error implies successful lock release.

Releases previously acquired lock.

## Releases

We follow semantic versioning policy (see: [semver.org](http://semver.org/)):

> Given a version number MAJOR.MINOR.PATCH, increment the:
>
>MAJOR version when you make incompatible API changes,<br/>
>MINOR version when you add functionality in a backwards-compatible manner, and<br/>
>PATCH version when you make backwards-compatible bug fixes.

**caveat**: Major version zero is a special case indicating development version that may make incompatible API changes without incrementing MAJOR version.
