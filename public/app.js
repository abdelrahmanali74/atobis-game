// ==================== Socket.IO Connection with Reconnection ====================
const socket = io({
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 15000
});

// ==================== Safe DOM Helpers ====================
function $(id) { return document.getElementById(id); }
function safeText(id, text) { const el = $(id); if (el) el.textContent = text; }
function safeHTML(id, html) { const el = $(id); if (el) el.innerHTML = html; }
function safeStyle(id, prop, val) { const el = $(id); if (el) el.style[prop] = val; }
function safeDisable(id, disabled) { const el = $(id); if (el) el.disabled = disabled; }
function safeAddClick(id, fn) { const el = $(id); if (el) el.addEventListener('click', fn); }

// ==================== All Available Categories ====================
const ALL_CATEGORIES = {
    boy: { label: '👦 ولد', key: 'boy', emoji: '👦' },
    girl: { label: '👧 بنت', key: 'girl', emoji: '👧' },
    animal: { label: '🦁 حيوان', key: 'animal', emoji: '🦁' },
    plant: { label: '🌿 نبات', key: 'plant', emoji: '🌿' },
    object: { label: '📦 جماد', key: 'object', emoji: '📦' },
    country: { label: '🌍 بلد', key: 'country', emoji: '🌍' },
    food: { label: '🍕 أكلة', key: 'food', emoji: '🍕' },
    color: { label: '🎨 لون', key: 'color', emoji: '🎨' },
    egcity: { label: '🏛️ مدينة مصرية', key: 'egcity', emoji: '🏛️' },
    celebrity: { label: '⭐ مشهور', key: 'celebrity', emoji: '⭐' },
    footballer: { label: '⚽ لاعب كرة قدم', key: 'footballer', emoji: '⚽' },
    club: { label: '🏟️ اسم نادي', key: 'club', emoji: '🏟️' }
};
const DEFAULT_CATEGORIES = ['boy', 'girl', 'animal', 'plant', 'object', 'country'];

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
    if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
}
initTheme();
safeAddClick('theme-toggle', toggleTheme);

// ==================== Connection Overlay ====================
function createConnectionOverlay() {
    if ($('connection-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'connection-overlay';
    overlay.innerHTML = `
        <div class="connection-modal">
            <div class="connection-spinner"></div>
            <h3 id="connection-title">جاري إعادة الاتصال...</h3>
            <p id="connection-message">مستنيك ترجع تاني 🔄</p>
            <p id="connection-attempts" style="font-size:0.85rem;opacity:0.7;margin-top:8px;"></p>
        </div>
    `;
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);display:none;justify-content:center;align-items:center;z-index:10000;backdrop-filter:blur(5px);';
    const modal = overlay.querySelector('.connection-modal');
    modal.style.cssText = 'text-align:center;color:#fff;padding:40px;border-radius:20px;background:rgba(30,30,60,0.95);border:1px solid rgba(102,126,234,0.3);max-width:340px;';
    const spinner = overlay.querySelector('.connection-spinner');
    spinner.style.cssText = 'width:50px;height:50px;border:4px solid rgba(255,255,255,0.2);border-top-color:#667eea;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px;';
    if (!document.querySelector('#spin-style')) {
        const style = document.createElement('style');
        style.id = 'spin-style';
        style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(style);
    }
    document.body.appendChild(overlay);
}
function showConnectionOverlay(title, message) {
    createConnectionOverlay();
    const ov = $('connection-overlay');
    if (ov) { ov.style.display = 'flex'; safeText('connection-title', title || 'جاري إعادة الاتصال...'); safeText('connection-message', message || ''); }
}
function hideConnectionOverlay() {
    const ov = $('connection-overlay');
    if (ov) ov.style.display = 'none';
}

// ==================== Session Persistence ====================
function saveSession() {
    try {
        sessionStorage.setItem('atobis-session', JSON.stringify({
            roomCode: gameState.roomCode,
            playerName: gameState.playerName,
            isHost: gameState.isHost,
            gameType: 'atobis'
        }));
    } catch (e) { /* ignore */ }
}
function loadSession() {
    try {
        const data = sessionStorage.getItem('atobis-session');
        return data ? JSON.parse(data) : null;
    } catch (e) { return null; }
}
function clearSession() {
    try { sessionStorage.removeItem('atobis-session'); } catch (e) { /* ignore */ }
}

// ==================== Game State ====================
const gameState = {
    roomCode: null, playerName: null, players: [], currentLetter: null,
    totalRounds: 5, currentRound: 1, gameStartTime: null, timerInterval: null,
    isHost: false, gameAnswers: {}, scoringData: [],
    activeCategories: [...DEFAULT_CATEGORIES],
    isReconnecting: false,
    serverTimeOffset: 0, // local - server time diff
    roundStartTime: null // server timestamp when round started
};

// ==================== Screen Management ====================
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = $(screenId);
    if (el) el.classList.add('active');
}

