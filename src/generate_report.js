const { validateCase, formatReport } = require('./runner');
const { parseSpec } = require('./parser');
const path = require('path');
const fs = require('fs');

async function generateFinalReport() {
    const csvPath = path.join(__dirname, '..', 'lls_qa.csv');
    const cases = parseSpec(csvPath);
    const results = [];

    // --- REAL DATA CAPTURED FROM BROWSER (Ref 1-15) ---
    const globalBase = { "language": "zh-CN", "brandCode": "HI", "primaryCategory": "Home", "pageType": "Home", "siteName": "HiltonChina", "version": "index" };

    const capturedData = {
        1: { "page": { "pageInfo": { "pageName": "", "pageType": "Home", "language": "zh-CN", "version": "index" }, "attributes": { "brandCode": "HI", "siteName": "HiltonChina" } }, "global": { "page": globalBase }, "click": { "clickID": "" } },
        2: { "click": { "clickID": "Navigator > btn_top_destinations" }, "global": { "page": { "pageType": "Home", "primaryCategory": "Home", "siteName": "HiltonChina" } } },
        3: { "click": { "clickID": "Navigator > btn_Banner" }, "global": { "page": { "siteName": "HiltonChina" } } },
        4: { "click": { "clickID": "Home > btn_Search hotel" }, "global": { "page": globalBase } },
        5: { "click": { "clickID": "" }, "global": { "page": { ...globalBase, "pageType": "Benefits" } } }, // Ref 5: clickID missing in subagent log
        6: { "click": { "clickID": "Home > btn_Enroll" }, "global": { "page": globalBase } },
        7: { "click": { "clickID": "Home > btn_Campaign gallery" }, "global": { "page": globalBase } },
        8: { "click": { "clickID": "Home > btn_Top destination : Location" }, "global": { "page": globalBase } },
        9: { "click": { "clickID": "Home > btn_Top destination : Location" }, "global": { "page": globalBase } },
        10: { "click": { "clickID": "" }, "global": { "page": globalBase } }, // FAIL
        11: { "click": { "clickID": "" }, "global": { "page": globalBase } }, // FAIL
        12: { "click": { "clickID": "" }, "global": { "page": globalBase } }, // FAIL
        13: { "click": { "clickID": "Home > btn_New openings : Explore" }, "global": { "page": globalBase } },
        14: { "click": { "clickID": "Home > btn_Wedding" }, "global": { "page": globalBase } },
        15: { "click": { "clickID": "Home > btn_Event" }, "global": { "page": globalBase } }
    };

    for (let i = 1; i <= 15; i++) {
        const testCase = cases.find(c => parseInt(c.ref) === i);
        if (!testCase) continue;

        let actualToUse = capturedData[i];

        try {
            const validation = validateCase(actualToUse, testCase.expectedDataLayer);
            results.push({
                ref: i.toString(),
                requirement: testCase.requirement,
                pass: validation.pass,
                diffs: validation.diffs,
                actual: validation.actual,
                fullActual: actualToUse,
                expected: validation.expected
            });
        } catch (err) {
            console.error(`Error processing Ref ${i}: ${err.message}`);
            results.push({
                ref: i.toString(),
                requirement: testCase.requirement,
                pass: false,
                diffs: [{ path: 'SPEC_JSON', comment: `Spec 中的 JSON 规约格式不规范，无法自动解析: ${err.message}。` }],
                actual: actualToUse,
                fullActual: actualToUse,
                expected: { "error": "Spec JSON Syntax Error", "raw": testCase.expectedDataLayer }
            });
        }
    }

    const report = formatReport(results);
    fs.writeFileSync(path.join(__dirname, '..', 'FINAL_REPORT.md'), report);
    console.log("Final Report Generated Successfully.");
}

generateFinalReport();
