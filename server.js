const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Game state
const rooms = new Map();

// Helper functions
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return rooms.has(code) ? generateRoomCode() : code;
}

function getRoomByCode(code) {
    return rooms.get(code);
}

function createRoom(hostSocketId, hostName) {
    const roomCode = generateRoomCode();
    const room = {
        code: roomCode,
        host: hostSocketId,
        players: [{
            id: hostSocketId,
            name: hostName,
            isHost: true,
            finished: false,
            answers: null,
            score: 0,
            finishTime: null
        }],
        currentLetter: null,
        usedLetters: [],
        gameStartTime: null,
        gameActive: false
    };
    rooms.set(roomCode, room);
    return room;
}

function addPlayerToRoom(roomCode, socketId, playerName) {
    const room = getRoomByCode(roomCode);
    if (!room) return null;

    const player = {
        id: socketId,
        name: playerName,
        isHost: false,
        finished: false,
        answers: null,
        score: 0,
        finishTime: null
    };

    room.players.push(player);
    return room;
}

function removePlayerFromRoom(socketId) {
    for (const [code, room] of rooms.entries()) {
        const playerIndex = room.players.findIndex(p => p.id === socketId);
        if (playerIndex !== -1) {
            room.players.splice(playerIndex, 1);

            // If room is empty, delete it
            if (room.players.length === 0) {
                rooms.delete(code);
                return { deleted: true, code };
            }

            // If host left, assign new host
            if (room.host === socketId && room.players.length > 0) {
                room.host = room.players[0].id;
                room.players[0].isHost = true;
            }

            return { deleted: false, code, room };
        }
    }
    return null;
}

function calculateScore(player, room) {
    let score = 0;
    const answers = player.answers;

    if (!answers) return 0;

    Object.keys(answers).forEach(category => {
        const answer = answers[category];
        if (!answer) return;

        // Check if answer starts with current letter
        if (!answer.startsWith(room.currentLetter)) return;

        // Count duplicate answers
        const sameAnswers = room.players.filter(p =>
            p.answers && p.answers[category] === answer
        ).length;

        if (sameAnswers === 1) {
            score += 10; // Unique answer
        } else {
            score += 5; // Duplicate answer
        }
    });

    // Bonus for finishing first
    const sortedByTime = [...room.players]
        .filter(p => p.finishTime !== null)
        .sort((a, b) => a.finishTime - b.finishTime);

    if (sortedByTime.length > 0 && sortedByTime[0].id === player.id) {
        score += 10;
    }

    return score;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`✅ Player connected: ${socket.id}`);

    // Create or join room
    socket.on('create-room', (playerName) => {
        const room = createRoom(socket.id, playerName);
        socket.join(room.code);

        socket.emit('room-created', {
            roomCode: room.code,
            players: room.players,
            usedLetters: room.usedLetters
        });

        console.log(`🏠 Room created: ${room.code} by ${playerName}`);
    });

    socket.on('join-room', ({ roomCode, playerName }) => {
        const room = addPlayerToRoom(roomCode, socket.id, playerName);

        if (!room) {
            socket.emit('error', { message: 'الغرفة غير موجودة!' });
            return;
        }

        socket.join(roomCode);

        // Notify all players in room
        io.to(roomCode).emit('player-joined', {
            players: room.players,
            newPlayer: playerName
        });

        socket.emit('room-joined', {
            roomCode: room.code,
            players: room.players,
            usedLetters: room.usedLetters,
            currentLetter: room.currentLetter,
            gameActive: room.gameActive
        });

        console.log(`👋 ${playerName} joined room: ${roomCode}`);
    });

    // Letter selection
    socket.on('select-letter', ({ roomCode, letter }) => {
        const room = getRoomByCode(roomCode);
        if (!room || room.host !== socket.id) return;

        room.currentLetter = letter;
        io.to(roomCode).emit('letter-selected', { letter });
    });

    // Start game
    socket.on('start-game', (roomCode) => {
        const room = getRoomByCode(roomCode);
        if (!room || room.host !== socket.id || !room.currentLetter) return;

        room.gameActive = true;
        room.gameStartTime = Date.now();
        room.usedLetters.push(room.currentLetter);

        // Reset players
        room.players.forEach(player => {
            player.finished = false;
            player.answers = null;
            player.score = 0;
            player.finishTime = null;
        });

        io.to(roomCode).emit('game-started', {
            letter: room.currentLetter,
            startTime: room.gameStartTime
        });

        console.log(`🎮 Game started in room ${roomCode} with letter: ${room.currentLetter}`);
    });

    // Submit answers
    socket.on('submit-answers', ({ roomCode, answers }) => {
        const room = getRoomByCode(roomCode);
        if (!room || !room.gameActive) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.finished) return;

        player.finished = true;
        player.answers = answers;
        player.finishTime = Date.now() - room.gameStartTime;

        // Notify all players
        io.to(roomCode).emit('player-finished', {
            playerId: socket.id,
            playerName: player.name,
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                finished: p.finished
            }))
        });

        console.log(`✅ ${player.name} finished in room ${roomCode}`);

        // Check if all players finished
        if (room.players.every(p => p.finished)) {
            // Calculate scores
            room.players.forEach(player => {
                player.score = calculateScore(player, room);
            });

            room.gameActive = false;

            // Send results
            setTimeout(() => {
                io.to(roomCode).emit('game-ended', {
                    players: room.players.map(p => ({
                        name: p.name,
                        answers: p.answers,
                        score: p.score,
                        finishTime: p.finishTime
                    }))
                });

                console.log(`🏆 Game ended in room ${roomCode}`);
            }, 1000);
        }
    });

    // Play again
    socket.on('play-again', (roomCode) => {
        const room = getRoomByCode(roomCode);
        if (!room) return;

        room.currentLetter = null;
        room.gameActive = false;
        room.gameStartTime = null;

        room.players.forEach(player => {
            player.finished = false;
            player.answers = null;
            player.score = 0;
            player.finishTime = null;
        });

        io.to(roomCode).emit('reset-game', {
            players: room.players,
            usedLetters: room.usedLetters
        });

        console.log(`🔄 Game reset in room ${roomCode}`);
    });

    // Disconnect
    socket.on('disconnect', () => {
        const result = removePlayerFromRoom(socket.id);

        if (result) {
            if (result.deleted) {
                console.log(`🗑️ Room ${result.code} deleted (empty)`);
            } else {
                io.to(result.code).emit('player-left', {
                    players: result.room.players
                });
                console.log(`👋 Player left room ${result.code}`);
            }
        }

        console.log(`❌ Player disconnected: ${socket.id}`);
    });
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stats', (req, res) => {
    res.json({
        totalRooms: rooms.size,
        rooms: Array.from(rooms.values()).map(room => ({
            code: room.code,
            players: room.players.length,
            gameActive: room.gameActive
        }))
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🚌 أتوبيس كومبليت - السيرفر       ║
║   🌐 http://localhost:${PORT}           ║
║   ✅ السيرفر شغال بنجاح!              ║
╚═══════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});
