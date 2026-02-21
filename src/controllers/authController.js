const db = require('../config/db');
const jwt = require('jsonwebtoken');
const axios = require('axios');

// --- 1. FULL EMERGENCY COMMAND MAPPING ---
const getNeighbors = (zone) => {
    const map = {
        1: [14, 12, 1], 2: [11, 17, 2], 3: [13, 8, 3], 4: [9, 10, 4],
        5: [16, 18, 5], 6: [15, 17, 6], 7: [7, 8, 4], 8: [3, 7, 8],
        9: [4, 10, 9], 10: [4, 9, 10], 11: [2, 17, 11], 12: [1, 13, 12],
        13: [3, 12, 13], 14: [1, 10, 14], 15: [6, 16, 15], 16: [5, 15, 16],
        17: [2, 6, 11, 17], 18: [5, 16, 18]
    };
    return map[zone] || [7];
};

// --- 2. AUTHENTICATION & REGISTRATION ---
exports.requestOtp = async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ success: false, message: "Phone number required" });
    const generatedCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000);
    try {
        await db.query(
            `INSERT INTO di_otp_codes (phone_number, code, expires_at, attempts) 
             VALUES ($1, $2, $3, 0) ON CONFLICT (phone_number) DO UPDATE SET code = $2, expires_at = $3, attempts = 0`,
            [phoneNumber, generatedCode, expiresAt]
        );
        console.log(`[SMS SIMULATION] To: ${phoneNumber} | Code: ${generatedCode}`);
        res.status(200).json({ success: true, message: "OTP sent" });
    } catch (err) { res.status(500).json({ success: false }); }
};

exports.verifyAndRegister = async (req, res) => {
    const { phoneNumber, otp } = req.body;
    try {
        const otpCheck = await db.query('SELECT * FROM di_otp_codes WHERE phone_number = $1', [phoneNumber]);
        const record = otpCheck.rows[0];
        
        if (!record || new Date() > new Date(record.expires_at) || record.attempts >= 3) {
            return res.status(400).json({ success: false, message: "Invalid or expired OTP." });
        }
        
        if (record.code !== otp) {
            await db.query('UPDATE di_otp_codes SET attempts = attempts + 1 WHERE id = $1', [record.id]);
            return res.status(400).json({ success: false, message: "Invalid code." });
        }

        const userCheck = await db.query('SELECT id FROM di_users WHERE phone_number = $1', [phoneNumber]);
        const userExists = userCheck.rows.length > 0;

        const userResult = await db.query(
            `INSERT INTO di_users (phone_number, is_otp_verified, verification_status, subscription_tier, subscription_status)
             VALUES ($1, true, 'unverified', 1, 'inactive') 
             ON CONFLICT (phone_number) DO UPDATE SET is_otp_verified = true
             RETURNING id, phone_number`, [phoneNumber]
        );
        
        const user = userResult.rows[0];
        const token = jwt.sign(
            { userId: user.id, phoneNumber: user.phone_number }, 
            process.env.JWT_SECRET, 
            { expiresIn: '365d' }
        );

        await db.query('DELETE FROM di_otp_codes WHERE phone_number = $1', [phoneNumber]);
        res.status(200).json({ success: true, token, message: userExists ? "Logged in successfully." : "Verified." });
    } catch (err) { res.status(500).json({ success: false }); }
};

// --- 3. KYC (NIN & PHOTO) ---
exports.verifyNINAuth = async (req, res) => {
    const { ninNumber, consent, safetyPin } = req.body;
    const userId = req.user.userId;
    if (!ninNumber || ninNumber.length !== 11 || !consent) return res.status(400).json({ success: false, message: "Invalid NIN." });
    try {
        await db.query(
            `UPDATE di_users SET verification_status = 'approved', id_type = 'NIN', nin_number = $1, safety_pin = $2 WHERE id = $3`,
            [ninNumber, safetyPin, userId]
        );
        res.json({ success: true, message: "Identity and Safe Word PIN linked." });
    } catch (err) { res.status(500).json({ success: false }); }
};

exports.uploadIdDocument = async (req, res) => {
    const userId = req.user.userId;
    if (!req.file) return res.status(400).json({ success: false, message: "No image file." });
    try {
        await db.query(`UPDATE di_users SET id_image_url = $1 WHERE id = $2`, [req.file.path, userId]);
        res.json({ success: true, message: "ID image uploaded" });
    } catch (err) { res.status(500).json({ success: false }); }
};

