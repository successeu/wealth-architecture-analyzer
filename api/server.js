const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const { put } = require('@vercel/blob');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

/**
 * POST /api/generate-pdf
 * 
 * Generates personalized 90-Day Wealth Blueprint PDF
 * Stores PDF on Vercel Blob
 * Sends data to Active Campaign via Zapier
 * Returns downloadable PDF URL
 */
app.post('/api/generate-pdf', async (req, res) => {
    let browser;
    try {
        console.log('📄 PDF Generation started');
        const {
            firstName, lastName, email, phoneCode, phone,
            income, expenses, savings, debt, surplus,
            incomeSources, goals, countryName, countryCode, currencyCode,
            timeline, riskTolerance, investmentExperience, incomeInterest
        } = req.body;

        if (!firstName || !email || income === undefined) {
            console.error('❌ Validation failed: missing required fields');
            return res.status(400).json({ 
                error: 'Missing required fields: firstName, email, income',
                success: false
            });
        }

        console.log(`✅ Generating blueprint for ${firstName} ${lastName}`);

        const blueprintData = {
            firstName, lastName, email, phoneCode, phone,
            income, expenses, savings, debt, surplus,
            incomeSources, goals, countryName, countryCode, currencyCode,
            timeline, riskTolerance, investmentExperience, incomeInterest
        };

        const blueprintHTML = generatePremiumBlueprintHTML(blueprintData);

        console.log('🚀 Launching Puppeteer browser...');
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process',
                '--no-first-run',
                '--no-zygote'
            ],
            timeout: 30000
        });

        console.log('📝 Creating page...');
        const page = await browser.createPage();
        
        await page.setViewport({ width: 1024, height: 1280 });
        await page.setContent(blueprintHTML, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        console.log('🎨 Generating PDF...');
        const pdfBuffer = await page.pdf({
            format: 'A4',
            margin: { 
                top: '20px', 
                right: '20px', 
                bottom: '20px', 
                left: '20px' 
            },
            printBackground: true,
            timeout: 30000
        });

        console.log('✅ PDF generated successfully');

        if (browser) {
            await browser.close();
            console.log('🔒 Browser closed');
        }

        console.log('☁️ Uploading to Vercel Blob...');
        const timestamp = Date.now();
        const fileName = `${firstName}_${lastName}_90Day_Wealth_Blueprint_${timestamp}.pdf`;
        const blob = await put(fileName, pdfBuffer, {
            access: 'public',
            contentType: 'application/pdf'
        });

        const pdfDownloadURL = blob.url;
        console.log('✅ PDF uploaded successfully');

        console.log('📤 Sending to Active Campaign...');
        await sendToActiveCampaign({
            ...blueprintData,
            blueprintPDFDownloadURL: pdfDownloadURL,
            blueprintPDFFileName: fileName,
            submittedAt: new Date().toISOString()
        });

        console.log('✅ Active Campaign integration complete');

        res.json({
            success: true,
            pdfUrl: pdfDownloadURL,
            fileName: fileName,
            message: 'Blueprint generated and submitted successfully'
        });

    } catch (error) {
        console.error('❌ PDF Generation Error:', error);
        console.error('Error Stack:', error.stack);

        if (browser) {
            try {
                await browser.close();
            } catch (e) {
                console.error('Error closing browser:', e);
            }
        }

        res.status(500).json({
            error: 'Failed to generate PDF',
            details: error.message,
            success: false
        });
    }
});

/**
 * Send blueprint data to Active Campaign via Zapier webhook
 */
