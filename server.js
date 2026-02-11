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
    },
    pingTimeout: 30000,
    pingInterval: 10000,
    connectionStateRecovery: {
        maxDisconnectionDuration: 120000,
        skipMiddlewares: true
    }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== RATE LIMITING ====================
const rateLimits = new Map();
function rateLimit(socketId, event, maxPerSec = 5) {
    const key = `${socketId}:${event}`;
    const now = Date.now();
    const entry = rateLimits.get(key);
    if (entry && now - entry.time < 1000) {
        entry.count++;
        if (entry.count > maxPerSec) return false;
    } else {
        rateLimits.set(key, { time: now, count: 1 });
    }
    return true;
}
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of rateLimits.entries()) {
        if (now - val.time > 5000) rateLimits.delete(key);
    }
}, 10000);

// ==================== RECONNECTION MAP ====================
const disconnectedPlayers = new Map(); // tempId -> { playerName, roomCode, gameType, oldId, disconnectTime }

// ==================== ATOBIS COMPLETE GAME STATE ====================
const rooms = new Map();
const DEFAULT_CATEGORIES = ['boy', 'girl', 'animal', 'plant', 'object', 'country'];

// ==================== ROOM CLEANUP ====================
setInterval(() => {
    const now = Date.now();
    // Clean empty rooms older than 30 min
    for (const [code, room] of rooms.entries()) {
        if (room.players.length === 0 || (room.lastActivity && now - room.lastActivity > 1800000)) {
            if (room.players.length === 0) rooms.delete(code);
        }
    }
    for (const [code, room] of spyRooms.entries()) {
        if (room.players.length === 0 || (room.lastActivity && now - room.lastActivity > 1800000)) {
            if (room.players.length === 0) spyRooms.delete(code);
        }
    }
    // Clean old disconnected player entries
    for (const [key, val] of disconnectedPlayers.entries()) {
        if (now - val.disconnectTime > 120000) disconnectedPlayers.delete(key);
    }
}, 60000);

// Helper functions
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return (rooms.has(code) || spyRooms.has(code)) ? generateRoomCode() : code;
}

function getRoomByCode(code) {
    return rooms.get(code);
}

function sanitize(str, maxLen = 50) {
    if (typeof str !== 'string') return '';
    return str.trim().substring(0, maxLen);
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
        gameActive: false,
        categories: [...DEFAULT_CATEGORIES],
        lastActivity: Date.now()
    };
    rooms.set(roomCode, room);
    return room;
}

function addPlayerToRoom(roomCode, socketId, playerName) {
    const room = getRoomByCode(roomCode);
    if (!room) return null;
    if (room.players.length >= 20) return null; // Max players

    const existing = room.players.find(p => p.name === playerName && p.disconnected);
    if (existing) {
        existing.id = socketId;
        existing.disconnected = false;
        room.lastActivity = Date.now();
        return room;
    }

    const player = {
        id: socketId,
        name: playerName,
        isHost: false,
        finished: false,
        answers: null,
        score: 0,
        finishTime: null,
        disconnected: false
    };
    room.players.push(player);
    room.lastActivity = Date.now();
    return room;
}

function markPlayerDisconnected(socketId) {
    for (const [code, room] of rooms.entries()) {
        const player = room.players.find(p => p.id === socketId);
        if (player) {
            player.disconnected = true;
            room.lastActivity = Date.now();

            // Store for reconnection
            disconnectedPlayers.set(player.name + ':' + code, {
                playerName: player.name,
                roomCode: code,
                gameType: 'atobis',
                oldId: socketId,
                disconnectTime: Date.now()
            });

            // If host disconnected, migrate host
            if (room.host === socketId) {
                const activePlayer = room.players.find(p => !p.disconnected);
                if (activePlayer) {
                    room.host = activePlayer.id;
                    activePlayer.isHost = true;
                    player.isHost = false;
                    io.to(code).emit('host-changed', {
                        newHostId: activePlayer.id,
                        newHostName: activePlayer.name,
                        players: room.players.filter(p => !p.disconnected)
                    });
                }
            }

            const activePlayers = room.players.filter(p => !p.disconnected);
            if (activePlayers.length === 0) {
                rooms.delete(code);
                return { deleted: true, code };
            }

            // Check if disconnect affects game flow
            checkGameFlowAfterDisconnect(code, room);

            return { deleted: false, code, room, activePlayers };
        }
    }
    return null;
}

function checkGameFlowAfterDisconnect(code, room) {
    if (!room || !room.gameActive) return;

    // If in scoring phase, check if all active players submitted
    if (room.roundState === 'scoring') {
        const activePlayers = room.players.filter(p => !p.disconnected);
        const allSubmitted = activePlayers.every(p => p.hasSubmitted);
        if (allSubmitted && activePlayers.length > 0) {
            calculateInitialScores(room);
            io.to(code).emit('scoring-phase', {
                players: activePlayers.map(p => ({
                    id: p.id, name: p.name, answers: p.answers,
                    roundScore: p.roundScore, totalScore: p.totalScore || 0
                })),
                currentRound: room.currentRound,
                totalRounds: room.totalRounds,
                categories: room.categories,
                isHost: false
            });
        }
    }
}

function removePlayerFromRoom(socketId) {
    for (const [code, room] of rooms.entries()) {
        const playerIndex = room.players.findIndex(p => p.id === socketId);
        if (playerIndex !== -1) {
            room.players.splice(playerIndex, 1);
            if (room.players.length === 0) {
                rooms.delete(code);
                return { deleted: true, code };
            }
            if (room.host === socketId && room.players.length > 0) {
                room.host = room.players[0].id;
                room.players[0].isHost = true;
            }
            return { deleted: false, code, room };
        }
    }
    return null;
}

