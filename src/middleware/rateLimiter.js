const rateLimit = require('express-rate-limit');

const otpRequestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { success: false, message: "Too many OTP requests." },
    standardHeaders: true,
    legacyHeaders: false,
});

// IMPORTANT: Ensure this matches exactly
module.exports = { otpRequestLimiter };