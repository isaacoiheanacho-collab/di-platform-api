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
            // Include reply_data in the query
            const result = await query(
                'SELECT id, user_id, text, created_at, sender_name, reply_data FROM di_messages WHERE circle_id = $1 ORDER BY created_at DESC LIMIT 50',
                [circleId]
            );
            // Send history in chronological order
            const history = result.rows.reverse();
            socket.emit('history', history);
        } catch (err) {
            console.error('Error fetching message history:', err);
        }
    });

    // Handle new message with status tracking
    socket.on('send_message', async (data) => {
        // Fetch sender's name from database
        let senderName = 'User';
        try {
            const userResult = await query('SELECT full_name FROM di_users WHERE id = $1', [socket.user.id]);
            if (userResult.rows.length > 0) {
                senderName = userResult.rows[0].full_name || 'User';
            }
        } catch (err) {
            console.error('Error fetching sender name:', err);
        }

        // Enrich message with verified sender ID and name (ensure ID is string)
        const enrichedMessage = {
            ...data,
            user: {
                ...data.user,
                _id: socket.user.id.toString(), // FIX: convert to string for alignment
                name: senderName,
            },
            createdAt: new Date(),
        };

        console.log(`📩 [Circle ${data.circleId}] Message from Verified ID ${socket.user.id} (${senderName})`);

        // Save to database including reply_data and get the message ID
        let messageId;
        try {
            const insertResult = await query(
                'INSERT INTO di_messages (circle_id, user_id, text, created_at, sender_name, reply_data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
                [
                    data.circleId,
                    socket.user.id,
                    data.text,
                    enrichedMessage.createdAt,
                    senderName,
                    data.replyTo ? JSON.stringify(data.replyTo) : null
                ]
            );
            messageId = insertResult.rows[0].id;
        } catch (err) {
            console.error('Error saving message:', err);
            return;
        }

        // Fetch all members of this circle (excluding sender) to create status records
        // For simplicity, we assume all users are in the same circle. Adjust as needed.
        try {
            const members = await query('SELECT id FROM di_users WHERE id != $1', [socket.user.id]);
            for (const member of members.rows) {
                await query(
                    'INSERT INTO message_status (message_id, user_id, status) VALUES ($1, $2, $3)',
                    [messageId, member.id, 'sent']
                );
            }
        } catch (err) {
            console.error('Error creating message statuses:', err);
        }

        // Broadcast to room
        socket.to(`circle_${data.circleId}`).emit('receive_message', enrichedMessage);
    });

    // Handle delivered notification
    socket.on('delivered', async ({ messageId }) => {
        // Update status for this recipient (the current user)
        try {
            await query(
                'UPDATE message_status SET status = $1, updated_at = NOW() WHERE message_id = $2 AND user_id = $3',
                ['delivered', messageId, socket.user.id]
            );
            // Get the sender of the message to notify them
            const msg = await query('SELECT user_id FROM di_messages WHERE id = $1', [messageId]);
            if (msg.rows.length > 0) {
                const senderId = msg.rows[0].user_id;
                socket.to(`user:${senderId}`).emit('status_update', { 
                    messageId, 
                    userId: socket.user.id, 
                    status: 'delivered' 
                });
            }
        } catch (err) {
            console.error('Error updating delivery status:', err);
        }
    });

    // --- NEW: Handle read receipt (per message) ---
    socket.on('read', async ({ messageId }) => {
        try {
            await query(
                'UPDATE message_status SET status = $1, updated_at = NOW() WHERE message_id = $2 AND user_id = $3',
                ['read', messageId, socket.user.id]
            );
            const msg = await query('SELECT user_id FROM di_messages WHERE id = $1', [messageId]);
            if (msg.rows.length > 0) {
                const senderId = msg.rows[0].user_id;
                socket.to(`user:${senderId}`).emit('status_update', { 
                    messageId, 
                    userId: socket.user.id, 
                    status: 'read' 
                });
            }
        } catch (err) {
            console.error('Error updating read status:', err);
        }
    });

    // --- NEW: Mark all messages as read when user opens chat ---
    socket.on('mark_all_read', async ({ circleId }) => {
        try {
            // Find all messages in this circle where the current user is the recipient (not sender) and status is not 'read'
            const messages = await query(
                `SELECT m.id FROM di_messages m
                 WHERE m.circle_id = $1 AND m.user_id != $2
                 AND EXISTS (SELECT 1 FROM message_status ms WHERE ms.message_id = m.id AND ms.user_id = $2 AND ms.status != 'read')`,
                [circleId, socket.user.id]
            );
            for (const row of messages.rows) {
                await query(
                    'UPDATE message_status SET status = $1, updated_at = NOW() WHERE message_id = $2 AND user_id = $3',
                    ['read', row.id, socket.user.id]
                );
                // Notify sender
                const msg = await query('SELECT user_id FROM di_messages WHERE id = $1', [row.id]);
                if (msg.rows.length > 0) {
                    const senderId = msg.rows[0].user_id;
                    socket.to(`user:${senderId}`).emit('status_update', { 
                        messageId: row.id, 
                        userId: socket.user.id, 
                        status: 'read' 
                    });
                }
            }
        } catch (err) {
            console.error('Error marking all as read:', err);
        }
    });

    // --- NEW: Handle message deletion (corrected) ---
    socket.on('delete_message', async ({ messageId }) => {
        try {
            // Check if the user is the sender and get circle_id
            const msgCheck = await query('SELECT user_id, circle_id FROM di_messages WHERE id = $1', [messageId]);
            if (msgCheck.rows.length === 0) return;
            if (msgCheck.rows[0].user_id !== socket.user.id) {
                console.log(`⚠️ User ${socket.user.id} tried to delete message ${messageId} but is not the sender`);
                return;
            }
            const circleId = msgCheck.rows[0].circle_id;
            // Delete from message_status
            await query('DELETE FROM message_status WHERE message_id = $1', [messageId]);
            // Delete the message
            await query('DELETE FROM di_messages WHERE id = $1', [messageId]);
            // Notify all participants
            socket.to(`circle_${circleId}`).emit('message_deleted', messageId);
        } catch (err) {
            console.error('Error deleting message:', err);
        }
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