// ==================== Toast Notifications ====================
function showToast(message, type = 'success') {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

// ==================== Categories Selector ====================
function renderCategoriesSelector() {
    const container = $('categories-selector');
    if (!container) return;
    container.innerHTML = '';
    Object.keys(ALL_CATEGORIES).forEach(key => {
        const cat = ALL_CATEGORIES[key];
        const isChecked = gameState.activeCategories.includes(key);
        const item = document.createElement('label');
        item.className = `category-chip ${isChecked ? 'active' : ''}`;
        item.innerHTML = `<input type="checkbox" value="${key}" ${isChecked ? 'checked' : ''} class="category-checkbox"><span class="chip-emoji">${cat.emoji}</span><span class="chip-label">${cat.label.replace(cat.emoji + ' ', '')}</span>`;
        const checkbox = item.querySelector('input');
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) { if (!gameState.activeCategories.includes(key)) gameState.activeCategories.push(key); item.classList.add('active'); }
            else { gameState.activeCategories = gameState.activeCategories.filter(c => c !== key); item.classList.remove('active'); }
        });
        container.appendChild(item);
    });
}

function renderGameInputs(categories) {
    const grid = $('game-inputs-grid');
    if (!grid) return;
    grid.innerHTML = '';
    categories.forEach(key => {
        const cat = ALL_CATEGORIES[key];
        if (!cat) return;
        const div = document.createElement('div');
        div.className = 'input-field';
        div.innerHTML = `<label>${cat.label}</label><input type="text" id="${key}-input" class="game-input" autocomplete="off">`;
        grid.appendChild(div);
    });
}

function renderScoringHeaders(categories) {
    const thead = $('scoring-thead');
    if (!thead) return;
    let h = '<tr><th>اللاعب</th>';
    categories.forEach(key => { const cat = ALL_CATEGORIES[key]; if (cat) h += `<th>${cat.label.replace(cat.emoji + ' ', '')}</th>`; });
    h += '<th>المجموع</th></tr>';
    thead.innerHTML = h;
}

// ==================== Start Screen ====================
safeAddClick('start-btn', () => {
    const nameEl = $('player-name');
    const codeEl = $('room-code');
    const playerName = nameEl ? nameEl.value.trim() : '';
    const roomCode = codeEl ? codeEl.value.trim().toUpperCase() : '';

    if (!playerName) { showToast('من فضلك أدخل اسمك!', 'error'); return; }
    if (playerName.length > 50) { showToast('الاسم طويل جداً!', 'error'); return; }

    gameState.playerName = playerName;
    if (roomCode) {
        socket.emit('join-room', { roomCode, playerName });
    } else {
        gameState.isHost = true;
        socket.emit('create-room', playerName);
    }
});

// ==================== Socket Events ====================
socket.on('room-created', (data) => {
    gameState.roomCode = data.roomCode;
    gameState.players = data.players || [];
    gameState.isHost = true;
    saveSession();
    showWaitingScreen();
    showToast('تم إنشاء الغرفة بنجاح! 🎉');
});