function calculateInitialScores(room) {
    const categories = room.categories;
    const normalize = (text) => text ? text.trim().toLowerCase() : '';
    const activePlayers = room.players.filter(p => !p.disconnected);

    activePlayers.forEach(player => {
        player.roundScore = 0;
        player.scores = {};
        categories.forEach(cat => {
            const ans = normalize(player.answers ? player.answers[cat] : '');
            if (!ans || !ans.startsWith(room.currentLetter)) {
                player.scores[cat] = 0;
                return;
            }
            const isDuplicate = activePlayers.some(other =>
                other.id !== player.id && normalize(other.answers ? other.answers[cat] : '') === ans
            );
            player.scores[cat] = isDuplicate ? 5 : 10;
            player.roundScore += player.scores[cat];
        });
    });
}

// ==================== SPY GAME STATE ====================
const spyRooms = new Map();

const SPY_WORD_DATABASE = {
    animal: {
        label: '🦁 حيوان',
        words: [
            'أسد', 'نمر', 'فيل', 'زرافة', 'قرد', 'دب', 'ذئب', 'ثعلب', 'أرنب', 'غزال',
            'حصان', 'حمار وحشي', 'وحيد القرن', 'تمساح', 'سلحفاة', 'نسر', 'ببغاء', 'بطريق', 'دولفين', 'حوت',
            'قرش', 'أخطبوط', 'فراشة', 'نحلة', 'عنكبوت', 'عقرب', 'ثعبان', 'ضفدع', 'قط', 'كلب',
            'بقرة', 'خروف', 'ماعز', 'جمل', 'فأر', 'همستر', 'جاموسة', 'نعامة', 'ديناصور', 'باندا',
            'بومة', 'صقر', 'ديك', 'بطة', 'إوزة', 'حمار', 'غراب', 'طاووس', 'سنجاب', 'خفاش'
        ]
    },
    object: {
        label: '📦 جماد',
        words: [
            'كرسي', 'طاولة', 'سرير', 'مرآة', 'ساعة', 'مفتاح', 'قلم', 'كتاب', 'هاتف', 'تلفزيون',
            'ثلاجة', 'غسالة', 'مكيف', 'مروحة', 'سيارة', 'دراجة', 'طائرة', 'قطار', 'سفينة', 'صاروخ',
            'كمبيوتر', 'لابتوب', 'تابلت', 'كاميرا', 'مصباح', 'شمعة', 'مظلة', 'حقيبة', 'محفظة', 'نظارة',
            'دفتر', 'ممحاة', 'مسطرة', 'حاسبة', 'سماعة', 'شاحن', 'فلاشة', 'ماوس', 'لوحة مفاتيح', 'شاشة'
        ]
    },
    food: {
        label: '🍕 أكل',
        words: [
            'كشري', 'فول', 'طعمية', 'شاورما', 'كباب', 'كفتة', 'ملوخية', 'محشي', 'مسقعة', 'فتة',
            'بيتزا', 'برجر', 'سوشي', 'باستا', 'كريب', 'وافل', 'بان كيك', 'آيس كريم', 'شوكولاتة', 'كنافة',
            'بقلاوة', 'بسبوسة', 'أم علي', 'رز بلبن', 'قطايف', 'مهلبية', 'جلاش', 'فطيرة', 'سمبوسة', 'ناجتس',
            'فلافل', 'حمص', 'فول سوداني', 'لب', 'ذرة مشوي', 'بطاطس محمرة', 'مكرونة', 'كبدة', 'سجق', 'حواوشي'
        ]
    },
    place: {
        label: '📍 مكان',
        words: [
            'مدرسة', 'مستشفى', 'مسجد', 'كنيسة', 'سوبرماركت', 'مطعم', 'كافيه', 'سينما', 'مكتبة', 'ملعب',
            'حديقة', 'شاطئ', 'جبل', 'صحراء', 'غابة', 'مطار', 'محطة قطار', 'ميناء', 'فندق', 'متحف',
            'جامعة', 'بنك', 'صيدلية', 'مغسلة', 'كوبري', 'نفق', 'برج', 'قصر', 'قلعة', 'هرم',
            'بقالة', 'مخبز', 'جزار', 'صالون', 'جيم', 'حمام سباحة', 'مغسلة', 'ورشة', 'جراج', 'مول'
        ]
    },
    country: {
        label: '🌍 بلد',
        words: [
            'مصر', 'السعودية', 'الإمارات', 'الكويت', 'قطر', 'البحرين', 'عمان', 'الأردن', 'لبنان', 'سوريا',
            'العراق', 'فلسطين', 'ليبيا', 'تونس', 'الجزائر', 'المغرب', 'السودان', 'اليمن', 'أمريكا', 'بريطانيا',
            'فرنسا', 'ألمانيا', 'إيطاليا', 'إسبانيا', 'البرازيل', 'الأرجنتين', 'اليابان', 'الصين', 'الهند', 'كوريا',
            'روسيا', 'أوكرانيا', 'بولندا', 'السويد', 'النرويج', 'سويسرا', 'النمسا', 'اليونان', 'تايلاند', 'ماليزيا'
        ]
    },
    job: {
        label: '👨‍💼 مهنة',
        words: [
            'دكتور', 'مهندس', 'محامي', 'معلم', 'ضابط', 'طيار', 'رائد فضاء', 'صحفي', 'مصور', 'ممثل',
            'مغني', 'رسام', 'نحات', 'كاتب', 'شيف', 'نجار', 'حداد', 'سباك', 'كهربائي', 'ميكانيكي',
            'سائق', 'بحار', 'صياد', 'فلاح', 'خباز', 'جزار', 'حلاق', 'خياط', 'عطار', 'صيدلي',
            'محاسب', 'مبرمج', 'مصمم', 'مترجم', 'حارس أمن', 'إطفائي', 'ممرض', 'طبيب أسنان', 'بيطري', 'مدرب',
            'حكم', 'لاعب كرة', 'مذيع', 'مخرج', 'منتج', 'رجل أعمال', 'عالم', 'فيلسوف', 'قاضي', 'دبلوماسي'
        ]
    },
    sport: {
        label: '⚽ رياضة',
        words: [
            'كرة قدم', 'كرة سلة', 'كرة طائرة', 'كرة يد', 'تنس', 'تنس طاولة', 'بادل', 'سباحة', 'غطس', 'تزلج',
            'ملاكمة', 'مصارعة', 'جودو', 'كاراتيه', 'تايكوندو', 'كونغ فو', 'رماية', 'رمي الرمح', 'رمي القرص', 'الوثب الطويل',
            'الوثب العالي', 'ركوب خيل', 'بولو', 'جولف', 'بيسبول', 'كريكيت', 'رجبي', 'هوكي', 'تزلج على الجليد', 'سباق سيارات',
            'دراجات', 'ماراثون', 'ترياثلون', 'رفع أثقال', 'جمباز', 'باليه', 'يوجا', 'سكواش', 'بولينج', 'بلياردو',
            'شطرنج', 'سهام', 'صيد', 'تسلق جبال', 'باراشوت', 'تجديف', 'قوارب شراعية', 'ووتر بولو', 'كرة ماء', 'سيرف'
        ]
    },
    movie: {
        label: '🎬 فيلم/مسلسل',
        words: [
            'الناظر', 'عسل أسود', 'الليمبي', 'صعيدي في الجامعة', 'مرجان أحمد مرجان', 'الباشا تلميذ', 'زكي شان', 'جعلتني مجرماً', 'اللي بالي بالك',
            'همام في أمستردام', 'أبو علي', 'كلم ماما', 'ولاد العم', 'تيمور وشفيقة', 'كابتن مصر', 'الفيل الأزرق', 'تراب الماس', 'كيرة والجن', 'واحد صحيح',
            'عمر وسلمى', 'البيه البواب', 'سمير أبو النيل', 'طباخ الريس', 'جري الوحوش', 'حين ميسرة', 'هستيريا', 'الحفلة', 'غبي منه فيه',
            'لا تراجع ولا استسلام', 'الجزيرة', 'الممر', 'كلمني شكراً', 'عوكل', 'أولاد رزق', 'حرب كرموز', 'الخلية', 'كازابلانكا', 'نادي الرجال السري'
        ]
    },
    celebrity: {
        label: '⭐ شخصية مشهورة',
        words: [
            'محمد صلاح', 'عمرو دياب', 'أحمد حلمي', 'محمد هنيدي', 'عادل إمام', 'كريستيانو رونالدو', 'ليونيل ميسي', 'محمد رمضان', 'تامر حسني', 'شيرين',
            'أنغام', 'نانسي عجرم', 'إليسا', 'أحمد السقا', 'كريم عبدالعزيز', 'أحمد عز', 'ياسمين عبدالعزيز', 'منى زكي', 'أحمد مكي', 'محمد سعد',
            'بيومي فؤاد', 'أكرم حسني', 'علي ربيع', 'أشرف عبدالباقي', 'أمينة خليل', 'نيللي كريم', 'يسرا', 'ليلى علوي', 'هند صبري', 'حسن الرداد',
            'إيمي سمير غانم', 'حمادة هلال', 'مصطفى قمر', 'خالد النبوي', 'أحمد زكي', 'نور الشريف', 'محمود عبدالعزيز', 'سعاد حسني', 'فاتن حمامة', 'عمر الشريف'
        ]
    },
    clothing: {
        label: '👔 لبس',
        words: [
            'تيشيرت', 'قميص', 'بنطلون', 'جينز', 'شورت', 'فستان', 'جيبة', 'بلوزة', 'جاكيت', 'كوت',
            'بالطو', 'سويتر', 'هودي', 'عباية', 'جلابية', 'طرحة', 'حجاب', 'إيشارب', 'كرافتة', 'بابيون',
            'حذاء', 'صندل', 'شبشب', 'جزمة', 'كوتشي', 'كعب', 'شراب', 'قفاز', 'قبعة', 'طاقية',
            'نظارة شمس', 'ساعة يد', 'خاتم', 'سلسلة', 'حلق', 'بروش', 'حزام', 'بيجامة', 'روب', 'مايوه'
        ]
    }
};

