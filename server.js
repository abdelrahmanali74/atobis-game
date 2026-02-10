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

// ==================== ATOBIS COMPLETE GAME STATE ====================
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
    return (rooms.has(code) || spyRooms.has(code)) ? generateRoomCode() : code;
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
        categories: [...DEFAULT_CATEGORIES]
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

// ==================== SPY GAME STATE ====================
const spyRooms = new Map();

// Spy Word Database
const SPY_WORD_DATABASE = {
    animal: {
        label: '🦁 حيوان',
        words: [
            'أسد', 'نمر', 'فيل', 'زرافة', 'قرد', 'دب', 'ذئب', 'ثعلب', 'أرنب', 'غزال',
            'حصان', 'جمل', 'بقرة', 'خروف', 'ماعز', 'قط', 'كلب', 'فأر', 'سلحفاة', 'تمساح',
            'ثعبان', 'نسر', 'ببغاء', 'حمامة', 'بطريق', 'دولفين', 'حوت', 'سمكة قرش', 'أخطبوط', 'فراشة',
            'نحلة', 'عقرب', 'عنكبوت', 'وحيد القرن', 'فهد', 'باندا', 'كنغر', 'كوالا', 'حمار وحشي', 'فلامنجو',
            'بومة', 'صقر', 'ديك', 'بطة', 'إوزة', 'حمار', 'غراب', 'طاووس', 'سنجاب', 'خفاش'
        ]
    },
    object: {
        label: '📦 جماد',
        words: [
            'كرسي', 'طاولة', 'سرير', 'مرآة', 'ساعة', 'مفتاح', 'قلم', 'كتاب', 'هاتف', 'تلفزيون',
            'ثلاجة', 'غسالة', 'مكنسة', 'مروحة', 'مكيف', 'لمبة', 'شمعة', 'حقيبة', 'محفظة', 'نظارة',
            'مظلة', 'وسادة', 'بطانية', 'صحن', 'كوب', 'ملعقة', 'شوكة', 'سكين', 'قدر', 'مقلاة',
            'فرشاة أسنان', 'مشط', 'صابون', 'منشفة', 'دلو', 'مسمار', 'مطرقة', 'مقص', 'إبرة', 'خيط',
            'دفتر', 'ممحاة', 'مسطرة', 'حاسبة', 'سماعة', 'شاحن', 'فلاشة', 'ماوس', 'لوحة مفاتيح', 'شاشة'
        ]
    },
    food: {
        label: '🍕 أكل',
        words: [
            'كشري', 'فول', 'طعمية', 'شاورما', 'كباب', 'كفتة', 'ملوخية', 'محشي', 'مسقعة', 'فتة',
            'بيتزا', 'برجر', 'سوشي', 'باستا', 'لازانيا', 'سلطة', 'شوربة', 'فراخ مشوية', 'سمك مشوي', 'رز',
            'عيش', 'جبنة', 'زبدة', 'بيض', 'لبن', 'زبادي', 'عسل', 'مربى', 'شيبسي', 'بسكويت',
            'كيك', 'آيس كريم', 'شوكولاتة', 'حلاوة', 'بسبوسة', 'كنافة', 'قطايف', 'أم علي', 'بقلاوة', 'كريب',
            'فلافل', 'حمص', 'فول سوداني', 'لب', 'ذرة مشوي', 'بطاطس محمرة', 'مكرونة', 'كبدة', 'سجق', 'حواوشي'
        ]
    },
    place: {
        label: '📍 مكان',
        words: [
            'مدرسة', 'مستشفى', 'مسجد', 'كنيسة', 'سوبرماركت', 'مطعم', 'كافيه', 'سينما', 'مكتبة', 'ملعب',
            'حديقة', 'شاطئ', 'جبل', 'صحراء', 'غابة', 'نهر', 'بحيرة', 'شلال', 'كهف', 'جزيرة',
            'مطار', 'محطة قطر', 'موقف أتوبيس', 'فندق', 'متحف', 'قلعة', 'قصر', 'برج', 'جسر', 'نفق',
            'مصنع', 'مزرعة', 'حديقة حيوان', 'ملاهي', 'سيرك', 'استاد', 'جامعة', 'مختبر', 'صيدلية', 'بنك',
            'بقالة', 'مخبز', 'جزار', 'صالون', 'جيم', 'حمام سباحة', 'مغسلة', 'ورشة', 'جراج', 'مول'
        ]
    },
    country: {
        label: '🌍 بلد',
        words: [
            'مصر', 'السعودية', 'الإمارات', 'الكويت', 'قطر', 'البحرين', 'عمان', 'الأردن', 'لبنان', 'سوريا',
            'العراق', 'فلسطين', 'اليمن', 'ليبيا', 'تونس', 'الجزائر', 'المغرب', 'السودان', 'الصومال', 'جيبوتي',
            'أمريكا', 'كندا', 'بريطانيا', 'فرنسا', 'ألمانيا', 'إيطاليا', 'إسبانيا', 'البرتغال', 'هولندا', 'بلجيكا',
            'تركيا', 'إيران', 'الهند', 'الصين', 'اليابان', 'كوريا', 'أستراليا', 'البرازيل', 'المكسيك', 'الأرجنتين',
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

// Spy Game Helper Functions
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
            votedFor: null
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
        roundState: null // 'role-reveal', 'discussion', 'voting', 'guessing', 'result'
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

    const player = {
        id: socketId,
        name: playerName,
        isHost: false,
        totalScore: 0,
        roundScore: 0,
        isSpy: false,
        confirmed: false,
        voted: false,
        votedFor: null
    };

    room.players.push(player);
    return room;
}

function removePlayerFromSpyRoom(socketId) {
    for (const [code, room] of spyRooms.entries()) {
        const playerIndex = room.players.findIndex(p => p.id === socketId);
        if (playerIndex !== -1) {
            room.players.splice(playerIndex, 1);

            if (room.players.length === 0) {
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
    // Pick a random category from selected
    const cat = room.categories[Math.floor(Math.random() * room.categories.length)];
    const catData = SPY_WORD_DATABASE[cat];
    if (!catData) return { category: cat, word: 'كلمة' };

    // Filter out used words
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
    // Get the correct word + some decoys from the same category
    const catData = SPY_WORD_DATABASE[room.currentCategory];
    if (!catData) return [room.currentWord];

    const correctWord = room.currentWord;
    let decoys = catData.words.filter(w => w !== correctWord);

    // Shuffle and take 5 decoys
    decoys = decoys.sort(() => Math.random() - 0.5).slice(0, 5);

    // Combine and shuffle
    const options = [correctWord, ...decoys].sort(() => Math.random() - 0.5);
    return options;
}

// ==================== Socket.IO connection handling ====================
io.on('connection', (socket) => {
    console.log(`✅ Player connected: ${socket.id}`);

    // ==================== ATOBIS COMPLETE EVENTS ====================
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

        const arabicLetters = [
            'أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش',
            'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي'
        ];

        let availableLetters = arabicLetters.filter(l => !room.usedLetters.includes(l));
        if (availableLetters.length === 0) {
            room.usedLetters = [];
            availableLetters = arabicLetters;
        }

        const randomLetter = availableLetters[Math.floor(Math.random() * availableLetters.length)];

        room.currentLetter = randomLetter;
        room.usedLetters.push(randomLetter);
        room.gameActive = true;
        room.roundStartTime = Date.now();
        room.roundState = 'playing';

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

    // Player finished round
    socket.on('finish-round', ({ roomCode, answers }) => {
        const room = getRoomByCode(roomCode);
        if (!room || !room.gameActive || room.roundState !== 'playing') return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        player.answers = answers;
        player.finished = true;
        room.roundState = 'scoring';

        io.to(roomCode).emit('round-ended', {
            finisher: player.name
        });
    });

    // Receive answers
    socket.on('submit-answers', ({ roomCode, answers }) => {
        const room = getRoomByCode(roomCode);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        player.answers = answers;
        player.hasSubmitted = true;

        const allSubmitted = room.players.every(p => p.hasSubmitted || p.disconnected);

        if (allSubmitted) {
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
        const categories = room.categories;
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

                const isDuplicate = room.players.some(other =>
                    other.id !== player.id &&
                    normalize(other.answers[cat]) === ans
                );

                player.scores[cat] = isDuplicate ? 5 : 10;
                player.roundScore += player.scores[cat];
            });
        });
    }

    // Host updates score
    socket.on('update-single-score', ({ roomCode, playerId, category, score }) => {
        const room = getRoomByCode(roomCode);
        if (!room || room.host !== socket.id) return;

        const player = room.players.find(p => p.id === playerId);
        if (player) {
            if (!player.scores) player.scores = {};

            player.scores[category] = score;

            let roundTotal = 0;
            const categories = room.categories;
            categories.forEach(cat => {
                if (player.scores[cat] !== undefined) {
                    roundTotal += player.scores[cat];
                }
            });
            player.roundScore = roundTotal;

            io.to(roomCode).emit('score-updated', {
                playerId,
                category,
                score,
                roundScore: roundTotal
            });
        }
    });

    // Host finishes scoring
    socket.on('update-scores-and-next', ({ roomCode }) => {
        const room = getRoomByCode(roomCode);
        if (!room || room.host !== socket.id) return;

        room.players.forEach(p => {
            p.totalScore = (p.totalScore || 0) + (p.roundScore || 0);
        });

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

    // ==================== SPY GAME EVENTS ====================
    socket.on('spy-create-room', (playerName) => {
        const room = createSpyRoom(socket.id, playerName);
        socket.join(room.code);

        socket.emit('spy-room-created', {
            roomCode: room.code,
            players: room.players
        });

        console.log(`🕵️ Spy room created: ${room.code} by ${playerName}`);
    });

    socket.on('spy-join-room', ({ roomCode, playerName }) => {
        const room = addPlayerToSpyRoom(roomCode, socket.id, playerName);

        if (!room) {
            socket.emit('error', { message: 'الغرفة غير موجودة!' });
            return;
        }

        socket.join(roomCode);

        io.to(roomCode).emit('spy-player-joined', {
            players: room.players,
            newPlayer: playerName
        });

        socket.emit('spy-room-joined', {
            roomCode: room.code,
            players: room.players
        });

        console.log(`🕵️ ${playerName} joined spy room: ${roomCode}`);
    });

    socket.on('spy-start-game', ({ roomCode, totalRounds, timerDuration, spyCount, categories }) => {
        const room = getSpyRoomByCode(roomCode);
        if (!room || room.host !== socket.id) return;

        if (room.players.length < 3) {
            socket.emit('error', { message: 'محتاج على الأقل 3 لاعبين!' });
            return;
        }

        room.totalRounds = parseInt(totalRounds) || 5;
        room.timerDuration = parseInt(timerDuration) || 120;
        room.spyCount = Math.min(parseInt(spyCount) || 1, room.players.length - 1);
        room.currentRound = 0;

        if (categories && Array.isArray(categories) && categories.length >= 1) {
            room.categories = categories;
        }

        room.players.forEach(p => p.totalScore = 0);
        room.gameActive = true;

        startSpyRound(roomCode);
    });

    function startSpyRound(roomCode) {
        const room = getSpyRoomByCode(roomCode);
        if (!room) return;

        room.currentRound++;
        room.roundState = 'role-reveal';

        // Pick word
        const { category, word } = pickRandomWord(room);
        room.currentWord = word;
        room.currentCategory = category;

        // Pick spies randomly
        const playerIds = room.players.map(p => p.id);
        const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
        room.spyIds = shuffled.slice(0, room.spyCount);

        // Reset player states
        room.players.forEach(p => {
            p.isSpy = room.spyIds.includes(p.id);
            p.confirmed = false;
            p.voted = false;
            p.votedFor = null;
            p.roundScore = 0;
        });

        // Send role to each player
        room.players.forEach(player => {
            io.to(player.id).emit('spy-round-started', {
                round: room.currentRound,
                totalRounds: room.totalRounds,
                isSpy: player.isSpy,
                word: player.isSpy ? null : word,
                category: category,
                timerDuration: room.timerDuration
            });
        });

        console.log(`🕵️ Spy round ${room.currentRound} started in room ${roomCode} | Word: ${word} | Category: ${category} | Spies: ${room.spyIds.length}`);
    }

    socket.on('spy-confirm-role', ({ roomCode }) => {
        const room = getSpyRoomByCode(roomCode);
        if (!room || room.roundState !== 'role-reveal') return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        player.confirmed = true;

        const confirmed = room.players.filter(p => p.confirmed).length;
        const total = room.players.length;

        io.to(roomCode).emit('spy-confirm-update', { confirmed, total });

        // All confirmed -> start discussion
        if (confirmed === total) {
            room.roundState = 'discussion';

            io.to(roomCode).emit('spy-start-discussion', {
                timerDuration: room.timerDuration
            });

            // Auto start voting after timer
            setTimeout(() => {
                if (room.roundState === 'discussion') {
                    room.roundState = 'voting';
                    io.to(roomCode).emit('spy-start-voting', {
                        players: room.players.map(p => ({
                            id: p.id,
                            name: p.name
                        }))
                    });
                }
            }, room.timerDuration * 1000);
        }
    });

    socket.on('spy-submit-vote', ({ roomCode, votedFor }) => {
        const room = getSpyRoomByCode(roomCode);
        if (!room || room.roundState !== 'voting') return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.voted) return;

        player.voted = true;
        player.votedFor = votedFor;

        const voted = room.players.filter(p => p.voted).length;
        const total = room.players.length;

        io.to(roomCode).emit('spy-vote-update', { voted, total });

        // All voted -> process
        if (voted === total) {
            processVotes(roomCode);
        }
    });

    function processVotes(roomCode) {
        const room = getSpyRoomByCode(roomCode);
        if (!room) return;

        // Count votes
        const voteCounts = {};
        room.players.forEach(p => {
            if (p.votedFor) {
                voteCounts[p.votedFor] = (voteCounts[p.votedFor] || 0) + 1;
            }
        });

        // Find most voted
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

        // If spy was caught, give them a chance to guess
        if (spyCaught) {
            room.roundState = 'guessing';

            const options = getGuessOptions(room);

            room.players.forEach(player => {
                const iAmSpy = room.spyIds.includes(player.id);
                io.to(player.id).emit('spy-guess-phase', {
                    iAmSpy,
                    category: room.currentCategory,
                    options: iAmSpy ? options : [],
                    spyNames
                });
            });
        } else {
            // Spy not caught - calculate scores directly
            calculateSpyScores(room, false, false);

            room.roundState = 'result';
            emitRoundResult(room, false, false);
        }
    }

    socket.on('spy-submit-guess', ({ roomCode, guess }) => {
        const room = getSpyRoomByCode(roomCode);
        if (!room || room.roundState !== 'guessing') return;

        if (!room.spyIds.includes(socket.id)) return;

        const guessedCorrectly = guess === room.currentWord;

        calculateSpyScores(room, true, guessedCorrectly);

        room.roundState = 'result';
        emitRoundResult(room, true, guessedCorrectly);
    });

    function calculateSpyScores(room, spyCaught, spyGuessedCorrectly) {
        room.players.forEach(p => {
            const isSpy = room.spyIds.includes(p.id);

            if (isSpy) {
                if (spyCaught) {
                    if (spyGuessedCorrectly) {
                        p.roundScore = 2; // Caught but guessed correctly
                    } else {
                        p.roundScore = -2; // Caught and failed
                    }
                } else {
                    p.roundScore = 4; // Not caught
                }
            } else {
                if (spyCaught) {
                    if (spyGuessedCorrectly) {
                        p.roundScore = 1; // Caught spy but spy still got the word
                    } else {
                        p.roundScore = 3; // Caught spy and spy failed
                    }
                } else {
                    p.roundScore = -1; // Failed to catch spy
                }
            }

            p.totalScore = (p.totalScore || 0) + p.roundScore;
        });
    }

    function emitRoundResult(room, spyCaught, spyGuessedCorrectly) {
        io.to(room.code).emit('spy-round-result', {
            spyCaught,
            spyGuessedCorrectly,
            word: room.currentWord,
            category: room.currentCategory,
            spyNames: room.players.filter(p => room.spyIds.includes(p.id)).map(p => p.name),
            spyIds: room.spyIds,
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                roundScore: p.roundScore,
                totalScore: p.totalScore,
                isSpy: room.spyIds.includes(p.id)
            }))
        });
    }

    socket.on('spy-next-round', ({ roomCode }) => {
        const room = getSpyRoomByCode(roomCode);
        if (!room || room.host !== socket.id) return;

        if (room.currentRound >= room.totalRounds) {
            io.to(roomCode).emit('spy-game-over', {
                players: room.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    totalScore: p.totalScore
                })).sort((a, b) => b.totalScore - a.totalScore)
            });
            room.gameActive = false;
        } else {
            startSpyRound(roomCode);
        }
    });

    // ==================== DISCONNECT ====================
    socket.on('disconnect', () => {
        // Check atobis rooms
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

        // Check spy rooms
        const spyResult = removePlayerFromSpyRoom(socket.id);
        if (spyResult) {
            if (spyResult.deleted) {
                console.log(`🗑️ Spy room ${spyResult.code} deleted (empty)`);
            } else {
                io.to(spyResult.code).emit('spy-player-left', {
                    players: spyResult.room.players
                });
                console.log(`👋 Player left spy room ${spyResult.code}`);
            }
        }

        console.log(`❌ Player disconnected: ${socket.id}`);
    });
});

// ==================== Routes ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/atobis', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'atobis.html'));
});

app.get('/spy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'spy.html'));
});

app.get('/stats', (req, res) => {
    res.json({
        totalAtobisRooms: rooms.size,
        totalSpyRooms: spyRooms.size,
        atobisRooms: Array.from(rooms.values()).map(room => ({
            code: room.code,
            players: room.players.length,
            gameActive: room.gameActive,
            categories: room.categories
        })),
        spyRooms: Array.from(spyRooms.values()).map(room => ({
            code: room.code,
            players: room.players.length,
            gameActive: room.gameActive,
            round: room.currentRound,
            totalRounds: room.totalRounds
        }))
    });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════╗
║   🎮 ألعاب أونلاين - السيرفر                ║
║   🚌 أتوبيس كومبليت                         ║
║   🕵️ لعبة الجاسوس                           ║
║   🌐 Port: ${PORT}                              ║
║   ✅ السيرفر شغال بنجاح!                     ║
╚══════════════════════════════════════════════╝
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
