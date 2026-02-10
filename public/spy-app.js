// ==================== Socket.IO Connection ====================
const socket = io();

// ==================== Spy Categories (matching server) ====================
const SPY_CATEGORIES = {
    animal: { label: '🦁 حيوان', emoji: '🦁' },
    object: { label: '📦 جماد', emoji: '📦' },
    food: { label: '🍕 أكل', emoji: '🍕' },
    place: { label: '📍 مكان', emoji: '📍' },
    country: { label: '🌍 بلد', emoji: '🌍' },
    job: { label: '👨‍💼 مهنة', emoji: '👨‍💼' },
    sport: { label: '⚽ رياضة', emoji: '⚽' },
    movie: { label: '🎬 فيلم/مسلسل', emoji: '🎬' },
    celebrity: { label: '⭐ شخصية مشهورة', emoji: '⭐' },
    clothing: { label: '👔 لبس', emoji: '👔' }
};

// ==================== Theme Management ====================
function initTheme() {
    const savedTheme = localStorage.getItem('atobis-theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const current = document.body.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('atobis-theme', next);
    updateThemeIcon(next);
}

function updateThemeIcon(theme) {
    const icon = document.querySelector('.theme-icon');
    if (icon) {
        icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
}

initTheme();
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

// ==================== Game State ====================
const spyState = {
    roomCode: null,
    playerName: null,
    playerId: null,
    players: [],
    isHost: false,
    isSpy: false,
    currentWord: null,
    currentCategory: null,
    totalRounds: 5,
    currentRound: 1,
    timerDuration: 120,
    timerInterval: null,
    timerRemaining: 0,
    selectedVote: null,
    selectedGuess: null,
    roleConfirmed: false,
    selectedCategories: ['animal', 'object', 'food', 'place', 'country'],
    spyCount: 1
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
    const toast = document.getElementById('spy-toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ==================== Categories Selector ====================
function renderSpyCategoriesSelector() {
    const container = document.getElementById('spy-categories-selector');
    if (!container) return;

    container.innerHTML = '';
    Object.keys(SPY_CATEGORIES).forEach(key => {
        const cat = SPY_CATEGORIES[key];
        const isChecked = spyState.selectedCategories.includes(key);

        const item = document.createElement('label');
        item.className = `category-chip ${isChecked ? 'active' : ''}`;
        item.innerHTML = `
            <input type="checkbox" value="${key}" ${isChecked ? 'checked' : ''} class="category-checkbox">
            <span class="chip-emoji">${cat.emoji}</span>
            <span class="chip-label">${cat.label.replace(cat.emoji + ' ', '')}</span>
        `;

        const checkbox = item.querySelector('input');
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                if (!spyState.selectedCategories.includes(key)) {
                    spyState.selectedCategories.push(key);
                }
                item.classList.add('active');
            } else {
                spyState.selectedCategories = spyState.selectedCategories.filter(c => c !== key);
                item.classList.remove('active');
            }
        });

        container.appendChild(item);
    });
}

// ==================== Start Screen ====================
document.getElementById('spy-start-btn').addEventListener('click', () => {
    const playerName = document.getElementById('spy-player-name').value.trim();
    const roomCode = document.getElementById('spy-room-code').value.trim().toUpperCase();

    if (!playerName) {
        showToast('من فضلك أدخل اسمك!', 'error');
        return;
    }

    spyState.playerName = playerName;

    if (roomCode) {
        socket.emit('spy-join-room', { roomCode, playerName });
    } else {
        spyState.isHost = true;
        socket.emit('spy-create-room', playerName);
    }
});

// ==================== Socket Events ====================

// Room created
socket.on('spy-room-created', (data) => {
    spyState.roomCode = data.roomCode;
    spyState.players = data.players;
    spyState.playerId = socket.id;
    spyState.isHost = true;

    showWaitingScreen();
    showToast('تم إنشاء الغرفة بنجاح! 🎉');
});

// Room joined
socket.on('spy-room-joined', (data) => {
    spyState.roomCode = data.roomCode;
    spyState.players = data.players;
    spyState.playerId = socket.id;

    showWaitingScreen();
    showToast('تم الانضمام للغرفة بنجاح! 🎉');
});

// Player joined
socket.on('spy-player-joined', (data) => {
    spyState.players = data.players;
    updatePlayersList();
    showToast(`${data.newPlayer} انضم للعبة! 👋`);
});

// Player left
socket.on('spy-player-left', (data) => {
    spyState.players = data.players;
    updatePlayersList();
});

// Round started - role assignment
socket.on('spy-round-started', (data) => {
    spyState.currentRound = data.round;
    spyState.totalRounds = data.totalRounds;
    spyState.isSpy = data.isSpy;
    spyState.currentWord = data.word;
    spyState.currentCategory = data.category;
    spyState.timerDuration = data.timerDuration;
    spyState.roleConfirmed = false;

    showRoleScreen();
});

// All confirmed - start discussion
socket.on('spy-start-discussion', (data) => {
    spyState.timerDuration = data.timerDuration;
    showDiscussionScreen();
});

// Confirmation status update
socket.on('spy-confirm-update', (data) => {
    document.getElementById('spy-confirmed-count').textContent = `${data.confirmed} / ${data.total}`;
});

// Timer ended - start voting
socket.on('spy-start-voting', (data) => {
    spyState.players = data.players;
    showVotingScreen();
});

// Vote update
socket.on('spy-vote-update', (data) => {
    document.getElementById('spy-votes-count').textContent = `${data.voted} / ${data.total}`;
});

// Spy guessing phase
socket.on('spy-guess-phase', (data) => {
    showGuessScreen(data);
});

// Round result
socket.on('spy-round-result', (data) => {
    showRoundResult(data);
});

// Game over
socket.on('spy-game-over', (data) => {
    showFinalResults(data.players);
});

// Error
socket.on('error', (data) => {
    showToast(data.message, 'error');
});

// ==================== Waiting Screen ====================
function showWaitingScreen() {
    showScreen('spy-waiting-screen');
    document.getElementById('spy-display-room-code').textContent = spyState.roomCode;
    updatePlayersList();

    const hostControls = document.getElementById('spy-host-controls');
    const waitingMsg = document.getElementById('spy-waiting-message');

    if (spyState.isHost) {
        hostControls.style.display = 'block';
        waitingMsg.style.display = 'none';
        renderSpyCategoriesSelector();
    } else {
        hostControls.style.display = 'none';
        waitingMsg.style.display = 'block';
    }
}

function updatePlayersList() {
    const container = document.getElementById('spy-players-container');
    const count = document.getElementById('spy-players-count');

    count.textContent = spyState.players.length;

    container.innerHTML = spyState.players.map(player => `
        <div class="player-item animate-slide-in">
            <span class="emoji">${player.isHost ? '👑' : '🎮'}</span>
            <span class="name">${player.name}</span>
        </div>
    `).join('');
}

// Copy room code
document.getElementById('spy-copy-code-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(spyState.roomCode).then(() => {
        showToast('تم نسخ الكود! 📋');
    });
});