function createSpyRoom(hostSocketId, hostName) {
    const roomCode = generateRoomCode();
    const room = {
        code: roomCode,
        gameType: 'spy',
        host: hostSocketId,
        players: [{
            id: hostSocketId,
            name: hostName,
            isHost: true,
            totalScore: 0,
            roundScore: 0,
            isSpy: false,
            confirmed: false,
            voted: false,
            votedFor: null,
            disconnected: false
        }],
        currentRound: 0,
        totalRounds: 5,
        timerDuration: 120,
        spyCount: 1,
        currentWord: null,
        currentCategory: null,
        spyIds: [],
        categories: ['animal', 'object', 'food', 'place', 'country'],
        usedWords: [],
        gameActive: false,
        roundState: null,
        lastActivity: Date.now(),
        timerRef: null
    };
    spyRooms.set(roomCode, room);
    return room;
}

function getSpyRoomByCode(code) {
    return spyRooms.get(code);
}

function addPlayerToSpyRoom(roomCode, socketId, playerName) {
    const room = getSpyRoomByCode(roomCode);
    if (!room) return null;
    if (room.players.length >= 20) return null;

    const existing = room.players.find(p => p.name === playerName && p.disconnected);
    if (existing) {
        existing.id = socketId;
        existing.disconnected = false;
        room.lastActivity = Date.now();
        return room;
    }

    if (room.gameActive) return null; // Can't join mid-game

    const player = {
        id: socketId,
        name: playerName,
        isHost: false,
        totalScore: 0,
        roundScore: 0,
        isSpy: false,
        confirmed: false,
        voted: false,
        votedFor: null,
        disconnected: false
    };
    room.players.push(player);
    room.lastActivity = Date.now();
    return room;
}

