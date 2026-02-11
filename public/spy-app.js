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
function safeStyle(id, prop, val) { const el = $(id); if (el) el.style[prop] = val; }
function safeAddClick(id, fn) { const el = $(id); if (el) el.addEventListener('click', fn); }

// ==================== Spy Categories ====================
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

// ==================== Theme ====================
function initTheme() {
    const t = localStorage.getItem('atobis-theme') || 'dark';
    document.body.setAttribute('data-theme', t);
    updateThemeIcon(t);
}
function toggleTheme() {
    const c = document.body.getAttribute('data-theme');
    const n = c === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', n);
    localStorage.setItem('atobis-theme', n);
    updateThemeIcon(n);
}
function updateThemeIcon(t) {
    const icon = document.querySelector('.theme-icon');
    if (icon) icon.textContent = t === 'dark' ? '☀️' : '🌙';
}
initTheme();
safeAddClick('theme-toggle', toggleTheme);

// ==================== Connection Overlay ====================
function createConnectionOverlay() {
    if ($('connection-overlay')) return;
    const ov = document.createElement('div');
    ov.id = 'connection-overlay';
    ov.innerHTML = `<div style="text-align:center;color:#fff;padding:40px;border-radius:20px;background:rgba(30,30,60,0.95);border:1px solid rgba(102,126,234,0.3);max-width:340px;">
        <div style="width:50px;height:50px;border:4px solid rgba(255,255,255,0.2);border-top-color:#667eea;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px;"></div>
        <h3 id="spy-conn-title">جاري إعادة الاتصال...</h3>
        <p id="spy-conn-msg">مستنيك ترجع تاني 🔄</p>
        <p id="spy-conn-attempts" style="font-size:0.85rem;opacity:0.7;margin-top:8px;"></p>
    </div>`;
    ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);display:none;justify-content:center;align-items:center;z-index:10000;backdrop-filter:blur(5px);';
    if (!document.querySelector('#spin-style')) {
        const s = document.createElement('style'); s.id = 'spin-style';
        s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(s);
    }
    document.body.appendChild(ov);
}
function showConnectionOverlay(t, m) {
    createConnectionOverlay();
    const ov = $('connection-overlay');
    if (ov) { ov.style.display = 'flex'; safeText('spy-conn-title', t || 'جاري إعادة الاتصال...'); safeText('spy-conn-msg', m || ''); }
}
function hideConnectionOverlay() { const ov = $('connection-overlay'); if (ov) ov.style.display = 'none'; }

// ==================== Session Persistence ====================
function saveSession() {
    try {
        sessionStorage.setItem('spy-session', JSON.stringify({
            roomCode: spyState.roomCode, playerName: spyState.playerName,
            isHost: spyState.isHost, gameType: 'spy'
        }));
    } catch (e) { }
}
function loadSession() { try { const d = sessionStorage.getItem('spy-session'); return d ? JSON.parse(d) : null; } catch (e) { return null; } }
function clearSession() { try { sessionStorage.removeItem('spy-session'); } catch (e) { } }

// ==================== Game State ====================
const spyState = {
    roomCode: null, playerName: null, playerId: null, players: [],
    isHost: false, isSpy: false, currentWord: null, currentCategory: null,
    totalRounds: 5, currentRound: 1, timerDuration: 120,
    timerInterval: null, timerRemaining: 0,
    selectedVote: null, selectedGuess: null, roleConfirmed: false,
    selectedCategories: ['animal', 'object', 'food', 'place', 'country'],
    spyCount: 1, isReconnecting: false,
    serverTimeOffset: 0, // local - server time diff
    discussionStartTime: null // server timestamp when discussion started
};

