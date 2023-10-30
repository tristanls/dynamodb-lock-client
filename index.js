"use strict";

const crypto = require("crypto");
const events = require("events");
const Joi = require("@hapi/joi");
const os = require("os");
const pkg = require("./package.json");
const util = require("util");

const FailClosed = function(config)
{
    if(!(this instanceof FailClosed))
    {
        return new FailClosed(config);
    }
    const self = this;

    // constant configuration
    self._config = config;

    const configValidationResult = FailClosed.schema.config.validate(
        self._config,
        {
            abortEarly: false,
            convert: false
        }
    );
    if (configValidationResult.error)
    {
        throw configValidationResult.error;
    }
    self._retryCount = self._config.retryCount === undefined ? 1 : self._config.retryCount;
};

FailClosed.schema =
{
    config: require("./schema/failClosedConfig.js")
};

FailClosed.prototype.acquireLock = function(id, callback)
{
    const self = this;
    let partitionID, sortID;
    if (typeof id === "object")
    {
        partitionID = id[self._config.partitionKey];
        sortID = id[self._config.sortKey];
    }
    else
    {
        partitionID = id;
    }
    if (self._config.sortKey && sortID === undefined)
    {
        return callback(new Error("Lock ID is missing required sortKey value"));
    }
    const workflow = new events.EventEmitter();
    // Register workflow event handlers
    workflow.on("start", dataBag => workflow.emit("acquire lock", dataBag));
    workflow.on("acquire lock", dataBag =>
        {
            const params =
            {
                TableName: self._config.lockTable,
                Item:
                {
                    [self._config.partitionKey]: dataBag.partitionID,
                    ownerName: dataBag.ownerName,
                    recordVersionNumber: dataBag.recordVersionNumber
                },
                ConditionExpression: buildAttributeNotExistsExpression(self),
                ExpressionAttributeNames: buildExpressionAttributeNames(self)
            };
            if (self._config.sortKey)
            {
                params.Item[self._config.sortKey] = dataBag.sortID;
            }
            self._config.dynamodb.put(params, (error, data) =>
                {
                    if (error)
                    {
                        if (error.code === "ConditionalCheckFailedException")
                        {
                            if (dataBag.retryCount > 0)
                            {
                                return workflow.emit("retry acquire lock", dataBag);
                            }
                            else
                            {
                                const err = new Error("Failed to acquire lock.");
                                err.code = "FailedToAcquireLock";
                                err.originalError = error;
                                return callback(err);
                            }
                        }
                        return callback(error);
                    }
                    return callback(undefined, new Lock(
                        {
                            dynamodb: self._config.dynamodb,
                            recordVersionNumber: dataBag.recordVersionNumber,
                            lockTable: self._config.lockTable,
                            partitionID: dataBag.partitionID,
                            partitionKey: self._config.partitionKey,
                            sortID: dataBag.sortID,
                            sortKey: self._config.sortKey,
                            leaseUnit: self._config.leaseUnit,
                            type: FailClosed
                        }
                    ));
                }
            );
        }
    );
    workflow.on("retry acquire lock", dataBag =>
        {
            dataBag.retryCount--;
            setTimeout(() => workflow.emit("acquire lock", dataBag), self._config.acquirePeriodMs);
        }
    );
    // Start the workflow
    workflow.emit("start",
        {
            partitionID,
            sortID,
            ownerName: self._config.ownerName || `${pkg.name}@${pkg.version}_${os.userInfo().username}@${os.hostname()}`,
            retryCount: self._retryCount,
            recordVersionNumber: crypto.randomBytes(64)
        }
    )
};

function buildAttributeExistsExpression(self)
{
    let expr = "attribute_exists(#partitionKey)";
    if (self._config.sortKey)
    {
        expr += " and attribute_exists(#sortKey)";
        return `(${expr})`;
    }
    return expr;
}

function buildAttributeNotExistsExpression(self)
{
    let expr = "attribute_not_exists(#partitionKey)";
    if (self._config.sortKey)
    {
        expr += " and attribute_not_exists(#sortKey)";
        return `(${expr})`;
    }
    return expr;
}

function buildExpressionAttributeNames(self)
{
    const names =
    {
        "#partitionKey": self._config.partitionKey
    };
    if (self._config.sortKey)
    {
        names["#sortKey"] = self._config.sortKey;
    }
    return names;
}

function getMsForLease(time, unit) {
    switch (unit) {
        case "milliseconds":
            return time;
        case "seconds":
            return time * 1000;
        case "minutes":
            return time * 1000 * 60;
        case "hours":
            return time * 1000 * 60 * 60;
        case "days":
            return time * 1000 * 60 * 60 * 24;
        default:
            throw new Error(`Invalid lease unit: ${unit}`);
    }
}

