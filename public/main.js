// Using global Papa from CDN

// ============================================
// 1. MATCHER LOGIC (Ported for Browser)
// ============================================

function deepCompare(actual, expected, path = '') {
    const results = [];

    if (typeof expected === 'string') {
        const placeholderRegex = /\{dynamic\}|\{CTYHOCN\}|\{Hotel Brand\}|\{Dynamic\}|\{HotelBrand\}|\{search_page\}|\{Dynamic campaign name\}/i;
        if (placeholderRegex.test(expected)) {
            const isValid = actual !== undefined && actual !== null && actual !== '';
            results.push({ path, actual, expected, match: isValid, comment: isValid ? 'Placeholder match' : 'Missing required dynamic value' });
            return results;
        }

        const match = actual === expected;
        results.push({ path, actual, expected, match, comment: match ? 'Exact match' : `Value mismatch (Expected "${expected}", Got "${actual}")` });
        return results;
    }

    if (expected === null || typeof expected !== 'object') {
        const match = actual === expected;
        results.push({ path, actual, expected, match, comment: match ? 'Exact match' : 'Value mismatch' });
        return results;
    }

    for (const key in expected) {
        const currentPath = path ? `${path}.${key}` : key;
        if (actual === null || typeof actual !== 'object' || !(key in actual)) {
            results.push({ path: currentPath, actual: undefined, expected: expected[key], match: false, comment: 'Required field missing in actual data' });
        } else {
            results.push(...deepCompare(actual[key], expected[key], currentPath));
        }
    }
    return results;
}

function validateCase(actual, expected) {
    let jsonObjActual = actual;
    if (typeof actual === 'string') {
        try { jsonObjActual = JSON.parse(actual); } catch (e) { }
    }

    let jsonObjExpected = expected;
    if (typeof expected === 'string') {
        try {
            const fn = new Function(`return ${expected}`);
            jsonObjExpected = fn();
        } catch (e) {
            console.error(`Error parsing expected JSON: ${e.message}`);
            return { pass: false, errors: [{ path: 'ROOT', comment: 'Invalid expected data format' }] };
        }
    }

    const diffs = deepCompare(jsonObjActual, jsonObjExpected);
    const pass = diffs.every(d => d.match);

    return { pass, actual: jsonObjActual, expected: jsonObjExpected, diffs };
}

// ============================================
// 2. CSV PARSER LOGIC
// ============================================

function cleanDataLayer(raw) {
    if (!raw) return null;
    let cleaned = raw.replace(/<script.*?>/gi, '')
        .replace(/<\/script>/gi, '')
        .replace(/var digitalData = /gi, '')
        .trim();
    cleaned = cleaned.replace(/\/\/.*$/gm, '');
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
    cleaned = cleaned.replace(/;+$/, '');
    cleaned = cleaned.replace(/^<+/, '');
    return cleaned.trim();
}

// ============================================
// 3. UI STATE & BINDINGS
// ============================================

let testCases = [];
let selectedCase = null;

const elements = {
    csvUpload: document.getElementById('csv-upload'),
    csvFilename: document.getElementById('csv-filename'),
    refSelect: document.getElementById('ref-select'),
    reqPreview: document.getElementById('req-preview'),
    baseUrl: document.getElementById('base-url'),
    loadingOverlay: document.getElementById('loading-overlay'),
    validateBtn: document.getElementById('validate-btn'),
    resultsSection: document.getElementById('results-section'),
    statusBadge: document.getElementById('status-badge'),
    resultsContent: document.getElementById('results-content'),
    step2: document.getElementById('step-2'),
    step3: document.getElementById('step-3')
};

// Handle CSV Upload
elements.csvUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    elements.csvFilename.textContent = file.name;

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function (results) {
            testCases = results.data
                .filter(row => {
                    const ref = parseInt(row.ref || row.Ref);
                    return ref >= 1 && ref <= 15;
                })
                .map(row => ({
                    ref: row.ref || row.Ref,
                    location: row.Location,
                    section: row.Section,
                    requirement: row.Requirement,
                    description: row.Description,
                    expectedDataLayer: cleanDataLayer(row['Data layer'])
                }));

            populateRefSelect();
            elements.step2.style.opacity = '1';
            elements.step2.style.pointerEvents = 'auto';
        }
    });
});

