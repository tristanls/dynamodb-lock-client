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
        partitionKey: "key",
        acquirePeriodMs: 1e4
    }
);

failClosedClient.acquireLock("my-lock-name", (error, lock) =>
    {
        if (error)
        {
            return console.error(error)
        }
        // do stuff
        lock.release(error => error ? console.error(error) : console.log("released"));
    }
);

// "fail open": if process crashes and lock is not released, lock will
//              eventually expire after leaseDurationMs from last heartbeat
//              sent
const failOpenClient = new DynamoDBLockClient.FailOpen(
    {
        dynamodb,
        lockTable: "my-lock-table-name",
        heartbeatPeriodMs: 3e3,
        sendHeartbeats: true,
        leaseDurationMs: 1e4
    }
);

failOpenClient.acquireLock("my-lock-name", (error, lock) =>
    {
        if (error)
        {
            return console.error(error)
        }
        // do stuff
        lock.release(error => error ? console.error(error) : console.log("released"));
    }
);
