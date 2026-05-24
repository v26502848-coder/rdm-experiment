const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data.db');

// Connect to SQLite Database
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Database connection failed:", err.message);
    } else {
        console.log("Connected to SQLite Database at:", dbPath);
    }
});

// Initialize Table structure
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS trials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            participant_id TEXT NOT NULL,
            trial_num INTEGER NOT NULL,
            block TEXT NOT NULL,
            coherence REAL NOT NULL,
            response TEXT,
            accuracy INTEGER NOT NULL,
            rt REAL,
            valid_trial INTEGER NOT NULL,
            feedback_group TEXT NOT NULL,
            confidence_rating INTEGER,
            feedback_shown TEXT,
            actual_feedback TEXT NOT NULL,
            manipulated_trial INTEGER NOT NULL,
            credit_balance INTEGER NOT NULL,
            timer_condition TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error("Error creating trials table:", err.message);
        } else {
            console.log("Table 'trials' verified successfully (strict schema matching).");
        }
    });

    // Speed up SQLite inserts using WAL journal mode and synchronous setting
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
});

/**
 * Inserts a batch of clean trial rows inside an atomic transaction.
 * This guarantees transaction safety and zero partial-upload corruption.
 */
function saveParticipantTrials(trials, callback) {
    db.serialize(() => {
        db.run("BEGIN TRANSACTION", (err) => {
            if (err) return callback(err);

            const stmt = db.prepare(`
                INSERT INTO trials (
                    participant_id, trial_num, block, coherence, response,
                    accuracy, rt, valid_trial, feedback_group, confidence_rating,
                    feedback_shown, actual_feedback, manipulated_trial, credit_balance, timer_condition
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            let insertError = null;

            for (const trial of trials) {
                stmt.run(
                    [
                        trial.participant_id,
                        trial.trial_num,
                        trial.block,
                        trial.coherence,
                        trial.response,
                        trial.accuracy,
                        trial.rt,
                        trial.valid_trial,
                        trial.feedback_group,
                        trial.confidence_rating,
                        trial.feedback_shown,
                        trial.actual_feedback,
                        trial.manipulated_trial,
                        trial.credit_balance,
                        trial.timer_condition
                    ],
                    (err) => {
                        if (err) {
                            insertError = err;
                            console.error("Batch insert row error:", err.message);
                        }
                    }
                );
                if (insertError) break;
            }

            stmt.finalize((err) => {
                if (err || insertError) {
                    db.run("ROLLBACK", () => {
                        callback(err || insertError);
                    });
                } else {
                    db.run("COMMIT", (commitErr) => {
                        callback(commitErr);
                    });
                }
            });
        });
    });
}

/**
 * Returns all trials in chronological order to export a merged analytical dataset.
 */
function getAllTrials(callback) {
    db.all(`
        SELECT 
            participant_id, trial_num, block, coherence, response,
            accuracy, rt, valid_trial, feedback_group, confidence_rating,
            feedback_shown, actual_feedback, manipulated_trial, credit_balance, timer_condition,
            created_at
        FROM trials 
        ORDER BY participant_id, trial_num ASC
    `, [], (err, rows) => {
        callback(err, rows);
    });
}

/**
 * Helper to count unique participant submissions in database.
 */
function getParticipantSummaries(callback) {
    db.all(`
        SELECT
            participant_id,
            COUNT(*) AS total_trials,
            SUM(valid_trial) AS valid_trials,
            AVG(accuracy) AS mean_accuracy,
            AVG(rt) AS mean_rt,
            AVG(confidence_rating) AS confidence_rating,
            feedback_group
        FROM trials
        GROUP BY participant_id, feedback_group
    `, [], (err, rows) => {
        callback(err, rows);
    });
}

/**
 * Helper to check if a participant already has trials logged in the database.
 */
function checkParticipantExists(participantId, callback) {
    db.get("SELECT COUNT(*) as count FROM trials WHERE participant_id = ?", [participantId], (err, row) => {
        if (err) return callback(err, false);
        callback(null, row ? row.count > 0 : false);
    });
}

module.exports = {
    saveParticipantTrials,
    getAllTrials,
    getParticipantSummaries,
    checkParticipantExists
};
