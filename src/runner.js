const { parseSpec } = require('./parser');
const { validateCase } = require('./matcher');
const path = require('path');

/**
 * Main runner to execute QA automation for specified refs.
 */
async function runValidation(targetRefs = []) {
    const csvPath = path.join(__dirname, '..', 'lls_qa.csv');
    const allCases = parseSpec(csvPath);

    const casesToRun = targetRefs.length > 0
        ? allCases.filter(c => targetRefs.includes(parseInt(c.ref)))
        : allCases;

    const results = [];

    for (const testCase of casesToRun) {
        console.log(`Running Validation for Ref ${testCase.ref}: ${testCase.requirement}`);

        results.push({
            ref: testCase.ref,
            requirement: testCase.requirement,
            expected: testCase.expectedDataLayer,
            actual: null,
            status: 'PENDING'
        });
    }

    return results;
}

/**
 * Report formatter for the user.
 */
function formatReport(results) {
    let report = "# Web QA 自动化验证报告\n\n";
    report += "> [!NOTE]\n";
    report += "> 本次验证重点关注 Ref 1-15 (首页相关)。比对逻辑：确保 Spec 要求的结构和字段完全存在且严格匹配。提供完整代码供人工肉眼观察冗余。\n\n";

    results.forEach(res => {
        report += `## Ref ${res.ref}: ${res.requirement}\n`;
        report += `**验证状态:** ${res.pass ? '✅ 通过 (PASS)' : '❌ 未通过 (FAIL)'}\n\n`;

        report += "### 🔍 代码对比 (Carousel)\n";
        report += "````carousel\n";
        report += "```json\n";
        report += "// [Slide 1] Expected: Spec 验收标准要求的代码\n";
        report += JSON.stringify(res.expected, null, 2);
        report += "\n```\n";
        report += "<!-- slide -->\n";
        report += "```json\n";
        report += "// [Slide 2] Actual (Subset): 实际抓取到的对应部分 (保持原始顺序)\n";

        // Helper to extract subset recursively preserving ACTUAL order
        const getSubset = (act, exp) => {
            if (act === null || typeof act !== 'object' || exp === null || typeof exp !== 'object') {
                return act;
            }
            if (Array.isArray(act)) return act;

            const sub = {};
            // Iterate thru ACTUAL data keys to maintain original structure/order
            for (const key in act) {
                if (key in exp) {
                    sub[key] = getSubset(act[key], exp[key]);
                }
            }
            return sub;
        };

        const fullData = res.fullActual || res.actual;
        const actualSubset = getSubset(fullData, res.expected);

        report += JSON.stringify(actualSubset, null, 2);
        report += "\n```\n";
        report += "<!-- slide -->\n";
        report += "```json\n";
        report += "// [Slide 3] Full Actual: 浏览器返回的完整 digitalData (供肉眼观察冗余)\n";
        report += JSON.stringify(res.fullActual || res.actual, null, 2);
        report += "\n```\n";
        report += "````\n\n";

        // Handle Errors (Missing or Mismatch)
        const errors = (res.diffs || []).filter(d => !d.match);
        if (errors.length > 0) {
            report += `### 💡 诊断详情\n`;
            errors.forEach(d => {
                report += `- **字段路径**: \`${d.path}\`\n`;
                report += `  - **问题**: ${d.comment}\n`;
                if (d.expected !== undefined && d.actual !== undefined) {
                    report += `  - **对比**: 期望 \`${JSON.stringify(d.expected)}\`，实际为 \`${JSON.stringify(d.actual)}\`。\n`;
                }
            });

            // Add Possible Causes for Dev
            report += `\n**🛠️ 可能原因 (致 Dev):**\n\n`;
            const comments = errors.map(e => e.comment).join(' ');
            if (comments.includes('Value mismatch')) {
                report += `- **值不匹配**: 可能是由于大小写差异（如 zh-CN vs zh-cn）或 ID 前缀不一致导致。\n`;
            }
            if (comments.includes('Required field missing')) {
                report += `- **字段丢失**: 交互后 digitalData 对象刷新，但 global.page 下的静态属性未被重新赋值。\n`;
            }
            if (comments.includes('Loading Spinner')) {
                report += `- **环境因素**: UAT 页面未完成 Hydration，交互拦截失败，未触发埋点更新。\n`;
            }
            report += `\n`;
        }

        if (res.pass && errors.length === 0) {
            report += `> [!TIP]\n> 所有 Spec 要求的关键结构和字段均已匹配成功。请滑至 Slide 3 审阅冗余部分。\n\n`;
        }
        report += "---\n\n";
    });
    return report;
}

module.exports = { runValidation, validateCase, formatReport };
