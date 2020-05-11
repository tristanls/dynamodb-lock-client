"use strict";

const clone = require("clone");
const countdown = require("./test/countdown.js");
const DynamoDBLockClient = require("./index.js");

const LOCK_TABLE = "my-lock-table-name";
const PARTITION_KEY = "myPartitionKey";
const SORT_KEY = "mySortKey";
const HEARTBEAT_PERIOD_MS = 3e3;
const LEASE_DURATION_MS = 1e4;
const OWNER = "me";
const LOCK_ID = "lockId";

// describe("FailClosed lock acquisition", () =>
// {
//         describe("puts item into DynamoDB table", () =>
//         {
//             describe("if non-ConditionalCheckFailedException error", () =>
//             {
//                 it("returns FailedToAcquireLock error", done =>
//                     {

//                     }
//                 );
//             });
//             describe("if ConditionalCheckFailedException error", () =>
//             {
//                 it("")
//             });
//         });
// });

describe("FailClosed lock release", () =>
{

});

describe("FailOpen lock acquisition", () =>
{
    let config, dynamodb;
    beforeEach(() =>
        {
            config =
            {
                lockTable: LOCK_TABLE,
                partitionKey: PARTITION_KEY,
                heartbeatPeriodMs: HEARTBEAT_PERIOD_MS,
                leaseDurationMs: LEASE_DURATION_MS,
                owner: OWNER
            };
            dynamodb =
            {
                delete: () => {},
                get: () => {},
                put: () => {}
            }
        }
    );
    describe("using partitionKey", () =>
    {
        describe("gets item from DynamoDB table", () =>
        {
            test("if error, invokes callback with error", done =>
                {
                    const finish = countdown(done, 2);
                    const error = new Error("boom");
                    config.dynamodb = Object.assign(
                        dynamodb,
                        {
                            get(params, callback)
                            {
                                expect(params).toEqual(
                                    {
                                        TableName: LOCK_TABLE,
                                        Key:
                                        {
                                            [PARTITION_KEY]: LOCK_ID
                                        },
                                        ConsistentRead: true
                                    }
                                );
                                finish();
                                return callback(error);
                            }
                        }
                    );
                    const failOpen = new DynamoDBLockClient.FailOpen(config);
                    failOpen.acquireLock(LOCK_ID, (err, lock) =>
                        {
                            expect(err).toBe(error);
                            expect(lock).toBe(undefined);
                            finish();
                        }
                    );
                }
            );
            describe("no item present", () =>
            {
                beforeEach(() =>
                    {
                        dynamodb = Object.assign(
                            dynamodb,
                            {
                                get: (_, callback) => callback(undefined, {})
                            }
                        );
                    }
                );
                describe("puts new item in DynamoDB table", () =>
                {
                    test("if non-ConditionalCheckFailedException error, invokes callback with error", done =>
                        {
                            const finish = countdown(done, 2);
                            const error = new Error("boom");
                            config.dynamodb = Object.assign(
                                dynamodb,
                                {
                                    put(params, callback)
                                    {
                                        expect(params).toEqual(
                                            {
                                                TableName: LOCK_TABLE,
                                                Item:
                                                {
                                                    [PARTITION_KEY]: LOCK_ID,
                                                    fencingToken: 1,
                                                    leaseDurationMs: LEASE_DURATION_MS,
                                                    owner: OWNER,
                                                    guid: expect.any(Buffer)
                                                },
                                                ConditionExpression: `attribute_not_exists(#partitionKey)`,
                                                ExpressionAttributeNames:
                                                {
                                                    "#partitionKey": PARTITION_KEY
                                                }
                                            }
                                        );
                                        finish();
                                        return callback(error);
                                    }
                                }
                            );
                            const failOpen = new DynamoDBLockClient.FailOpen(config);
                            failOpen.acquireLock(LOCK_ID, (err, lock) =>
                                {
                                    expect(err).toBe(error);
                                    expect(lock).toBe(undefined);
                                    finish();
                                }
                            );
                        }
                    );
                    describe("if ConditionalCheckFailedException error", () =>
                    {
                        const error = new Error("boom");
                        error.code = "ConditionalCheckFailedException";
                        beforeEach(() =>
                            {
                                dynamodb = Object.assign(
                                    dynamodb,
                                    {
                                        put: (_, callback) => callback(error)
                                    }
                                );
                            }
                        );
                        describe("default retryCount", () =>
                        {
                            test("retries to get item from DynamoDB table, if error, invokes callback with error", done =>
                                {
                                    let callCount = 0;
                                    const finish = countdown(done, 3);
                                    const err = new Error("boom");
                                    config.dynamodb = Object.assign(
                                        dynamodb,
                                        {
                                            get(params, callback)
                                            {
                                                if (++callCount == 1)
                                                {
                                                    finish();
                                                    return callback(undefined, {}); // no item
                                                }
                                                expect(params).toEqual(
                                                    {
                                                        TableName: LOCK_TABLE,
                                                        Key:
                                                        {
                                                            [PARTITION_KEY]: LOCK_ID
                                                        },
                                                        ConsistentRead: true
                                                    }
                                                );
                                                finish();
                                                return callback(err);
                                            }
                                        }
                                    );
                                    const failOpen = new DynamoDBLockClient.FailOpen(config);
                                    failOpen.acquireLock(LOCK_ID, (e, lock) =>
                                        {
                                            expect(e).toBe(err);
                                            expect(lock).toBe(undefined);
                                            finish();
                                        }
                                    );
                                }
                            );
                        });
                        describe("out of retries", () =>
                        {
                            beforeEach(() =>
                                {
                                    config.retryCount = 0;
                                }
                            );
                            test("invokes callback with FailedToAcquireLock error", done =>
                                {
                                    config.dynamodb = dynamodb
                                    const failOpen = new DynamoDBLockClient.FailOpen(config);
                                    failOpen.acquireLock(LOCK_ID, (err, lock) =>
                                        {
                                            expect(err.message).toBe("Failed to acquire lock.");
                                            expect(err.code).toBe("FailedToAcquireLock");
                                            expect(lock).toBe(undefined);
                                            done();
                                        }
                                    );
                                }
                            );
                        });
                    });
                    test("on success, returns configured Lock", done =>
                        {
                            config.dynamodb = Object.assign(
                                dynamodb,
                                {
                                    put: (_, callback) => callback()
                                }
                            );
                            const failOpen = new DynamoDBLockClient.FailOpen(config);
                            failOpen.acquireLock(LOCK_ID, (error, lock) =>
                                {
                                    expect(error).toBe(undefined);
                                    expect(lock).toEqual(
                                        expect.objectContaining(
                                            {
                                                _config:
                                                {
                                                    dynamodb: config.dynamodb,
                                                    fencingToken: 1,
                                                    guid: expect.any(Buffer),
                                                    heartbeatPeriodMs: HEARTBEAT_PERIOD_MS,
                                                    id: LOCK_ID,
                                                    leaseDurationMs: LEASE_DURATION_MS,
                                                    lockTable: LOCK_TABLE,
                                                    owner: OWNER,
                                                    partitionKey: PARTITION_KEY,
                                                    type: DynamoDBLockClient.FailOpen
                                                },
                                                _released: false
                                            }
                                        )
                                    );
                                    done();
                                }
                            );
                        }
                    );
                });
            });
            describe("item present", () =>
            {
                // TODO
            });
        });
    });
    describe("using partitionKey and sortKey", () =>
    {
        // TODO
    });
});

describe("FailOpen lock release", () =>
{

});
