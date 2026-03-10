const { validateCase, formatReport } = require('./runner');
const { parseSpec } = require('./parser');
const path = require('path');

async function validateRef1() {
    const csvPath = path.join(__dirname, '..', 'lls_qa.csv');
    const cases = parseSpec(csvPath);
    const ref1Case = cases.find(c => parseInt(c.ref) === 1);

    // This is the FULL digitalData captured from browser
    const fullActualData = {
        "click": { "clickID": "" },
        "component": [],
        "event": [],
        "global": {
            "page": {
                "attributes": {},
                "brandCode": "HI",
                "language": "zh-cn",
                "pageType": "Home",
                "primaryCategory": "Home",
                "siteName": "HiltonChina",
                "version": "index"
            },
            "property": { "attributes": {}, "propertyCode": "" }
        },
        "page": {
            "attributes": { "brandCode": "HI", "siteName": "HiltonChina" },
            "category": { "primaryCategory": "Home", "subCategory1": "" },
            "pageInfo": { "language": "zh-cn", "pageName": "", "pageType": "Home", "version": "index" }
        },
        "performance": { "total": 119006.3 }
    };

    const validation = validateCase(fullActualData, ref1Case.expectedDataLayer);

    const results = [{
        ref: 1,
        requirement: ref1Case.requirement,
        pass: validation.pass,
        diffs: validation.diffs,
        actual: validation.actual, // In this case, matched subset and full are similar in logic, but formatReport will use it.
        fullActual: fullActualData, // Passing full data for Slide 3
        expected: validation.expected
    }];

    const report = formatReport(results);
    console.log(report);
}

validateRef1();
