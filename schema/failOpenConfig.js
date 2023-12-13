"use strict";

const Joi = require("@hapi/joi");

const schema = Joi.object().keys(
    {
        owner: Joi.string(),
        dynamodb: Joi.object().keys(
            {
                deleteItem: Joi.func().required(),
                getItem: Joi.func().required(),
                putItem: Joi.func().required()
            }
        ).unknown().required(),
        lockTable: Joi.string().required(),
        partitionKey: Joi.string().invalid("fencingToken", "leaseDurationMs", "lockAcquiredTimeUnixMs", "owner", "guid").required(),
        sortKey: Joi.string().invalid("fencingToken", "leaseDurationMs", "lockAcquiredTimeUnixMs", "owner", "guid"),
        heartbeatPeriodMs: Joi.number().integer().min(0),
        leaseDurationMs: Joi.number().integer().min(0).required(),
        trustLocalTime: Joi.boolean(),
        retryCount: Joi.number().integer().min(0)
    }
).required();

module.exports = schema;