// Start game (Host)
document.getElementById('spy-start-game-btn').addEventListener('click', () => {
    if (spyState.players.length < 3) {
        showToast('محتاج على الأقل 3 لاعبين!', 'error');
        return;
    }

    if (spyState.selectedCategories.length < 1) {
        showToast('اختر على الأقل فئة واحدة!', 'error');
        return;
    }

    const spyCount = parseInt(document.getElementById('spy-count-select').value);
    if (spyCount >= spyState.players.length) {
        showToast('عدد الجواسيس لازم يكون أقل من عدد اللاعبين!', 'error');
        return;
    }

    const rounds = parseInt(document.getElementById('spy-rounds-select').value);
    const timerDuration = parseInt(document.getElementById('spy-timer-select').value);

    socket.emit('spy-start-game', {
        roomCode: spyState.roomCode,
        totalRounds: rounds,
        timerDuration: timerDuration,
        spyCount: spyCount,
        categories: spyState.selectedCategories
    });
});

// ==================== Role Screen ====================
function showRoleScreen() {
    showScreen('spy-role-screen');

    document.getElementById('spy-round-display').textContent = spyState.currentRound;
    document.getElementById('spy-total-rounds-display').textContent = spyState.totalRounds;

    // Reset state
    document.getElementById('spy-role-hidden').style.display = 'block';
    document.getElementById('spy-role-revealed').style.display = 'none';
    document.getElementById('spy-role-confirmed').style.display = 'none';
}