function markSpyPlayerDisconnected(socketId) {
    for (const [code, room] of spyRooms.entries()) {
        const player = room.players.find(p => p.id === socketId);
        if (player) {
            player.disconnected = true;
            room.lastActivity = Date.now();

            disconnectedPlayers.set(player.name + ':spy:' + code, {
                playerName: player.name,
                roomCode: code,
                gameType: 'spy',
                oldId: socketId,
                disconnectTime: Date.now()
            });

            if (room.host === socketId) {
                const activePlayer = room.players.find(p => !p.disconnected);
                if (activePlayer) {
                    room.host = activePlayer.id;
                    activePlayer.isHost = true;
                    player.isHost = false;
                    io.to(code).emit('spy-host-changed', {
                        newHostId: activePlayer.id,
                        newHostName: activePlayer.name,
                        players: room.players.filter(p => !p.disconnected)
                    });
                }
            }

            const activePlayers = room.players.filter(p => !p.disconnected);
            if (activePlayers.length === 0) {
                if (room.timerRef) clearTimeout(room.timerRef);
                spyRooms.delete(code);
                return { deleted: true, code };
            }

            // Handle game flow after disconnect
            checkSpyGameFlowAfterDisconnect(code, room);

            return { deleted: false, code, room, activePlayers };
        }
    }
    return null;
}

function checkSpyGameFlowAfterDisconnect(code, room) {
    if (!room || !room.gameActive) return;
    const activePlayers = room.players.filter(p => !p.disconnected);

    if (room.roundState === 'role-reveal') {
        const confirmed = activePlayers.filter(p => p.confirmed).length;
        if (confirmed === activePlayers.length && activePlayers.length > 0) {
            room.roundState = 'discussion';
            room.discussionStartTime = Date.now();
            io.to(code).emit('spy-start-discussion', { timerDuration: room.timerDuration, discussionStartTime: room.discussionStartTime, serverTime: Date.now() });
            room.timerRef = setTimeout(() => {
                if (room.roundState === 'discussion') {
                    room.roundState = 'voting';
                    io.to(code).emit('spy-start-voting', {
                        players: activePlayers.map(p => ({ id: p.id, name: p.name }))
                    });
                }
            }, room.timerDuration * 1000);
        }
    } else if (room.roundState === 'voting') {
        const voted = activePlayers.filter(p => p.voted).length;
        if (voted === activePlayers.length && activePlayers.length > 0) {
            processVotes(code);
        }
    } else if (room.roundState === 'guessing') {
        const activeSpies = activePlayers.filter(p => room.spyIds.includes(p.id));
        if (activeSpies.length === 0) {
            calculateSpyScores(room, true, false);
            room.roundState = 'result';
            emitRoundResult(room, true, false);
        }
    }
}

function removePlayerFromSpyRoom(socketId) {
    for (const [code, room] of spyRooms.entries()) {
        const playerIndex = room.players.findIndex(p => p.id === socketId);
        if (playerIndex !== -1) {
            room.players.splice(playerIndex, 1);
            if (room.players.length === 0) {
                if (room.timerRef) clearTimeout(room.timerRef);
                spyRooms.delete(code);
                return { deleted: true, code };
            }
            if (room.host === socketId && room.players.length > 0) {
                room.host = room.players[0].id;
                room.players[0].isHost = true;
            }
            return { deleted: false, code, room };
        }
    }
    return null;
}

function pickRandomWord(room) {
    const cat = room.categories[Math.floor(Math.random() * room.categories.length)];
    const catData = SPY_WORD_DATABASE[cat];
    if (!catData) return { category: cat, word: 'كلمة' };
    let available = catData.words.filter(w => !room.usedWords.includes(w));
    if (available.length === 0) {
        room.usedWords = room.usedWords.filter(w => !catData.words.includes(w));
        available = catData.words;
    }
    const word = available[Math.floor(Math.random() * available.length)];
    room.usedWords.push(word);
    return { category: cat, word };
}

function getGuessOptions(room) {
    const catData = SPY_WORD_DATABASE[room.currentCategory];
    if (!catData) return [room.currentWord];
    const correctWord = room.currentWord;
    let decoys = catData.words.filter(w => w !== correctWord);
    decoys = decoys.sort(() => Math.random() - 0.5).slice(0, 5);
    const options = [correctWord, ...decoys].sort(() => Math.random() - 0.5);
    return options;
}

