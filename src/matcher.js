/**
 * Smart Matcher for deep object comparison between actual and expected Data Layer.
 */

function deepCompare(actual, expected, path = '') {
    const results = [];

    // If expected is a placeholder string
    if (typeof expected === 'string') {
        const placeholderRegex = /\{dynamic\}|\{CTYHOCN\}|\{Hotel Brand\}|\{Dynamic\}|\{HotelBrand\}|\{search_page\}|\{Dynamic campaign name\}/i;
        if (placeholderRegex.test(expected)) {
            const isValid = actual !== undefined && actual !== null && actual !== '';
            results.push({
                path,
                actual,
                expected,
                match: isValid,
                comment: isValid ? 'Placeholder match' : 'Missing required dynamic value'
            });
            return results;
        }

        // Literal string match - CRITICAL: Strict case-sensitivity (大小写差异不忽略)
        const match = actual === expected;
        results.push({
            path,
            actual,
            expected,
            match,
            comment: match ? 'Exact match' : `Value mismatch (Expected "${expected}", Got "${actual}")`
        });
        return results;
    }

    // If expected is not an object (primitive), direct compare
    if (expected === null || typeof expected !== 'object') {
        const match = actual === expected;
        results.push({
            path,
            actual,
            expected,
            match,
            comment: match ? 'Exact match' : 'Value mismatch'
        });
        return results;
    }

    // If expected is an object, recurse
    for (const key in expected) {
        const currentPath = path ? `${path}.${key}` : key;

        // Ensure key exists in actual - actual can have MORE keys, but must have these
        if (actual === null || typeof actual !== 'object' || !(key in actual)) {
            results.push({
                path: currentPath,
                actual: undefined,
                expected: expected[key],
                match: false,
                comment: 'Required field missing in actual data'
            });
        } else {
            results.push(...deepCompare(actual[key], expected[key], currentPath));
        }
    }
    return results;
}

/**
 * Orchestrates the comparison and prepares the report data.
 */
function validateCase(actual, expected) {
    // Basic cleanup: if actual is string, try to parse
    let jsonObjActual = actual;
    if (typeof actual === 'string') {
        try { jsonObjActual = JSON.parse(actual); } catch (e) { }
    }

    let jsonObjExpected = expected;
    if (typeof expected === 'string') {
        // More robust eval for the spec data since it might be JS-like but not strict JSON
        try {
            // Using Function constructor is safer than eval for string-to-object
            const fn = new Function(`return ${expected}`);
            jsonObjExpected = fn();
        } catch (e) {
            console.error(`Error parsing expected JSON: ${e.message}`);
            return { pass: false, errors: [{ path: 'ROOT', comment: 'Invalid expected data format' }] };
        }
    }

    const diffs = deepCompare(jsonObjActual, jsonObjExpected);
    const pass = diffs.every(d => d.match);

    return {
        pass,
        actual: jsonObjActual,
        expected: jsonObjExpected,
        diffs
    };
}

module.exports = { validateCase };