const FailOpen = function(config)
{
    if(!(this instanceof FailOpen))
    {
        return new FailOpen(config);
    }
    const self = this;

    // constant configuration
    self._config = config;

    const configValidationResult = FailOpen.schema.config.validate(
        self._config,
        {
            abortEarly: false,
            convert: false
        }
    );
    if (configValidationResult.error)
    {
        throw configValidationResult.error;
    }
    self._retryCount = self._config.retryCount === undefined ? 1 : self._config.retryCount;
};

FailOpen.schema =
{
    config: require("./schema/failOpenConfig.js")
};

FailOpen.prototype.acquireLock = function(id, callback)
{
    const self = this;
    let partitionID, sortID;
    if (typeof id === "object")
    {
        partitionID = id[self._config.partitionKey];
        sortID = id[self._config.sortKey];
    }
    else
    {
        partitionID = id;
    }
    if (self._config.sortKey && sortID === undefined)
    {
        return callback(new Error("Lock ID is missing required sortKey value"));
    }
    const workflow = new events.EventEmitter();
    // Register workflow event handlers
    workflow.on("start", dataBag => workflow.emit("check for existing lock", dataBag));
    workflow.on("check for existing lock", dataBag =>
        {
            const params =
            {
                TableName: self._config.lockTable,
                Key:
                {
                    [self._config.partitionKey]: dataBag.partitionID
                },
                ConsistentRead: true
            };
            if (self._config.sortKey)
            {
                params.Key[self._config.sortKey] = dataBag.sortID;
            }
            self._config.dynamodb.get(params, (error, data) =>
                {
                    if (error)
                    {
                        return callback(error);
                    }
                    if (!data.Item)
                    {
                        return workflow.emit("acquire new lock", dataBag);
                    }
                    dataBag.lock = data.Item;
                    const leaseDurationMs = parseInt(dataBag.lock.leaseDuration) || 10000; // Lease durations are stored in milliseconds in DynamoDB
                    let timeout;
                    if (self._config.trustLocalTime)
                    {
                        const lockAcquiredTimeUnixMs = parseInt(dataBag.lock.lockAcquiredTimeUnixMs);
                        const localTimeUnixMs = (new Date()).getTime();
                        timeout = Math.max(0, leaseDurationMs - (localTimeUnixMs - lockAcquiredTimeUnixMs));
                    }
                    else
                    {
                        timeout = leaseDurationMs;
                    }
                    return setTimeout(
                        () => workflow.emit("acquire existing lock", dataBag),
                        timeout
                    );
                }
            );
        }
    );
    workflow.on("acquire new lock", dataBag =>
        {
            const params =
            {
                TableName: self._config.lockTable,
                Item:
                {
                    [self._config.partitionKey]: dataBag.partitionID,
                    leaseDuration: getMsForLease(self._config.leaseDuration || 10000, self._config.leaseUnit).toString(),
                    ownerName: dataBag.ownerName,
                    recordVersionNumber: dataBag.recordVersionNumber
                },
                ConditionExpression: buildAttributeNotExistsExpression(self),
                ExpressionAttributeNames: buildExpressionAttributeNames(self)
            };
            if (self._config.trustLocalTime)
            {
                params.Item.lockAcquiredTimeUnixMs = (new Date()).getTime();
            }
            if (dataBag.sortID)
            {
                params.Item[self._config.sortKey] = dataBag.sortID;
            }
            self._config.dynamodb.put(params, (error, data) =>
                {
                    if (error)
                    {
                        if (error.code === "ConditionalCheckFailedException")
                        {
                            if (dataBag.retryCount > 0)
                            {
                                dataBag.retryCount--;
                                return workflow.emit("check for existing lock", dataBag);
                            }
                            else
                            {
                                const err = new Error("Failed to acquire lock.");
                                err.code = "FailedToAcquireLock";
                                err.originalError = error;
                                return callback(err);
                            }
                        }
                        return callback(error);
                    }
                    return workflow.emit("configure acquired lock", dataBag);
                }
            );
        }
    );
    workflow.on("acquire existing lock", dataBag =>
        {
            const params =
            {
                TableName: self._config.lockTable,
                Item:
                {
                    [self._config.partitionKey]: dataBag.partitionID,
                    leaseDuration: getMsForLease(self._config.leaseDuration || 10000, self._config.leaseUnit).toString(),
                    ownerName: dataBag.ownerName,
                    recordVersionNumber: dataBag.recordVersionNumber
                },
                ConditionExpression: `${buildAttributeNotExistsExpression(self)} or (recordVersionNumber = :recordVersionNumber)`,
                ExpressionAttributeNames: buildExpressionAttributeNames(self),
                ExpressionAttributeValues:
                {
                    ":recordVersionNumber": dataBag.lock.recordVersionNumber
                }
            };
            if (self._config.trustLocalTime)
            {
                params.Item.lockAcquiredTimeUnixMs = (new Date()).getTime();
            }
            if (dataBag.sortID)
            {
                params.Item[self._config.sortKey] = dataBag.sortID;
            }
            self._config.dynamodb.put(params, (error, data) =>
                {
                    if (error)
                    {
                        if (error.code === "ConditionalCheckFailedException")
                        {
                            if (dataBag.retryCount > 0)
                            {
                                dataBag.retryCount--;
                                return workflow.emit("check for existing lock", dataBag);
                            }
                            else
                            {
                                const err = new Error("Failed to acquire lock.");
                                err.code = "FailedToAcquireLock";
                                err.originalError = error;
                                return callback(err);
                            }
                        }
                        return callback(error);
                    }
                    return workflow.emit("configure acquired lock", dataBag);
                }
            );
        }
    );
    workflow.on("configure acquired lock", dataBag =>
        {
            return callback(undefined, new Lock(
                {
                    dynamodb: self._config.dynamodb,
                    recordVersionNumber: dataBag.recordVersionNumber,
                    heartbeatPeriodMs: self._config.heartbeatPeriodMs,
                    leaseDuration: self._config.leaseDuration || 10000,
                    leaseUnit: self._config.leaseUnit,
                    lockTable: self._config.lockTable,
                    ownerName: dataBag.ownerName,
                    partitionID: dataBag.partitionID,
                    partitionKey: self._config.partitionKey,
                    sortID: dataBag.sortID,
                    sortKey: self._config.sortKey,
                    trustLocalTime: self._config.trustLocalTime,
                    type: FailOpen
                }
            ));
        }
    );
    // Start the workflow
    workflow.emit("start",
        {
            partitionID,
            sortID,
            ownerName: self._config.ownerName || `${pkg.name}@${pkg.version}_${os.userInfo().username}@${os.hostname()}`,
            retryCount: self._retryCount,
            recordVersionNumber: crypto.randomBytes(64)
        }
    )
};

