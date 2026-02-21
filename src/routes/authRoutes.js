const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const securityController = require('../controllers/securityController'); 
const upload = require('../middleware/uploadMiddleware');
const authMiddleware = require('../middleware/authMiddleware');

// --- 1. PUBLIC ROUTES (No Token Needed) ---
router.post('/request-otp', authController.requestOtp);
router.post('/verify-otp', authController.verifyAndRegister);
router.post('/accept-invite', authController.acceptInvite);
router.post('/paystack-webhook', authController.paystackWebhook);
router.get('/emergency-view/:linkId', authController.getVictimEmergencyDetails);

// --- 2. SECURITY PIN ROUTES (Secured) ---
// These allow the user to set, verify, and change their 4-digit PIN
router.post('/set-pin', authMiddleware, securityController.setSecurityPin);
router.post('/verify-pin', authMiddleware, securityController.verifyPin);
router.post('/update-pin', authMiddleware, securityController.updatePin);

// --- 3. ONBOARDING & KYC ROUTES (Secured) ---
router.post('/verify-nin', authMiddleware, authController.verifyNINAuth);
router.post('/upload-id-document', authMiddleware, upload.single('idCard'), authController.uploadIdDocument);
router.post('/select-category', authMiddleware, authController.selectCategory);

// --- 4. APP FUNCTIONALITY & SOS ROUTES (Secured) ---
router.get('/profile', authMiddleware, authController.getUserProfile);
router.post('/add-responder', authMiddleware, authController.addResponder);
router.get('/circle-status', authMiddleware, authController.getCircleStatus);
router.post('/initialize-payment', authMiddleware, authController.initializePayment);
router.post('/panic-alert', authMiddleware, authController.triggerPanicAlert);
router.post('/update-location', authMiddleware, authController.updateLiveLocation);
router.post('/deactivate-panic', authMiddleware, authController.deactivatePanicAlert);

// --- 5. THE MISSING LINK: RESPONDER POLLING ROUTE ---
/**
 * This is the critical route for the ResponderDashboard.
 * It maps the polling request to the controller function that 
 * checks the database for active emergencies.
 */
router.get('/check-active-alerts', authMiddleware, authController.checkActiveAlerts);

module.exports = router;