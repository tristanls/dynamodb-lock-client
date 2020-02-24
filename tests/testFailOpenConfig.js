"use strict";

const AWS = require("aws-sdk");
const assert = require("assert");
const chai = require("chai");
const chaiSubset = require("chai-subset");
const sinon = require("sinon");
const DynamoDBEmbedded = require("dynamodb-local");
const DynamoDBLockClient = require("../index.js");
const expect = chai.expect;
const spy = sinon.spy;

chai.use(chaiSubset);

const PORT = 8001;
const TABLE_NAME = "my-lock-table-name";
const PARTITION_KEY = "myPartitionKey";
const HEARTBEAT_PERIOD_MS = 3e3;
const LEASE_DURATION_MS = 1e4;
const OWNER = 'me';
const LOCK_ID = 'lockId';

describe("FailOpen lock with partitionKey only", () => {

    let dynamodb;
    let docClient;
    let failOpenClient;
    let putSpy, getSpy, deleteSpy;

    const resetAllSpies = () => {
        putSpy.resetHistory();
        getSpy.resetHistory();
        deleteSpy.resetHistory();
    };

    const setup = () => {
        const params = {
            TableName: TABLE_NAME,
            KeySchema: [
                {AttributeName: PARTITION_KEY, KeyType: "HASH"}
            ],
            AttributeDefinitions: [
                {AttributeName: PARTITION_KEY, AttributeType: "S"}
            ],
            ProvisionedThroughput: {
                ReadCapacityUnits: 10,
                WriteCapacityUnits: 10
            }
        };

        return new Promise((resolve, reject) => {
            dynamodb.createTable(params).promise()
                .then(created => resolve(created.TableDescription))
                .catch(err => reject(err));
        });
    };

    const drop = () => {
        return new Promise((resolve, reject) => {
            dynamodb.deleteTable({TableName: TABLE_NAME}).promise()
                .then(dropped => resolve(dropped.TableDescription))
                .catch(err => reject(err));
        });
    };

    before(() => {
        return DynamoDBEmbedded.launch(PORT, null, [], true, true)
            .then(() => {
                const config = {
                    region: "aws-region-1", endpoint: `http://localhost:${PORT}`,
                    accessKeyId: "whatever", secretAccessKey: "whatever"
                };
                dynamodb = new AWS.DynamoDB(config);
                docClient = new AWS.DynamoDB.DocumentClient(config);
            });
    });

    after(() => {
        return DynamoDBEmbedded.stop(PORT);
    });

    beforeEach(() => {
        return setup()
            .then(() => {
                failOpenClient = new DynamoDBLockClient.FailOpen(
                    {
                        dynamodb: docClient,
                        lockTable: TABLE_NAME,
                        partitionKey: PARTITION_KEY,
                        heartbeatPeriodMs: HEARTBEAT_PERIOD_MS,
                        leaseDurationMs: LEASE_DURATION_MS,
                        owner: OWNER
                    }
                );
            });
    });

    beforeEach(() => {
        putSpy = spy(docClient, 'put');
        getSpy = spy(docClient, 'get');
        deleteSpy = spy(docClient, 'delete');
    });

    afterEach(() => {
        putSpy.restore();
        getSpy.restore();
        deleteSpy.restore();
    });

    afterEach(() => {
        return drop();
    });

    it("acquires lock if there is no lock yet", () => {

        return new Promise((resolve, reject) => {
            failOpenClient.acquireLock(LOCK_ID, (error, lock) => {
                if (error) {
                    reject(error);
                } else {
                    console.log(`acquired open lock with fencing token ${lock.fencingToken}`);
                    lock.on('error', () => console.error('failed to heartbeat!'));
                    resolve(lock);
                }
            });
        }).then(lock => {
            expect(lock._id).to.eq(LOCK_ID);
            expect(lock._leaseDurationMs).to.eq(LEASE_DURATION_MS);
            expect(lock._heartbeatPeriodMs).to.eq(HEARTBEAT_PERIOD_MS);

            // check for communication
            expect(getSpy.callCount).to.eq(1, 'get called: check for existing lock');
            expect(getSpy.lastCall.args[0]).to.eql({
                "TableName": TABLE_NAME,
                "Key": {
                    [PARTITION_KEY]: LOCK_ID
                },
                "ConsistentRead": true
            });

            expect(putSpy.callCount).to.eq(1, 'put called: acquire new lock');
            expect(putSpy.lastCall.args[0]).to.containSubset({
                "TableName": TABLE_NAME,
                "Item": {
                    "fencingToken": 1,
                    "leaseDurationMs": LEASE_DURATION_MS,
                    "owner": OWNER,
                    [PARTITION_KEY]: LOCK_ID
                },
                "ConditionExpression": "attribute_not_exists(#partitionKey)",
                "ExpressionAttributeNames": {
                    "#partitionKey": PARTITION_KEY
                }
            });

            expect(deleteSpy.callCount).to.eq(0, 'no delete called');

        }).catch(err => assert.fail(err));
    });

    it('releases the lock if there is a lock present', async () => {

        return new Promise((resolve, reject) => {
            failOpenClient.acquireLock(LOCK_ID, (error, lock) => {
                if (error) {
                    reject(error);
                } else {
                    console.log(`acquired open lock with fencing token ${lock.fencingToken}`);
                    lock.on('error', () => console.error('failed to heartbeat!'));
                    resolve(lock);
                }
            });
        }).then(lock => {
            resetAllSpies();
            expect(lock._heartbeatTimeout).to.be.ok;
            return new Promise((resolve, reject) => {
                lock.release(err => {
                    if (err) {
                        reject(err)
                    } else {
                        expect(lock._heartbeatTimeout).to.be.undefined;
                        resolve();
                    }
                });
            });
        }).then(lock => {
            expect(lock).to.be.undefined;

            expect(getSpy.callCount).to.eq(0, 'get called: no calls');
            expect(putSpy.callCount).to.eq(1, 'put called: check for existing lock');
            const guid = putSpy.lastCall.args[0].Item.guid;
            expect(putSpy.lastCall.args[0]).to.containSubset({
                "TableName": TABLE_NAME,
                "Item": {
                    "fencingToken": 1,
                    "leaseDurationMs": 1,
                    "owner": "me",
                    "guid": guid,
                    [PARTITION_KEY]: LOCK_ID
                },
                "ConditionExpression": "attribute_exists(#partitionKey) and guid = :guid",
                "ExpressionAttributeNames": {
                    "#partitionKey": PARTITION_KEY
                },
                "ExpressionAttributeValues": {
                    ":guid": guid
                }
            });
            expect(deleteSpy.callCount).to.eq(0, 'delete called: no calls');
        }).catch(err => assert.fail(err));
    });
});

