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
        partitionKey: Joi.string().invalid("owner", "guid").required(),
        sortKey: Joi.string().invalid("owner", "guid").required(),
        acquirePeriodMs: Joi.number().integer().min(0).required(),
        retryCount: Joi.number().integer().min(0)
    }
).required();

module.exports = schema;