// ==================== Screen & Toast ====================
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = $(screenId); if (el) el.classList.add('active');
}
function showToast(message, type = 'success') {
    const toast = $('spy-toast'); if (!toast) return;
    toast.textContent = message; toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ==================== Categories Selector ====================
function renderSpyCategoriesSelector() {
    const container = $('spy-categories-selector'); if (!container) return;
    container.innerHTML = '';
    Object.keys(SPY_CATEGORIES).forEach(key => {
        const cat = SPY_CATEGORIES[key];
        const isChecked = spyState.selectedCategories.includes(key);
        const item = document.createElement('label');
        item.className = `category-chip ${isChecked ? 'active' : ''}`;
        item.innerHTML = `<input type="checkbox" value="${key}" ${isChecked ? 'checked' : ''} class="category-checkbox"><span class="chip-emoji">${cat.emoji}</span><span class="chip-label">${cat.label.replace(cat.emoji + ' ', '')}</span>`;
        const cb = item.querySelector('input');
        cb.addEventListener('change', () => {
            if (cb.checked) { if (!spyState.selectedCategories.includes(key)) spyState.selectedCategories.push(key); item.classList.add('active'); }
            else { spyState.selectedCategories = spyState.selectedCategories.filter(c => c !== key); item.classList.remove('active'); }
        });
        container.appendChild(item);
    });
}

// ==================== Start Screen ====================
safeAddClick('spy-start-btn', () => {
    const nameEl = $('spy-player-name');
    const codeEl = $('spy-room-code');
    const playerName = nameEl ? nameEl.value.trim() : '';
    const roomCode = codeEl ? codeEl.value.trim().toUpperCase() : '';
    if (!playerName) { showToast('من فضلك أدخل اسمك!', 'error'); return; }
    if (playerName.length > 50) { showToast('الاسم طويل جداً!', 'error'); return; }
    spyState.playerName = playerName;
    if (roomCode) { socket.emit('spy-join-room', { roomCode, playerName }); }
    else { spyState.isHost = true; socket.emit('spy-create-room', playerName); }
});

// ==================== Socket Events ====================
socket.on('spy-room-created', (data) => {
    spyState.roomCode = data.roomCode; spyState.players = data.players || [];
    spyState.playerId = socket.id; spyState.isHost = true;
    saveSession(); showWaitingScreen(); showToast('تم إنشاء الغرفة بنجاح! 🎉');
});

socket.on('spy-room-joined', (data) => {
    spyState.roomCode = data.roomCode; spyState.players = data.players || [];
    spyState.playerId = socket.id;
    saveSession(); showWaitingScreen(); showToast('تم الانضمام للغرفة بنجاح! 🎉');
});

socket.on('spy-player-joined', (data) => {
    spyState.players = data.players || []; updatePlayersList();
    if (data.newPlayer) showToast(`${data.newPlayer} انضم للعبة! 👋`);
});

socket.on('spy-player-left', (data) => {
    spyState.players = data.players || []; updatePlayersList();
    if (data.disconnectedPlayer) showToast('لاعب خرج من اللعبة ⚠️', 'warning');
});

socket.on('spy-player-reconnected', (data) => {
    spyState.players = data.players || []; updatePlayersList();
    if (data.playerName) showToast(`${data.playerName} رجع للعبة! 🔄`);
});

socket.on('spy-host-changed', (data) => {
    spyState.players = data.players || [];
    spyState.isHost = (data.newHostId === socket.id);
    updatePlayersList();
    showToast(`${data.newHostName} بقى الهوست الجديد 👑`, 'warning');
    const hc = $('spy-host-controls'); const wm = $('spy-waiting-message');
    if (hc && wm) {
        if (spyState.isHost) { hc.style.display = 'block'; wm.style.display = 'none'; renderSpyCategoriesSelector(); }
        else { hc.style.display = 'none'; wm.style.display = 'block'; }
    }
    // Also update result screen host controls
    const hnc = $('spy-host-next-controls'); const wn = $('spy-waiting-next');
    if (hnc && wn) {
        if (spyState.isHost) { hnc.style.display = 'block'; wn.style.display = 'none'; }
        else { hnc.style.display = 'none'; wn.style.display = 'block'; }
    }
});

socket.on('spy-round-started', (data) => {
    spyState.currentRound = data.round; spyState.totalRounds = data.totalRounds;
    spyState.isSpy = data.isSpy; spyState.currentWord = data.word;
    spyState.currentCategory = data.category; spyState.timerDuration = data.timerDuration;
    spyState.roleConfirmed = false; showRoleScreen();
});

socket.on('spy-start-discussion', (data) => {
    spyState.timerDuration = data.timerDuration;
    if (data.discussionStartTime) spyState.discussionStartTime = data.discussionStartTime;
    if (data.serverTime) spyState.serverTimeOffset = Date.now() - data.serverTime;
    showDiscussionScreen();
});

socket.on('spy-confirm-update', (data) => { safeText('spy-confirmed-count', `${data.confirmed} / ${data.total}`); });

socket.on('spy-start-voting', (data) => { spyState.players = data.players || []; showVotingScreen(); });

socket.on('spy-vote-update', (data) => { safeText('spy-votes-count', `${data.voted} / ${data.total}`); });

socket.on('spy-guess-phase', (data) => { showGuessScreen(data); });

socket.on('spy-round-result', (data) => { showRoundResult(data); });

socket.on('spy-game-over', (data) => { showFinalResults(data.players || []); });

socket.on('error', (data) => { showToast((data && data.message) || 'حصل خطأ!', 'error'); });

socket.on('server-shutdown', () => { showToast('السيرفر هيتعمله ريستارت، استنى شوية...', 'warning'); });

// ==================== Reconnection ====================
socket.on('connect', () => {
    console.log('✅ متصل بالسيرفر (Spy)');
    spyState.playerId = socket.id;
    hideConnectionOverlay();
    if (spyState.isReconnecting && spyState.roomCode && spyState.playerName) {
        socket.emit('attempt-reconnect', { playerName: spyState.playerName, roomCode: spyState.roomCode, gameType: 'spy' });
    } else {
        const session = loadSession();
        if (session && session.roomCode && session.playerName && session.gameType === 'spy') {
            spyState.playerName = session.playerName; spyState.roomCode = session.roomCode; spyState.isHost = session.isHost;
            socket.emit('attempt-reconnect', { playerName: session.playerName, roomCode: session.roomCode, gameType: 'spy' });
        }
    }
});

socket.on('disconnect', (reason) => {
    console.log('❌ انقطع الاتصال:', reason);
    spyState.isReconnecting = true;
    if (spyState.roomCode) showConnectionOverlay('انقطع الاتصال بالسيرفر! 😢', 'جاري إعادة الاتصال...');
    else showToast('انقطع الاتصال بالسيرفر!', 'error');
});

socket.io.on('reconnect_attempt', (attempt) => { safeText('spy-conn-attempts', `محاولة ${attempt} من 20`); });

socket.io.on('reconnect_failed', () => {
    safeText('spy-conn-title', 'فشل الاتصال! 😞');
    safeText('spy-conn-msg', 'تأكد من الإنترنت وحدّث الصفحة');
});

socket.on('reconnect-success', (data) => {
    console.log('🔄 Spy reconnected!');
    hideConnectionOverlay(); spyState.isReconnecting = false;
    spyState.roomCode = data.roomCode; spyState.players = data.players || [];
    spyState.isHost = data.isHost; spyState.playerId = socket.id;
    if (data.serverTime) spyState.serverTimeOffset = Date.now() - data.serverTime;

    if (data.gameType === 'spy') {
        if (!data.gameActive) {
            showWaitingScreen();
        } else if (data.roundState === 'role-reveal') {
            // Restore role reveal state
            spyState.isSpy = data.isSpy; spyState.currentWord = data.currentWord;
            spyState.currentCategory = data.currentCategory; spyState.timerDuration = data.timerDuration;
            spyState.currentRound = data.currentRound; spyState.totalRounds = data.totalRounds;
            spyState.roleConfirmed = data.confirmed || false;
            if (spyState.roleConfirmed) {
                // Already confirmed, show waiting for others
                showRoleScreen();
                // Jump to confirmed state
                safeStyle('spy-role-hidden', 'display', 'none');
                safeStyle('spy-role-revealed', 'display', 'none');
                safeStyle('spy-role-confirmed', 'display', 'block');
            } else {
                showRoleScreen();
            }
        } else if (data.roundState === 'discussion') {
            spyState.isSpy = data.isSpy; spyState.currentWord = data.currentWord;
            spyState.currentCategory = data.currentCategory; spyState.timerDuration = data.timerDuration;
            spyState.currentRound = data.currentRound; spyState.totalRounds = data.totalRounds;
            spyState.discussionStartTime = data.discussionStartTime;
            // Calculate elapsed seconds from server time
            const elapsedMs = Date.now() - (data.discussionStartTime + spyState.serverTimeOffset);
            const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
            showDiscussionScreen(elapsedSec);
        } else if (data.roundState === 'voting') {
            spyState.isSpy = data.isSpy; spyState.currentWord = data.currentWord;
            spyState.currentCategory = data.currentCategory;
            spyState.currentRound = data.currentRound; spyState.totalRounds = data.totalRounds;
            showVotingScreen();
        } else if (data.roundState === 'guessing') {
            spyState.isSpy = data.isSpy; spyState.currentWord = data.currentWord;
            spyState.currentCategory = data.currentCategory;
            spyState.currentRound = data.currentRound; spyState.totalRounds = data.totalRounds;
            // Show waiting screen for guess phase since we can't restore guess options
            showScreen('spy-guess-screen');
            safeStyle('spy-guess-container', 'display', 'none');
            safeStyle('spy-guess-waiting', 'display', 'block');
        } else if (data.roundState === 'result' && data.lastRoundResult) {
            spyState.currentRound = data.currentRound; spyState.totalRounds = data.totalRounds;
            showRoundResult(data.lastRoundResult);
        } else {
            showWaitingScreen();
        }
    }
    showToast('تم إعادة الاتصال بنجاح! ✅');
});

socket.on('reconnect-failed', () => {
    hideConnectionOverlay(); spyState.isReconnecting = false; clearSession();
    showScreen('spy-start-screen'); showToast('الغرفة مش موجودة، ابدأ من جديد', 'error');
});

// ==================== Waiting Screen ====================
function showWaitingScreen() {
    showScreen('spy-waiting-screen');
    safeText('spy-display-room-code', spyState.roomCode || '');
    updatePlayersList();
    const hc = $('spy-host-controls'); const wm = $('spy-waiting-message');
    if (spyState.isHost) {
        if (hc) hc.style.display = 'block'; if (wm) wm.style.display = 'none';
        renderSpyCategoriesSelector();
    } else {
        if (hc) hc.style.display = 'none'; if (wm) wm.style.display = 'block';
    }
}

function updatePlayersList() {
    const container = $('spy-players-container'); const count = $('spy-players-count');
    if (count) count.textContent = spyState.players.length;
    if (container) {
        container.innerHTML = spyState.players.map(p => `
            <div class="player-item animate-slide-in"><span class="emoji">${p.isHost ? '👑' : '🎮'}</span><span class="name">${p.name || 'لاعب'}</span></div>
        `).join('');
    }
}

safeAddClick('spy-copy-code-btn', () => {
    const code = spyState.roomCode || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => showToast('تم نسخ الكود! 📋')).catch(() => fallbackCopy(code));
    } else { fallbackCopy(code); }
});
function fallbackCopy(text) {
    try {
        const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta); showToast('تم نسخ الكود! 📋');
    } catch (e) { showToast('انسخ الكود يدوي: ' + text, 'error'); }
}

