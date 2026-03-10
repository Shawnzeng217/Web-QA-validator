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

        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

        page.on('console', msg => console.log(`[Browser] ${msg.text()}`));

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
                        const clickID = (snap.click && snap.click.clickID) ? snap.click.clickID : "EMPTY";
                        if (clickID !== "EMPTY") {
                            console.log(`[Proxy/Event] Capture! Source: ${source}, ClickID: ${clickID}`);
                            window.pushSnapshotToNode(snap, source);
                        }
                    } catch (e) { }
                }
            };

            // Navigation Stopper: Attempt to freeze the page on unload to catch transient data
            window.addEventListener('beforeunload', (e) => {
                doCapture('unload_stopper');
                // On some sites, we can briefly delay navigation
                const start = Date.now();
                while (Date.now() - start < 100);
            }, true);

            // Deep Proxy for digitalData
            const createProxy = (obj, path) => {
                return new Proxy(obj, {
                    set(target, prop, value) {
                        target[prop] = value;
                        if (prop === 'clickID' && value !== "") {
                            console.log(`[Proxy] CRITICAL CAPTURE! clickID set to: ${value}`);
                            doCapture('proxy_success');
                        }
                        return true;
                    }
                });
            };

            let wrapped = false;
            const wrapper = setInterval(() => {
                if (window.digitalData && !wrapped) {
                    if (window.digitalData.click) {
                        window.digitalData.click = createProxy(window.digitalData.click, 'click');
                        wrapped = true;
                        console.log("[Browser] digitalData.click Proxy attached.");
                    } else if (window.digitalData) {
                        // If click doesn't exist, create it as a proxy
                        window.digitalData.click = createProxy({}, 'click');
                        wrapped = true;
                        console.log("[Browser] digitalData.click Proxy initialized.");
                    }
                }
            }, 50);

            // Fallback listeners
            window.addEventListener('mousedown', () => doCapture('mousedown_bubble'), false);
            window.addEventListener('click', () => doCapture('click_bubble'), false);
            window.addEventListener('beforeunload', () => doCapture('unload'), false);
        });

        console.log(`Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
        // Give analytics time to fully load and process
        await new Promise(r => setTimeout(r, 4000));

        // --- 2. INTERACTION LOGIC ---
        const isClickTest = expectedDataLayer && expectedDataLayer.includes('"click"');

        if (isClickTest && requirement) {
            console.log(`[Puppeteer] Click Test detected for requirement: "${requirement}"`);

            const elementInfo = await page.evaluate((text) => {
                const elements = Array.from(document.querySelectorAll('a, button, span, div, li, p, h1, h2, h3, h4, i, strong'));
                const targets = elements.filter(el => {
                    const elText = (el.innerText || el.textContent || "").trim();
                    return elText === "更多权益" ||
                        elText === "Detailed Benefit" ||
                        elText.includes("详细权益") ||
                        elText.includes(text) ||
                        elText.includes("Benefit");
                });

                // Priority: exact match > partial match
                const target = targets.find(el => (el.innerText || "").trim() === "更多权益") ||
                    targets.find(el => el.tagName === 'A' || el.tagName === 'BUTTON') ||
                    targets[0];

                if (target) {
                    target.scrollIntoView({ block: 'center' });
                    const rect = target.getBoundingClientRect();
                    return { found: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, tagName: target.tagName, text: target.innerText };
                }
                return { found: false };
            }, requirement);

            if (elementInfo.found) {
                console.log(`[Puppeteer] Found ${elementInfo.tagName} "${elementInfo.text}". Clicking via DOM-native click...`);
                await page.evaluate((text) => {
                    const el = Array.from(document.querySelectorAll('.more-link, a, button'))
                        .find(e => (e.innerText || e.textContent || "").includes(text) || e.innerText.includes("更多权益"));
                    if (el) el.click();
                }, requirement);
            } else {
                console.warn(`[Puppeteer] Element text "${requirement}" NOT found by text search. Waiting for generic interaction bridge...`);
            }

            // --- 3. WAIT FOR DATA ---
            console.log(`[Puppeteer] Waiting for clickID update in browser context...`);
            try {
                await page.waitForFunction(() => {
                    return window.digitalData && window.digitalData.click && window.digitalData.click.clickID !== "";
                }, { timeout: 8000, polling: 100 });
                console.log(`[Puppeteer] DETECTED clickID change in browser!`);
            } catch (e) {
                console.warn(`[Puppeteer] Timeout waiting for clickID change via polling. Falling back to bridge snapshot.`);
            }

            await Promise.race([
                capturePromise,
                new Promise(r => setTimeout(r, 2000)) // Short wait for any late bridge messages
            ]);
        } else if (ref) {
            await performActionForRef(page, ref);
            await new Promise(r => setTimeout(r, 1000));
        }

        // --- 4. FINAL EXTRACTION ---
        let finalData = null;
        if (isClickTest) {
            // For click tests, we STICK with the snapshot taken during the interaction.
            // This guarantees we don't get 'leaked' data from the destination page.
            if (capturedData && capturedData.click && capturedData.click.clickID) {
                finalData = capturedData;
                console.log(`[Extraction] SUCCESS: Captured transient clickID "${capturedData.click.clickID}"`);
            } else if (capturedData) {
                // Return the best snapshot we got even if clickID is missing
                finalData = capturedData;
                console.log(`[Extraction] WARNING: Bridge captured data but clickID is empty.`);
            } else {
                // Absolute fallback
                finalData = await page.evaluate(() => window.digitalData || null);
            }
        } else {
            // Standard Page Load test
            finalData = await page.evaluate(() => window.digitalData || null);
        }

        if (!finalData) {
            return res.status(404).json({ error: 'digitalData not found.' });
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
