"use strict";

module.exports = (done, count) =>
{
    let doneCount = 0;
    return () =>
    {
        doneCount++;
        if (doneCount == count)
        {
            done();
        }
    }
};