// --- 4. SUBSCRIPTION & PAYSTACK ---
exports.selectCategory = async (req, res) => {
    const { category } = req.body; 
    const userId = req.user.userId;
    try {
        await db.query(`UPDATE di_users SET subscription_tier = $1, subscription_status = 'pending_payment' WHERE id = $2`, [category, userId]);
        res.json({ success: true, message: "Category selected. Proceed to payment." });
    } catch (err) { res.status(500).json({ success: false }); }
};

exports.initializePayment = async (req, res) => {
    const { planType } = req.body; 
    const userId = req.user.userId;
    try {
        const user = (await db.query('SELECT phone_number, subscription_tier FROM di_users WHERE id = $1', [userId])).rows[0];
        const prices = { 1: 1000, 2: 1500, 3: 3000 }; 
        let amount = prices[user.subscription_tier];
        if (planType === 'yearly') amount = (amount * 12) * 0.5;

        const response = await axios.post('https://api.paystack.co/transaction/initialize', 
            { email: `${user.phone_number}@di-platform.com`, amount: amount * 100, metadata: { userId } },
            { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
        );
        await db.query('UPDATE di_users SET paystack_ref = $1 WHERE id = $2', [response.data.data.reference, userId]);
        res.json({ success: true, authorization_url: response.data.data.authorization_url });
    } catch (err) { res.status(500).json({ success: false }); }
};

exports.paystackWebhook = async (req, res) => {
    const event = req.body;
    if (event.event === 'charge.success') {
        const userId = event.data.metadata.userId;
        await db.query("UPDATE di_users SET subscription_status = 'active' WHERE id = $1", [userId]);
        await db.query("UPDATE di_circle_links SET invite_status = 'pending' WHERE user_id = $1 AND invite_status = 'pending_payment'", [userId]);
    }
    res.sendStatus(200);
};

// --- 5. RESPONDER MANAGEMENT ---
exports.addResponder = async (req, res) => {
    const { responderPhone, responderName, relationship } = req.body;
    const userId = req.user.userId;
    try {
        const user = (await db.query('SELECT subscription_tier, subscription_status FROM di_users WHERE id = $1', [userId])).rows[0];
        const limits = { 1: 1, 2: 3, 3: 5 };
        const countResult = await db.query('SELECT COUNT(*) FROM di_circle_links WHERE user_id = $1', [userId]);
        
        if (parseInt(countResult.rows[0].count) >= limits[user.subscription_tier]) {
            return res.status(400).json({ message: "Limit reached." });
        }

        await db.query(
            'INSERT INTO di_circle_links (user_id, responder_name, responder_phone, relationship, invite_status) VALUES ($1, $2, $3, $4, $5)',
            [userId, responderName, responderPhone, relationship, user.subscription_status === 'active' ? 'pending' : 'pending_payment']
        );
        res.json({ success: true, message: "Responder added." });
    } catch (err) { res.status(500).json({ success: false }); }
};

// --- 6. STEALTH PANIC & REAL-TIME HANDSHAKE (UNIFIED) ---

exports.triggerPanicAlert = async (req, res) => {
    const userId = req.user.userId;
    const { latitude, longitude, currentState, addressLine } = req.body; 

    try {
        await db.query('BEGIN'); // Start atomic block

        const user = (await db.query('SELECT subscription_status FROM di_users WHERE id = $1', [userId])).rows[0];
        if (!user || user.subscription_status !== 'active') {
            await db.query('ROLLBACK');
            return res.status(403).json({ success: false, message: "Subscription required." });
        }

        // 1. Update User Record
        await db.query('UPDATE di_users SET is_emergency_active = TRUE WHERE id = $1', [userId]);
        
        // 2. Log Start Location
        await db.query(
            'INSERT INTO di_locations (user_id, latitude, longitude, state_name, address_line) VALUES ($1, $2, $3, $4, $5)', 
            [userId, latitude, longitude, currentState, addressLine]
        );

        // 3. Create/Update Active Alert
        await db.query(
            `INSERT INTO di_alerts (user_id, status, start_latitude, start_longitude, start_state, started_at) 
             VALUES ($1, 'active', $2, $3, $4, NOW()) 
             ON CONFLICT (user_id) DO UPDATE SET status = 'active', started_at = NOW(), resolved_at = NULL`,
            [userId, latitude, longitude, currentState]
        );

        await db.query('COMMIT'); // Finalize all changes
        console.log(`🚨 SOS ACTIVATED: User ${userId}`);
        res.json({ success: true, message: "SOS Activated." });
    } catch (err) { 
        await db.query('ROLLBACK');
        console.error("SOS Trigger Error:", err);
        res.status(500).json({ success: false }); 
    }
};

exports.checkActiveAlerts = async (req, res) => {
    try {
        const responderId = req.user.userId;
        const result = await db.query(
            `SELECT cl.id as link_id, u.full_name as victim_name, u.id_image_url, u.phone_number as victim_phone
             FROM di_circle_links cl
             JOIN di_users u ON cl.user_id = u.id
             WHERE cl.responder_phone = (SELECT phone_number FROM di_users WHERE id = $1)
             AND u.is_emergency_active = TRUE`,
            [responderId]
        );
        res.json({ success: true, activeAlert: result.rows[0] || null });
    } catch (err) { res.status(500).json({ success: false }); }
};

exports.getVictimEmergencyDetails = async (req, res) => {
    const { linkId } = req.params;
    try {
        const result = await db.query(
            `SELECT l.id, u.full_name as victim_name, u.id_image_url, u.phone_number as victim_phone,
                    u.is_emergency_active, u.subscription_tier, loc.latitude, loc.longitude, 
                    loc.state_name as current_state, loc.address_line as last_known_address
             FROM di_circle_links l 
             JOIN di_users u ON l.user_id = u.id 
             LEFT JOIN LATERAL (
                SELECT latitude, longitude, state_name, address_line FROM di_locations 
                WHERE user_id = u.id ORDER BY id DESC LIMIT 1
             ) loc ON true WHERE l.id = $1`, [linkId]
        );

        if (result.rowCount === 0) return res.status(404).json({ success: false });
        const victim = result.rows[0];
        
        const stateForQuery = victim.current_state || 'Lagos';
        const zoneQuery = await db.query('SELECT zone_number FROM di_emergency_commands WHERE state_name = $1', [stateForQuery]);
        const primaryZone = zoneQuery.rows[0]?.zone_number || 7;
        const zonalCodes = (victim.subscription_tier === 1) ? [0] : getNeighbors(primaryZone);
        
        const phoneQuery = await db.query(
            'SELECT zone_number, control_room_numbers FROM di_emergency_commands WHERE zone_number = ANY($1)', [zonalCodes]
        );

        res.json({ success: true, data: { ...victim, actionable_police_contacts: phoneQuery.rows } });
    } catch (err) { res.status(500).json({ success: false }); }
};

exports.deactivatePanicAlert = async (req, res) => {
    const { pin } = req.body;
    const userId = req.user.userId;

    try {
        const userResult = await db.query('SELECT safety_pin FROM di_users WHERE id = $1', [userId]);
        const user = userResult.rows[0];
        
        if (!user || user.safety_pin !== pin) {
            return res.status(403).json({ success: false, message: "Incorrect PIN." });
        }
        
        await db.query('BEGIN'); // Start atomic resolution

        // Update both tables simultaneously
        await db.query('UPDATE di_users SET is_emergency_active = FALSE WHERE id = $1', [userId]);
        await db.query(
            "UPDATE di_alerts SET status = 'resolved', resolved_at = NOW() WHERE user_id = $1 AND status = 'active'", 
            [userId]
        );

        await db.query('COMMIT'); // Commit the resolution
        console.log(`✅ SOS RESOLVED: User ${userId}`);
        res.json({ success: true, message: "Deactivated successfully." });
    } catch (err) { 
        await db.query('ROLLBACK');
        console.error("Deactivation Error:", err);
        res.status(500).json({ success: false }); 
    }
};

// --- 7. UTILITY & PROFILE ---
exports.getUserProfile = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM di_users WHERE id = $1', [req.user.userId]);
        res.json({ success: true, profile: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false }); }
};

// MODIFIED: Now includes responder_id (the user ID of the guardian)
exports.getCircleStatus = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT cl.*, u.id as responder_id 
             FROM di_circle_links cl
             JOIN di_users u ON cl.responder_phone = u.phone_number
             WHERE cl.user_id = $1`,
            [req.user.userId]
        );
        res.json({ success: true, responders: result.rows });
    } catch (err) { 
        console.error("Circle status error:", err);
        res.status(500).json({ success: false }); 
    }
};

exports.acceptInvite = async (req, res) => {
    const { responderPhone } = req.body;
    try {
        await db.query("UPDATE di_circle_links SET invite_status = 'accepted' WHERE responder_phone = $1", [responderPhone]);
        res.json({ success: true, message: "Accepted" });
    } catch (err) { res.status(500).json({ success: false }); }
};

exports.updateLiveLocation = async (req, res) => {
    const { latitude, longitude } = req.body;
    try {
        await db.query('INSERT INTO di_locations (user_id, latitude, longitude) VALUES ($1, $2, $3)', [req.user.userId, latitude, longitude]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
};