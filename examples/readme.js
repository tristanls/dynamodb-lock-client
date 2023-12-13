"use strict";

const AWS = require("@aws-sdk/client-dynamodb");
const DynamoDBLockClient = require("../index.js");

const dynamodb = new AWS.DynamoDB({
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
    region: process.env.AWS_REGION,
    endpoint: process.env.DDB_ENDPOINT
  })

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
        console.log(`acquired fail open lock with fencing token ${lock.fencingToken}`);
        lock.on("error", error => console.error("failed to heartbeat!"));
        // do stuff
        lock.release(error => error ? console.error(error) : console.log("released fail open lock"));
    }
);