safeAddClick('spy-start-game-btn', () => {
    if (spyState.players.length < 3) { showToast('محتاج على الأقل 3 لاعبين!', 'error'); return; }
    if (spyState.selectedCategories.length < 1) { showToast('اختر على الأقل فئة واحدة!', 'error'); return; }
    const scEl = $('spy-count-select'); const spyCount = scEl ? parseInt(scEl.value) : 1;
    if (spyCount >= spyState.players.length) { showToast('عدد الجواسيس لازم يكون أقل من عدد اللاعبين!', 'error'); return; }
    const rnds = $('spy-rounds-select'); const tmr = $('spy-timer-select');
    socket.emit('spy-start-game', {
        roomCode: spyState.roomCode,
        totalRounds: rnds ? parseInt(rnds.value) : 5,
        timerDuration: tmr ? parseInt(tmr.value) : 120,
        spyCount: spyCount,
        categories: spyState.selectedCategories
    });
});

// ==================== Role Screen ====================
function showRoleScreen() {
    showScreen('spy-role-screen');
    safeText('spy-round-display', spyState.currentRound);
    safeText('spy-total-rounds-display', spyState.totalRounds);
    safeStyle('spy-role-hidden', 'display', 'block');
    safeStyle('spy-role-revealed', 'display', 'none');
    safeStyle('spy-role-confirmed', 'display', 'none');
}