socket.on('room-joined', (data) => {
    gameState.roomCode = data.roomCode;
    gameState.players = data.players || [];
    gameState.currentLetter = data.currentLetter;
    if (data.categories) gameState.activeCategories = data.categories;
    saveSession();
    showWaitingScreen();
    showToast('تم الانضمام للغرفة بنجاح! 🎉');
});

socket.on('player-joined', (data) => {
    gameState.players = data.players || [];
    updatePlayersList();
    if (data.newPlayer) showToast(`${data.newPlayer} انضم للعبة! 👋`);
});

socket.on('player-left', (data) => {
    gameState.players = data.players || [];
    updatePlayersList();
    if (data.disconnectedPlayer) showToast('لاعب خرج من اللعبة ⚠️', 'warning');
});

socket.on('player-reconnected', (data) => {
    gameState.players = data.players || [];
    updatePlayersList();
    if (data.playerName) showToast(`${data.playerName} رجع للعبة! 🔄`);
});

socket.on('host-changed', (data) => {
    gameState.players = data.players || [];
    gameState.isHost = (data.newHostId === socket.id);
    updatePlayersList();
    showToast(`${data.newHostName} بقى الهوست الجديد 👑`, 'warning');
    // Re-render controls if on waiting screen
    const hostControls = $('host-controls');
    const waitingMsg = $('waiting-message');
    if (hostControls && waitingMsg) {
        if (gameState.isHost) { hostControls.style.display = 'block'; waitingMsg.style.display = 'none'; renderCategoriesSelector(); }
        else { hostControls.style.display = 'none'; waitingMsg.style.display = 'block'; }
    }
});

socket.on('round-started', (data) => {
    gameState.currentLetter = data.letter;
    gameState.currentRound = data.round;
    gameState.totalRounds = data.totalRounds;
    gameState.gameStartTime = data.startTime;
    gameState.roundStartTime = data.startTime;
    if (data.categories) gameState.activeCategories = data.categories;
    startRound(false, 0);
});

socket.on('round-ended', (data) => {
    stopTimer();
    showToast(`${data.finisher} خلص الجولة! ✋`, 'warning');
    submitCurrentAnswers();
});

socket.on('scoring-phase', (data) => {
    gameState.scoringData = data.players || [];
    showScoringScreen(data);
});

socket.on('score-updated', (data) => {
    const totalCell = $(`total-${data.playerId}`);
    if (totalCell) { totalCell.textContent = data.roundScore; totalCell.style.color = '#fff'; setTimeout(() => totalCell.style.color = '', 300); }
    if (!gameState.isHost) {
        const badge = document.querySelector(`.score-badge[data-player-id="${data.playerId}"][data-category="${data.category}"]`);
        if (badge) { badge.textContent = data.score; badge.className = `score-badge score-${data.score}`; }
    }
});

socket.on('game-over', (data) => { showFinalResults(data.players || []); });

socket.on('error', (data) => { showToast(data.message || 'حصل خطأ!', 'error'); });

socket.on('server-shutdown', () => {
    showToast('السيرفر هيتعمله ريستارت، استنى شوية...', 'warning');
});

// ==================== Reconnection Events ====================
socket.on('connect', () => {
    console.log('✅ متصل بالسيرفر');
    hideConnectionOverlay();

    if (gameState.isReconnecting && gameState.roomCode && gameState.playerName) {
        socket.emit('attempt-reconnect', {
            playerName: gameState.playerName,
            roomCode: gameState.roomCode,
            gameType: 'atobis'
        });
    } else {
        // Try session recovery on fresh connect
        const session = loadSession();
        if (session && session.roomCode && session.playerName) {
            gameState.playerName = session.playerName;
            gameState.roomCode = session.roomCode;
            gameState.isHost = session.isHost;
            socket.emit('attempt-reconnect', {
                playerName: session.playerName,
                roomCode: session.roomCode,
                gameType: 'atobis'
            });
        }
    }
});

