"use strict";

const Joi = require("@hapi/joi");

const schema = Joi.object().keys(
    {
        ownerName: Joi.string(),
        dynamodb: Joi.object().keys(
            {
                delete: Joi.func().required(),
                get: Joi.func().required(),
                put: Joi.func().required()
            }
        ).unknown().required(),
        lockTable: Joi.string().required(),
        partitionKey: Joi.string().invalid("leaseDuration", "lockAcquiredTimeUnixMs", "ownerName", "recordVersionNumber").required(),
        sortKey: Joi.string().invalid("leaseDuration", "lockAcquiredTimeUnixMs", "ownerName", "recordVersionNumber"),
        heartbeatPeriodMs: Joi.number().integer().min(0),
        leaseDuration: Joi.number().integer().min(0).required(),
        leaseUnit: Joi.string().valid("milliseconds", "seconds", "minutes", "hours", "days").required(),
        trustLocalTime: Joi.boolean(),
        retryCount: Joi.number().integer().min(0)
    }
).required();

module.exports = schema;
