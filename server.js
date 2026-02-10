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

// Default categories
const DEFAULT_CATEGORIES = ['boy', 'girl', 'animal', 'plant', 'object', 'country'];

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
        gameActive: false,
        categories: [...DEFAULT_CATEGORIES] // Dynamic categories
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
            gameActive: room.gameActive,
            categories: room.categories
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
    socket.on('start-game', ({ roomCode, totalRounds, categories }) => {
        const room = getRoomByCode(roomCode);
        if (!room || room.host !== socket.id) return;

        room.totalRounds = parseInt(totalRounds) || 5;
        room.currentRound = 1;
        room.usedLetters = [];
        // Save the custom categories from the host
        if (categories && Array.isArray(categories) && categories.length >= 3) {
            room.categories = categories;
        } else {
            room.categories = [...DEFAULT_CATEGORIES];
        }
        room.players.forEach(p => p.totalScore = 0);

        startRound(roomCode);
    });

    function startRound(roomCode) {
        const room = getRoomByCode(roomCode);
        if (!room) return;

        // Select random letter not used yet
        const arabicLetters = [
            'أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش',
            'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي'
        ];

        let availableLetters = arabicLetters.filter(l => !room.usedLetters.includes(l));
        if (availableLetters.length === 0) {
            room.usedLetters = []; // Reset if all used
            availableLetters = arabicLetters;
        }

        const randomLetter = availableLetters[Math.floor(Math.random() * availableLetters.length)];

        room.currentLetter = randomLetter;
        room.usedLetters.push(randomLetter);
        room.gameActive = true;
        room.roundStartTime = Date.now();
        room.roundState = 'playing';

        // Reset round data - use dynamic categories
        const emptyAnswers = {};
        room.categories.forEach(cat => { emptyAnswers[cat] = ''; });

        room.players.forEach(player => {
            player.finished = false;
            player.answers = { ...emptyAnswers };
            player.roundScore = 0;
            player.hasSubmitted = false;
        });

        io.to(roomCode).emit('round-started', {
            round: room.currentRound,
            totalRounds: room.totalRounds,
            letter: room.currentLetter,
            startTime: room.roundStartTime,
            categories: room.categories
        });

        console.log(`🎮 Round ${room.currentRound} started in room ${roomCode} with letter: ${room.currentLetter} | Categories: ${room.categories.join(', ')}`);
    }

    // Player finished round (triggers stop for everyone)
    socket.on('finish-round', ({ roomCode, answers }) => {
        const room = getRoomByCode(roomCode);
        if (!room || !room.gameActive || room.roundState !== 'playing') return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        // Save this player's answers
        player.answers = answers;
        player.finished = true;

        // Stop the round immediately for everyone
        room.roundState = 'scoring';

        io.to(roomCode).emit('round-ended', {
            finisher: player.name
        });
    });

    // Receive answers from all players after round ends
    socket.on('submit-answers', ({ roomCode, answers }) => {
        const room = getRoomByCode(roomCode);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        player.answers = answers;
        player.hasSubmitted = true;

        // Check if all active players have submitted
        const allSubmitted = room.players.every(p => p.hasSubmitted || p.disconnected);

        if (allSubmitted) {
            // initial scoring calculation
            calculateInitialScores(room);

            io.to(roomCode).emit('scoring-phase', {
                players: room.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    answers: p.answers,
                    roundScore: p.roundScore,
                    totalScore: p.totalScore || 0
                })),
                currentRound: room.currentRound,
                totalRounds: room.totalRounds,
                categories: room.categories,
                isHost: socket.id === room.host
            });
        }
    });

    function calculateInitialScores(room) {
        // Use dynamic categories
        const categories = room.categories;

        // Helper to normalize text
        const normalize = (text) => text ? text.trim().toLowerCase() : '';

        room.players.forEach(player => {
            player.roundScore = 0;
            player.scores = {};

            categories.forEach(cat => {
                const ans = normalize(player.answers[cat]);
                if (!ans || !ans.startsWith(room.currentLetter)) {
                    player.scores[cat] = 0;
                    return;
                }

                // Check duplicates against other players
                const isDuplicate = room.players.some(other =>
                    other.id !== player.id &&
                    normalize(other.answers[cat]) === ans
                );

                player.scores[cat] = isDuplicate ? 5 : 10;
                player.roundScore += player.scores[cat];
            });
        });
    }

    // Host updates a single score item (Real-time Broadcast)
    socket.on('update-single-score', ({ roomCode, playerId, category, score }) => {
        const room = getRoomByCode(roomCode);
        if (!room || room.host !== socket.id) return;

        const player = room.players.find(p => p.id === playerId);
        if (player) {
            if (!player.scores) player.scores = {};

            player.scores[category] = score;

            // Recalculate round total using dynamic categories
            let roundTotal = 0;
            const categories = room.categories;
            categories.forEach(cat => {
                if (player.scores[cat] !== undefined) {
                    roundTotal += player.scores[cat];
                }
            });
            player.roundScore = roundTotal;

            // Broadcast update to everyone
            io.to(roomCode).emit('score-updated', {
                playerId,
                category,
                score,
                roundScore: roundTotal
            });
        }
    });

    // Host finishes scoring and proceeds
    socket.on('update-scores-and-next', ({ roomCode }) => {
        const room = getRoomByCode(roomCode);
        if (!room || room.host !== socket.id) return;

        room.players.forEach(p => {
            p.totalScore = (p.totalScore || 0) + (p.roundScore || 0);
        });

        // Check if game over
        if (room.currentRound >= room.totalRounds) {
            io.to(roomCode).emit('game-over', {
                players: room.players.sort((a, b) => b.totalScore - a.totalScore)
            });
            room.gameActive = false;
        } else {
            room.currentRound++;
            startRound(roomCode);
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
            gameActive: room.gameActive,
            categories: room.categories
        }))
    });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🚌 أتوبيس كومبليت - السيرفر       ║
║   🌐 Port: ${PORT}                      ║
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
