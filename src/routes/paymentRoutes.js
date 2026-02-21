const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../config/db');
require('dotenv').config();

// 1. UNIFIED ONBOARDING: Register + Calculate Price + Initialize Paystack
router.post('/onboard-subscriber', async (req, res) => {
    const { full_name, email, phone_number, responders, interval } = req.body;
    
    // Pricing Logic
    const responderCount = responders.length; 
    let baseRate = 2000; // Base price per responder per month
    let totalAmount = baseRate * responderCount;

    // Apply 50% discount for yearly billing
    if (interval === 'yearly') {
        totalAmount = (totalAmount * 12) * 0.5;
    }

    try {
        // Create the User in Neon
        // Note: registration_complete is false until payment is verified
        const userResult = await db.query(
            'INSERT INTO di_users (full_name, email, phone_number, responder_limit, billing_cycle, plan_type, subscription_status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [full_name, email, phone_number, responderCount, interval, 'PREMIUM', 'inactive']
        );
        const victimId = userResult.rows[0].id;

        // Store the Guardians/Responders in the Circle Links table
        for (let phone of responders) {
            await db.query(
                'INSERT INTO di_circle_links (victim_id, responder_phone) VALUES ($1, $2)',
                [victimId, phone]
            );
        }

        // Initialize Paystack Transaction
        const paystackRes = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            {
                email,
                amount: totalAmount * 100, // Amount in Kobo
                callback_url: `http://localhost:5000/api/pay/verify`, // Where Paystack sends user after payment
                metadata: { 
                    victim_id: victimId,
                    responder_count: responderCount
                }
            },
            { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
        );

        res.json({
            status: "success",
            message: "Onboarding initiated",
            total_amount: totalAmount,
            checkout_url: paystackRes.data.data.authorization_url
        });

    } catch (error) {
        console.error("Onboarding Error:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Could not initialize onboarding. Check server logs." });
    }
});

// 2. VERIFICATION ROUTE: Finalize the "Security Circle"
router.get('/verify', async (req, res) => {
    const { trxref } = req.query;

    try {
        const response = await axios.get(
            `https://api.paystack.co/transaction/verify/${trxref}`,
            { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
        );

        if (response.data.data.status === 'success') {
            const victimId = response.data.data.metadata.victim_id;

            // Activate the user in Neon
            await db.query(
                'UPDATE di_users SET subscription_status = $1, registration_complete = $2 WHERE id = $3',
                ['active', true, victimId]
            );

            res.send("<h1>Payment Successful! Your Security Circle is now being activated.</h1>");
            // NOTE: This is where we will trigger the SMS Invites to Responders next!
        } else {
            res.status(400).send("Payment failed. Please try again.");
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;