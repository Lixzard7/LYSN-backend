const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Create HTTP server to serve the HTML file
const server = http.createServer((req, res) => {
    console.log(`Request: ${req.method} ${req.url}`);
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // Serve the HTML file
    if (req.url === '/' || req.url === '/index.html') {
        const htmlPath = path.join(__dirname, 'index.html');
        console.log(`Looking for HTML file at: ${htmlPath}`);
        
        fs.readFile(htmlPath, 'utf8', (err, data) => {
            if (err) {
                console.error('Error reading HTML file:', err);
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                        <body>
                            <h1>LYSN Server is Running!</h1>
                            <p>But index.html file not found.</p>
                            <p>Please create an index.html file in the same directory as server.js</p>
                            <p>Server is running on port 3000</p>
                            <p>WebSocket server is ready for connections</p>
                        </body>
                    </html>
                `);
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
});

// Create WebSocket server
console.log('Creating WebSocket server...');
const wss = new WebSocket.Server({ 
    server: server
    // Remove the path: '/ws' to accept connections on root
});

console.log('WebSocket server created and attached to HTTP server');

// Store rooms and users
const rooms = new Map();
const userToRoom = new Map();

// Generate random room code
function generateRoomCode() {
  const adjectives = ['Cool', 'Fire', 'Epic', 'Lit', 'Vibe', 'Wave', 'Beat', 'Flow', 'Chill', 'Wild'];
  const nouns = ['Cats', 'Beats', 'Vibes', 'Squad', 'Crew', 'Gang', 'Wave', 'Zone', 'Party', 'Club'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${adj}${noun}${num}`.toUpperCase();
    //return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// Generate unique user ID
function generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 12) + Date.now().toString(36);
    //return Math.random().toString(36).substr(2, 9);
}

// Send message to specific client
function sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

// Send message to all users in a room except sender
function broadcastToRoom(roomCode, message, excludeWs = null) {
    const room = rooms.get(roomCode);
    if (room) {
        Object.values(room.users).forEach(user => {
            if (user.ws !== excludeWs && user.ws.readyState === WebSocket.OPEN) {
                sendMessage(user.ws, message);
            }
        });
    }
}

// Send message to specific user
function sendToUser(roomCode, userId, message) {
    const room = rooms.get(roomCode);
    if (room && room.users[userId]) {
        sendMessage(room.users[userId].ws, message);
    }
}

// Clean up disconnected user
function cleanupUser(ws) {
    const roomCode = userToRoom.get(ws);
    if (roomCode) {
        const room = rooms.get(roomCode);
        if (room) {
            // Find and remove user
            let removedUserId = null;
            for (const [userId, user] of Object.entries(room.users)) {
                if (user.ws === ws) {
                    delete room.users[userId];
                    removedUserId = userId;
                    break;
                }
            }
            
            // If room is empty, delete it
            if (Object.keys(room.users).length === 0) {
                rooms.delete(roomCode);
                console.log(`Room ${roomCode} deleted (empty)`);
            } else {
                // If host left, assign new host
                if (removedUserId === room.hostId) {
                    const remainingUsers = Object.keys(room.users);
                    if (remainingUsers.length > 0) {
                        room.hostId = remainingUsers[0];
                        room.users[remainingUsers[0]].isHost = true;
                        console.log(`New host assigned in room ${roomCode}: ${remainingUsers[0]}`);
                    }
                }
                
                // Notify remaining users
                broadcastToRoom(roomCode, {
                    type: 'user-left',
                    data: {
                        userId: removedUserId,
                        users: Object.fromEntries(
                            Object.entries(room.users).map(([id, user]) => [
                                id, {
                                    id,
                                    username: user.username,
                                    isHost: user.isHost
                                }
                            ])
                        )
                    }
                });
            }
        }
        userToRoom.delete(ws);
    }
}

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
    console.log('New client connected from:', req.socket.remoteAddress);
    
    // Send welcome message
    sendMessage(ws, {
        type: 'connected',
        message: 'Connected to LYSN server'
    });
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log('Received message:', message.type);
            handleMessage(ws, message);
        } catch (error) {
            console.error('Error parsing message:', error);
            sendMessage(ws, {
                type: 'error',
                message: 'Invalid message format'
            });
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected');
        cleanupUser(ws);
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        cleanupUser(ws);
    });
});