safeAddClick('spy-role-hidden', () => {
    safeStyle('spy-role-hidden', 'display', 'none');
    safeStyle('spy-role-revealed', 'display', 'block');
    const roleEmoji = $('spy-role-emoji'); const roleTitle = $('spy-role-title');
    const wordContainer = $('spy-role-word-container');
    const roleCategory = $('spy-role-category'); const roleWord = $('spy-role-word');

    const catLabel = SPY_CATEGORIES[spyState.currentCategory]?.label || spyState.currentCategory || '';
    if (spyState.isSpy) {
        if (roleEmoji) roleEmoji.textContent = '🕵️';
        if (roleTitle) { roleTitle.textContent = 'أنت الجاسوس! 🕵️'; roleTitle.className = 'role-title spy-role'; }
        if (wordContainer) { wordContainer.style.display = 'block'; wordContainer.style.background = 'rgba(231,76,60,0.1)'; wordContainer.style.borderColor = 'rgba(231,76,60,0.3)'; }
        if (roleCategory) roleCategory.textContent = catLabel;
        if (roleWord) { roleWord.textContent = '❓❓❓'; roleWord.className = 'role-word spy-word'; }
    } else {
        if (roleEmoji) roleEmoji.textContent = '✅';
        if (roleTitle) { roleTitle.textContent = 'أنت لاعب عادي'; roleTitle.className = 'role-title civilian-role'; }
        if (wordContainer) { wordContainer.style.display = 'block'; wordContainer.style.background = 'rgba(46,204,113,0.1)'; wordContainer.style.borderColor = 'rgba(46,204,113,0.3)'; }
        if (roleCategory) roleCategory.textContent = catLabel;
        if (roleWord) { roleWord.textContent = spyState.currentWord || ''; roleWord.className = 'role-word'; }
    }
});