function processVotes(roomCode) {
    const room = getSpyRoomByCode(roomCode);
    if (!room) return;
    const activePlayers = room.players.filter(p => !p.disconnected);

    const voteCounts = {};
    activePlayers.forEach(p => {
        if (p.votedFor) {
            voteCounts[p.votedFor] = (voteCounts[p.votedFor] || 0) + 1;
        }
    });

    let maxVotes = 0;
    let mostVoted = null;
    for (const [playerId, count] of Object.entries(voteCounts)) {
        if (count > maxVotes) {
            maxVotes = count;
            mostVoted = playerId;
        }
    }

    const spyCaught = room.spyIds.includes(mostVoted);
    const spyNames = room.players.filter(p => room.spyIds.includes(p.id)).map(p => p.name);

    if (spyCaught) {
        room.roundState = 'guessing';
        const options = getGuessOptions(room);
        const activeSpies = activePlayers.filter(p => room.spyIds.includes(p.id));

        if (activeSpies.length === 0) {
            calculateSpyScores(room, true, false);
            room.roundState = 'result';
            emitRoundResult(room, true, false);
            return;
        }

        activePlayers.forEach(player => {
            const iAmSpy = room.spyIds.includes(player.id);
            io.to(player.id).emit('spy-guess-phase', {
                iAmSpy,
                category: room.currentCategory,
                options: iAmSpy ? options : [],
                spyNames
            });
        });

        // Auto-resolve if spy doesn't guess within 30s
        room.timerRef = setTimeout(() => {
            if (room.roundState === 'guessing') {
                calculateSpyScores(room, true, false);
                room.roundState = 'result';
                emitRoundResult(room, true, false);
            }
        }, 30000);
    } else {
        calculateSpyScores(room, false, false);
        room.roundState = 'result';
        emitRoundResult(room, false, false);
    }
}

function calculateSpyScores(room, spyCaught, spyGuessedCorrectly) {
    room.players.filter(p => !p.disconnected).forEach(p => {
        const isSpy = room.spyIds.includes(p.id);
        if (isSpy) {
            if (spyCaught) {
                p.roundScore = spyGuessedCorrectly ? 2 : -2;
            } else {
                p.roundScore = 4;
            }
        } else {
            if (spyCaught) {
                p.roundScore = spyGuessedCorrectly ? 1 : 3;
            } else {
                p.roundScore = -1;
            }
        }
        p.totalScore = (p.totalScore || 0) + p.roundScore;
    });
}

function emitRoundResult(room, spyCaught, spyGuessedCorrectly) {
    const resultData = {
        spyCaught,
        spyGuessedCorrectly,
        word: room.currentWord,
        category: room.currentCategory,
        spyNames: room.players.filter(p => room.spyIds.includes(p.id)).map(p => p.name),
        spyIds: room.spyIds,
        players: room.players.filter(p => !p.disconnected).map(p => ({
            id: p.id, name: p.name, roundScore: p.roundScore,
            totalScore: p.totalScore, isSpy: room.spyIds.includes(p.id)
        }))
    };
    room.lastRoundResult = resultData;
    io.to(room.code).emit('spy-round-result', resultData);
}

