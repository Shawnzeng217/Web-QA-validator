const http = require('http');

const data = JSON.stringify({
    url: 'https://lls-uat.hilton.com.cn/zh-cn/',
    ref: '5',
    requirement: 'Detailed Benefit',
    expectedDataLayer: '{"click": {"clickID": "Home > btn_Honors benefit"}}'
});

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/extract',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

console.log('🚀 Starting Native Verification for Ref 5...');

const req = http.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
        console.log('CRITICAL_DEBUG_TEST_RAW_BODY_START');
        console.log(body);
        console.log('CRITICAL_DEBUG_TEST_RAW_BODY_END');
        try {
            const result = JSON.parse(body);
            console.log('\n--- Extraction Result ---');
            console.log(JSON.stringify(result.data, null, 2));

            if (result.data && result.data.click && result.data.click.clickID === "Home > btn_Honors benefit") {
                console.log('\n✅ VERIFICATION SUCCESS: clickID matches manual result!');
            } else {
                console.log('\n❌ VERIFICATION FAILED: clickID mismatch or not found.');
                console.log('Got ClickID:', (result.data && result.data.click) ? result.data.click.clickID : 'UNDEFINED');
            }
        } catch (e) {
            console.error('Failed to parse response:', body);
        }
    });
});

req.on('error', (error) => {
    console.error('Request error:', error.message);
});

req.write(data);
req.end();
