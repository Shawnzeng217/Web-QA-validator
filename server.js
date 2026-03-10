const express = require('express');
const puppeteer = require('puppeteer');
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

        // --- 1. SET UP NODE-BROWSER BRIDGE ---
        let capturedData = null;
        let resolveCapture;
        const capturePromise = new Promise(resolve => { resolveCapture = resolve; });

        // Expose a function to the browser to "push" data to Node
        await page.exposeFunction('pushSnapshotToNode', (data) => {
            if (data && data.click && data.click.clickID) {
                console.log(`[Bridge] Received valid click snapshot: ${data.click.clickID}`);
                capturedData = data;
                resolveCapture();
            }
        });

        await page.evaluateOnNewDocument(() => {
            let lastClickID = "";
            const check = () => {
                const current = (window.digitalData && window.digitalData.click) ? window.digitalData.click.clickID : "";
                if (current && current !== lastClickID) {
                    lastClickID = current;
                    // Push to Node instantly
                    window.pushSnapshotToNode(JSON.parse(JSON.stringify(window.digitalData)));
                }
            };
            setInterval(check, 50);
            window.addEventListener('mousedown', check, true);
            window.addEventListener('click', check, true);
        });

        console.log(`Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });

        // --- 2. INTERACTION LOGIC ---
        const isClickTest = expectedDataLayer && expectedDataLayer.includes('"click"');

        if (isClickTest && requirement) {
            console.log(`[Puppeteer] Click requirement detected: "${requirement}"`);

            const elementInfo = await page.evaluate((text) => {
                const elements = Array.from(document.querySelectorAll('a, button, span, div, li, p'));
                const target = elements.find(el => (el.innerText || el.textContent || "").trim().toLowerCase().includes(text.toLowerCase()));
                if (target) {
                    target.scrollIntoView({ block: 'center' });
                    const rect = target.getBoundingClientRect();
                    return { found: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                }
                return { found: false };
            }, requirement);

            if (elementInfo.found) {
                console.log(`[Puppeteer] Performing native click at (${elementInfo.x}, ${elementInfo.y})`);

                // Trigger the click and wait for the bridge to resolve OR timeout
                await page.mouse.click(elementInfo.x, elementInfo.y);

                console.log(`[Puppeteer] Clicked. Waiting for Bridge callback...`);
                // Wait up to 5 seconds for the bridge to receive the data
                await Promise.race([
                    capturePromise,
                    new Promise(r => setTimeout(r, 5000))
                ]);

                if (capturedData) {
                    console.log(`[Puppeteer] Bridge successfully captured data.`);
                } else {
                    console.warn(`[Puppeteer] Bridge timeout. No click data received.`);
                }
            } else {
                console.warn(`[Puppeteer] Element text "${requirement}" NOT FOUND.`);
            }
        } else if (ref) {
            await performActionForRef(page, ref);
            await new Promise(r => setTimeout(r, 1000));
        }

        // --- 3. FINAL EXTRACTION ---
        console.log(`Extracting final result...`);
        const finalData = capturedData || await page.evaluate(() => window.digitalData || null);

        console.log(`Extraction complete.`);
        console.log(`======================================\n`);

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
