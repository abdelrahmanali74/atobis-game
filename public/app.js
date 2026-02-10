// ==================== Socket.IO Connection ====================
const socket = io();

// ==================== Game State ====================
const gameState = {
    roomCode: null,
    playerName: null,
    players: [],
    currentLetter: null,
    totalRounds: 5,
    currentRound: 1,
    gameStartTime: null,
    timerInterval: null,
    isHost: false,
    gameAnswers: {},
    scoringData: [] // Stores player data during scoring phase
};

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
    gameState.isHost = true;

    showWaitingScreen();
    showToast('تم إنشاء الغرفة بنجاح! 🎉');
});

// Room joined
socket.on('room-joined', (data) => {
    gameState.roomCode = data.roomCode;
    gameState.players = data.players;
    gameState.currentLetter = data.currentLetter;

    showWaitingScreen();
    showToast('تم الانضمام للغرفة بنجاح! 🎉');
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
});

// Round Started
socket.on('round-started', (data) => {
    gameState.currentLetter = data.letter;
    gameState.currentRound = data.round;
    gameState.totalRounds = data.totalRounds;
    gameState.gameStartTime = data.startTime;

    startRound();
});

// Round Ended (Someone finished)
socket.on('round-ended', (data) => {
    stopTimer();
    showToast(`${data.finisher} خلص الجولة! ✋`, 'warning');
    // Important: Wait for user input or auto-submit?
    // Current design: Auto-submit what they have.
    submitCurrentAnswers();
});

// Scoring Phase
socket.on('scoring-phase', (data) => {
    gameState.scoringData = data.players;
    showScoringScreen(data);
});

// Game Over
socket.on('game-over', (data) => {
    showFinalResults(data.players);
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

    // Show host controls
    const hostControls = document.getElementById('host-controls');
    const waitingMsg = document.getElementById('waiting-message');

    if (gameState.isHost) {
        hostControls.style.display = 'block';
        waitingMsg.style.display = 'none';
    } else {
        hostControls.style.display = 'none';
        waitingMsg.style.display = 'block';
    }
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

// ==================== Copy Room Code ====================
document.getElementById('copy-code-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(gameState.roomCode).then(() => {
        showToast('تم نسخ الكود! 📋');
    });
});

// ==================== Start Game (Host) ====================
document.getElementById('start-game-btn').addEventListener('click', () => {
    const rounds = document.getElementById('rounds-select').value;
    socket.emit('start-game', {
        roomCode: gameState.roomCode,
        totalRounds: rounds
    });
});

// ==================== Game Logic ====================
function startRound() {
    showScreen('game-screen');

    // Update Header
    document.getElementById('current-letter').textContent = gameState.currentLetter;
    document.getElementById('round-display').textContent = `${gameState.currentRound} / ${gameState.totalRounds}`;

    // Reset Form
    document.getElementById('game-form').reset();
    document.getElementById('finish-btn').disabled = false;
    document.querySelectorAll('.game-input').forEach(input => {
        input.disabled = false;
        input.value = '';
        input.classList.remove('filled');
    });

    // Start Timer
    startTimer();
    addInputListeners();

    showToast(`بدأت الجولة ${gameState.currentRound}! الحرف: ${gameState.currentLetter} 🚀`);
}

