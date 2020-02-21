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
    self._dynamodb = self._config.dynamodb;
    self._lockTable = self._config.lockTable;
    self._partitionKey = self._config.partitionKey;
    self._rangeKey = self._config.rangeKey;
    self._acquirePeriodMs = self._config.acquirePeriodMs;
    self._retryCount = self._config.retryCount === undefined ? 1 : self._config.retryCount;
};

FailClosed.schema =
{
    config: require("./schema/failClosedConfig.js")
};

FailClosed.prototype.acquireLock = function(id, callback)
{
    const self = this;
    const workflow = new events.EventEmitter();
    setImmediate(() => workflow.emit("start",
        {
            id,
            owner: self._config.owner || `${pkg.name}@${pkg.version}_${os.userInfo().username}@${os.hostname()}`,
            retryCount: self._config.retryCount,
            guid: crypto.randomBytes(64)
        }
    ));
    workflow.on("start", dataBag => workflow.emit("acquire lock", dataBag));
    workflow.on("acquire lock", dataBag =>
        {
            const params =
            {
                TableName: self._lockTable,
                Item:
                {
                    owner: dataBag.owner,
                    guid: dataBag.guid
                },
                ConditionExpression: "attribute_not_exists(#partitionKey)",
                ExpressionAttributeNames:
                {
                    "#partitionKey": self._partitionKey
                }
            };
            params.Item[self._partitionKey] = dataBag.id;
            self._dynamodb.put(params, (error, data) =>
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
                            dynamodb: self._dynamodb,
                            failClosed: true,
                            id: dataBag.id,
                            lockTable: self._lockTable,
                            partitionKey: self._partitionKey,
                            guid: dataBag.guid,
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
            setTimeout(() => workflow.emit("acquire lock", dataBag), self._acquirePeriodMs);
        }
    );
};

function buildNegativeConditionExpression(self) {
    let expr = 'attribute_not_exists(#partitionKey)';
    if (self._rangeKey) {
        expr += ' and attribute_not_exists(#rangeKey)';
        return `(${expr})`;
    }
    return expr;
}

function buildPositiveConditionExpression(self) {
    let expr = 'attribute_exists(#partitionKey)';
    if (self._rangeKey) {
        expr += ' and attribute_exists(#rangeKey)';
        return `(${expr})`;
    }
    return expr;
}

function buildExpressionAttributeNames(self) {
    const names = {
        "#partitionKey": self._partitionKey
    };
    if (self._rangeKey) {
        names["#rangeKey"] = self._rangeKey;
    }
    return names;
}

const FailOpen = function(config)
{
    if(!(this instanceof FailOpen))
    {
        return new FailOpen(config);
    }
    const self = this;

    self._config = config;

    const configValidationResult = FailOpen.schema.config.validate( // partitionKey NOT in [leaseDurationMs, owner, guid]
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
    self._dynamodb = self._config.dynamodb;
    self._lockTable = self._config.lockTable;
    self._partitionKey = self._config.partitionKey;
    self._rangeKey = self._config.rangeKey;
    self._heartbeatPeriodMs = self._config.heartbeatPeriodMs;
    self._leaseDurationMs = self._config.leaseDurationMs;
    self._trustLocalTime = self._config.trustLocalTime;
    self._retryCount = self._config.retryCount === undefined ? 1 : self._config.retryCount;
};

FailOpen.schema =
{
    config: require("./schema/failOpenConfig.js")
};

FailOpen.prototype.acquireLock = function(id, callback)
{
    const self = this;
    let partitionKeyValue, rangeKeyValue;
    if (Object.getPrototypeOf(id).constructor === Array) {
        partitionKeyValue = id[0];
        rangeKeyValue = id[1];
    } else {
        partitionKeyValue = id;
    }
    const workflow = new events.EventEmitter();
    setImmediate(() => workflow.emit("start",
        {
            id: partitionKeyValue,
            subId: rangeKeyValue,
            owner: self._config.owner || `${pkg.name}@${pkg.version}_${os.userInfo().username}@${os.hostname()}`,
            retryCount: self._config.retryCount,
            guid: crypto.randomBytes(64)
        }
    ));
    workflow.on("start", dataBag => workflow.emit("check for existing lock", dataBag));
    workflow.on("check for existing lock", dataBag =>
        {
            const params =
            {
                TableName: self._lockTable,
                Key: {},
                ConsistentRead: true
            };
            params.Key[self._partitionKey] = dataBag.id;
            if (dataBag.subId) {
                params.Key[self._rangeKey] = dataBag.subId;
            }
            self._dynamodb.get(params, (error, data) =>
                {
                    if (error)
                    {
                        return callback(error);
                    }
                    if (!data.Item)
                    {
                        dataBag.fencingToken = 1;
                        return workflow.emit("acquire new lock", dataBag);
                    }
                    dataBag.lock = data.Item;
                    dataBag.fencingToken = dataBag.lock.fencingToken + 1;
                    const leaseDurationMs = parseInt(dataBag.lock.leaseDurationMs);
                    let timeout;
                    if (self._trustLocalTime)
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
                TableName: self._lockTable,
                Item:
                {
                    fencingToken: dataBag.fencingToken,
                    leaseDurationMs: self._leaseDurationMs,
                    owner: dataBag.owner,
                    guid: dataBag.guid
                },
                ConditionExpression: buildNegativeConditionExpression(self),
                ExpressionAttributeNames: buildExpressionAttributeNames(self)
            };
            if (self._trustLocalTime)
            {
                params.Item.lockAcquiredTimeUnixMs = (new Date()).getTime();
            }
            params.Item[self._partitionKey] = dataBag.id;
            if (dataBag.subId) {
                params.Item[self._rangeKey] = dataBag.subId;
            }
            self._dynamodb.put(params, (error, data) =>
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
                TableName: self._lockTable,
                Item:
                {
                    fencingToken: dataBag.fencingToken,
                    leaseDurationMs: self._leaseDurationMs,
                    owner: dataBag.owner,
                    guid: dataBag.guid
                },
                ConditionExpression: `${buildNegativeConditionExpression(self)} or (guid = :guid and fencingToken = :fencingToken)`,
                ExpressionAttributeNames: buildExpressionAttributeNames(self),
                ExpressionAttributeValues:
                {
                    ":fencingToken": dataBag.lock.fencingToken,
                    ":guid": dataBag.lock.guid
                }
            };
            if (self._trustLocalTime)
            {
                params.Item.lockAcquiredTimeUnixMs = (new Date()).getTime();
            }
            params.Item[self._partitionKey] = dataBag.id;
            if (dataBag.subId) {
                params.Item[self._rangeKey] = dataBag.subId;
            }
            self._dynamodb.put(params, (error, data) =>
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
                    dynamodb: self._dynamodb,
                    fencingToken: dataBag.fencingToken,
                    guid: dataBag.guid,
                    heartbeatPeriodMs: self._heartbeatPeriodMs,
                    id: dataBag.id,
                    subId: dataBag.subId,
                    leaseDurationMs: self._leaseDurationMs,
                    lockTable: self._lockTable,
                    owner: dataBag.owner,
                    partitionKey: self._partitionKey,
                    rangeKey: self._rangeKey,
                    trustLocalTime: self._trustLocalTime,
                    type: FailOpen
                }
            ));
        }
    );
};

const Lock = function(config)
{
    const self = this;
    events.EventEmitter.call(self);

    self._config = config;
    self._dynamodb = self._config.dynamodb;
    self._failClosed = self._config.failClosed;
    self._fencingToken = self._config.fencingToken;
    self._guid = self._config.guid;
    self._heartbeatPeriodMs = self._config.heartbeatPeriodMs;
    self._id = self._config.id;
    self._subId = self._config.subId;
    self._leaseDurationMs = self._config.leaseDurationMs;
    self._lockTable = self._config.lockTable;
    self._owner = self._config.owner;
    self._partitionKey = self._config.partitionKey;
    self._rangeKey = self._config.rangeKey;
    self._released = false;
    self._trustLocalTime = self._config.trustLocalTime;
    self._type = self._config.type;

    self.fencingToken = self._fencingToken;

    if (self._heartbeatPeriodMs)
    {
        const refreshLock = function()
        {
            const newGuid = crypto.randomBytes(64);
            const params =
            {
                TableName: self._lockTable,
                Item:
                {
                    fencingToken: self._fencingToken,
                    leaseDurationMs: self._leaseDurationMs,
                    owner: self._owner,
                    guid: newGuid
                },
                ConditionExpression: `${buildPositiveConditionExpression(self)} and guid = :guid`,
                ExpressionAttributeNames: buildExpressionAttributeNames(self),
                ExpressionAttributeValues:
                {
                    ":guid": self._guid
                }
            };
            if (self._trustLocalTime)
            {
                params.Item.lockAcquiredTimeUnixMs = (new Date()).getTime();
            }
            params.Item[self._partitionKey] = self._id;
            if (self._subId) {
                params.Item[self._rangeKey] = self._subId;
            }
            self._dynamodb.put(params, (error, data) =>
                {
                    if (error)
                    {
                        return self.emit("error", error);
                    }
                    self._guid = newGuid;
                    if (!self._released) // See https://github.com/tristanls/dynamodb-lock-client/issues/1
                    {
                        self._heartbeatTimeout = setTimeout(refreshLock, self._heartbeatPeriodMs);
                    }
                }
            );
        };
        self._heartbeatTimeout = setTimeout(refreshLock, self._heartbeatPeriodMs);
    }
};

util.inherits(Lock, events.EventEmitter);

Lock.prototype.release = function(callback)
{
    const self = this;
    self._released = true;
    if (self._heartbeatTimeout)
    {
        clearTimeout(self._heartbeatTimeout);
        self._heartbeatTimeout = undefined;
    }
    if (self._type == FailOpen)
    {
        return self._releaseFailOpen(callback);
    }
    else
    {
        return self._releaseFailClosed(callback);
    }
};

Lock.prototype._releaseFailClosed = function(callback)
{
    const self = this;
    const params =
    {
        TableName: self._lockTable,
        Key: {},
        ConditionExpression: `${buildPositiveConditionExpression(self)} and guid = :guid`,
        ExpressionAttributeNames: buildExpressionAttributeNames(self),
        ExpressionAttributeValues:
        {
            ":guid": self._guid
        }
    };
    params.Key[self._partitionKey] = self._id;
    if (self._subId) {
        params.Key[self._rangeKey] = self._subId;
    }
    self._dynamodb.delete(params, (error, data) =>
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

Lock.prototype._releaseFailOpen = function(callback)
{
    const self = this;
    const params =
    {
        TableName: self._lockTable,
        Item:
        {
            fencingToken: self._fencingToken,
            leaseDurationMs: 1,
            owner: self._owner,
            guid: self._guid
        },
        ConditionExpression: `${buildPositiveConditionExpression(self)} and guid = :guid`,
        ExpressionAttributeNames: buildExpressionAttributeNames(self),
        ExpressionAttributeValues:
        {
            ":guid": self._guid
        }
    };
    if (self._trustLocalTime)
    {
        params.Item.lockAcquiredTimeUnixMs = (new Date()).getTime();
    }
    params.Item[self._partitionKey] = self._id;
    if (self._subId) {
        params.Item[self._rangeKey] = self._subId;
    }
    self._dynamodb.put(params, (error, data) =>
        {
            if (error && error.code === "ConditionalCheckFailedException")
            {
                // another process may have claimed lock already
                return callback();
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
