require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const authRoutes = require('./src/routes/authRoutes');

const app = express();
const server = http.createServer(app);

// --- 1. MIDDLEWARE ---
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json()); 

// --- 2. SOCKET.IO SETUP ---
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

/**
 * SOCKET MIDDLEWARE: GATEKEEPER
 * Fixes the "undefined" User ID issue by correctly mapping the JWT payload.
 */
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        console.log("❌ Connection Rejected: No Token Provided");
        return next(new Error("Authentication error"));
    }
    
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            console.log("❌ Connection Rejected: Invalid Token");
            return next(new Error("Authentication error"));
        }
        
        // CRITICAL FIX: Ensure we map userId (from your authController.js JWT sign) 
        // to socket.user so the logs work correctly.
        socket.user = {
            id: decoded.userId, 
            phoneNumber: decoded.phoneNumber
        };
        next();
    });
});

io.on('connection', (socket) => {
    // Now socket.user.id will show up correctly in your terminal
    console.log(`📡 Device Verified: ${socket.id} (User ID: ${socket.user.id})`);

    // Join personal room for direct messages/calls (NEW)
    socket.join(`user:${socket.user.id}`);

    // --- CHAT LOGIC ---
    socket.on('join_chat', (circleId) => {
        socket.join(`circle_${circleId}`);
        console.log(`👤 User ${socket.user.id} joined Chat Circle: ${circleId}`);
    });

    socket.on('send_message', (data) => {
        // SECURITY: We use socket.user.id from the token, NOT the ID sent in the payload
        // to prevent users from spoofing other responders' identities.
        const enrichedMessage = {
            ...data,
            user: {
                ...data.user,
                _id: socket.user.id // Overwrite with verified ID
            },
            createdAt: new Date(),
        };

        console.log(`📩 [Circle ${data.circleId}] Message from Verified ID ${socket.user.id}`);
        
        // Broadcast to specific room only
        socket.to(`circle_${data.circleId}`).emit('receive_message', enrichedMessage);
    });

    // --- CALL SIGNALING (NEW) ---
    socket.on('call_user', ({ targetUserId, offer }) => {
        console.log(`📞 Call from User ${socket.user.id} to User ${targetUserId}`);
        socket.to(`user:${targetUserId}`).emit('incoming_call', {
            from: socket.user.id,
            offer
        });
    });

    socket.on('answer_call', ({ target, answer }) => {
        console.log(`📞 Call answered from User ${socket.user.id} to User ${target}`);
        socket.to(`user:${target}`).emit('call_answered', { answer });
    });

    socket.on('ice_candidate', ({ target, candidate }) => {
        socket.to(`user:${target}`).emit('ice_candidate', { candidate });
    });

    socket.on('decline_call', ({ target }) => {
        console.log(`📞 Call declined from User ${socket.user.id} to User ${target}`);
        socket.to(`user:${target}`).emit('call_declined');
    });

    socket.on('disconnect', () => {
        if (socket.user) {
            console.log(`🔌 User ${socket.user.id} Disconnected`);
        }
    });
});

// --- 3. ROUTES ---
app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
    res.send('🚀 DI Platform API is Online & Connected with Sockets!');
});

// --- 4. SERVER START ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`-----------------------------------------------`);
    console.log(`🚀 DI Live Server is LIVE & Synchronized`);
    console.log(`📡 Socket.io Engine: ACTIVE`);
    console.log(`🔒 Handshake Security: userId Mapping FIXED`);
    console.log(`🔗 Network Access: http://192.168.0.36:${PORT}`); 
    console.log(`-----------------------------------------------`);
});