const db = require('../config/db');

/**
 * SECURITY CONTROLLER
 * Handles Safety PIN logic: Creation, Verification, and Updates.
 * Column name in Neon DB: safety_pin
 */

// 1. SET/RESET PIN
// Used during onboarding or after a successful Forgot PIN OTP verification
exports.setSecurityPin = async (req, res) => {
    const { pin } = req.body;
    const userId = req.user.userId;

    // Validation: Ensure it's 4 digits
    if (!pin || pin.length !== 4) {
        return res.status(400).json({ success: false, message: "PIN must be exactly 4 digits." });
    }

    try {
        /**
         * BACKEND SAFETY CHECK:
         * We check if the user already has a PIN.
         * This prevents direct API attacks from overwriting an existing PIN
         * without going through the Verify/Update process.
         */
        const checkResult = await db.query('SELECT safety_pin FROM di_users WHERE id = $1', [userId]);
        const existingPin = checkResult.rows[0]?.safety_pin;

        // If a PIN exists and is NOT null/empty, we block 'set-pin'
        // User must use 'update-pin' or verify OTP to clear it first.
        if (existingPin && existingPin !== "") {
            return res.status(403).json({ 
                success: false, 
                message: "A PIN already exists. Use the Update or Forgot PIN flow." 
            });
        }

        // Save the new PIN
        await db.query(
            'UPDATE di_users SET safety_pin = $1 WHERE id = $2',
            [pin, userId]
        );

        res.json({ success: true, message: "Safety PIN set successfully." });
    } catch (err) {
        console.error("Set PIN Error:", err.message);
        res.status(500).json({ success: false, message: "Database error while setting PIN." });
    }
};

// 2. VERIFY PIN
// Used on the Security Lock screen to grant access to the app
exports.verifyPin = async (req, res) => {
    const { pin } = req.body;
    const userId = req.user.userId;

    try {
        const result = await db.query('SELECT safety_pin FROM di_users WHERE id = $1', [userId]);
        const userPin = result.rows[0]?.safety_pin;

        if (!userPin) {
            return res.status(404).json({ success: false, message: "No PIN found. Please create one." });
        }

        if (userPin === pin) {
            return res.json({ success: true, message: "PIN Verified." });
        } else {
            return res.status(401).json({ success: false, message: "Incorrect PIN." });
        }
    } catch (err) {
        console.error("Verify PIN Error:", err.message);
        res.status(500).json({ success: false, message: "Verification failed on server." });
    }
};

// 3. UPDATE PIN
// Used in Settings - Requires knowing the OLD PIN to set a NEW one
exports.updatePin = async (req, res) => {
    const { oldPin, newPin } = req.body;
    const userId = req.user.userId;

    if (!newPin || newPin.length !== 4) {
        return res.status(400).json({ success: false, message: "New PIN must be 4 digits." });
    }

    try {
        const result = await db.query('SELECT safety_pin FROM di_users WHERE id = $1', [userId]);
        const currentPin = result.rows[0]?.safety_pin;

        if (currentPin !== oldPin) {
            return res.status(401).json({ success: false, message: "Current PIN is incorrect." });
        }

        await db.query('UPDATE di_users SET safety_pin = $1 WHERE id = $2', [newPin, userId]);
        
        res.json({ success: true, message: "PIN updated successfully." });
    } catch (err) {
        console.error("Update PIN Error:", err.message);
        res.status(500).json({ success: false, message: "Failed to update PIN." });
    }
};