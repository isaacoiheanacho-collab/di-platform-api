const jwt = require('jsonwebtoken');

/**
 * AUTH MIDDLEWARE
 * This file acts as the security gatekeeper for your API.
 * It verifies the JWT and handles expired/invalid sessions gracefully.
 */
module.exports = (req, res, next) => {
    // 1. Look for the 'Authorization' header in the request
    const authHeader = req.headers['authorization'];
    
    // 2. Extract the token (Format: "Bearer <token>")
    const token = authHeader && authHeader.split(' ')[1];

    // 3. If there is no token, stop the request immediately
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            message: "Access Denied: No Token Provided. Please login again." 
        });
    }

    try {
        // 4. Check if the token is valid using your secret key from .env
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        
        // 5. Attach the user's data (ID and Phone) to the request object
        req.user = verified;
        
        // 6. Move to the next step (the Controller)
        next();
    } catch (err) {
        /**
         * 7. Error Handling & Logging
         * We log the exact error (e.g., "jwt expired" or "invalid signature") 
         * to the server console so you can debug in real-time.
         */
        console.error("--- JWT AUTH ERROR ---");
        console.error("Reason:", err.message);
        console.error("Timestamp:", new Date().toISOString());
        console.error("-----------------------");

        // Send a 403 Forbidden status to the frontend
        res.status(403).json({ 
            success: false, 
            message: `Session Error: ${err.message}` 
        });
    }
};