function startTimer() {
    const timerDisplay = document.getElementById('timer');
    let startTime = Date.now();

    if (gameState.timerInterval) clearInterval(gameState.timerInterval);

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

function addInputListeners() {
    document.querySelectorAll('.game-input').forEach(input => {
        input.addEventListener('input', (e) => {
            if (e.target.value.trim()) {
                e.target.classList.add('filled');
            } else {
                e.target.classList.remove('filled');
            }
        });
    });
}

// ==================== Submit Logic ====================
// Triggered by "Finished" button
document.getElementById('game-form').addEventListener('submit', (e) => {
    e.preventDefault();
    document.getElementById('finish-btn').disabled = true;

    const answers = collectAnswers();
    socket.emit('finish-round', {
        roomCode: gameState.roomCode,
        answers: answers
    });

    // Disable inputs
    disableInputs();
});

function submitCurrentAnswers() {
    // When round is forced to end by someone else
    const answers = collectAnswers();
    disableInputs();

    socket.emit('submit-answers', {
        roomCode: gameState.roomCode,
        answers: answers
    });
}

function collectAnswers() {
    return {
        boy: document.getElementById('boy-input').value.trim(),
        girl: document.getElementById('girl-input').value.trim(),
        animal: document.getElementById('animal-input').value.trim(),
        plant: document.getElementById('plant-input').value.trim(),
        object: document.getElementById('object-input').value.trim(),
        country: document.getElementById('country-input').value.trim()
    };
}

function disableInputs() {
    document.querySelectorAll('.game-input').forEach(i => i.disabled = true);
    document.getElementById('finish-btn').disabled = true;
}

// ==================== Scoring Screen ====================
// Score Updated (Real-time)
socket.on('score-updated', (data) => {
    // Update local state if needed (optional since we trust server broadcast)

    // Update UI
    const totalCell = document.getElementById(`total-${data.playerId}`);
    if (totalCell) {
        totalCell.textContent = data.roundScore;
        // Animation effect
        totalCell.style.color = '#fff';
        setTimeout(() => totalCell.style.color = '', 300);
    }

    // Update the specific cell badge if we are not the host (host already sees toggle update)
    if (!gameState.isHost) {
        // Find the cell for this category using data attributes
        const scoreBadge = document.querySelector(`.score-badge[data-player-id="${data.playerId}"][data-category="${data.category}"]`);
        if (scoreBadge) {
            scoreBadge.textContent = data.score;
            scoreBadge.className = `score-badge score-${data.score}`;
        }
    }
});


// ==================== Scoring Screen ====================
function showScoringScreen(data) {
    showScreen('scoring-screen');
    document.getElementById('scoring-round-num').textContent = data.currentRound;

    const tbody = document.getElementById('scoring-body');
    tbody.innerHTML = '';

    const categories = ['boy', 'girl', 'animal', 'plant', 'object', 'country'];
    const isHost = gameState.isHost;

    data.players.forEach(player => {
        const row = document.createElement('tr');

        // Name
        const nameCell = document.createElement('td');
        // Add ID to name cell for easy access if needed
        nameCell.innerHTML = `<strong style="color: #ffd700">${player.name}</strong>`;
        row.appendChild(nameCell);

        let playerScoreSum = 0;

        // Answers
        categories.forEach(cat => {
            const cell = document.createElement('td');
            const answerText = player.answers[cat] || '-';

            // Default logic if not set
            let currentScore = 0;
            if (answerText.trim() !== '-' && answerText.trim().length > 0) {
                if (answerText.trim().toLowerCase().startsWith(gameState.currentLetter.toLowerCase())) {
                    currentScore = 10;
                }
            }
            // If server sent specific scores, use them (future proofing), currently we rely on defaults/updates.

            if (isHost) {
                // Editable controls (Toggle Button)
                const container = document.createElement('div');
                container.className = 'score-control-container';

                const ansDiv = document.createElement('div');
                ansDiv.className = 'answer-text';
                ansDiv.textContent = answerText;

                const toggleBtn = document.createElement('button');
                toggleBtn.className = `score-toggle score-${currentScore}`;
                toggleBtn.textContent = currentScore;
                toggleBtn.dataset.value = currentScore;
                toggleBtn.dataset.playerId = player.id;
                toggleBtn.dataset.category = cat;

                // Click to cycle: 0 -> 5 -> 10 -> 0
                toggleBtn.addEventListener('click', () => {
                    let currentVal = parseInt(toggleBtn.dataset.value);
                    let nextVal = 0;
                    if (currentVal === 0) nextVal = 5;
                    else if (currentVal === 5) nextVal = 10;
                    else nextVal = 0;

                    // Update UI immediately for host
                    toggleBtn.dataset.value = nextVal;
                    toggleBtn.textContent = nextVal;
                    toggleBtn.className = `score-toggle score-${nextVal}`;

                    // Send update to server
                    socket.emit('update-single-score', {
                        roomCode: gameState.roomCode,
                        playerId: player.id,
                        category: cat,
                        score: nextVal
                    });

                    // Recalculate totals locally
                    calculateTotalsLocally();
                });

                container.appendChild(ansDiv);
                container.appendChild(toggleBtn);
                cell.appendChild(container);

                playerScoreSum += currentScore;
            } else {
                // Non-host view
                const container = document.createElement('div');
                container.className = 'score-control-container';

                const ansDiv = document.createElement('div');
                ansDiv.className = 'answer-text';
                ansDiv.textContent = answerText;

                // Score Badge (Valid View)
                const badge = document.createElement('span');
                badge.className = `score-badge score-${currentScore}`;
                badge.textContent = currentScore;
                badge.dataset.playerId = player.id;
                badge.dataset.category = cat;

                container.appendChild(ansDiv);
                container.appendChild(badge);
                cell.appendChild(container);

                playerScoreSum = player.roundScore;
            }
            row.appendChild(cell);
        });

        // Total
        const totalCell = document.createElement('td');
        totalCell.className = 'round-total';
        totalCell.id = `total-${player.id}`;
        totalCell.textContent = playerScoreSum;
        row.appendChild(totalCell);

        tbody.appendChild(row);
    });

    if (isHost) {
        document.getElementById('host-scoring-controls').style.display = 'block';
        document.getElementById('waiting-host-scoring').style.display = 'none';
        calculateTotalsLocally();
    } else {
        document.getElementById('host-scoring-controls').style.display = 'none';
        document.getElementById('waiting-host-scoring').style.display = 'block';
    }
}

function calculateTotalsLocally() {
    const rows = document.getElementById('scoring-body').querySelectorAll('tr');
    rows.forEach(row => {
        const buttons = row.querySelectorAll('.score-toggle');
        let sum = 0;
        if (buttons.length > 0) {
            buttons.forEach(btn => sum += parseInt(btn.dataset.value));
            const totalCell = row.querySelector('.round-total');
            if (totalCell) totalCell.textContent = sum;
        }
    });
}

// Next Round (Host)
document.getElementById('next-round-btn').addEventListener('click', () => {
    socket.emit('update-scores-and-next', {
        roomCode: gameState.roomCode
    });
});

// ==================== Final Results ====================
function showFinalResults(players) {
    showScreen('final-screen');

    const podium = document.getElementById('podium');
    const list = document.getElementById('leaderboard-list');

    // Convert to array and sort
    const sorted = players.sort((a, b) => b.totalScore - a.totalScore);

    // Top 3
    let podiumHTML = '';
    if (sorted[0]) podiumHTML += createPodiumItem(sorted[0], 1, '🥇');
    if (sorted[1]) podiumHTML += createPodiumItem(sorted[1], 2, '🥈');
    if (sorted[2]) podiumHTML += createPodiumItem(sorted[2], 3, '🥉');
    podium.innerHTML = podiumHTML;

    // List
    list.innerHTML = sorted.map((p, i) => `
        <li class="leaderboard-item">
            <span class="rank">#${i + 1}</span>
            <span class="name">${p.name}</span>
            <span class="score">${p.totalScore} نقطة</span>
        </li>
    `).join('');
}

function createPodiumItem(player, rank, medal) {
    return `
        <div class="podium-item rank-${rank}">
            <div class="medal">${medal}</div>
            <div class="p-name">${player.name}</div>
            <div class="p-score">${player.totalScore}</div>
        </div>
    `;
}

document.getElementById('go-home-btn').addEventListener('click', () => {
    location.reload();
});

// ==================== Connection Status ====================
socket.on('connect', () => {
    console.log('✅ متصل بالسيرفر');
});

socket.on('disconnect', () => {
    console.log('❌ انقطع الاتصال بالسيرفر');
    showToast('انقطع الاتصال بالسيرفر!', 'error');
});

console.log('🚌 لعبة أتوبيس كومبليت - تطوير عبد الرحمن علي');
