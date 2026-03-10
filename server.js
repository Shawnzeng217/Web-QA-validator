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

        console.log(`Navigating to ${url}...`);
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 90000
        });

        // 1. Inject Improved "Sticky" Snapshot Listener
        await page.evaluateOnNewDocument(() => {
            window._digitalDataSnapshot = null;
            // Listen to both mousedown and click to ensure we catch it whenever the app updates it
            const capture = () => {
                if (window.digitalData && window.digitalData.click && window.digitalData.click.clickID) {
                    window._digitalDataSnapshot = JSON.parse(JSON.stringify(window.digitalData));
                }
            };
            window.addEventListener('mousedown', capture, true);
            window.addEventListener('click', capture, true);

            // Periodically check during interaction
            setInterval(capture, 100);
        });

        // Re-inject for current session
        await page.evaluate(() => {
            window._digitalDataSnapshot = null;
            const capture = () => {
                if (window.digitalData && window.digitalData.click && window.digitalData.click.clickID) {
                    window._digitalDataSnapshot = JSON.parse(JSON.stringify(window.digitalData));
                }
            };
            window.addEventListener('mousedown', capture, true);
            window.addEventListener('click', capture, true);
        });

        // 2. Interaction Logic
        const isClickTest = expectedDataLayer && expectedDataLayer.includes('"click"');

        if (isClickTest && requirement) {
            console.log(`[Puppeteer] Click requirement detected. Searching for visible element with text: "${requirement}"`);

            // Find coordinates/selector in JS context
            const elementInfo = await page.evaluate((text) => {
                const elements = Array.from(document.querySelectorAll('a, button, span, div, li, p'));
                const target = elements.find(el => {
                    const elText = el.innerText || el.textContent || "";
                    return elText.trim().toLowerCase().includes(text.toLowerCase());
                });

                if (target) {
                    target.scrollIntoView({ block: 'center' });
                    const rect = target.getBoundingClientRect();
                    return { found: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                }
                return { found: false };
            }, requirement);

            if (elementInfo.found) {
                console.log(`[Puppeteer] Element found at (${elementInfo.x}, ${elementInfo.y}). Performing native click...`);

                // Use native mouse clicks which are more "trusted" by analytics frameworks
                await page.mouse.click(elementInfo.x, elementInfo.y);

                console.log(`[Puppeteer] Clicked. Waiting for digitalData sequence to complete...`);

                // Smart Wait: Poll for clickID to appear in snapshot
                let attempts = 0;
                while (attempts < 20) {
                    const hasData = await page.evaluate(() => {
                        return window._digitalDataSnapshot &&
                            window._digitalDataSnapshot.click &&
                            window._digitalDataSnapshot.click.clickID !== "";
                    });
                    if (hasData) {
                        console.log(`[Puppeteer] Success! Captured clickID in snapshot.`);
                        break;
                    }
                    await new Promise(r => setTimeout(r, 200));
                    attempts++;
                }

                if (attempts >= 20) {
                    console.warn(`[Puppeteer] Timeout waiting for clickID. Reverting to current window state.`);
                }
            } else {
                console.warn(`[Puppeteer] Element text "${requirement}" NOT FOUND on page.`);
            }
        } else if (ref) {
            await performActionForRef(page, ref);
            await new Promise(r => setTimeout(r, 1000));
        }

        console.log(`Extracting final state...`);
        const extractedData = await page.evaluate(() => {
            // First try the snapshot (captured during click), then fall back to live window
            const snap = window._digitalDataSnapshot;
            if (snap && snap.click && snap.click.clickID) return snap;
            return window.digitalData || null;
        });

        console.log(`Extraction complete.`);
        console.log(`======================================\n`);

        if (!extractedData) {
            return res.status(404).json({ error: 'digitalData not found.' });
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