socket.on('disconnect', (reason) => {
    console.log('❌ انقطع الاتصال:', reason);
    gameState.isReconnecting = true;
    if (gameState.roomCode) {
        showConnectionOverlay('انقطع الاتصال بالسيرفر! 😢', 'جاري إعادة الاتصال...');
    } else {
        showToast('انقطع الاتصال بالسيرفر!', 'error');
    }
});

socket.io.on('reconnect_attempt', (attempt) => {
    safeText('connection-attempts', `محاولة ${attempt} من 20`);
});

socket.io.on('reconnect_failed', () => {
    safeText('connection-title', 'فشل الاتصال! 😞');
    safeText('connection-message', 'تأكد من الإنترنت وحدّث الصفحة');
    safeText('connection-attempts', '');
});

socket.on('reconnect-success', (data) => {
    console.log('🔄 Reconnected successfully!');
    hideConnectionOverlay();
    gameState.isReconnecting = false;
    gameState.roomCode = data.roomCode;
    gameState.players = data.players || [];
    gameState.isHost = data.isHost;
    if (data.categories) gameState.activeCategories = data.categories;
    if (data.serverTime) gameState.serverTimeOffset = Date.now() - data.serverTime;

    if (!data.gameActive) {
        showWaitingScreen();
    } else if (data.roundState === 'playing') {
        gameState.currentLetter = data.currentLetter;
        gameState.currentRound = data.currentRound;
        gameState.totalRounds = data.totalRounds;
        gameState.roundStartTime = data.roundStartTime;
        // Calculate elapsed time since round started
        const elapsedMs = Date.now() - (data.roundStartTime + gameState.serverTimeOffset);
        const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
        startRound(true, elapsedSec);
    } else if (data.roundState === 'scoring' && data.scoringData) {
        gameState.currentLetter = data.currentLetter;
        gameState.currentRound = data.currentRound;
        gameState.totalRounds = data.totalRounds;
        showScoringScreen({
            players: data.scoringData,
            currentRound: data.currentRound,
            totalRounds: data.totalRounds,
            categories: data.categories,
            isHost: data.isHost
        });
    } else {
        showWaitingScreen();
    }
    showToast('تم إعادة الاتصال بنجاح! ✅');
});

socket.on('reconnect-failed', () => {
    hideConnectionOverlay();
    gameState.isReconnecting = false;
    clearSession();
    showScreen('start-screen');
    showToast('الغرفة مش موجودة، ابدأ من جديد', 'error');
});

// ==================== Waiting Screen ====================
function showWaitingScreen() {
    showScreen('waiting-screen');
    safeText('display-room-code', gameState.roomCode || '');
    updatePlayersList();
    const hostControls = $('host-controls');
    const waitingMsg = $('waiting-message');
    if (gameState.isHost) {
        if (hostControls) hostControls.style.display = 'block';
        if (waitingMsg) waitingMsg.style.display = 'none';
        renderCategoriesSelector();
    } else {
        if (hostControls) hostControls.style.display = 'none';
        if (waitingMsg) waitingMsg.style.display = 'block';
    }
}

function updatePlayersList() {
    const container = $('players-container');
    const count = $('players-count');
    if (count) count.textContent = gameState.players.length;
    if (container) {
        container.innerHTML = gameState.players.map(player => `
            <div class="player-item animate-slide-in">
                <span class="emoji">${player.isHost ? '👑' : '🎮'}</span>
                <span class="name">${player.name || 'لاعب'}</span>
            </div>
        `).join('');
    }
}

// ==================== Copy Room Code ====================
safeAddClick('copy-code-btn', () => {
    const code = gameState.roomCode || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => showToast('تم نسخ الكود! 📋')).catch(() => fallbackCopy(code));
    } else { fallbackCopy(code); }
});
function fallbackCopy(text) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta); showToast('تم نسخ الكود! 📋');
    } catch (e) { showToast('مقدرتش أنسخ الكود، انسخه يدوي: ' + text, 'error'); }
}

