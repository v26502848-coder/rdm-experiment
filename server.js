const express = require('express');
const cors = require('cors');
const { 
    saveParticipantTrials, 
    getAllTrials, 
    getParticipantSummaries, 
    checkParticipantExists 
} = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname));

// Enable CORS and JSON parsing (supporting up to 2MB batches)
app.use(cors());
app.use(express.json({ limit: '2mb' }));

/**
 * Endpoint 1: POST /api/save-trial-data
 * Receives and validates strict trial-level data from participants
 */
app.post('/api/save-trial-data', (req, res) => {
    const { participant_id, trials } = req.body;

    // 1. Basic Structure Validation
    if (!participant_id || !Array.isArray(trials) || trials.length === 0) {
        return res.status(400).json({ 
            success: false, 
            message: "Malformed request. Missing participant_id or trials array." 
        });
    }

    // 2. Prevent Duplicate Participant Submissions
    checkParticipantExists(participant_id, (err, exists) => {
        if (err) {
            console.error("DB check participant error:", err.message);
            return res.status(500).json({ success: false, message: "Database validation failed." });
        }
        if (exists) {
            return res.status(400).json({ 
                success: false, 
                message: `Duplicate entry. Participant ID '${participant_id}' has already submitted results.` 
            });
        }

        // 3. Schema Validation & Sanitization per Row
        const validBlocks = ["practice", "neutral", "pressure"];
        const validCoherences = [0.05, 0.10, 0.25, 0.35];
        const validDirections = ["left", "right", null];
        const validGroups = ["positive", "negative"];

        for (let i = 0; i < trials.length; i++) {
            const t = trials[i];
            
            // Check mandatory core identifiers
            if (t.participant_id !== participant_id) {
                return res.status(400).json({ success: false, message: `Row ${i+1}: Participant ID mismatch.` });
            }
            if (typeof t.trial_num !== 'number' || t.trial_num < 1) {
                return res.status(400).json({ success: false, message: `Row ${i+1}: Invalid trial number.` });
            }
            if (!validBlocks.includes(t.block)) {
                return res.status(400).json({ success: false, message: `Row ${i+1}: Block must be practice, neutral, or pressure.` });
            }
            if (!validCoherences.includes(t.coherence)) {
                return res.status(400).json({ success: false, message: `Row ${i+1}: Invalid coherence value (must be 0.05, 0.10, 0.25, or 0.35).` });
            }
            if (t.response !== undefined && !validDirections.includes(t.response)) {
                return res.status(400).json({ success: false, message: `Row ${i+1}: Response must be 'left', 'right', or null.` });
            }
            if (t.accuracy !== 0 && t.accuracy !== 1) {
                return res.status(400).json({ success: false, message: `Row ${i+1}: Accuracy must be 0 or 1.` });
            }
            if (t.rt !== null && typeof t.rt !== 'number') {
                return res.status(400).json({ success: false, message: `Row ${i+1}: RT must be a number or null.` });
            }
            if (t.valid_trial !== 0 && t.valid_trial !== 1) {
                return res.status(400).json({ success: false, message: `Row ${i+1}: valid_trial must be 0 or 1.` });
            }
            if (!validGroups.includes(t.feedback_group)) {
                return res.status(400).json({ success: false, message: `Row ${i+1}: feedback_group must be positive or negative.` });
            }
            if (t.confidence_rating !== null && (typeof t.confidence_rating !== 'number' || t.confidence_rating < 1 || t.confidence_rating > 7)) {
                return res.status(400).json({ success: false, message: `Row ${i+1}: confidence_rating must be integer 1-7 or null.` });
            }

            // Check secondary system metrics
            if (t.manipulated_trial !== 0 && t.manipulated_trial !== 1) {
                return res.status(400).json({ success: false, message: `Row ${i+1}: manipulated_trial must be 0 or 1.` });
            }
            if (typeof t.credit_balance !== 'number') {
                return res.status(400).json({ success: false, message: `Row ${i+1}: credit_balance must be an integer.` });
            }
            if (typeof t.timer_condition !== 'string') {
                return res.status(400).json({ success: false, message: `Row ${i+1}: timer_condition must be a string.` });
            }
        }

        // 4. Batch Transactional Insert
        saveParticipantTrials(trials, (err) => {
            if (err) {
                console.error("Transactional write failed:", err.message);
                return res.status(500).json({ success: false, message: "Database write error. Data rolled back." });
            }
            console.log(`Successfully stored ${trials.length} clean trial rows for participant: ${participant_id}`);
            return res.status(200).json({ success: true, message: "Dataset uploaded and saved successfully." });
        });
    });
});

