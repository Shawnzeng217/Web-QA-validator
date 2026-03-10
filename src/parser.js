const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

/**
 * Parses the lls_qa.csv file and extracts test cases for Ref 1-15.
 */
function parseSpec(filePath) {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
    });

    const testCases = records
        .filter(row => {
            const ref = parseInt(row.ref);
            return ref >= 1 && ref <= 15;
        })
        .map(row => {
            return {
                ref: row.ref,
                location: row.Location,
                section: row.Section,
                requirement: row.Requirement,
                description: row.Description,
                implementNotes: row['Implement Notes'],
                expectedDataLayerRaw: row['Data layer'],
                expectedDataLayer: cleanDataLayer(row['Data layer'])
            };
        });

    return testCases;
}

/**
 * Cleans the "Data layer" column to extract a valid JSON object.
 * Handles script tags, comments, and common typos.
 */
function cleanDataLayer(raw) {
    if (!raw) return null;

    // Remove script tags
    let cleaned = raw.replace(/<script.*?>/gi, '')
        .replace(/<\/script>/gi, '')
        .replace(/var digitalData = /gi, '')
        .trim();

    // Remove single-line JS comments (// ...)
    cleaned = cleaned.replace(/\/\/.*$/gm, '');

    // Remove multi-line JS comments (/* ... */)
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');

    // Remove trailing semicolons
    cleaned = cleaned.replace(/;+$/, '');

    // Fix typos like <<script
    cleaned = cleaned.replace(/^<+/, '');

    return cleaned.trim();
}

module.exports = { parseSpec };

// Simple test run
if (require.main === module) {
    const csvPath = path.join(__dirname, '..', 'lls_qa.csv');
    const cases = parseSpec(csvPath);
    console.log(JSON.stringify(cases, null, 2));
}
