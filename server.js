require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const authRoutes = require('./src/routes/authRoutes');

// Import database pool
const { query } = require('./src/config/db');

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
    },
    // Increase ping timeout to reduce disconnections on slow networks
    pingTimeout: 60000,
    pingInterval: 25000
});

/**
 * SOCKET MIDDLEWARE: GATEKEEPER
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
        
        socket.user = {
            id: decoded.userId, 
            phoneNumber: decoded.phoneNumber
        };
        next();
    });
});

io.on('connection', (socket) => {
    console.log(`📡 Device Verified: ${socket.id} (User ID: ${socket.user.id})`);

    // Join personal room for direct messages/calls
    socket.join(`user:${socket.user.id}`);

    // --- CHAT LOGIC ---
    socket.on('join_chat', (circleId) => {
        socket.join(`circle_${circleId}`);
        console.log(`👤 User ${socket.user.id} joined Chat Circle: ${circleId}`);
    });

    // Request chat history for a circle
    socket.on('request_history', async (circleId) => {
        try {
            const result = await query(
                'SELECT * FROM di_messages WHERE circle_id = $1 ORDER BY created_at DESC LIMIT 50',
                [circleId]
            );
            // Send history in chronological order
            const history = result.rows.reverse();
            socket.emit('history', history);
        } catch (err) {
            console.error('Error fetching message history:', err);
        }
    });

    // Handle new message
    socket.on('send_message', async (data) => {
        // SECURITY: Overwrite sender ID with verified user from token
        const enrichedMessage = {
            ...data,
            user: {
                ...data.user,
                _id: socket.user.id
            },
            createdAt: new Date(),
        };

        console.log(`📩 [Circle ${data.circleId}] Message from Verified ID ${socket.user.id}`);

        // Save to database
        try {
            await query(
                'INSERT INTO di_messages (circle_id, user_id, text, created_at) VALUES ($1, $2, $3, $4)',
                [data.circleId, socket.user.id, data.text, enrichedMessage.createdAt]
            );
        } catch (err) {
            console.error('Error saving message:', err);
        }

        // Broadcast to room
        socket.to(`circle_${data.circleId}`).emit('receive_message', enrichedMessage);
    });

    // --- CALL SIGNALING ---
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