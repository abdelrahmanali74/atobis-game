// ==================== Socket.IO Connection ====================
const socket = io();

// ==================== Game State ====================
const gameState = {
    roomCode: null,
    playerName: null,
    players: [],
    currentLetter: null,
    usedLetters: [],
    gameStartTime: null,
    timerInterval: null,
    isHost: false,
    gameAnswers: {},
    selectedLetter: null
};

// ==================== Arabic Letters ====================
const arabicLetters = [
    'أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش',
    'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي'
];

// ==================== Screen Management ====================
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

// ==================== Toast Notifications ====================
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ==================== Start Screen ====================
document.getElementById('start-btn').addEventListener('click', () => {
    const playerName = document.getElementById('player-name').value.trim();
    const roomCode = document.getElementById('room-code').value.trim().toUpperCase();

    if (!playerName) {
        showToast('من فضلك أدخل اسمك!', 'error');
        return;
    }

    gameState.playerName = playerName;

    if (roomCode) {
        // Join existing room
        socket.emit('join-room', { roomCode, playerName });
    } else {
        // Create new room
        gameState.isHost = true;
        socket.emit('create-room', playerName);
    }
});

// ==================== Socket Events ====================

// Room created
socket.on('room-created', (data) => {
    gameState.roomCode = data.roomCode;
    gameState.players = data.players;
    gameState.usedLetters = data.usedLetters;
    gameState.isHost = true;

    showWaitingScreen();
    showToast('تم إنشاء الغرفة بنجاح! 🎉');
});

// Room joined
socket.on('room-joined', (data) => {
    gameState.roomCode = data.roomCode;
    gameState.players = data.players;
    gameState.usedLetters = data.usedLetters;
    gameState.currentLetter = data.currentLetter;

    showWaitingScreen();
    showToast('تم الانضمام للغرفة بنجاح! 🎉');

    // If game is active, join the game
    if (data.gameActive && data.currentLetter) {
        setTimeout(() => {
            startGameRound(data.currentLetter);
        }, 1000);
    }
});

// Player joined
socket.on('player-joined', (data) => {
    gameState.players = data.players;
    updatePlayersList();
    showToast(`${data.newPlayer} انضم للعبة! 👋`);
});

// Player left
socket.on('player-left', (data) => {
    gameState.players = data.players;
    updatePlayersList();
    updatePlayersStatus();
});

// Letter selected
socket.on('letter-selected', (data) => {
    gameState.currentLetter = data.letter;
    gameState.selectedLetter = data.letter;

    // Update UI
    document.querySelectorAll('.letter-btn').forEach(btn => {
        btn.classList.remove('selected');
        if (btn.dataset.letter === data.letter) {
            btn.classList.add('selected');
        }
    });
});

// Game started
socket.on('game-started', (data) => {
    gameState.currentLetter = data.letter;
    gameState.gameStartTime = data.startTime;
    startGameRound(data.letter);
});

// Player finished
socket.on('player-finished', (data) => {
    gameState.players = data.players.map(p => {
        const existingPlayer = gameState.players.find(ep => ep.id === p.id);
        return {
            ...existingPlayer,
            ...p
        };
    });
    updatePlayersStatus();

    if (data.playerId !== socket.id) {
        showToast(`${data.playerName} خلص! ⚡`);
    }
});

// Game ended
socket.on('game-ended', (data) => {
    stopTimer();
    setTimeout(() => {
        showResults(data.players);
    }, 1000);
});

// Reset game
socket.on('reset-game', (data) => {
    gameState.players = data.players;
    gameState.usedLetters = data.usedLetters;
    gameState.currentLetter = null;
    gameState.selectedLetter = null;

    showWaitingScreen();
    renderLettersGrid();
    showToast('جاهز لجولة جديدة! 🎮');
});

// Error
socket.on('error', (data) => {
    showToast(data.message, 'error');
});

// ==================== Waiting Screen ====================
function showWaitingScreen() {
    showScreen('waiting-screen');
    document.getElementById('display-room-code').textContent = gameState.roomCode;
    updatePlayersList();
    renderLettersGrid();

    // Show start button only for host
    const startBtn = document.getElementById('start-game-btn');
    startBtn.style.display = gameState.isHost ? 'flex' : 'none';
}

function updatePlayersList() {
    const container = document.getElementById('players-container');
    const count = document.getElementById('players-count');

    count.textContent = gameState.players.length;

    container.innerHTML = gameState.players.map(player => `
        <div class="player-item animate-slide-in">
            <span class="emoji">${player.isHost ? '👑' : '🎮'}</span>
            <span class="name">${player.name}</span>
        </div>
    `).join('');
}

function renderLettersGrid() {
    const grid = document.getElementById('letters-grid');
    grid.innerHTML = arabicLetters.map(letter => `
        <button class="letter-btn ${gameState.usedLetters.includes(letter) ? 'used' : ''} ${gameState.selectedLetter === letter ? 'selected' : ''}" 
                data-letter="${letter}"
                ${gameState.usedLetters.includes(letter) || !gameState.isHost ? 'disabled' : ''}>
            ${letter}
        </button>
    `).join('');

    // Add click listeners (only for host)
    if (gameState.isHost) {
        document.querySelectorAll('.letter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!btn.classList.contains('used')) {
                    gameState.selectedLetter = btn.dataset.letter;
                    socket.emit('select-letter', {
                        roomCode: gameState.roomCode,
                        letter: btn.dataset.letter
                    });
                }
            });
        });
    }
}