safeAddClick('spy-hide-role-btn', () => {
    spyState.roleConfirmed = true;
    safeStyle('spy-role-revealed', 'display', 'none');
    safeStyle('spy-role-confirmed', 'display', 'block');
    socket.emit('spy-confirm-role', { roomCode: spyState.roomCode });
});

// ==================== Discussion Screen ====================
function showDiscussionScreen(initialElapsedSec = 0) {
    showScreen('spy-discussion-screen');
    safeText('spy-discussion-round', spyState.currentRound);
    safeText('spy-discussion-total', spyState.totalRounds);
    safeText('spy-discussion-category', SPY_CATEGORIES[spyState.currentCategory]?.label || spyState.currentCategory || '');

    if (spyState.isSpy) {
        safeStyle('spy-your-word-reminder', 'display', 'none');
        safeStyle('spy-you-are-spy-reminder', 'display', 'block');
    } else {
        safeStyle('spy-your-word-reminder', 'display', 'block');
        safeStyle('spy-you-are-spy-reminder', 'display', 'none');
        safeText('spy-your-word-text', spyState.currentWord || '');
    }
    startDiscussionTimer(initialElapsedSec);
}

function startDiscussionTimer(initialElapsedSec = 0) {
    // Calculate remaining time accounting for elapsed time
    spyState.timerRemaining = Math.max(0, spyState.timerDuration - initialElapsedSec);
    const timerProgress = $('spy-timer-progress');
    const circumference = 2 * Math.PI * 45;
    if (timerProgress) { timerProgress.style.strokeDasharray = circumference; timerProgress.style.strokeDashoffset = 0; }
    if (spyState.timerInterval) clearInterval(spyState.timerInterval);

    updateTimerDisplay();
    // Update progress bar immediately
    if (timerProgress) {
        const progress = 1 - (spyState.timerRemaining / spyState.timerDuration);
        timerProgress.style.strokeDashoffset = circumference * progress;
    }
    spyState.timerInterval = setInterval(() => {
        spyState.timerRemaining--;
        if (spyState.timerRemaining <= 0) { clearInterval(spyState.timerInterval); spyState.timerRemaining = 0; }
        updateTimerDisplay();
        if (timerProgress) {
            const progress = 1 - (spyState.timerRemaining / spyState.timerDuration);
            timerProgress.style.strokeDashoffset = circumference * progress;
            if (spyState.timerRemaining <= 10) timerProgress.style.stroke = '#e74c3c';
            else if (spyState.timerRemaining <= 30) timerProgress.style.stroke = '#f39c12';
            else timerProgress.style.stroke = '#667eea';
        }
        const td = $('spy-timer-display');
        if (td) {
            if (spyState.timerRemaining <= 10) td.className = 'timer-big danger';
            else if (spyState.timerRemaining <= 30) td.className = 'timer-big warning';
            else td.className = 'timer-big';
        }
    }, 1000);
}