const Lock = function(config)
{
    const self = this;
    events.EventEmitter.call(self);

    // constant Lock configuration
    self._config = config;

    // variable properties
    self._recordVersionNumber = self._config.recordVersionNumber;
    self._released = false;

    // public properties

    if (self._config.heartbeatPeriodMs)
    {
        const refreshLock = function()
        {
            const newGuid = crypto.randomBytes(64);
            const params =
            {
                TableName: self._config.lockTable,
                Item:
                {
                    [self._config.partitionKey]: self._config.partitionID,
                    leaseDuration: getMsForLease(self._config.leaseDuration || 10000, self._config.leaseUnit).toString(),
                    ownerName: self._config.ownerName,
                    recordVersionNumber: newGuid
                },
                ConditionExpression: `${buildAttributeExistsExpression(self)} and recordVersionNumber = :recordVersionNumber`,
                ExpressionAttributeNames: buildExpressionAttributeNames(self),
                ExpressionAttributeValues:
                {
                    ":recordVersionNumber": self._recordVersionNumber
                }
            };
            if (self._config.trustLocalTime)
            {
                params.Item.lockAcquiredTimeUnixMs = (new Date()).getTime();
            }
            if (self._config.sortKey)
            {
                params.Item[self._config.sortKey] = self._config.sortID;
            }
            self._config.dynamodb.put(params, (error, data) =>
                {
                    if (error)
                    {
                        return self.emit("error", error);
                    }
                    self._recordVersionNumber = newGuid;
                    if (!self._released) // See https://github.com/tristanls/dynamodb-lock-client/issues/1
                    {
                        self.heartbeatTimeout = setTimeout(refreshLock, self._config.heartbeatPeriodMs);
                    }
                }
            );
        };
        self.heartbeatTimeout = setTimeout(refreshLock, self._config.heartbeatPeriodMs);
    }
};

util.inherits(Lock, events.EventEmitter);

Lock.prototype.release = function(callback)
{
    const self = this;
    self._released = true;
    if (self.heartbeatTimeout)
    {
        clearTimeout(self.heartbeatTimeout);
        self.heartbeatTimeout = undefined;
    }
    const params =
    {
        TableName: self._config.lockTable,
        Key:
        {
            [self._config.partitionKey]: self._config.partitionID
        },
        ConditionExpression: `${buildAttributeExistsExpression(self)} and recordVersionNumber = :recordVersionNumber`,
        ExpressionAttributeNames: buildExpressionAttributeNames(self),
        ExpressionAttributeValues:
        {
            ":recordVersionNumber": self._recordVersionNumber
        }
    };
    if (self._config.sortKey)
    {
        params.Key[self._config.sortKey] = self._config.sortID;
    }
    self._config.dynamodb.delete(params, (error, data) =>
        {
            if (error && error.code === "ConditionalCheckFailedException")
            {
                const err = new Error("Failed to release lock.");
                err.code = "FailedToReleaseLock";
                err.originalError = error;
                return callback(err);
            }
            return callback(error);
        }
    );
};

module.exports =
{
    FailClosed,
    FailOpen,
    Lock
};
