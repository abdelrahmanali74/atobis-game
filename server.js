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
            finishTime: null,
            disconnected: false
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

    // Simple name check - no reconnection
    // Check if name is taken by a connected player, or just allow multiple? 
    // To prevent confusion, if name exists, reject.
    if (room.players.some(p => p.name === playerName)) {
        return { error: 'الاسم مستخدم بالفعل في هذه الغرفة!' };
    }

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
    return { room, player };
}

function removePlayerFromRoom(socketId) {
    for (const [code, room] of rooms.entries()) {
        const index = room.players.findIndex(p => p.id === socketId);

        if (index !== -1) {
            const player = room.players[index];
            room.players.splice(index, 1); // Remove immediately

            // If room is empty, delete it
            if (room.players.length === 0) {
                rooms.delete(code);
                return { deleted: true, code };
            }

            // If host left, assign new host
            if (player.isHost && room.players.length > 0) {
                room.host = room.players[0].id;
                room.players[0].isHost = true;
                console.log(`👑 New host assigned: ${room.players[0].name}`);
            }

            return { deleted: false, code, room, player };
        }
    }
    return null;
}

// ... (calculateScore function remains same)

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
        const result = addPlayerToRoom(roomCode, socket.id, playerName);

        if (!result) {
            socket.emit('error', { message: 'الغرفة غير موجودة!' });
            return;
        }

        if (result.error) {
            socket.emit('error', { message: result.error });
            return;
        }

        const room = result.room;
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
            currentRound: room.currentRound,
            totalRounds: room.totalRounds
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
    socket.on('start-game', ({ roomCode, totalRounds }) => {
        const room = getRoomByCode(roomCode);
        if (!room || room.host !== socket.id) return;

        room.totalRounds = parseInt(totalRounds) || 5;
        room.currentRound = 1;
        room.usedLetters = [];
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

        // Reset round data
        room.players.forEach(player => {
            player.finished = false;
            player.answers = { boy: '', girl: '', animal: '', plant: '', object: '', country: '' };
            player.roundScore = 0;
        });

        io.to(roomCode).emit('round-started', {
            round: room.currentRound,
            totalRounds: room.totalRounds,
            letter: room.currentLetter,
            startTime: room.roundStartTime
        });

        console.log(`🎮 Round ${room.currentRound} started in room ${roomCode} with letter: ${room.currentLetter}`);
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

        // Calculate initial scores (auto-scoring)
        room.players.forEach(p => {
            // If player didn't finish, their answers might be empty/partial (we rely on frontend to send current state)
            // But here we only have the finisher's answers confirmed. 
            // We need to ask everyone else for their answers OR rely on live updates (not implemented).
            // Strategy: When one finishes, we broadcast "stop", clients send "submit-round-answers".
        });

        // Correction: The requester said "First one finishes -> move to results".
        // Use a two-step process: 
        // 1. Finisher sends 'finish-round'. 
        // 2. Server tells everyone 'round-ended'. 
        // 3. Everyone sends 'submit-answers'.
        // 4. Server aggregates and sends 'scoring-phase'.

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
                isHost: socket.id === room.host // logic helper
            });
        }
    });

    function calculateInitialScores(room) {
        // Collect all answers for each category to check duplicates
        const categories = ['boy', 'girl', 'animal', 'plant', 'object', 'country'];

        // Helper to normalize text
        const normalize = (text) => text ? text.trim().toLowerCase() : '';

        room.players.forEach(player => {
            player.roundScore = 0;
            player.scores = {}; // Detailed scores per category

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

    // Host updates single score (Real-time)
    socket.on('update-player-score', ({ roomCode, playerId, scoreDelta }) => {
        const room = getRoomByCode(roomCode);
        if (!room || room.host !== socket.id) return;

        const player = room.players.find(p => p.id === playerId);
        if (player) {
            // Update the specific score logic if we had per-category tracking on server
            // For now, we trust the host's delta or absolute value.
            // Simplified: The client sends the NEW total round score for that player.
            player.roundScore = scoreDelta;

            // Broadcast to everyone so they see the change live
            io.to(roomCode).emit('score-updated', {
                playerId: playerId,
                roundScore: player.roundScore
            });
        }
    });

    // Host updates scores and proceeds
    socket.on('update-scores-and-next', ({ roomCode, playerScores }) => {
        console.log(`📩 Received 'update-scores-and-next' for room ${roomCode} from ${socket.id}`);

        const room = getRoomByCode(roomCode);
        if (!room) {
            console.error(`❌ Room ${roomCode} not found`);
            socket.emit('error', { message: 'الغرفة غير موجودة' });
            return;
        }

        // Robust Host Check
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isHost) {
            console.error(`⛔ Permission denied: Player ${socket.id} is not host. Real host: ${room.host}`);
            // Fallback: If room.host matches socket.id but player.isHost is false (inconsistency), trust room.host
            if (room.host !== socket.id) {
                socket.emit('error', { message: 'أنت لست المضيف (Host)!' });
                return;
            }
        }

        console.log(`✅ Host verified. Processing scores...`);

        // Update scores based on host editing
        if (playerScores && Array.isArray(playerScores)) {
            playerScores.forEach(update => {
                const p = room.players.find(pl => pl.id === update.id);
                if (p) {
                    p.roundScore = update.roundScore;
                    p.totalScore = (p.totalScore || 0) + p.roundScore;
                }
            });
        }

        // Check if game over
        if (room.currentRound >= room.totalRounds) {
            console.log(`🏁 Game Over in room ${roomCode}`);
            io.to(roomCode).emit('game-over', {
                players: room.players.sort((a, b) => b.totalScore - a.totalScore)
            });
            room.gameActive = false;
        } else {
            console.log(`➡️ Proceeding to Round ${room.currentRound + 1}`);
            // Next round
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
            gameActive: room.gameActive
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