// ==================== Socket.IO connection handling ====================
io.on('connection', (socket) => {
    console.log(`✅ Player connected: ${socket.id}`);

    // ==================== RECONNECTION ====================
    socket.on('attempt-reconnect', ({ playerName, roomCode, gameType }) => {
        if (!playerName || !roomCode) return;
        const name = sanitize(playerName);
        const code = sanitize(roomCode, 10).toUpperCase();

        if (gameType === 'spy') {
            const room = getSpyRoomByCode(code);
            if (!room) { socket.emit('reconnect-failed'); return; }
            const player = room.players.find(p => p.name === name);
            if (!player) { socket.emit('reconnect-failed'); return; }

            player.id = socket.id;
            player.disconnected = false;
            socket.join(code);

            const activePlayers = room.players.filter(p => !p.disconnected);
            const reconnectData = {
                gameType: 'spy',
                roomCode: code,
                players: activePlayers,
                isHost: room.host === socket.id,
                gameActive: room.gameActive,
                roundState: room.roundState,
                currentRound: room.currentRound,
                totalRounds: room.totalRounds,
                isSpy: player.isSpy,
                currentWord: player.isSpy ? null : room.currentWord,
                currentCategory: room.currentCategory,
                timerDuration: room.timerDuration,
                discussionStartTime: room.discussionStartTime || null,
                serverTime: Date.now(),
                confirmed: player.confirmed,
                voted: player.voted,
                // For result screen
                lastRoundResult: room.lastRoundResult || null
            };

            socket.emit('reconnect-success', reconnectData);
            io.to(code).emit('spy-player-reconnected', { playerName: name, players: activePlayers });
        } else {
            const room = getRoomByCode(code);
            if (!room) { socket.emit('reconnect-failed'); return; }
            const player = room.players.find(p => p.name === name);
            if (!player) { socket.emit('reconnect-failed'); return; }

            player.id = socket.id;
            player.disconnected = false;
            socket.join(code);

            const activePlayers = room.players.filter(p => !p.disconnected);
            const reconnectData = {
                gameType: 'atobis',
                roomCode: code,
                players: activePlayers,
                isHost: room.host === socket.id,
                gameActive: room.gameActive,
                currentLetter: room.currentLetter,
                currentRound: room.currentRound,
                totalRounds: room.totalRounds,
                categories: room.categories,
                usedLetters: room.usedLetters,
                roundState: room.roundState,
                roundStartTime: room.roundStartTime || null,
                serverTime: Date.now(),
                // For scoring screen
                scoringData: (room.roundState === 'scoring') ? activePlayers.map(p => ({
                    id: p.id, name: p.name, answers: p.answers,
                    roundScore: p.roundScore || 0, totalScore: p.totalScore || 0
                })) : null,
                playerAnswers: player.answers || null,
                hasSubmitted: player.hasSubmitted || false
            };

            socket.emit('reconnect-success', reconnectData);
            io.to(code).emit('player-reconnected', { playerName: name, players: activePlayers });
        }
    });

    // ==================== ATOBIS COMPLETE EVENTS ====================
    socket.on('create-room', (playerName) => {
        if (!rateLimit(socket.id, 'create-room', 2)) return;
        const name = sanitize(playerName);
        if (!name) { socket.emit('error', { message: 'أدخل اسم صحيح!' }); return; }

        const room = createRoom(socket.id, name);
        socket.join(room.code);
        socket.emit('room-created', { roomCode: room.code, players: room.players, usedLetters: room.usedLetters });
        console.log(`🏠 Room created: ${room.code} by ${name}`);
    });

    socket.on('join-room', ({ roomCode, playerName }) => {
        if (!rateLimit(socket.id, 'join-room', 3)) return;
        const name = sanitize(playerName);
        const code = sanitize(roomCode, 10).toUpperCase();
        if (!name) { socket.emit('error', { message: 'أدخل اسم صحيح!' }); return; }
        if (!code) { socket.emit('error', { message: 'أدخل كود الغرفة!' }); return; }

        const room = addPlayerToRoom(code, socket.id, name);
        if (!room) { socket.emit('error', { message: 'الغرفة غير موجودة أو ممتلئة!' }); return; }

        socket.join(code);
        io.to(code).emit('player-joined', { players: room.players.filter(p => !p.disconnected), newPlayer: name });
        socket.emit('room-joined', {
            roomCode: room.code, players: room.players.filter(p => !p.disconnected),
            usedLetters: room.usedLetters, currentLetter: room.currentLetter,
            gameActive: room.gameActive, categories: room.categories
        });
        console.log(`👋 ${name} joined room: ${code}`);
    });

    socket.on('select-letter', ({ roomCode, letter }) => {
        if (!rateLimit(socket.id, 'select-letter')) return;
        const room = getRoomByCode(roomCode);
        if (!room || room.host !== socket.id) return;
        room.currentLetter = letter;
        room.lastActivity = Date.now();
        io.to(roomCode).emit('letter-selected', { letter });
    });

    socket.on('start-game', ({ roomCode, totalRounds, categories }) => {
        if (!rateLimit(socket.id, 'start-game', 2)) return;
        const room = getRoomByCode(roomCode);
        if (!room || room.host !== socket.id) return;

        room.totalRounds = Math.min(Math.max(parseInt(totalRounds) || 5, 1), 20);
        room.currentRound = 1;
        room.usedLetters = [];
        if (categories && Array.isArray(categories) && categories.length >= 3) {
            room.categories = categories.slice(0, 12);
        } else {
            room.categories = [...DEFAULT_CATEGORIES];
        }
        room.players.forEach(p => { p.totalScore = 0; p.disconnected = false; });
        room.lastActivity = Date.now();
        startRound(roomCode);
    });

    function startRound(roomCode) {
        const room = getRoomByCode(roomCode);
        if (!room) return;

        const arabicLetters = [
            'أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش',
            'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي'
        ];
        let availableLetters = arabicLetters.filter(l => !room.usedLetters.includes(l));
        if (availableLetters.length === 0) { room.usedLetters = []; availableLetters = arabicLetters; }

        const randomLetter = availableLetters[Math.floor(Math.random() * availableLetters.length)];
        room.currentLetter = randomLetter;
        room.usedLetters.push(randomLetter);
        room.gameActive = true;
        room.roundStartTime = Date.now();
        room.roundState = 'playing';
        room.lastActivity = Date.now();

        const emptyAnswers = {};
        room.categories.forEach(cat => { emptyAnswers[cat] = ''; });
        room.players.forEach(player => {
            player.finished = false;
            player.answers = { ...emptyAnswers };
            player.roundScore = 0;
            player.hasSubmitted = false;
        });

        io.to(roomCode).emit('round-started', {
            round: room.currentRound, totalRounds: room.totalRounds,
            letter: room.currentLetter, startTime: room.roundStartTime, categories: room.categories
        });
        console.log(`🎮 Round ${room.currentRound} started in room ${roomCode} with letter: ${room.currentLetter}`);
    }

    socket.on('finish-round', ({ roomCode, answers }) => {
        if (!rateLimit(socket.id, 'finish-round', 2)) return;
        const room = getRoomByCode(roomCode);
        if (!room || !room.gameActive || room.roundState !== 'playing') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        player.answers = answers || {};
        player.finished = true;
        room.roundState = 'scoring';
        room.lastActivity = Date.now();
        io.to(roomCode).emit('round-ended', { finisher: player.name });
    });

    socket.on('submit-answers', ({ roomCode, answers }) => {
        if (!rateLimit(socket.id, 'submit-answers')) return;
        const room = getRoomByCode(roomCode);
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        player.answers = answers || {};
        player.hasSubmitted = true;
        room.lastActivity = Date.now();

        const activePlayers = room.players.filter(p => !p.disconnected);
        const allSubmitted = activePlayers.every(p => p.hasSubmitted);
        if (allSubmitted) {
            calculateInitialScores(room);
            io.to(roomCode).emit('scoring-phase', {
                players: activePlayers.map(p => ({
                    id: p.id, name: p.name, answers: p.answers,
                    roundScore: p.roundScore, totalScore: p.totalScore || 0
                })),
                currentRound: room.currentRound, totalRounds: room.totalRounds,
                categories: room.categories, isHost: socket.id === room.host
            });
        }
    });

    socket.on('update-single-score', ({ roomCode, playerId, category, score }) => {
        if (!rateLimit(socket.id, 'update-score')) return;
        const room = getRoomByCode(roomCode);
        if (!room || room.host !== socket.id) return;
        const player = room.players.find(p => p.id === playerId);
        if (!player) return;

        if (!player.scores) player.scores = {};
        player.scores[category] = Math.min(Math.max(parseInt(score) || 0, 0), 10);

        let roundTotal = 0;
        room.categories.forEach(cat => {
            if (player.scores[cat] !== undefined) roundTotal += player.scores[cat];
        });
        player.roundScore = roundTotal;
        room.lastActivity = Date.now();

        io.to(roomCode).emit('score-updated', {
            playerId, category, score: player.scores[category], roundScore: roundTotal
        });
    });

    socket.on('update-scores-and-next', ({ roomCode }) => {
        if (!rateLimit(socket.id, 'next-round', 2)) return;
        const room = getRoomByCode(roomCode);
        if (!room || room.host !== socket.id) return;

        room.players.forEach(p => { p.totalScore = (p.totalScore || 0) + (p.roundScore || 0); });
        room.lastActivity = Date.now();

        if (room.currentRound >= room.totalRounds) {
            io.to(roomCode).emit('game-over', {
                players: room.players.filter(p => !p.disconnected).sort((a, b) => b.totalScore - a.totalScore)
            });
            room.gameActive = false;
        } else {
            room.currentRound++;
            startRound(roomCode);
        }
    });

    socket.on('play-again', (roomCode) => {
        const room = getRoomByCode(roomCode);
        if (!room) return;
        room.currentLetter = null;
        room.gameActive = false;
        room.gameStartTime = null;
        room.lastActivity = Date.now();
        room.players.forEach(player => {
            player.finished = false; player.answers = null;
            player.score = 0; player.finishTime = null;
        });
        io.to(roomCode).emit('reset-game', { players: room.players.filter(p => !p.disconnected), usedLetters: room.usedLetters });
    });

    // ==================== SPY GAME EVENTS ====================
    socket.on('spy-create-room', (playerName) => {
        if (!rateLimit(socket.id, 'spy-create', 2)) return;
        const name = sanitize(playerName);
        if (!name) { socket.emit('error', { message: 'أدخل اسم صحيح!' }); return; }

        const room = createSpyRoom(socket.id, name);
        socket.join(room.code);
        socket.emit('spy-room-created', { roomCode: room.code, players: room.players });
        console.log(`🕵️ Spy room created: ${room.code} by ${name}`);
    });

    socket.on('spy-join-room', ({ roomCode, playerName }) => {
        if (!rateLimit(socket.id, 'spy-join', 3)) return;
        const name = sanitize(playerName);
        const code = sanitize(roomCode, 10).toUpperCase();
        if (!name || !code) { socket.emit('error', { message: 'أدخل بيانات صحيحة!' }); return; }

        const room = addPlayerToSpyRoom(code, socket.id, name);
        if (!room) { socket.emit('error', { message: 'الغرفة غير موجودة أو اللعبة بدأت!' }); return; }

        socket.join(code);
        io.to(code).emit('spy-player-joined', { players: room.players.filter(p => !p.disconnected), newPlayer: name });
        socket.emit('spy-room-joined', { roomCode: room.code, players: room.players.filter(p => !p.disconnected) });
        console.log(`🕵️ ${name} joined spy room: ${code}`);
    });

    socket.on('spy-start-game', ({ roomCode, totalRounds, timerDuration, spyCount, categories }) => {
        if (!rateLimit(socket.id, 'spy-start', 2)) return;
        const room = getSpyRoomByCode(roomCode);
        if (!room || room.host !== socket.id) return;

        const activePlayers = room.players.filter(p => !p.disconnected);
        if (activePlayers.length < 3) { socket.emit('error', { message: 'محتاج على الأقل 3 لاعبين!' }); return; }

        room.totalRounds = Math.min(Math.max(parseInt(totalRounds) || 5, 1), 20);
        room.timerDuration = Math.min(Math.max(parseInt(timerDuration) || 120, 30), 600);
        room.spyCount = Math.min(parseInt(spyCount) || 1, activePlayers.length - 1);
        room.currentRound = 0;
        if (categories && Array.isArray(categories) && categories.length >= 1) {
            room.categories = categories.slice(0, 10);
        }
        room.players.forEach(p => { p.totalScore = 0; p.disconnected = false; });
        room.gameActive = true;
        room.lastActivity = Date.now();
        startSpyRound(roomCode);
    });

    function startSpyRound(roomCode) {
        const room = getSpyRoomByCode(roomCode);
        if (!room) return;
        room.currentRound++;
        room.roundState = 'role-reveal';
        room.lastActivity = Date.now();

        const { category, word } = pickRandomWord(room);
        room.currentWord = word;
        room.currentCategory = category;

        const activePlayers = room.players.filter(p => !p.disconnected);
        const playerIds = activePlayers.map(p => p.id);
        const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
        room.spyIds = shuffled.slice(0, room.spyCount);

        room.players.forEach(p => {
            p.isSpy = room.spyIds.includes(p.id);
            p.confirmed = false; p.voted = false;
            p.votedFor = null; p.roundScore = 0;
        });

        activePlayers.forEach(player => {
            io.to(player.id).emit('spy-round-started', {
                round: room.currentRound, totalRounds: room.totalRounds,
                isSpy: player.isSpy, word: player.isSpy ? null : word,
                category: category, timerDuration: room.timerDuration
            });
        });
        console.log(`🕵️ Spy round ${room.currentRound} in room ${roomCode} | Word: ${word}`);
    }

    socket.on('spy-confirm-role', ({ roomCode }) => {
        if (!rateLimit(socket.id, 'spy-confirm')) return;
        const room = getSpyRoomByCode(roomCode);
        if (!room || room.roundState !== 'role-reveal') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        player.confirmed = true;
        const activePlayers = room.players.filter(p => !p.disconnected);
        const confirmed = activePlayers.filter(p => p.confirmed).length;
        const total = activePlayers.length;

        io.to(roomCode).emit('spy-confirm-update', { confirmed, total });

        if (confirmed === total) {
            room.roundState = 'discussion';
            room.discussionStartTime = Date.now();
            io.to(roomCode).emit('spy-start-discussion', { timerDuration: room.timerDuration, discussionStartTime: room.discussionStartTime, serverTime: Date.now() });
            room.timerRef = setTimeout(() => {
                if (room.roundState === 'discussion') {
                    room.roundState = 'voting';
                    const active = room.players.filter(p => !p.disconnected);
                    io.to(roomCode).emit('spy-start-voting', {
                        players: active.map(p => ({ id: p.id, name: p.name }))
                    });
                }
            }, room.timerDuration * 1000);
        }
    });

    socket.on('spy-submit-vote', ({ roomCode, votedFor }) => {
        if (!rateLimit(socket.id, 'spy-vote', 2)) return;
        const room = getSpyRoomByCode(roomCode);
        if (!room || room.roundState !== 'voting') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.voted) return;

        player.voted = true;
        player.votedFor = votedFor;
        room.lastActivity = Date.now();

        const activePlayers = room.players.filter(p => !p.disconnected);
        const voted = activePlayers.filter(p => p.voted).length;
        io.to(roomCode).emit('spy-vote-update', { voted, total: activePlayers.length });

        if (voted === activePlayers.length) processVotes(roomCode);
    });

    socket.on('spy-submit-guess', ({ roomCode, guess }) => {
        if (!rateLimit(socket.id, 'spy-guess', 2)) return;
        const room = getSpyRoomByCode(roomCode);
        if (!room || room.roundState !== 'guessing') return;
        if (!room.spyIds.includes(socket.id)) return;

        if (room.timerRef) clearTimeout(room.timerRef);
        const guessedCorrectly = guess === room.currentWord;
        calculateSpyScores(room, true, guessedCorrectly);
        room.roundState = 'result';
        room.lastActivity = Date.now();
        emitRoundResult(room, true, guessedCorrectly);
    });

    socket.on('spy-next-round', ({ roomCode }) => {
        if (!rateLimit(socket.id, 'spy-next', 2)) return;
        const room = getSpyRoomByCode(roomCode);
        if (!room || room.host !== socket.id) return;
        room.lastActivity = Date.now();

        if (room.currentRound >= room.totalRounds) {
            io.to(roomCode).emit('spy-game-over', {
                players: room.players.filter(p => !p.disconnected).map(p => ({
                    id: p.id, name: p.name, totalScore: p.totalScore
                })).sort((a, b) => b.totalScore - a.totalScore)
            });
            room.gameActive = false;
        } else {
            startSpyRound(roomCode);
        }
    });

    // ==================== DISCONNECT ====================
    socket.on('disconnect', () => {
        const result = markPlayerDisconnected(socket.id);
        if (result) {
            if (result.deleted) {
                console.log(`🗑️ Room ${result.code} deleted (empty)`);
            } else {
                io.to(result.code).emit('player-left', {
                    players: result.activePlayers || result.room.players.filter(p => !p.disconnected),
                    disconnectedPlayer: true
                });
                console.log(`⚠️ Player disconnected from room ${result.code}`);
            }
        }

        const spyResult = markSpyPlayerDisconnected(socket.id);
        if (spyResult) {
            if (spyResult.deleted) {
                console.log(`🗑️ Spy room ${spyResult.code} deleted (empty)`);
            } else {
                io.to(spyResult.code).emit('spy-player-left', {
                    players: spyResult.activePlayers || spyResult.room.players.filter(p => !p.disconnected),
                    disconnectedPlayer: true
                });
                console.log(`⚠️ Player disconnected from spy room ${spyResult.code}`);
            }
        }
        console.log(`❌ Player disconnected: ${socket.id}`);
    });
});