// Tap to reveal
document.getElementById('spy-role-hidden').addEventListener('click', () => {
    document.getElementById('spy-role-hidden').style.display = 'none';
    document.getElementById('spy-role-revealed').style.display = 'block';

    const roleEmoji = document.getElementById('spy-role-emoji');
    const roleTitle = document.getElementById('spy-role-title');
    const wordContainer = document.getElementById('spy-role-word-container');
    const roleCategory = document.getElementById('spy-role-category');
    const roleWord = document.getElementById('spy-role-word');

    if (spyState.isSpy) {
        roleEmoji.textContent = '🕵️';
        roleTitle.textContent = 'أنت الجاسوس! 🕵️';
        roleTitle.className = 'role-title spy-role';
        wordContainer.style.display = 'block';
        wordContainer.style.background = 'rgba(231, 76, 60, 0.1)';
        wordContainer.style.borderColor = 'rgba(231, 76, 60, 0.3)';
        roleCategory.textContent = SPY_CATEGORIES[spyState.currentCategory]?.label || spyState.currentCategory;
        roleWord.textContent = '❓❓❓';
        roleWord.className = 'role-word spy-word';
    } else {
        roleEmoji.textContent = '✅';
        roleTitle.textContent = 'أنت لاعب عادي';
        roleTitle.className = 'role-title civilian-role';
        wordContainer.style.display = 'block';
        wordContainer.style.background = 'rgba(46, 204, 113, 0.1)';
        wordContainer.style.borderColor = 'rgba(46, 204, 113, 0.3)';
        roleCategory.textContent = SPY_CATEGORIES[spyState.currentCategory]?.label || spyState.currentCategory;
        roleWord.textContent = spyState.currentWord;
        roleWord.className = 'role-word';
    }
});

// Hide and confirm
document.getElementById('spy-hide-role-btn').addEventListener('click', () => {
    spyState.roleConfirmed = true;
    document.getElementById('spy-role-revealed').style.display = 'none';
    document.getElementById('spy-role-confirmed').style.display = 'block';

    socket.emit('spy-confirm-role', {
        roomCode: spyState.roomCode
    });
});

// ==================== Discussion Screen ====================
function showDiscussionScreen() {
    showScreen('spy-discussion-screen');

    document.getElementById('spy-discussion-round').textContent = spyState.currentRound;
    document.getElementById('spy-discussion-total').textContent = spyState.totalRounds;
    document.getElementById('spy-discussion-category').textContent =
        SPY_CATEGORIES[spyState.currentCategory]?.label || spyState.currentCategory;

    // Show word or spy reminder
    if (spyState.isSpy) {
        document.getElementById('spy-your-word-reminder').style.display = 'none';
        document.getElementById('spy-you-are-spy-reminder').style.display = 'block';
    } else {
        document.getElementById('spy-your-word-reminder').style.display = 'block';
        document.getElementById('spy-you-are-spy-reminder').style.display = 'none';
        document.getElementById('spy-your-word-text').textContent = spyState.currentWord;
    }

    startDiscussionTimer();
}

function startDiscussionTimer() {
    spyState.timerRemaining = spyState.timerDuration;
    const timerDisplay = document.getElementById('spy-timer-display');
    const timerProgress = document.getElementById('spy-timer-progress');

    const circumference = 2 * Math.PI * 45; // r=45
    timerProgress.style.strokeDasharray = circumference;
    timerProgress.style.strokeDashoffset = 0;

    if (spyState.timerInterval) clearInterval(spyState.timerInterval);

    updateTimerDisplay();

    spyState.timerInterval = setInterval(() => {
        spyState.timerRemaining--;

        if (spyState.timerRemaining <= 0) {
            clearInterval(spyState.timerInterval);
            spyState.timerRemaining = 0;
        }

        updateTimerDisplay();

        // Update circle
        const progress = 1 - (spyState.timerRemaining / spyState.timerDuration);
        timerProgress.style.strokeDashoffset = circumference * progress;

        // Color warnings
        if (spyState.timerRemaining <= 10) {
            timerDisplay.className = 'timer-big danger';
            timerProgress.style.stroke = '#e74c3c';
        } else if (spyState.timerRemaining <= 30) {
            timerDisplay.className = 'timer-big warning';
            timerProgress.style.stroke = '#f39c12';
        } else {
            timerDisplay.className = 'timer-big';
            timerProgress.style.stroke = '#667eea';
        }
    }, 1000);
}