async function sendToActiveCampaign(data) {
    try {
        const webhookURL = 'https://hooks.zapier.com/hooks/catch/3435365/u7o9p8p/';
        
        const payload = {
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName || '',
            phone: (data.phoneCode || '') + (data.phone || ''),
            country: data.countryName,
            currency: data.currencyCode,
            monthlyIncome: data.income,
            monthlyExpenses: data.expenses,
            monthlySurplus: data.surplus,
            currentSavings: data.savings,
            totalDebt: data.debt,
            financialGoal: data.goals || '',
            timeframe: data.timeline,
            incomeStreams: data.incomeSources || '',
            incomeInterest: data.incomeInterest || 'No',
            investmentExperience: data.investmentExperience || 'Beginner',
            riskTolerance: data.riskTolerance || 'Moderate',
            blueprintHealthScore: calculateHealthScore(data),
            blueprintPDFDownloadURL: data.blueprintPDFDownloadURL,
            blueprintPDFFileName: data.blueprintPDFFileName,
            submittedAt: data.submittedAt
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(webhookURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.warn('⚠️ Zapier webhook response status:', response.status);
        }

        console.log('✅ Zapier webhook sent successfully');
        return true;
    } catch (error) {
        console.error('⚠️ Error sending to Active Campaign:', error.message);
        return false;
    }
}

/**
 * Calculate Financial Health Score (0-100)
 */
function calculateHealthScore(data) {
    let score = 0;
    const surplus = data.income - data.expenses;
    const surplusPercentage = surplus > 0 ? (surplus / data.income) * 100 : -100;
    
    if (surplusPercentage > 30) score += 25;
    else if (surplusPercentage > 20) score += 20;
    else if (surplusPercentage > 10) score += 15;
    else if (surplusPercentage > 5) score += 10;
    else if (surplusPercentage > 0) score += 5;
    
    const cushionMonths = data.expenses > 0 ? data.savings / data.expenses : 0;
    if (cushionMonths > 6) score += 25;
    else if (cushionMonths > 3) score += 20;
    else if (cushionMonths > 1) score += 15;
    else if (cushionMonths > 0) score += 10;
    
    const annualIncome = data.income * 12;
    const debtRatio = annualIncome > 0 ? data.debt / annualIncome : 0;
    if (debtRatio < 0.1) score += 25;
    else if (debtRatio < 0.25) score += 20;
    else if (debtRatio < 0.5) score += 15;
    else if (debtRatio < 1) score += 10;
    
    const incomeSourceCount = (data.incomeSources || '').split(',').filter(s => s.trim()).length;
    if (incomeSourceCount >= 3) score += 15;
    else if (incomeSourceCount === 2) score += 10;
    else if (incomeSourceCount === 1) score += 5;
    
    const goalsCount = (data.goals || '').split(',').filter(g => g.trim()).length;
    if (goalsCount >= 3) score += 10;
    else if (goalsCount === 2) score += 7;
    else if (goalsCount === 1) score += 5;
    
    return Math.min(score, 100);
}

/**
 * Generate premium 5-page blueprint PDF HTML
 */
function generatePremiumBlueprintHTML(data) {
    const {
        firstName, lastName, email, countryName, currencyCode,
        income, expenses, savings, debt, surplus,
        incomeSources, goals, timeline, riskTolerance
    } = data;

    const formatCurrency = (value) => {
        return `${currencyCode} ${Math.round(value).toLocaleString()}`;
    };

    const healthScore = calculateHealthScore(data);
    const surplus90 = surplus * 3;
    const surplus12Month = surplus * 12;
    const surplus5Year = surplus * 12 * 5 * 1.07;

    let positionType = 'moderate';
    if (surplus > (income * 0.2)) positionType = 'positive';
    else if (surplus <= 0) positionType = 'critical';

    let executiveSummary = '';
    let scoreInterpretation = '';
    let scoreColor = '#ff8120';

    if (positionType === 'positive') {
        executiveSummary = `${firstName}, your financial position presents an exceptional opportunity. With a monthly surplus of ${formatCurrency(surplus)}, you've achieved what 70% of global earners haven't: positive cash flow.`;
        if (healthScore >= 75) {
            scoreInterpretation = 'Strong Foundation — Execute strategically for exponential results';
            scoreColor = '#33cc66';
        }
    } else if (positionType === 'critical') {
        executiveSummary = `${firstName}, your position requires immediate strategic action. This Blueprint maps your path from financial pressure to surplus in 30-90 days.`;
        if (healthScore < 45) {
            scoreInterpretation = 'Critical Reset Required — Focus on creating positive cash flow within 30 days';
            scoreColor = '#ff4444';
        }
    } else {
        executiveSummary = `${firstName}, you're in a transitional phase. Your ${formatCurrency(surplus)} monthly surplus enables dual-track debt elimination and emergency reserve building.`;
        scoreInterpretation = 'Transitional Phase — High transformation potential with focused action';
        scoreColor = '#ffb300';
    }

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>90-Day Wealth Blueprint</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                color: #333;
                line-height: 1.6;
                background: #fff;
            }
            .page { 
                page-break-after: always; 
                padding: 40px;
                min-height: 100vh;
                background: white;
            }
            .page:last-child { page-break-after: avoid; }
            
            .header {
                border-bottom: 3px solid #ff8120;
                padding-bottom: 30px;
                margin-bottom: 40px;
            }
            .header h1 {
                font-size: 32px;
                color: #000;
                margin-bottom: 5px;
            }
            .header .subtitle {
                color: #666;
                font-size: 14px;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            
            h2 {
                font-size: 20px;
                color: #ff8120;
                margin-top: 30px;
                margin-bottom: 15px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                border-left: 3px solid #ff8120;
                padding-left: 15px;
            }
            
            h3 {
                font-size: 16px;
                color: #000;
                margin-top: 20px;
                margin-bottom: 10px;
            }
            
            .section { margin-bottom: 30px; page-break-inside: avoid; }
            
            .metric-box {
                display: inline-block;
                background: #f9f9f9;
                padding: 15px 20px;
                margin: 10px 10px 10px 0;
                border-radius: 6px;
                border-left: 3px solid #ff8120;
                min-width: 200px;
            }
            .metric-label { font-size: 11px; color: #666; text-transform: uppercase; margin-bottom: 5px; }
            .metric-value { font-size: 18px; font-weight: bold; color: #ff8120; }
            
            .score-box {
                text-align: center;
                background: #f9f9f9;
                padding: 30px;
                border-radius: 8px;
                margin: 20px 0;
                border: 2px solid #ff8120;
            }
            .score-number {
                font-size: 48px;
                font-weight: bold;
                color: ${scoreColor};
                margin-bottom: 10px;
            }
            .score-label { font-size: 12px; color: #666; text-transform: uppercase; }
            
            .goal-plan {
                background: #f9f9f9;
                padding: 15px;
                border-radius: 6px;
                margin: 15px 0;
                border-left: 3px solid #ff8120;
                page-break-inside: avoid;
            }
            .goal-plan h4 { color: #ff8120; margin-bottom: 10px; }
            .goal-stat {
                display: flex;
                justify-content: space-between;
                padding: 8px 0;
                font-size: 14px;
            }
            .goal-stat-label { color: #666; }
            .goal-stat-value { color: #ff8120; font-weight: bold; }
            
            p { margin-bottom: 12px; color: #444; }
            strong { color: #000; }
            
            .footer {
                text-align: center;
                margin-top: 40px;
                padding-top: 20px;
                border-top: 1px solid #ddd;
                color: #666;
                font-size: 12px;
            }
        </style>
    </head>
    <body>
        <!-- PAGE 1: EXECUTIVE SUMMARY -->
        <div class="page">
            <div class="header">
                <h1>${firstName}'s 90-Day Wealth Blueprint</h1>
                <p class="subtitle">Personalized Financial Transformation Strategy</p>
            </div>
            
            <div class="section">
                <h2>Your Wealth Position</h2>
                <p>${executiveSummary}</p>
                <p>Combined with your <strong>${riskTolerance}</strong> risk tolerance and <strong>${timeline}</strong> timeline, you're positioned to build meaningful wealth within your desired timeframe.</p>
            </div>
            
            <div class="section">
                <h3>Your Financial Snapshot</h3>
                <div class="metric-box">
                    <div class="metric-label">Monthly Income</div>
                    <div class="metric-value">${formatCurrency(income)}</div>
                </div>
                <div class="metric-box">
                    <div class="metric-label">Monthly Expenses</div>
                    <div class="metric-value">${formatCurrency(expenses)}</div>
                </div>
                <div class="metric-box">
                    <div class="metric-label">Monthly Surplus</div>
                    <div class="metric-value" style="color: ${surplus > 0 ? '#33cc66' : '#ff4444'};">${formatCurrency(surplus)}</div>
                </div>
                <div class="metric-box">
                    <div class="metric-label">Current Savings</div>
                    <div class="metric-value">${formatCurrency(savings)}</div>
                </div>
                <div class="metric-box">
                    <div class="metric-label">Total Debt</div>
                    <div class="metric-value" style="color: #ff4444;">${formatCurrency(debt)}</div>
                </div>
            </div>
            
            <div class="footer">
                <p>Generated: ${new Date().toLocaleDateString()} | Financial Freedom Analyzer</p>
            </div>
        </div>

        <!-- PAGE 2: FINANCIAL HEALTH SCORE -->
        <div class="page">
            <div class="header">
                <h1>Financial Health Score</h1>
                <p class="subtitle">Your Position in the Wealth-Building Spectrum</p>
            </div>
            
            <div class="score-box">
                <div class="score-number">${healthScore}</div>
                <div class="score-label">/100 Financial Health Index</div>
            </div>
            
            <div class="section">
                <h3>Your Position</h3>
                <p><strong style="font-size: 16px; color: ${scoreColor};">${scoreInterpretation}</strong></p>
                
                <h3 style="margin-top: 30px;">Assessment Breakdown</h3>
                <div class="goal-plan">
                    <div class="goal-stat">
                        <span class="goal-stat-label">Surplus Capacity</span>
                        <span class="goal-stat-value">${surplus > 0 ? 'Strong' : 'Deficit'}</span>
                    </div>
                    <div class="goal-stat">
                        <span class="goal-stat-label">Financial Cushion</span>
                        <span class="goal-stat-value">${(savings / expenses).toFixed(1)} months</span>
                    </div>
                    <div class="goal-stat">
                        <span class="goal-stat-label">Debt-to-Income Ratio</span>
                        <span class="goal-stat-value">${((debt / (income * 12)) * 100).toFixed(0)}%</span>
                    </div>
                    <div class="goal-stat">
                        <span class="goal-stat-label">Income Sources</span>
                        <span class="goal-stat-value">${(incomeSources || '').split(',').length}</span>
                    </div>
                </div>
            </div>
            
            <div class="footer">
                <p>This score reflects your current financial position and capacity for strategic wealth building.</p>
            </div>
        </div>

        <!-- PAGE 3: 90-DAY ACTION BLUEPRINT -->
        <div class="page">
            <div class="header">
                <h1>90-Day Action Blueprint</h1>
                <p class="subtitle">Your Personalized Wealth-Building Strategy</p>
            </div>
            
            <div class="section">
                <h2>Emergency Fund Strategy</h2>
                <div class="goal-plan">
                    <h4>3-Month Emergency Reserve</h4>
                    <div class="goal-stat">
                        <span>Target Amount:</span>
                        <span style="color: #ff8120; font-weight: bold;">${formatCurrency(expenses * 3)}</span>
                    </div>
                    <div class="goal-stat">
                        <span>Current Position:</span>
                        <span style="color: #ff8120; font-weight: bold;">${formatCurrency(savings)}</span>
                    </div>
                    <div class="goal-stat">
                        <span>Monthly Allocation:</span>
                        <span style="color: #ff8120; font-weight: bold;">${formatCurrency(surplus * 0.6)}</span>
                    </div>
                    <p style="margin-top: 10px; font-size: 14px;"><strong>Action:</strong> Week 1-2: Automate transfer to high-yield savings. Week 3-4: Lock best rates. Week 5-8: Scale contributions. Week 9-12: Complete target.</p>
                </div>
            </div>
            
            ${debt > 0 ? `
            <div class="section">
                <h2>Debt Elimination Timeline</h2>
                <div class="goal-plan">
                    <h4>Strategic Payoff Plan</h4>
                    <div class="goal-stat">
                        <span>Total Debt:</span>
                        <span style="color: #ff8120; font-weight: bold;">${formatCurrency(debt)}</span>
                    </div>
                    <div class="goal-stat">
                        <span>Freedom Timeline:</span>
                        <span style="color: #ff8120; font-weight: bold;">${Math.ceil(debt / Math.max(surplus, 1))} months</span>
                    </div>
                    <div class="goal-stat">
                        <span>90-Day Reduction Target:</span>
                        <span style="color: #ff8120; font-weight: bold;">${formatCurrency(Math.min(surplus * 3, debt))}</span>
                    </div>
                    <p style="margin-top: 10px; font-size: 14px;"><strong>Strategy:</strong> Allocate ${formatCurrency(surplus)} monthly to debt elimination. Choose Avalanche (fastest interest payoff) or Snowball (psychological wins).</p>
                </div>
            </div>
            ` : ''}
            
            <div class="section">
                <h2>Investment Deployment</h2>
                <div class="goal-plan">
                    <h4>Strategic Capital Allocation</h4>
                    <div class="goal-stat">
                        <span>Monthly Investment:</span>
                        <span style="color: #ff8120; font-weight: bold;">${formatCurrency(surplus * 0.7)}</span>
                    </div>
                    <div class="goal-stat">
                        <span>90-Day Capital:</span>
                        <span style="color: #ff8120; font-weight: bold;">${formatCurrency(surplus * 0.7 * 3)}</span>
                    </div>
                    <div class="goal-stat">
                        <span>Risk Profile:</span>
                        <span style="color: #ff8120; font-weight: bold;">${riskTolerance}-Based</span>
                    </div>
                    <p style="margin-top: 10px; font-size: 14px;"><strong>Action:</strong> Week 1-2: Education & account setup. Week 3-4: Deploy first investment. Week 5+: Automate monthly contributions.</p>
                </div>
            </div>
            
            <div class="footer">
                <p>Progress tracking recommended weekly; comprehensive review monthly.</p>
            </div>
        </div>

        <!-- PAGE 4: OPPORTUNITIES & RISKS -->
        <div class="page">
            <div class="header">
                <h1>Strategic Opportunities & Risks</h1>
                <p class="subtitle">Maximizing Upside, Minimizing Downside</p>
            </div>
            
            <div class="section">
                <h2>Opportunities Identified</h2>
                
                ${surplus > 0 ? `
                <div class="goal-plan">
                    <h4 style="color: #33cc66;">Wealth Compounding Potential</h4>
                    <p>Your ${formatCurrency(surplus)} monthly surplus compounds dramatically over time:</p>
                    <div class="goal-stat">
                        <span>5-Year Projection (7% growth):</span>
                        <span style="color: #33cc66; font-weight: bold;">${formatCurrency(surplus5Year)}</span>
                    </div>
                    <p style="margin-top: 10px; font-size: 14px;"><strong>Implication:</strong> Consistent deployment creates exponential wealth growth.</p>
                </div>
                ` : ''}
                
                <div class="goal-plan">
                    <h4 style="color: #33cc66;">Income Growth Potential</h4>
                    <p>Current sources: <strong>${incomeSources || 'Primary income'}</strong></p>
                    <p><strong>Opportunity:</strong> +15-25% income growth within 12 months through strategic action.</p>
                    <p style="margin-top: 10px; font-size: 14px;"><strong>Action:</strong> Identify one high-leverage income stream this month.</p>
                </div>
            </div>
            
            <div class="section">
                <h2>Risks to Monitor</h2>
                
                ${surplus > (income * 0.2) ? `
                <div class="goal-plan">
                    <h4 style="color: #ff4444;">Risk: Lifestyle Inflation</h4>
                    <p>As surplus increases, expenses tend to rise proportionally, reducing wealth-building capacity.</p>
                    <p><strong>Protection:</strong> Lock current lifestyle baseline. Direct all new surplus to wealth systems.</p>
                    <p style="margin-top: 10px; font-size: 14px; color: #ff4444;"><strong>Impact if unchecked:</strong> 50-60% reduction in wealth-building capacity</p>
                </div>
                ` : ''}
                
                ${debt > 0 ? `
                <div class="goal-plan">
                    <h4 style="color: #ff4444;">Risk: Debt Interest Drain</h4>
                    <div class="goal-stat">
                        <span>Annual Interest Cost (est. 5%):</span>
                        <span style="color: #ff4444; font-weight: bold;">${formatCurrency(debt * 0.05)}</span>
                    </div>
                    <p style="margin-top: 10px;"><strong>Strategic Priority:</strong> Debt elimination is 100% ROI investment.</p>
                </div>
                ` : ''}
            </div>
            
            <div class="footer">
                <p>Review quarterly and adjust strategies based on changing circumstances.</p>
            </div>
        </div>

        <!-- PAGE 5: MILESTONES & MANIFESTO -->
        <div class="page">
            <div class="header">
                <h1>Your Wealth Milestones</h1>
                <p class="subtitle">From Today to Your 5-Year Vision</p>
            </div>
            
            <div class="section">
                <h2>Strategic Milestones</h2>
                
                <div class="goal-plan">
                    <h4>90-Day Milestone</h4>
                    <div class="goal-stat">
                        <span>Target Date:</span>
                        <span style="color: #ff8120; font-weight: bold;">${new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toLocaleDateString()}</span>
                    </div>
                    <div class="goal-stat">
                        <span>Projected Savings:</span>
                        <span style="color: #ff8120; font-weight: bold;">${formatCurrency(savings + surplus90)}</span>
                    </div>
                    <p style="margin-top: 10px; font-size: 14px;"><strong>Milestone:</strong> You've created real financial momentum and breathing room.</p>
                </div>
                
                <div class="goal-plan">
                    <h4>12-Month Milestone</h4>
                    <div class="goal-stat">
                        <span>Target Date:</span>
                        <span style="color: #ff8120; font-weight: bold;">${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toLocaleDateString()}</span>
                    </div>
                    <div class="goal-stat">
                        <span>Projected Net Worth:</span>
                        <span style="color: #ff8120; font-weight: bold;">${formatCurrency(savings + surplus12Month - debt)}</span>
                    </div>
                    <div class="goal-stat">
                        <span>Wealth Created:</span>
                        <span style="color: #33cc66; font-weight: bold;">${formatCurrency(surplus12Month)}</span>
                    </div>
                </div>
                
                <div class="goal-plan">
                    <h4>5-Year Vision</h4>
                    <div class="goal-stat">
                        <span>Projected Wealth:</span>
                        <span style="color: #ff8120; font-weight: bold;">${formatCurrency(surplus5Year)}</span>
                    </div>
                    <p style="margin-top: 10px; font-size: 14px;"><strong>What Becomes Possible:</strong> Home ownership, business investment, generational wealth, financial independence.</p>
                </div>
            </div>
            
            <div class="section">
                <h2>Your 90-Day Commitment</h2>
                <div style="background: #fff3e0; border: 2px solid #ff8120; padding: 20px; border-radius: 8px; text-align: center;">
                    <h3 style="color: #ff8120; border: none; padding: 0;">I am building wealth for FREEDOM.</h3>
                    <p style="margin-top: 15px;">I have ${formatCurrency(surplus)} monthly surplus. I commit to:</p>
                    <p>✓ Allocating my surplus strategically<br/>
                    ✓ Taking decisive action this week<br/>
                    ✓ Maintaining 100% consistency<br/>
                    ✓ Reviewing progress monthly</p>
                    <p style="margin-top: 15px; font-weight: bold; color: #ff8120; font-size: 16px;">My transformation starts TODAY.</p>
                </div>
            </div>
            
            <div class="footer">
                <p>Financial Freedom Analyzer | 90-Day Wealth Blueprint</p>
                <p>This blueprint is personalized to your situation. Review quarterly and adjust as life evolves.</p>
            </div>
        </div>
    </body>
    </html>
    `;
}

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'Blueprint PDF API'
    });
});

/**
 * Start server
 */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Blueprint PDF API running on port ${PORT}`);
    console.log(`📊 Features: PDF Generation | Vercel Blob Storage | Active Campaign Integration`);
});

module.exports = app;