// Populate Select Dropdown
function populateRefSelect() {
    elements.refSelect.innerHTML = '<option value="">-- Select Requirement (Ref) --</option>';
    testCases.forEach(tc => {
        const opt = document.createElement('option');
        opt.value = tc.ref;
        opt.textContent = `Ref ${tc.ref}: ${tc.requirement || 'No Requirement Name'}`;
        elements.refSelect.appendChild(opt);
    });
}

// Handle Ref Selection
elements.refSelect.addEventListener('change', (e) => {
    const refId = e.target.value;
    selectedCase = testCases.find(tc => String(tc.ref) === String(refId));

    if (selectedCase) {
        elements.reqPreview.style.display = 'block';
        elements.reqPreview.innerHTML = `
            <div style="margin-bottom: 8px;">
                <strong>Location:</strong> ${selectedCase.location || 'N/A'}<br/>
                <strong>Requirement:</strong> ${selectedCase.requirement || 'N/A'}
            </div>
            <strong style="color: var(--primary-blue); display:block; margin-top:12px; margin-bottom: 4px; font-size: 0.85rem;">Expected Data Layer Spec:</strong>
            <div class="json-block" style="font-size: 0.8rem; padding: 0.75rem;">${selectedCase.expectedDataLayer}</div>
        `;
        elements.step3.style.opacity = '1';
        elements.step3.style.pointerEvents = 'auto';
        checkReady();
    } else {
        elements.reqPreview.style.display = 'none';
        elements.step3.style.opacity = '0.5';
        elements.step3.style.pointerEvents = 'none';
        elements.validateBtn.disabled = true;
    }
});

elements.baseUrl.addEventListener('input', checkReady);

function checkReady() {
    if (selectedCase && elements.baseUrl.value.trim().length > 10) {
        elements.validateBtn.disabled = false;
    } else {
        elements.validateBtn.disabled = true;
    }
}

// Handle Validation
elements.validateBtn.addEventListener('click', async () => {
    const rawUrl = elements.baseUrl.value.trim();
    if (!rawUrl || !selectedCase) return;

    elements.validateBtn.innerHTML = 'VALIDATING...';
    elements.validateBtn.disabled = true;
    elements.loadingOverlay.style.display = 'block';

    const statusText = elements.loadingOverlay.querySelector('p');
    const stages = [
        '🚀 Initializing Hilton Validation Agent...',
        '🌐 Connecting to Target Environment...',
        '🧠 Analyzing Page Structure...',
        '🔍 Extracting DigitalData Objects...',
        '📊 Comparing against Spec Requirements...'
    ];

    let stageIdx = 0;
    const statusInterval = setInterval(() => {
        if (stageIdx < stages.length) {
            statusText.textContent = stages[stageIdx++];
        }
    }, 2500);

    // Hide previous results
    elements.resultsSection.style.display = 'none';

    try {
        const response = await fetch('http://localhost:3000/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: rawUrl,
                ref: selectedCase.ref
            })
        });

        const resultData = await response.json();

        if (!response.ok) {
            throw new Error(resultData.error || 'Failed to extract data');
        }

        const actualData = resultData.data;
        const result = validateCase(actualData, selectedCase.expectedDataLayer);

        clearInterval(statusInterval);
        renderReport(result);

        elements.resultsSection.style.display = 'block';
        elements.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (error) {
        alert('Extraction failed: ' + error.message);
        console.error(error);
    } finally {
        if (typeof statusInterval !== 'undefined') clearInterval(statusInterval);
        elements.validateBtn.innerHTML = 'RUN VALIDATION';
        elements.validateBtn.disabled = false;
        elements.loadingOverlay.style.display = 'none';
    }
});

