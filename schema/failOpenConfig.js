"use strict";

const Joi = require("@hapi/joi");

const schema = Joi.object().keys(
    {
        owner: Joi.string(),
        dynamodb: Joi.object().keys(
            {
                delete: Joi.func().required(),
                get: Joi.func().required(),
                put: Joi.func().required()
            }
        ).unknown().required(),
        lockTable: Joi.string().required(),
        partitionKey: Joi.string().invalid("fencingToken", "leaseDurationMs", "owner", "guid").required(),
        heartbeatPeriodMs: Joi.number().integer().min(0),
        leaseDurationMs: Joi.number().integer().min(0).required(),
        trustLocalTime: Joi.boolean(),
        retryCount: Joi.number().integer().min(0)
    }
).required();

module.exports = schema;