// ==================== Start Game ====================
safeAddClick('start-game-btn', () => {
    if (gameState.activeCategories.length < 3) { showToast('اختر على الأقل 3 فئات!', 'error'); return; }
    const roundsEl = $('rounds-select');
    const rounds = roundsEl ? roundsEl.value : '5';
    socket.emit('start-game', { roomCode: gameState.roomCode, totalRounds: rounds, categories: gameState.activeCategories });
});

// ==================== Game Logic ====================
function startRound(isReconnect = false, initialElapsed = 0) {
    showScreen('game-screen');
    safeText('current-letter', gameState.currentLetter || '');
    safeText('round-display', `${gameState.currentRound} / ${gameState.totalRounds}`);
    renderGameInputs(gameState.activeCategories);
    safeDisable('finish-btn', false);
    if (!isReconnect) {
        document.querySelectorAll('.game-input').forEach(input => { input.disabled = false; input.value = ''; input.classList.remove('filled'); });
    } else {
        document.querySelectorAll('.game-input').forEach(input => { input.disabled = false; });
    }
    startTimer(initialElapsed);
    addInputListeners();
    if (!isReconnect) {
        showToast(`بدأت الجولة ${gameState.currentRound}! الحرف: ${gameState.currentLetter} 🚀`);
    }
}

function startTimer(initialElapsed = 0) {
    const timerDisplay = $('timer');
    if (!timerDisplay) return;
    let startTime = Date.now() - (initialElapsed * 1000);
    if (gameState.timerInterval) clearInterval(gameState.timerInterval);
    // Show immediately
    const initElapsed = Math.floor((Date.now() - startTime) / 1000);
    timerDisplay.textContent = `${String(Math.floor(initElapsed / 60)).padStart(2, '0')}:${String(initElapsed % 60).padStart(2, '0')}`;
    gameState.timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        timerDisplay.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
    }, 1000);
}

function stopTimer() { if (gameState.timerInterval) { clearInterval(gameState.timerInterval); gameState.timerInterval = null; } }

function addInputListeners() {
    document.querySelectorAll('.game-input').forEach(input => {
        input.addEventListener('input', (e) => { e.target.value.trim() ? e.target.classList.add('filled') : e.target.classList.remove('filled'); });
    });
}

// ==================== Submit Logic ====================
const gameForm = $('game-form');
if (gameForm) {
    gameForm.addEventListener('submit', (e) => {
        e.preventDefault();
        safeDisable('finish-btn', true);
        socket.emit('finish-round', { roomCode: gameState.roomCode, answers: collectAnswers() });
        disableInputs();
    });
}

function submitCurrentAnswers() {
    disableInputs();
    socket.emit('submit-answers', { roomCode: gameState.roomCode, answers: collectAnswers() });
}

function collectAnswers() {
    const answers = {};
    gameState.activeCategories.forEach(key => { const input = $(`${key}-input`); answers[key] = input ? input.value.trim() : ''; });
    return answers;
}

function disableInputs() {
    document.querySelectorAll('.game-input').forEach(i => i.disabled = true);
    safeDisable('finish-btn', true);
}