// Render Report HTML
function renderJsonWithHighlights(obj, errorPaths = [], parentPath = '') {
    if (obj === null) return `<span style="color: #94a3b8">null</span>`;
    if (typeof obj !== 'object') {
        let color = '#ec4899'; // string
        if (typeof obj === 'number') color = '#10b981';
        if (typeof obj === 'boolean') color = '#f59e0b';
        return `<span style="color: ${color}">${escapeHtml(JSON.stringify(obj))}</span>`;
    }

    const isArray = Array.isArray(obj);
    let html = isArray ? '[' : '{';
    const keys = Object.keys(obj);

    if (keys.length === 0) return html + (isArray ? ']' : '}');

    html += '<div style="padding-left: 20px;">';
    keys.forEach((key, index) => {
        const fullPath = parentPath ? `${parentPath}.${key}` : key;
        const isError = errorPaths.includes(fullPath);

        html += `<div class="json-line ${isError ? 'json-highlight' : ''}">`;
        if (!isArray) {
            html += `<span style="color: #60a5fa">"${key}"</span>: `;
        }

        // Handle nested
        html += renderJsonWithHighlights(obj[key], errorPaths, isArray ? `${parentPath}[${index}]` : fullPath);

        if (index < keys.length - 1) html += ',';
        html += '</div>';
    });
    html += '</div>';
    html += isArray ? ']' : '}';
    return html;
}

function escapeHtml(text) {
    if (typeof text !== 'string') return String(text);
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderReport(result) {
    const { pass, expected, diffs } = result;
    const errorPaths = (diffs || []).filter(d => !d.match).map(d => d.path);

    elements.statusBadge.className = `badge ${pass ? 'pass' : 'fail'}`;
    elements.statusBadge.textContent = pass ? '✅ PASS' : '❌ FAIL';

    let html = '';

    // Show Errors
    const errors = (diffs || []).filter(d => !d.match);
    if (errors.length > 0) {
        html += `<h3>🔍 Diagnostic Details</h3>`;
        errors.forEach(d => {
            html += `
            <div class="diff-item">
                <div class="diff-path">${d.path || 'ROOT'}</div>
                <div class="diff-comment">${d.comment}</div>
                ${d.expected !== undefined ? `
                    <div style="margin-top:0.75rem;">
                        <h4 style="color: #94a3b8; font-size: 0.8rem; margin-bottom: 4px;">Expected Value</h4>
                        <div class="json-block" style="font-size: 0.8rem; padding: 0.5rem; margin-bottom: 8px;">${JSON.stringify(d.expected)}</div>
                        <h4 style="color: #94a3b8; font-size: 0.8rem; margin-bottom: 4px;">Actual Value</h4>
                        <div class="json-block" style="font-size: 0.8rem; padding: 0.5rem; border-left: 3px solid var(--error);">${JSON.stringify(d.actual)}</div>
                    </div>
                ` : ''}
            </div>`;
        });
    } else {
        html += `
        <div class="diff-item match" style="background: rgba(16, 185, 129, 0.1);">
            <div class="diff-comment" style="color: var(--success); font-weight: 500;">
                All spec requirements successfully matched!
            </div>
        </div>`;
    }

    // Show Full Comparison
    html += `<h3 style="margin-top: 2rem;">📊 Detailed Comparison</h3>
    <div class="comparison-grid">
        <div>
            <h4 style="color: var(--text-secondary); margin-bottom: 0.5rem; font-size: 0.9rem;">Spec Expected Object</h4>
            <div class="json-block">${renderJsonWithHighlights(expected, errorPaths)}</div>
        </div>
        <div>
            <h4 style="color: var(--text-secondary); margin-bottom: 0.5rem; font-size: 0.9rem;">Actual Matched Object (Subset)</h4>
            <div class="json-block">${renderJsonWithHighlights(getSubset(result.actual, expected), errorPaths)}</div>
        </div>
    </div>
    
    <div style="margin-top: 1.5rem;">
        <h4 style="color: var(--text-secondary); margin-bottom: 0.5rem; font-size: 0.9rem;">Full Actual Code Context (DigitalData)</h4>
        <div class="json-block">${renderJsonWithHighlights(result.actual, errorPaths)}</div>
    </div>`;

    elements.resultsContent.innerHTML = html;
}

// Helper: Extract subset recursively preserving ACTUAL order
function getSubset(act, exp) {
    if (act === null || typeof act !== 'object' || exp === null || typeof exp !== 'object') {
        return act;
    }
    if (Array.isArray(act)) return act;

    const sub = {};
    for (const key in act) {
        if (key in exp) {
            sub[key] = getSubset(act[key], exp[key]);
        }
    }
    return sub;
}

// Helper: JSON Syntax Highlighter - No longer used but kept for historical context
function syntaxHighlight(json) {
    if (!json) return '';
    return escapeHtml(json);
}