// ==================== Routes ====================
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/atobis', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'atobis.html')); });
app.get('/spy', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'spy.html')); });

app.get('/health', (req, res) => { res.json({ status: 'ok', uptime: process.uptime() }); });

app.get('/stats', (req, res) => {
    res.json({
        totalAtobisRooms: rooms.size,
        totalSpyRooms: spyRooms.size,
        atobisRooms: Array.from(rooms.values()).map(room => ({
            code: room.code, players: room.players.filter(p => !p.disconnected).length,
            gameActive: room.gameActive, categories: room.categories
        })),
        spyRooms: Array.from(spyRooms.values()).map(room => ({
            code: room.code, players: room.players.filter(p => !p.disconnected).length,
            gameActive: room.gameActive, round: room.currentRound, totalRounds: room.totalRounds
        }))
    });
});

// Error handling for uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (err) => {
    console.error('⚠️ Unhandled Rejection:', err);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════╗
║   🎮 ألعاب أونلاين - السيرفر                ║
║   🚌 أتوبيس كومبليت                         ║
║   🕵️ لعبة الجاسوس                           ║
║   🌐 Port: ${PORT}                              ║
║   ✅ السيرفر شغال بنجاح!                     ║
║   🛡️ Error handling enabled                  ║
╚══════════════════════════════════════════════╝
    `);
});

process.on('SIGTERM', () => {
    console.log('🛑 Shutting down gracefully...');
    io.emit('server-shutdown', { message: 'السيرفر هيتعمله ريستارت، استنى شوية...' });
    server.close(() => { console.log('✅ Server closed'); process.exit(0); });
});