function updateTimerDisplay() {
    const td = $('spy-timer-display'); if (!td) return;
    const m = Math.floor(spyState.timerRemaining / 60);
    td.textContent = `${m}:${String(spyState.timerRemaining % 60).padStart(2, '0')}`;
}

// ==================== Voting Screen ====================
function showVotingScreen() {
    showScreen('spy-voting-screen');
    if (spyState.timerInterval) clearInterval(spyState.timerInterval);
    spyState.selectedVote = null;
    const container = $('spy-voting-players');
    const submitBtn = $('spy-submit-vote-btn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.style.display = ''; }
    if (!container) return;
    container.style.pointerEvents = '';
    container.innerHTML = '';

    (spyState.players || []).forEach(player => {
        const card = document.createElement('div');
        const isMe = player.id === spyState.playerId;
        card.className = `vote-player-card ${isMe ? 'is-me' : ''}`;
        card.dataset.playerId = player.id;
        card.innerHTML = `<div class="vote-avatar">🎮</div><div class="vote-name">${player.name || 'لاعب'}${isMe ? ' (أنت)' : ''}</div>`;
        if (!isMe) {
            card.addEventListener('click', () => {
                container.querySelectorAll('.vote-player-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                spyState.selectedVote = player.id;
                if (submitBtn) submitBtn.disabled = false;
            });
        }
        container.appendChild(card);
    });
    safeStyle('spy-waiting-votes', 'display', 'none');
}

safeAddClick('spy-submit-vote-btn', () => {
    if (!spyState.selectedVote) return;
    socket.emit('spy-submit-vote', { roomCode: spyState.roomCode, votedFor: spyState.selectedVote });
    safeStyle('spy-submit-vote-btn', 'display', 'none');
    const vp = $('spy-voting-players'); if (vp) vp.style.pointerEvents = 'none';
    safeStyle('spy-waiting-votes', 'display', 'block');
    showToast('تم التصويت! ✅');
});

// ==================== Guess Screen ====================
function showGuessScreen(data) {
    showScreen('spy-guess-screen');
    spyState.selectedGuess = null;
    if (data.iAmSpy) {
        safeStyle('spy-guess-container', 'display', 'block');
        safeStyle('spy-guess-waiting', 'display', 'none');
        safeText('spy-guess-category', SPY_CATEGORIES[data.category]?.label || data.category || '');
        safeText('spy-guess-subtitle', 'أنت الجاسوس! اختر الكلمة الصحيحة:');
        const optC = $('spy-guess-options'); const subBtn = $('spy-submit-guess-btn');
        if (subBtn) subBtn.disabled = true;
        if (optC) {
            optC.innerHTML = '';
            (data.options || []).forEach(word => {
                const btn = document.createElement('button');
                btn.className = 'guess-option'; btn.textContent = word;
                btn.addEventListener('click', () => {
                    optC.querySelectorAll('.guess-option').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected'); spyState.selectedGuess = word;
                    if (subBtn) subBtn.disabled = false;
                });
                optC.appendChild(btn);
            });
        }
    } else {
        safeStyle('spy-guess-container', 'display', 'none');
        safeStyle('spy-guess-waiting', 'display', 'block');
        const names = data.spyNames ? data.spyNames.join(' و ') : '';
        safeText('spy-guess-subtitle', `الجاسوس ${names} بيحاول يخمن الكلمة...`);
    }
}

safeAddClick('spy-submit-guess-btn', () => {
    if (!spyState.selectedGuess) return;
    socket.emit('spy-submit-guess', { roomCode: spyState.roomCode, guess: spyState.selectedGuess });
    const btn = $('spy-submit-guess-btn'); if (btn) btn.disabled = true;
    showToast('تم إرسال التخمين! 🎯');
});

// ==================== Round Result ====================
function showRoundResult(data) {
    showScreen('spy-round-result-screen');
    if (spyState.timerInterval) clearInterval(spyState.timerInterval);

    if (data.spyCaught) {
        if (data.spyGuessedCorrectly) {
            safeText('spy-result-icon', '🕵️'); safeText('spy-result-title', 'الجاسوس اتمسك بس خمن صح!');
            safeText('spy-result-message', 'الجاسوس خسر التصويت لكن خمن الكلمة صح!');
        } else {
            safeText('spy-result-icon', '🎉'); safeText('spy-result-title', 'اللاعبين كسبوا!');
            safeText('spy-result-message', 'تم اكتشاف الجاسوس! برافو عليكم! 👏');
        }
    } else {
        if (data.spyGuessedCorrectly) {
            safeText('spy-result-icon', '🕵️'); safeText('spy-result-title', 'الجاسوس كسب!');
            safeText('spy-result-message', 'الجاسوس نجا من التصويت وخمن الكلمة صح! 💀');
        } else {
            safeText('spy-result-icon', '😅'); safeText('spy-result-title', 'الجاسوس نجا!');
            safeText('spy-result-message', 'الجاسوس نجا من التصويت.');
        }
    }

    safeText('spy-result-word', data.word || '');
    safeText('spy-result-category', SPY_CATEGORIES[data.category]?.label || data.category || '');
    safeText('spy-result-spies', (data.spyNames || []).join('، '));

    const sc = $('spy-round-scores');
    if (sc) {
        sc.innerHTML = '<h3>📊 نقاط الجولة</h3>';
        (data.players || []).forEach(p => {
            const isSpy = (data.spyIds || []).includes(p.id);
            const item = document.createElement('div');
            item.className = `score-item ${isSpy ? 'spy-player' : ''}`;
            item.innerHTML = `<span class="player-name">${isSpy ? '🕵️ ' : ''}${p.name || 'لاعب'}</span>
                <span class="player-score ${(p.roundScore || 0) < 0 ? 'negative' : ''}">${(p.roundScore || 0) > 0 ? '+' : ''}${p.roundScore || 0} نقطة (المجموع: ${p.totalScore || 0})</span>`;
            sc.appendChild(item);
        });
    }

    if (spyState.isHost) {
        safeStyle('spy-host-next-controls', 'display', 'block');
        safeStyle('spy-waiting-next', 'display', 'none');
    } else {
        safeStyle('spy-host-next-controls', 'display', 'none');
        safeStyle('spy-waiting-next', 'display', 'block');
    }
}

safeAddClick('spy-next-round-btn', () => { socket.emit('spy-next-round', { roomCode: spyState.roomCode }); });

// ==================== Final Results ====================
function showFinalResults(players) {
    showScreen('spy-final-screen'); clearSession();
    const podium = $('spy-podium'); const list = $('spy-leaderboard-list');
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

safeAddClick('spy-go-home-btn', () => { clearSession(); window.location.href = '/'; });

console.log('🕵️ لعبة الجاسوس - تطوير عبد الرحمن علي');
