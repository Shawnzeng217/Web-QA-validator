const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Serve the static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint for Railway/Cloud platforms
app.get('/health', (req, res) => res.status(200).send('OK'));

/**
 * Maps the ref ID to an action that Puppeteer needs to execute
 * before grabbing the digitalData.
 */
async function performActionForRef(page, ref) {
    const refId = parseInt(ref, 10);
    console.log(`[Puppeteer] Executing logic for Ref ${refId}`);

    try {
        switch (refId) {
            case 1:
                // Home Page Load - No action needed
                break;
            case 2:
                // Click Top Destination or similar top tag
                // Assuming standard class/data-test-id - using generic click for demo
                // Would need exact selectors from actual site
                console.log("[Puppeteer] Waiting for body to load to simulate click...");
                await new Promise(r => setTimeout(r, 2000));
                break;
            case 4:
                // Click Search Hotel
                // We attempt to find a generic search button
                const searchBtns = await page.$$('button[type="submit"], .search-btn, button:contains("Search")');
                if (searchBtns.length > 0) {
                    await searchBtns[0].click();
                    await new Promise(r => setTimeout(r, 1000));
                }
                break;
            // Add more specific selectors based on actual DOM
            default:
                console.log(`[Puppeteer] No specific action defined for Ref ${refId}, just grabbing data loaded on page.`);
                await new Promise(r => setTimeout(r, 2000)); // Give JS time to initialize digitalData
        }
    } catch (e) {
        console.error(`[Puppeteer] Action failed for Ref ${refId}:`, e.message);
    }
}

app.post('/api/extract', async (req, res) => {
    const { url, ref, requirement, expectedDataLayer } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    let browser;
    try {
        console.log(`\n======================================`);
        console.log(`[Extraction Request] URL: ${url} | Ref: ${ref}`);
        console.log(`Target Requirement: ${requirement}`);

        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(90000);
        page.setDefaultTimeout(90000);

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

        // --- 1. SET UP NODE-BROWSER BRIDGE (Hard Capture) ---
        let capturedData = null;
        let resolveCapture;
        const capturePromise = new Promise(resolve => { resolveCapture = resolve; });

        // Expose a function to the browser to "push" data to Node
        await page.exposeFunction('pushSnapshotToNode', (data, source) => {
            // Priority 1: A snap with a valid clickID
            if (data && data.click && data.click.clickID) {
                console.log(`[Bridge] Valid click captured from ${source}: ${data.click.clickID}`);
                capturedData = data;
                resolveCapture(); // Resolve the promise immediately
                return;
            }

            // Priority 2: Any data is better than null
            if (!capturedData || !capturedData.click || !capturedData.click.clickID) {
                capturedData = data;
            }
        });

        await page.evaluateOnNewDocument(() => {
            window._lastClickID = "";
            const doCapture = (source) => {
                if (window.digitalData) {
                    try {
                        const snap = JSON.parse(JSON.stringify(window.digitalData));
                        window.pushSnapshotToNode(snap, source);
                    } catch (e) { }
                }
            };

            // Intercept at bubble phase (false) to run AFTER most site listeners
            window.addEventListener('mousedown', () => doCapture('mousedown_bubble'), false);
            window.addEventListener('click', () => doCapture('click_bubble'), false);

            // Force capture before navigation
            window.addEventListener('beforeunload', () => doCapture('unload'), false);

            // Faster watcher for transient changes
            setInterval(() => {
                const currentID = (window.digitalData && window.digitalData.click) ? window.digitalData.click.clickID : "";
                if (currentID && currentID !== window._lastClickID) {
                    window._lastClickID = currentID;
                    doCapture('watcher_fast');
                }
            }, 20);
        });

        console.log(`Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });

        // --- 2. INTERACTION LOGIC ---
        const isClickTest = expectedDataLayer && expectedDataLayer.includes('"click"');

        if (isClickTest && requirement) {
            console.log(`[Puppeteer] Target Requirement: "${requirement}"`);

            const elementInfo = await page.evaluate((text) => {
                const elements = Array.from(document.querySelectorAll('a, button, span, div, li, p, h1, h2, h3, h4, i'));
                // Extremely aggressive search for Ref 5 / Honors Benefits area
                const targets = elements.filter(el => {
                    const elText = (el.innerText || el.textContent || "").trim();
                    return elText.includes(text) ||
                        elText.includes("详细权益") ||
                        elText.includes("更多权益") ||
                        elText.includes("Detailed Benefit") ||
                        elText.includes("查看更多") ||
                        elText.includes("Benefit");
                });

                // Pick the most likely clickable target (usually an A or Button)
                const target = targets.find(el => el.tagName === 'A' || el.tagName === 'BUTTON') || targets[0];

                if (target) {
                    target.scrollIntoView({ block: 'center' });
                    const rect = target.getBoundingClientRect();
                    return { found: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, tagName: target.tagName, text: target.innerText };
                }
                return { found: false };
            }, requirement);

            if (elementInfo.found) {
                console.log(`[Puppeteer] Found ${elementInfo.tagName} "${elementInfo.text}". Clicking...`);

                // Perform hardware-level click
                await page.mouse.click(elementInfo.x, elementInfo.y);

                console.log(`[Puppeteer] Clicked. Waiting for Bridge callback...`);
                // Wait up to 6 seconds for the bridge to receive the data
                await Promise.race([
                    capturePromise,
                    new Promise(r => setTimeout(r, 6000))
                ]);

                if (capturedData && capturedData.click && capturedData.click.clickID) {
                    console.log(`CRITICAL_DEBUG_BRIDGE_SUCCESS: Captured clickID = ${capturedData.click.clickID}`);
                } else {
                    console.warn(`CRITICAL_DEBUG_BRIDGE_FAIL: Snapshot is empty or missing clickID.`);
                    console.log("CRITICAL_DEBUG_SNAPSHOT_STATE:", JSON.stringify(capturedData));
                }
            } else {
                console.warn(`[Puppeteer] Element text "${requirement}" NOT FOUND on page.`);
            }
        } else if (ref) {
            await performActionForRef(page, ref);
            await new Promise(r => setTimeout(r, 1000));
        }

        // --- 3. FINAL EXTRACTION ---
        console.log(`Extracting final result...`);
        const finalData = (capturedData && capturedData.click && capturedData.click.clickID)
            ? capturedData
            : await page.evaluate(() => window.digitalData || null);

        console.log(`Extraction complete.`);
        console.log("FINAL_JSON_TO_SEND_START");
        console.log(JSON.stringify(finalData));
        console.log("FINAL_JSON_TO_SEND_END");
        console.log(`======================================\n`);

        if (!finalData) {
            return res.status(404).json({ error: 'digitalData not found.' });
        }

        if (finalData) {
            fs.writeFileSync('last_result.json', JSON.stringify({ data: finalData }, null, 2));
            console.log(`[Server] Saved result to last_result.json`);
        }
        res.json({ data: finalData });

    } catch (error) {
        console.error('Error during extraction:', error);
        res.status(500).json({ error: error.message || 'Failed to extract data' });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`\n=================================================`);
    console.log(`🚀 QA Inspector Automation Server running!`);
    console.log(`👉 Open http://localhost:${PORT} in your browser.`);
    console.log(`=================================================\n`);
});
