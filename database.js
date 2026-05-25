const { Pool } = require("pg");

console.log("🔥 DATABASE MODULE LOADED");
console.log("DATABASE_URL =", process.env.DATABASE_URL ? "EXISTS" : "MISSING");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});
pool.connect()
  .then(() => console.log("✅ PostgreSQL CONNECTED SUCCESSFULLY"))
  .catch(err => console.error("❌ PostgreSQL CONNECTION FAILED:", err.message));
// SAVE PARTICIPANT TRIALS
async function saveParticipantTrials(trials, callback) {
    try {
        const query = `
            INSERT INTO trials (
                participant_id, trial_num, block, coherence, response,
                accuracy, rt, valid_trial, feedback_group, confidence_rating,
                feedback_shown, actual_feedback, manipulated_trial, credit_balance, timer_condition
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        `;

        for (const t of trials) {
            await pool.query(query, [
                t.participant_id,
                t.trial_num,
                t.block,
                t.coherence,
                t.response,
                t.accuracy,
                t.rt,
                t.valid_trial,
                t.feedback_group,
                t.confidence_rating,
                t.feedback_shown,
                t.actual_feedback,
                t.manipulated_trial,
                t.credit_balance,
                t.timer_condition
            ]);
        }

        callback(null);
    } catch (err) {
        console.error("Insert error:", err.message);
        callback(err);
    }
}

// GET ALL TRIALS
async function getAllTrials(callback) {
    try {
        const result = await pool.query(`
            SELECT * FROM trials
            ORDER BY participant_id, trial_num ASC
        `);
        callback(null, result.rows);
    } catch (err) {
        callback(err, null);
    }
}

// PARTICIPANT SUMMARY (FOR DASHBOARD)
async function getParticipantSummaries(callback) {
    try {
        const result = await pool.query(`
            SELECT
                participant_id,
                COUNT(*) AS total_trials,
                SUM(valid_trial) AS valid_trials,
                AVG(accuracy) AS mean_accuracy,
                AVG(rt) AS mean_rt,
                AVG(confidence_rating) AS confidence_rating
            FROM trials
            GROUP BY participant_id
            ORDER BY participant_id DESC
        `);
        callback(null, result.rows);
    } catch (err) {
        callback(err, null);
    }
}

// CHECK PARTICIPANT EXISTS
async function checkParticipantExists(participantId, callback) {
    try {
        const result = await pool.query(
            "SELECT COUNT(*) FROM trials WHERE participant_id = $1",
            [participantId]
        );

        callback(null, parseInt(result.rows[0].count) > 0);
    } catch (err) {
        callback(err, false);
    }
}

module.exports = {
    saveParticipantTrials,
    getAllTrials,
    getParticipantSummaries,
    checkParticipantExists
};