function updateTimerDisplay() {
    const timerDisplay = document.getElementById('spy-timer-display');
    const minutes = Math.floor(spyState.timerRemaining / 60);
    const seconds = spyState.timerRemaining % 60;
    timerDisplay.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// ==================== Voting Screen ====================
function showVotingScreen() {
    showScreen('spy-voting-screen');

    if (spyState.timerInterval) {
        clearInterval(spyState.timerInterval);
    }

    spyState.selectedVote = null;
    const container = document.getElementById('spy-voting-players');
    const submitBtn = document.getElementById('spy-submit-vote-btn');
    submitBtn.disabled = true;

    container.innerHTML = '';
    spyState.players.forEach(player => {
        const card = document.createElement('div');
        card.className = `vote-player-card ${player.id === spyState.playerId ? 'is-me' : ''}`;
        card.dataset.playerId = player.id;
        card.innerHTML = `
            <div class="vote-avatar">🎮</div>
            <div class="vote-name">${player.name}${player.id === spyState.playerId ? ' (أنت)' : ''}</div>
        `;

        if (player.id !== spyState.playerId) {
            card.addEventListener('click', () => {
                // Deselect all
                container.querySelectorAll('.vote-player-card').forEach(c => c.classList.remove('selected'));
                // Select this
                card.classList.add('selected');
                spyState.selectedVote = player.id;
                submitBtn.disabled = false;
            });
        }

        container.appendChild(card);
    });

    document.getElementById('spy-waiting-votes').style.display = 'none';
}

// Submit vote
document.getElementById('spy-submit-vote-btn').addEventListener('click', () => {
    if (!spyState.selectedVote) return;

    socket.emit('spy-submit-vote', {
        roomCode: spyState.roomCode,
        votedFor: spyState.selectedVote
    });

    document.getElementById('spy-submit-vote-btn').style.display = 'none';
    document.getElementById('spy-voting-players').style.pointerEvents = 'none';
    document.getElementById('spy-waiting-votes').style.display = 'block';

    showToast('تم التصويت! ✅');
});

// ==================== Guess Screen ====================
function showGuessScreen(data) {
    showScreen('spy-guess-screen');

    spyState.selectedGuess = null;

    if (data.iAmSpy) {
        // Spy gets to guess
        document.getElementById('spy-guess-container').style.display = 'block';
        document.getElementById('spy-guess-waiting').style.display = 'none';
        document.getElementById('spy-guess-category').textContent =
            SPY_CATEGORIES[data.category]?.label || data.category;
        document.getElementById('spy-guess-subtitle').textContent = 'أنت الجاسوس! اختر الكلمة الصحيحة:';

        const optionsContainer = document.getElementById('spy-guess-options');
        const submitBtn = document.getElementById('spy-submit-guess-btn');
        submitBtn.disabled = true;

        optionsContainer.innerHTML = '';
        data.options.forEach(word => {
            const btn = document.createElement('button');
            btn.className = 'guess-option';
            btn.textContent = word;
            btn.addEventListener('click', () => {
                optionsContainer.querySelectorAll('.guess-option').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                spyState.selectedGuess = word;
                submitBtn.disabled = false;
            });
            optionsContainer.appendChild(btn);
        });
    } else {
        // Not spy - wait
        document.getElementById('spy-guess-container').style.display = 'none';
        document.getElementById('spy-guess-waiting').style.display = 'block';
        document.getElementById('spy-guess-subtitle').textContent =
            `الجاسوس ${data.spyNames?.join(' و ') || ''} بيحاول يخمن الكلمة...`;
    }
}

// Submit guess
document.getElementById('spy-submit-guess-btn').addEventListener('click', () => {
    if (!spyState.selectedGuess) return;

    socket.emit('spy-submit-guess', {
        roomCode: spyState.roomCode,
        guess: spyState.selectedGuess
    });

    document.getElementById('spy-submit-guess-btn').disabled = true;
    showToast('تم إرسال التخمين! 🎯');
});

// ==================== Round Result Screen ====================
function showRoundResult(data) {
    showScreen('spy-round-result-screen');

    if (spyState.timerInterval) {
        clearInterval(spyState.timerInterval);
    }

    const resultIcon = document.getElementById('spy-result-icon');
    const resultTitle = document.getElementById('spy-result-title');
    const resultMessage = document.getElementById('spy-result-message');

    if (data.spyCaught) {
        if (data.spyGuessedCorrectly) {
            resultIcon.textContent = '🕵️';
            resultTitle.textContent = 'الجاسوس اتمسك بس خمن صح!';
            resultMessage.textContent = 'الجاسوس خسر التصويت لكن خمن الكلمة صح! النقاط مقسمة.';
        } else {
            resultIcon.textContent = '🎉';
            resultTitle.textContent = 'اللاعبين كسبوا!';
            resultMessage.textContent = 'تم اكتشاف الجاسوس! برافو عليكم! 👏';
        }
    } else {
        if (data.spyGuessedCorrectly) {
            resultIcon.textContent = '🕵️';
            resultTitle.textContent = 'الجاسوس كسب!';
            resultMessage.textContent = 'الجاسوس نجا من التصويت وخمن الكلمة صح! 💀';
        } else {
            resultIcon.textContent = '😅';
            resultTitle.textContent = 'الجاسوس نجا!';
            resultMessage.textContent = 'الجاسوس نجا من التصويت لكن مخمنش الكلمة صح.';
        }
    }

    document.getElementById('spy-result-word').textContent = data.word;
    document.getElementById('spy-result-category').textContent =
        SPY_CATEGORIES[data.category]?.label || data.category;
    document.getElementById('spy-result-spies').textContent = data.spyNames.join('، ');

    // Show scores
    const scoresContainer = document.getElementById('spy-round-scores');
    scoresContainer.innerHTML = '<h3>📊 نقاط الجولة</h3>';
    data.players.forEach(p => {
        const item = document.createElement('div');
        const isSpy = data.spyIds.includes(p.id);
        item.className = `score-item ${isSpy ? 'spy-player' : ''}`;
        item.innerHTML = `
            <span class="player-name">${isSpy ? '🕵️ ' : ''}${p.name}</span>
            <span class="player-score ${p.roundScore < 0 ? 'negative' : ''}">
                ${p.roundScore > 0 ? '+' : ''}${p.roundScore} نقطة (المجموع: ${p.totalScore})
            </span>
        `;
        scoresContainer.appendChild(item);
    });

    // Host controls
    if (spyState.isHost) {
        document.getElementById('spy-host-next-controls').style.display = 'block';
        document.getElementById('spy-waiting-next').style.display = 'none';
    } else {
        document.getElementById('spy-host-next-controls').style.display = 'none';
        document.getElementById('spy-waiting-next').style.display = 'block';
    }
}

// Next round (Host)
document.getElementById('spy-next-round-btn').addEventListener('click', () => {
    socket.emit('spy-next-round', {
        roomCode: spyState.roomCode
    });
});

// ==================== Final Results ====================
function showFinalResults(players) {
    showScreen('spy-final-screen');

    const podium = document.getElementById('spy-podium');
    const list = document.getElementById('spy-leaderboard-list');

    const sorted = players.sort((a, b) => b.totalScore - a.totalScore);

    let podiumHTML = '';
    if (sorted[0]) podiumHTML += createPodiumItem(sorted[0], 1, '🥇');
    if (sorted[1]) podiumHTML += createPodiumItem(sorted[1], 2, '🥈');
    if (sorted[2]) podiumHTML += createPodiumItem(sorted[2], 3, '🥉');
    podium.innerHTML = podiumHTML;

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

document.getElementById('spy-go-home-btn').addEventListener('click', () => {
    window.location.href = '/';
});

// ==================== Connection Status ====================
socket.on('connect', () => {
    spyState.playerId = socket.id;
    console.log('✅ متصل بالسيرفر (Spy Game)');
});

socket.on('disconnect', () => {
    console.log('❌ انقطع الاتصال بالسيرفر');
    showToast('انقطع الاتصال بالسيرفر!', 'error');
});

console.log('🕵️ لعبة الجاسوس - تطوير عبد الرحمن علي');