// Handle incoming messages
function handleMessage(ws, message) {
    console.log(`Handling message: ${message.type}`);
    
    switch (message.type) {
        case 'create-room':
            handleCreateRoom(ws, message.data);
            break;
            
        case 'join-room':
            handleJoinRoom(ws, message.data);
            break;
            
        case 'leave-room':
            handleLeaveRoom(ws, message.data);
            break;
            
        case 'audio-started':
            handleAudioStarted(ws, message.data);
            break;
            
        case 'audio-stopped':
            handleAudioStopped(ws, message.data);
            break;
            
        case 'webrtc-offer':
            handleWebRTCOffer(ws, message.data);
            break;
            
        case 'webrtc-answer':
            handleWebRTCAnswer(ws, message.data);
            break;
            
        case 'webrtc-ice-candidate':
            handleWebRTCIceCandidate(ws, message.data);
            break;
            
        case 'sync-request':
            handleSyncRequest(ws, message.data);
            break;
            
        default:
            console.log(`Unknown message type: ${message.type}`);
            sendMessage(ws, {
                type: 'error',
                message: 'Unknown message type'
            });
    }
}

// Create room handler
function handleCreateRoom(ws, data) {
    const { username } = data;
    console.log(`Creating room for user: ${username}`);
    
    if (!username) {
        sendMessage(ws, {
            type: 'error',
            message: 'Username is required'
        });
        return;
    }
    
    const roomCode = generateRoomCode();
    const userId = generateUserId();
    
    const user = {
        id: userId,
        username,
        ws,
        isHost: true
    };
    
    const room = {
        code: roomCode,
        hostId: userId,
        users: {
            [userId]: user
        },
        createdAt: new Date(),
        isAudioActive: false
    };
    
    rooms.set(roomCode, room);
    userToRoom.set(ws, roomCode);
    
    console.log(`Room ${roomCode} created successfully`);
    
    sendMessage(ws, {
        type: 'room-created',
        data: {
            roomCode,
            userId,
            users: {
                [userId]: {
                    id: userId,
                    username,
                    isHost: true
                }
            }
        }
    });
}

// Join room handler
function handleJoinRoom(ws, data) {
    const { username, roomCode } = data;
    console.log(`User ${username} trying to join room ${roomCode}`);
    
    if (!username || !roomCode) {
        sendMessage(ws, {
            type: 'error',
            message: 'Username and room code are required'
        });
        return;
    }
    
    const room = rooms.get(roomCode);
    if (!room) {
        console.log(`Room ${roomCode} not found`);
        sendMessage(ws, {
            type: 'error',
            message: 'Room not found'
        });
        return;
    }
    
    const userId = generateUserId();
    const user = {
        id: userId,
        username,
        ws,
        isHost: false
    };
    
    room.users[userId] = user;
    userToRoom.set(ws, roomCode);
    
    console.log(`User ${username} joined room ${roomCode} successfully`);
    
    // Send confirmation to new user
    sendMessage(ws, {
        type: 'room-joined',
        data: {
            roomCode,
            userId,
            users: Object.fromEntries(
                Object.entries(room.users).map(([id, user]) => [
                    id, {
                        id,
                        username: user.username,
                        isHost: user.isHost
                    }
                ])
            )
        }
    });
    
    // Notify existing users
    broadcastToRoom(roomCode, {
        type: 'user-joined',
        data: {
            user: {
                id: userId,
                username,
                isHost: false
            },
            users: Object.fromEntries(
                Object.entries(room.users).map(([id, user]) => [
                    id, {
                        id,
                        username: user.username,
                        isHost: user.isHost
                    }
                ])
            )
        }
    }, ws);
}

// Leave room handler
function handleLeaveRoom(ws, data) {
    console.log('User leaving room');
    cleanupUser(ws);
}

// Audio started handler
function handleAudioStarted(ws, data) {
    const { roomCode } = data;
    console.log(`Audio started in room ${roomCode}`);
    const room = rooms.get(roomCode);
    
    if (room) {
        room.isAudioActive = true;
        broadcastToRoom(roomCode, {
            type: 'audio-started',
            data: { roomCode }
        }, ws);
    }
}