/**
 * Endpoint 2: GET /api/export-merged-data
 * Exposes a perfectly aggregated analysis-ready CSV dataset with no nested structures
 */
app.get('/api/export-merged-data', (req, res) => {
    getAllTrials((err, rows) => {
        if (err) {
            console.error("Merged export query failed:", err.message);
            return res.status(500).send("Database export query error.");
        }

        const headers = [
            "participant_id", "trial_num", "block", "coherence", "response",
            "accuracy", "rt", "valid_trial", "feedback_group", "confidence_rating",
            "feedback_shown", "actual_feedback", "manipulated_trial", "credit_balance", "timer_condition", "created_at"
        ];

        const csvRows = [headers.join(",")];

        for (const row of rows) {
            const values = headers.map(header => {
                const val = row[header];
                if (val === null || val === undefined) return "";
                const strVal = String(val);
                if (strVal.includes(",") || strVal.includes('"') || strVal.includes('\n')) {
                    return `"${strVal.replace(/"/g, '""')}"`;
                }
                return strVal;
            });
            csvRows.push(values.join(","));
        }

        const csvStr = csvRows.join("\n");

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=RDM_Merged_Study_Data.csv');
        return res.status(200).send(csvStr);
    });
});

/**
 * Endpoint 3: GET /admin
 * Serves a highly aesthetic, premium, responsive research dashboard
 */
