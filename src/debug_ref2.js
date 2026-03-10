const { parseSpec } = require('./parser');
const path = require('path');
const fs = require('fs');

const csvPath = path.join(__dirname, '..', 'lls_qa.csv');
const cases = parseSpec(csvPath);
const ref2 = cases.find(c => c.ref === '2');
fs.writeFileSync('debug_ref2.json', JSON.stringify(ref2, null, 2));
console.log('Written to debug_ref2.json');