// ==================== Copy Room Code ====================
document.getElementById('copy-code-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(gameState.roomCode).then(() => {
        showToast('تم نسخ الكود! 📋');
    });
});

// ==================== Start Game ====================
document.getElementById('start-game-btn').addEventListener('click', () => {
    if (!gameState.selectedLetter) {
        showToast('من فضلك اختر حرف للجولة!', 'error');
        return;
    }

    socket.emit('start-game', gameState.roomCode);
});

function startGameRound(letter) {
    showScreen('game-screen');
    document.getElementById('current-letter').textContent = letter;

    // Reset form
    document.getElementById('game-form').reset();
    gameState.gameAnswers = {};

    // Update players status
    updatePlayersStatus();

    // Start timer
    startTimer();

    // Add input listeners
    addInputListeners();

    showToast('بدأت الجولة! حظاً موفقاً 🚀');
}

// ==================== Timer ====================
function startTimer() {
    const timerDisplay = document.getElementById('timer');
    let startTime = Date.now();

    gameState.timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
}

function stopTimer() {
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
    }
}

// ==================== Input Listeners ====================
function addInputListeners() {
    const inputs = document.querySelectorAll('.game-input');
    inputs.forEach(input => {
        input.addEventListener('input', (e) => {
            const value = e.target.value.trim();
            if (value) {
                e.target.classList.add('filled');
            } else {
                e.target.classList.remove('filled');
            }
        });
    });
}

// ==================== Players Status ====================
function updatePlayersStatus() {
    const container = document.getElementById('players-status');
    container.innerHTML = gameState.players.map(player => `
        <div class="player-status ${player.finished ? 'finished' : ''}">
            <span class="status-icon">${player.finished ? '✅' : '⏳'}</span>
            <span>${player.name}</span>
        </div>
    `).join('');
}

// ==================== Submit Answers ====================
document.getElementById('game-form').addEventListener('submit', (e) => {
    e.preventDefault();

    // Collect answers
    gameState.gameAnswers = {
        boy: document.getElementById('boy-input').value.trim(),
        girl: document.getElementById('girl-input').value.trim(),
        animal: document.getElementById('animal-input').value.trim(),
        plant: document.getElementById('plant-input').value.trim(),
        object: document.getElementById('object-input').value.trim(),
        country: document.getElementById('country-input').value.trim()
    };

    // Send to server
    socket.emit('submit-answers', {
        roomCode: gameState.roomCode,
        answers: gameState.gameAnswers
    });

    showToast('تم إرسال إجاباتك! ⏳ في انتظار باقي اللاعبين...');

    // Disable form
    document.getElementById('finish-btn').disabled = true;
    document.querySelectorAll('.game-input').forEach(input => {
        input.disabled = true;
    });
});

// ==================== Show Results ====================
function showResults(players) {
    showScreen('results-screen');

    // Sort by score
    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);

    // Show winner
    const winner = sortedPlayers[0];
    document.getElementById('winner-announcement').innerHTML = `
        🏆 الفائز: <strong>${winner.name}</strong> بمجموع ${winner.score} نقطة!
    `;

    // Build results table
    const tbody = document.getElementById('results-body');
    tbody.innerHTML = sortedPlayers.map((player, index) => `
        <tr class="${index === 0 ? 'winner-row' : ''}">
            <td><strong>${player.name}</strong></td>
            <td>${player.answers?.boy || '-'}</td>
            <td>${player.answers?.girl || '-'}</td>
            <td>${player.answers?.animal || '-'}</td>
            <td>${player.answers?.plant || '-'}</td>
            <td>${player.answers?.object || '-'}</td>
            <td>${player.answers?.country || '-'}</td>
            <td class="score-cell">${player.score}</td>
        </tr>
    `).join('');

    // Re-enable form for next round
    document.getElementById('finish-btn').disabled = false;
    document.querySelectorAll('.game-input').forEach(input => {
        input.disabled = false;
    });
}

// ==================== Play Again ====================
document.getElementById('play-again-btn').addEventListener('click', () => {
    if (gameState.isHost) {
        socket.emit('play-again', gameState.roomCode);
    } else {
        showToast('فقط منشئ الغرفة يمكنه بدء جولة جديدة', 'error');
    }
});

// ==================== Exit Game ====================
document.getElementById('exit-btn').addEventListener('click', () => {
    if (confirm('هل أنت متأكد من الخروج من اللعبة؟')) {
        location.reload();
    }
});

// ==================== Connection Status ====================
socket.on('connect', () => {
    console.log('✅ متصل بالسيرفر');
});

socket.on('disconnect', () => {
    console.log('❌ انقطع الاتصال بالسيرفر');
    showToast('انقطع الاتصال بالسيرفر!', 'error');
});

// ==================== Initialize ====================
console.log('🚌 لعبة أتوبيس كومبليت - نسخة أونلاين جاهزة!');
console.log('تم تطوير اللعبة بواسطة Antigravity AI');