// Audio stopped handler
function handleAudioStopped(ws, data) {
    const { roomCode } = data;
    console.log(`Audio stopped in room ${roomCode}`);
    const room = rooms.get(roomCode);
    
    if (room) {
        room.isAudioActive = false;
        broadcastToRoom(roomCode, {
            type: 'audio-stopped',
            data: { roomCode }
        }, ws);
    }
}

// WebRTC offer handler
function handleWebRTCOffer(ws, data) {
    const { roomCode, targetUserId, offer } = data;
    const room = rooms.get(roomCode);
    
    if (room && room.users[targetUserId]) {
        // Find sender user ID
        let fromUserId = null;
        for (const [userId, user] of Object.entries(room.users)) {
            if (user.ws === ws) {
                fromUserId = userId;
                break;
            }
        }
        
        console.log(`Relaying WebRTC offer from ${fromUserId} to ${targetUserId}`);
        sendToUser(roomCode, targetUserId, {
            type: 'webrtc-offer',
            data: {
                fromUserId,
                offer
            }
        });
    }
}

// WebRTC answer handler
function handleWebRTCAnswer(ws, data) {
    const { roomCode, targetUserId, answer } = data;
    const room = rooms.get(roomCode);
    
    if (room && room.users[targetUserId]) {
        // Find sender user ID
        let fromUserId = null;
        for (const [userId, user] of Object.entries(room.users)) {
            if (user.ws === ws) {
                fromUserId = userId;
                break;
            }
        }
        
        console.log(`Relaying WebRTC answer from ${fromUserId} to ${targetUserId}`);
        sendToUser(roomCode, targetUserId, {
            type: 'webrtc-answer',
            data: {
                fromUserId,
                answer
            }
        });
    }
}

// WebRTC ICE candidate handler
function handleWebRTCIceCandidate(ws, data) {
    const { roomCode, targetUserId, candidate } = data;
    const room = rooms.get(roomCode);
    
    if (room && room.users[targetUserId]) {
        // Find sender user ID
        let fromUserId = null;
        for (const [userId, user] of Object.entries(room.users)) {
            if (user.ws === ws) {
                fromUserId = userId;
                break;
            }
        }
        
        sendToUser(roomCode, targetUserId, {
            type: 'webrtc-ice-candidate',
            data: {
                fromUserId,
                candidate
            }
        });
    }
}

// Sync request handler (for latency measurement)
function handleSyncRequest(ws, data) {
    const { roomCode, timestamp } = data;
    
    sendMessage(ws, {
        type: 'sync-timestamp',
        data: {
            roomCode,
            serverTime: Date.now(),
            clientTime: timestamp
        }
    });
}

// Cleanup old rooms (run every hour)
setInterval(() => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    for (const [roomCode, room] of rooms.entries()) {
        if (room.createdAt < oneHourAgo && Object.keys(room.users).length === 0) {
            rooms.delete(roomCode);
            console.log(`Cleaned up empty room ${roomCode}`);
        }
    }
}, 60 * 60 * 1000);

// Status logging
setInterval(() => {
    console.log(`📊 Status: ${rooms.size} active rooms, ${userToRoom.size} connected users`);
}, 30000);

// Handle server errors
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port 3000 is already in use. Please:`);
        console.error(`   1. Stop other applications using port 3000`);
        console.error(`   2. Or change the port in server.js`);
        console.error(`   3. Or run: lsof -ti:3000 | xargs kill`);
    } else {
        console.error('Server error:', err);
    }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log('🎵============================================🎵');
    console.log('🎤  LYSN Server Started Successfully! 🎤');
    console.log('🎵============================================🎵');
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🔗 WebSocket server is ready for connections`);
    console.log(`🌐 Open your browser and visit:`);
    console.log(`   👉 http://localhost:${PORT}`);
    console.log(`   👉 http://127.0.0.1:${PORT}`);
    console.log('');
    console.log('🎵 Ready for synchronized music streaming!');
    console.log('💡 Press Ctrl+C to stop the server');
    console.log('🎵============================================🎵');
});