"use strict";

const Joi = require("joi");

const schema = Joi.object().keys(
    {
        dynamodb: Joi.object().keys(
            {
                delete: Joi.func().required(),
                get: Joi.func().required(),
                put: Joi.func().required()
            }
        ).unknown().required(),
        lockTable: Joi.string().required(),
        partitionKey: Joi.string().required(),
        acquirePeriodMs: Joi.number().integer().min(0).required()
    }
).required();

module.exports = schema;