describe("FailOpen lock with partitionKey + rangeKey", () => {

    const RANGE_KEY = "myRangeKey";
    const SUB_LOCK_ID = 'subLockId';

    let dynamodb;
    let docClient;
    let failOpenClient;
    let putSpy, getSpy, deleteSpy;

    const resetAllSpies = () => {
        putSpy.resetHistory();
        getSpy.resetHistory();
        deleteSpy.resetHistory();
    };

    const setup = () => {
        const params = {
            TableName: TABLE_NAME,
            KeySchema: [
                {AttributeName: PARTITION_KEY, KeyType: "HASH"},
                {AttributeName: RANGE_KEY, KeyType: "RANGE"},
            ],
            AttributeDefinitions: [
                {AttributeName: PARTITION_KEY, AttributeType: "S"},
                {AttributeName: RANGE_KEY, AttributeType: "S"}
            ],
            ProvisionedThroughput: {
                ReadCapacityUnits: 10,
                WriteCapacityUnits: 10
            }
        };

        return new Promise((resolve, reject) => {
            dynamodb.createTable(params).promise()
                .then(created => resolve(created.TableDescription))
                .catch(err => reject(err));
        });
    };

    const drop = () => {
        return new Promise((resolve, reject) => {
            dynamodb.deleteTable({TableName: TABLE_NAME}).promise()
                .then(dropped => resolve(dropped.TableDescription))
                .catch(err => reject(err));
        });
    };

    before(() => {
        return DynamoDBEmbedded.launch(PORT, null, [], true, true)
            .then(() => {
                const config = {
                    region: "aws-region-1", endpoint: `http://localhost:${PORT}`,
                    accessKeyId: "whatever", secretAccessKey: "whatever"
                };
                dynamodb = new AWS.DynamoDB(config);
                docClient = new AWS.DynamoDB.DocumentClient(config);
            });
    });

    after(() => {
        return DynamoDBEmbedded.stop(PORT);
    });

    beforeEach(() => {
        return setup()
            .then(() => {
                failOpenClient = new DynamoDBLockClient.FailOpen(
                    {
                        dynamodb: docClient,
                        lockTable: TABLE_NAME,
                        partitionKey: PARTITION_KEY,
                        rangeKey: RANGE_KEY,
                        heartbeatPeriodMs: HEARTBEAT_PERIOD_MS,
                        leaseDurationMs: LEASE_DURATION_MS,
                        owner: OWNER
                    }
                );
            });
    });

    beforeEach(() => {
        putSpy = spy(docClient, 'put');
        getSpy = spy(docClient, 'get');
        deleteSpy = spy(docClient, 'delete');
    });

    afterEach(() => {
        putSpy.restore();
        getSpy.restore();
        deleteSpy.restore();
    });

    afterEach(() => {
        return drop();
    });

    it("acquires lock if there is no lock yet", () => {

        return new Promise((resolve, reject) => {
            failOpenClient.acquireLock([LOCK_ID, SUB_LOCK_ID], (error, lock) => {
                if (error) {
                    reject(error);
                } else {
                    console.log(`acquired open lock with fencing token ${lock.fencingToken}`);
                    lock.on('error', () => console.error('failed to heartbeat!'));
                    resolve(lock);
                }
            });
        }).then(lock => {
            expect(lock._id).to.eq(LOCK_ID);
            expect(lock._subId).to.eq(SUB_LOCK_ID);
            expect(lock._leaseDurationMs).to.eq(LEASE_DURATION_MS);
            expect(lock._heartbeatPeriodMs).to.eq(HEARTBEAT_PERIOD_MS);

            // check for communication
            expect(getSpy.callCount).to.eq(1, 'get called: check for existing lock');
            expect(getSpy.lastCall.args[0]).to.eql({
                "TableName": TABLE_NAME,
                "Key": {
                    [PARTITION_KEY]: LOCK_ID,
                    [RANGE_KEY]: SUB_LOCK_ID
                },
                "ConsistentRead": true
            });

            expect(putSpy.callCount).to.eq(1, 'put called: acquire new lock');
            expect(putSpy.lastCall.args[0]).to.containSubset({
                "TableName": TABLE_NAME,
                "Item": {
                    "fencingToken": 1,
                    "leaseDurationMs": LEASE_DURATION_MS,
                    "owner": OWNER,
                    [PARTITION_KEY]: LOCK_ID,
                    [RANGE_KEY]: SUB_LOCK_ID
                },
                "ConditionExpression": "(attribute_not_exists(#partitionKey) and attribute_not_exists(#rangeKey))",
                "ExpressionAttributeNames": {
                    "#partitionKey": PARTITION_KEY,
                    "#rangeKey": RANGE_KEY
                }
            });

            expect(deleteSpy.callCount).to.eq(0, 'no delete called');

        }).catch(err => assert.fail(err));
    });

    it("cannot acquire lock for range_key = null", () => {

        return new Promise((resolve, reject) => {
            failOpenClient.acquireLock([LOCK_ID, null], (error, lock) => {
                if (error) {
                    reject(error);
                } else {
                    console.log(`acquired open lock with fencing token ${lock.fencingToken}`);
                    lock.on('error', () => console.error('failed to heartbeat!'));
                    resolve(lock);
                }
            });
        }).then(() => {
            assert.fail('has to fail because range_key is null');
        }).catch(err => expect(err.message).to.eq('The number of conditions on the keys is invalid'));
    });

    it('releases the lock if there is a lock present', async () => {

        return new Promise((resolve, reject) => {
            failOpenClient.acquireLock([LOCK_ID, SUB_LOCK_ID], (error, lock) => {
                if (error) {
                    reject(error);
                } else {
                    console.log(`acquired open lock with fencing token ${lock.fencingToken}`);
                    lock.on('error', () => console.error('failed to heartbeat!'));
                    resolve(lock);
                }
            });
        }).then(lock => {
            resetAllSpies();
            expect(lock._heartbeatTimeout).to.be.ok;
            return new Promise((resolve, reject) => {
                lock.release(err => {
                    if (err) {
                        reject(err)
                    } else {
                        expect(lock._heartbeatTimeout).to.be.undefined;
                        resolve();
                    }
                });
            });
        }).then(lock => {
            expect(lock).to.be.undefined;

            expect(getSpy.callCount).to.eq(0, 'get called: no calls');
            expect(putSpy.callCount).to.eq(1, 'put called: check for existing lock');
            const guid = putSpy.lastCall.args[0].Item.guid;
            expect(putSpy.lastCall.args[0]).to.containSubset({
                "TableName": TABLE_NAME,
                "Item": {
                    "fencingToken": 1,
                    "leaseDurationMs": 1,
                    "owner": "me",
                    "guid": guid,
                    [PARTITION_KEY]: LOCK_ID,
                    [RANGE_KEY]: SUB_LOCK_ID
                },
                "ConditionExpression": "(attribute_exists(#partitionKey) and attribute_exists(#rangeKey)) and guid = :guid",
                "ExpressionAttributeNames": {
                    "#partitionKey": PARTITION_KEY,
                    "#rangeKey": RANGE_KEY
                },
                "ExpressionAttributeValues": {
                    ":guid": guid
                }
            });
            expect(deleteSpy.callCount).to.eq(0, 'delete called: no calls');
        }).catch(err => assert.fail(err));
    });
});