// ==================== Scoring Screen ====================
function showScoringScreen(data) {
    showScreen('scoring-screen');
    safeText('scoring-round-num', data.currentRound);
    const categories = gameState.activeCategories;
    renderScoringHeaders(categories);
    const tbody = $('scoring-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    const isHost = gameState.isHost;

    (data.players || []).forEach(player => {
        const row = document.createElement('tr');
        const nameCell = document.createElement('td');
        nameCell.innerHTML = `<strong style="color: var(--accent-gold, #ffd700)">${player.name || 'لاعب'}</strong>`;
        row.appendChild(nameCell);
        let playerScoreSum = 0;

        categories.forEach(cat => {
            const cell = document.createElement('td');
            const answerText = (player.answers && player.answers[cat]) || '-';
            let currentScore = 0;
            if (answerText.trim() !== '-' && answerText.trim().length > 0 && answerText.trim().startsWith(gameState.currentLetter)) currentScore = 10;

            if (isHost) {
                const container = document.createElement('div'); container.className = 'score-control-container';
                const ansDiv = document.createElement('div'); ansDiv.className = 'answer-text'; ansDiv.textContent = answerText;
                const toggleBtn = document.createElement('button');
                toggleBtn.className = `score-toggle score-${currentScore}`; toggleBtn.textContent = currentScore;
                toggleBtn.dataset.value = currentScore; toggleBtn.dataset.playerId = player.id; toggleBtn.dataset.category = cat;
                toggleBtn.addEventListener('click', () => {
                    let v = parseInt(toggleBtn.dataset.value);
                    let nv = v === 0 ? 5 : v === 5 ? 10 : 0;
                    toggleBtn.dataset.value = nv; toggleBtn.textContent = nv; toggleBtn.className = `score-toggle score-${nv}`;
                    socket.emit('update-single-score', { roomCode: gameState.roomCode, playerId: player.id, category: cat, score: nv });
                    calculateTotalsLocally();
                });
                container.appendChild(ansDiv); container.appendChild(toggleBtn); cell.appendChild(container);
                playerScoreSum += currentScore;
            } else {
                const container = document.createElement('div'); container.className = 'score-control-container';
                const ansDiv = document.createElement('div'); ansDiv.className = 'answer-text'; ansDiv.textContent = answerText;
                const badge = document.createElement('span'); badge.className = `score-badge score-${currentScore}`;
                badge.textContent = currentScore; badge.dataset.playerId = player.id; badge.dataset.category = cat;
                container.appendChild(ansDiv); container.appendChild(badge); cell.appendChild(container);
                playerScoreSum = player.roundScore || 0;
            }
            row.appendChild(cell);
        });

        const totalCell = document.createElement('td');
        totalCell.className = 'round-total'; totalCell.id = `total-${player.id}`; totalCell.textContent = playerScoreSum;
        row.appendChild(totalCell); tbody.appendChild(row);
    });

    if (isHost) {
        safeStyle('host-scoring-controls', 'display', 'block'); safeStyle('waiting-host-scoring', 'display', 'none');
        calculateTotalsLocally();
    } else {
        safeStyle('host-scoring-controls', 'display', 'none'); safeStyle('waiting-host-scoring', 'display', 'block');
    }
}

function calculateTotalsLocally() {
    const tbody = $('scoring-body');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach(row => {
        const buttons = row.querySelectorAll('.score-toggle');
        if (buttons.length > 0) {
            let sum = 0;
            buttons.forEach(btn => sum += parseInt(btn.dataset.value) || 0);
            const totalCell = row.querySelector('.round-total');
            if (totalCell) totalCell.textContent = sum;
        }
    });
}

safeAddClick('next-round-btn', () => { socket.emit('update-scores-and-next', { roomCode: gameState.roomCode }); });

// ==================== Final Results ====================
function showFinalResults(players) {
    showScreen('final-screen');
    clearSession();
    const podium = $('podium');
    const list = $('leaderboard-list');
    const sorted = (players || []).sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

    if (podium) {
        let h = '';
        if (sorted[0]) h += createPodiumItem(sorted[0], 1, '🥇');
        if (sorted[1]) h += createPodiumItem(sorted[1], 2, '🥈');
        if (sorted[2]) h += createPodiumItem(sorted[2], 3, '🥉');
        podium.innerHTML = h;
    }
    if (list) {
        list.innerHTML = sorted.map((p, i) => `
            <li class="leaderboard-item"><span class="rank">#${i + 1}</span><span class="name">${p.name || 'لاعب'}</span><span class="score">${p.totalScore || 0} نقطة</span></li>
        `).join('');
    }
}

function createPodiumItem(player, rank, medal) {
    return `<div class="podium-item rank-${rank}"><div class="medal">${medal}</div><div class="p-name">${player.name || 'لاعب'}</div><div class="p-score">${player.totalScore || 0}</div></div>`;
}

safeAddClick('go-home-btn', () => { clearSession(); location.reload(); });

console.log('🚌 لعبة أتوبيس كومبليت - تطوير عبد الرحمن علي');
