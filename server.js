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
        console.log(`Launching headless Chrome...`);

        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(90000);
        page.setDefaultTimeout(90000);

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

        console.log(`Navigating to ${url}...`);
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 90000
        });

        // 1. Inject Snapshot Listener
        // This script runs in the browser and captures digitalData on any click
        await page.evaluateOnNewDocument(() => {
            window._digitalDataSnapshot = null;
            window.addEventListener('mousedown', (event) => {
                // Instantly deep clone the digitalData at the moment of interaction
                if (window.digitalData) {
                    window._digitalDataSnapshot = JSON.parse(JSON.stringify(window.digitalData));
                }
            }, true);
        });

        // Re-inject if navigation happened or just to be safe for current page
        await page.evaluate(() => {
            window._digitalDataSnapshot = null;
            window.addEventListener('mousedown', (event) => {
                if (window.digitalData) {
                    window._digitalDataSnapshot = JSON.parse(JSON.stringify(window.digitalData));
                }
            }, true);
        });

        // 2. Identify and perform click if it's a click-based check
        const isClickTest = expectedDataLayer && expectedDataLayer.includes('"click"');

        if (isClickTest && requirement) {
            console.log(`[Puppeteer] Click detected in spec. Searching for element matching: "${requirement}"`);

            // Search for element by text content
            const clicked = await page.evaluate((text) => {
                const elements = Array.from(document.querySelectorAll('a, button, span, div, li'));
                const target = elements.find(el => el.textContent.trim().toLowerCase().includes(text.toLowerCase()));
                if (target) {
                    target.scrollIntoView();
                    target.click();
                    return true;
                }
                return false;
            }, requirement);

            if (clicked) {
                console.log(`[Puppeteer] Element clicked. Waiting for snapshot...`);
                // Wait briefly for the snapshot to be captured before page might unload
                await new Promise(r => setTimeout(r, 1500));
            } else {
                console.warn(`[Puppeteer] Could not find element matching text: "${requirement}"`);
            }
        } else if (ref) {
            // Fallback for non-click tests or legacy ref-based logic
            await performActionForRef(page, ref);
            await new Promise(r => setTimeout(r, 1000));
        }

        console.log(`Extracting data...`);
        const extractedData = await page.evaluate(() => {
            // Priority: Transient click snapshot > current window.digitalData
            return window._digitalDataSnapshot || window.digitalData || null;
        });

        console.log(`Extraction complete.`);
        console.log(`======================================\n`);

        if (!extractedData) {
            return res.status(404).json({ error: 'digitalData not found. Page might have failed to load or objective element not found.' });
        }

        res.json({ data: extractedData });

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