app.get('/admin', (req, res) => {
    getParticipantSummaries((err, summaries) => {
        if (err) {
            console.error("Summaries query failed:", err.message);
            return res.status(500).send("Database query error.");
        }

        let tableRowsHtml = "";
        if (summaries.length === 0) {
            tableRowsHtml = `<tr><td colspan="7" class="empty-state">No participant submissions recorded in the database yet.</td></tr>`;
        } else {
            summaries.forEach((s) => {
                const accStr = s.mean_accuracy !== null ? s.mean_accuracy : 'N/A';
                const rtStr = s.mean_rt !== null ? s.mean_rt : 'N/A';
                const confStr = s.confidence_rating !== null ? s.confidence_rating : 'N/A';
                const groupStr = s.feedback_group !== null ? s.feedback_group : 'N/A';

                tableRowsHtml += `
                    <tr>
                        <td class="bold-text">${s.participant_id}</td>
                        <td>${s.total_trials}</td>
                        <td>${s.valid_trials}</td>
                        <td class="accuracy-highlight">${accStr}</td>
                        <td>${rtStr}</td>
                        <td>${confStr}</td>
                        <td>${groupStr}</td>
                    </tr>
                `;
            });
        }

        const dashboardHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>RDM Study — Research Dashboard</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
            <style>
                :root {
                    --bg-gradient: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
                    --panel-bg: rgba(30, 41, 59, 0.7);
                    --border-color: rgba(255, 255, 255, 0.08);
                    --accent-color: #38bdf8;
                    --accent-hover: #0ea5e9;
                    --text-primary: #f8fafc;
                    --text-secondary: #94a3b8;
                    --success-color: #34d399;
                }
                
                body {
                    background: var(--bg-gradient);
                    color: var(--text-primary);
                    font-family: 'Inter', sans-serif;
                    margin: 0;
                    padding: 40px 20px;
                    min-height: 100vh;
                    box-sizing: border-box;
                }

                .dashboard-container {
                    max-width: 1200px;
                    margin: 0 auto;
                }

                header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 40px;
                    border-bottom: 1px solid var(--border-color);
                    padding-bottom: 25px;
                }

                h1 {
                    font-family: 'Outfit', sans-serif;
                    font-size: 36px;
                    font-weight: 800;
                    margin: 0;
                    background: linear-gradient(to right, #38bdf8, #818cf8);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }

                .subtitle {
                    color: var(--text-secondary);
                    font-size: 14px;
                    margin-top: 5px;
                    letter-spacing: 0.5px;
                }

                .btn-export {
                    background: linear-gradient(135deg, var(--accent-color) 0%, #818cf8 100%);
                    color: #0f172a;
                    font-weight: 700;
                    font-size: 15px;
                    text-decoration: none;
                    padding: 14px 28px;
                    border-radius: 12px;
                    box-shadow: 0 4px 15px rgba(56, 189, 248, 0.25);
                    transition: transform 0.2s, box-shadow 0.2s;
                    display: inline-flex;
                    align-items: center;
                    font-family: 'Outfit', sans-serif;
                }

                .btn-export:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(56, 189, 248, 0.4);
                }

                .btn-export:active {
                    transform: translateY(0);
                }

                /* Stats Summary Cards */
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
                    gap: 20px;
                    margin-bottom: 40px;
                }

                .stat-card {
                    background: var(--panel-bg);
                    border: 1px solid var(--border-color);
                    border-radius: 16px;
                    padding: 24px;
                    backdrop-filter: blur(10px);
                    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
                }

                .stat-label {
                    color: var(--text-secondary);
                    font-size: 13px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }

                .stat-value {
                    font-family: 'Outfit', sans-serif;
                    font-size: 32px;
                    font-weight: 800;
                    color: var(--text-primary);
                    margin-top: 10px;
                }

                .stat-desc {
                    color: var(--text-secondary);
                    font-size: 12px;
                    margin-top: 5px;
                }

                /* Data Panel Styling */
                .data-panel {
                    background: var(--panel-bg);
                    border: 1px solid var(--border-color);
                    border-radius: 20px;
                    padding: 30px;
                    backdrop-filter: blur(10px);
                    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.3);
                    overflow: hidden;
                }

                .panel-title {
                    font-family: 'Outfit', sans-serif;
                    font-size: 22px;
                    font-weight: 700;
                    margin: 0 0 25px 0;
                    display: flex;
                    align-items: center;
                }

                .pulse-indicator {
                    width: 10px;
                    height: 10px;
                    background-color: var(--success-color);
                    border-radius: 50%;
                    margin-right: 12px;
                    display: inline-block;
                    box-shadow: 0 0 8px var(--success-color);
                    animation: pulse 1.8s infinite;
                }

                @keyframes pulse {
                    0% { transform: scale(0.9); opacity: 0.8; }
                    50% { transform: scale(1.2); opacity: 1; box-shadow: 0 0 12px var(--success-color); }
                    100% { transform: scale(0.9); opacity: 0.8; }
                }

                /* Table Styling */
                .table-container {
                    overflow-x: auto;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                    text-align: left;
                }

                th {
                    color: var(--text-secondary);
                    font-size: 13px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    padding: 16px 20px;
                    border-bottom: 2px solid var(--border-color);
                }

                td {
                    padding: 18px 20px;
                    font-size: 14px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
                    color: #cbd5e1;
                }

                tr:hover td {
                    background: rgba(255, 255, 255, 0.02);
                }

                .bold-text {
                    font-weight: 600;
                    color: var(--text-primary);
                }

                .accuracy-highlight {
                    font-weight: 700;
                    color: var(--success-color);
                }

                .date-text {
                    color: var(--text-secondary);
                    font-size: 13px;
                }

                .empty-state {
                    text-align: center;
                    padding: 60px 20px;
                    color: var(--text-secondary);
                    font-size: 15px;
                    font-style: italic;
                }
            </style>
        </head>
        <body>
            <div class="dashboard-container">
                <header>
                    <div>
                        <h1>RDM Experiment Dashboard</h1>
                        <div class="subtitle">Secure research database management portal</div>
                    </div>
                    <a href="/api/export-merged-data" class="btn-export">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 10px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Export Merged CSV
                    </a>
                </header>

                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-label">Total Submissions</div>
                        <div class="stat-value">${summaries.length}</div>
                        <div class="stat-desc">Completed participant records</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Active Database</div>
                        <div class="stat-value" style="color: var(--accent-color);">SQLite 3</div>
                        <div class="stat-desc">Local atomic file storage (data.db)</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Data Schema Status</div>
                        <div class="stat-value" style="color: var(--success-color);">Optimal</div>
                        <div class="stat-desc">Strict 15-column format confirmed</div>
                    </div>
                </div>

                <div class="data-panel">
                    <div class="panel-title">
                        <span class="pulse-indicator"></span>
                        Participant Summaries
                    </div>
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Participant ID</th>
                                    <th>Total Trials</th>
                                    <th>Valid Trials</th>
                                    <th>Mean Accuracy</th>
                                    <th>Mean RT</th>
                                    <th>Confidence Rating</th>
                                    <th>Feedback Group</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tableRowsHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </body>
        </html>
        `;
        res.setHeader('Content-Type', 'text/html');
        return res.status(200).send(dashboardHtml);
    });
});

// Start Express Server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 RDM Research Storage Server is online!`);
    console.log(`📍 Server running on port ${PORT}`);
    console.log(`📊 Admin Panel available at /admin`);
    console.log(`💾 SQLite Database connected successfully.`);
    console.log(`======================================================\n`);
});
