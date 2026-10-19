
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.set('trust proxy', 1);

// ==========================================
// 1. Configuration
// ==========================================

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({
    limit: '10mb',
    extended: true
}));

// The admin dashboard is served by this same app, so it needs no separate
// hosting service and never receives MongoDB credentials in the browser.
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const PORT = Number(process.env.PORT) || 3000;
const MONGO_URI = (process.env.MONGO_URI || '').trim();
const MONGO_DB_NAME = (
    process.env.MONGO_DB_NAME || 'Cluster0'
).trim();

const STEAM_APP_ID = (
    process.env.STEAM_APP_ID || '1898080'
).trim();

const hasSteamApiKey = Boolean(
    (process.env.STEAM_API_KEY || '').trim()
);

// ==========================================
// 2. Player Schema
// หมายเหตุ: ต้องตรวจสอบโครงสร้างกับเกมจริง
// ==========================================

const playerSchema = new mongoose.Schema(
    {
        steamId: {
            type: String,
            required: true,
            trim: true,
            immutable: true
        },
        displayName: {
            type: String,
            default: 'Player',
            trim: true,
            maxlength: 64
        },
        level: {
            type: Number,
            default: 1,
            min: 1
        },
        experience: {
            type: Number,
            default: 0,
            min: 0
        },
        currency: {
            gold: {
                type: Number,
                default: 0,
                min: 0
            },
            gem: {
                type: Number,
                default: 0,
                min: 0
            }
        }
    },
    {
        timestamps: true,
        collection: 'players',
        versionKey: false
    }
);

playerSchema.index(
    { steamId: 1 },
    { unique: true }
);

const Player = mongoose.model('Player', playerSchema);

// ==========================================
// 3. Private player-data admin dashboard
// ==========================================

const ADMIN_COOKIE = 'hsho_admin_session';
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
const adminLoginAttempts = new Map();

function signAdminPayload(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
        .createHmac('sha256', process.env.ADMIN_SESSION_SECRET)
        .update(body)
        .digest('base64url');
    return `${body}.${signature}`;
}

function readAdminCookie(req) {
    const cookieHeader = req.headers.cookie || '';
    const cookie = cookieHeader
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(`${ADMIN_COOKIE}=`));

    if (!cookie || !process.env.ADMIN_SESSION_SECRET) return null;

    const token = cookie.slice(ADMIN_COOKIE.length + 1);
    const separator = token.lastIndexOf('.');
    if (separator < 1) return null;

    const body = token.slice(0, separator);
    const providedSignature = Buffer.from(token.slice(separator + 1));
    const expectedSignature = Buffer.from(crypto
        .createHmac('sha256', process.env.ADMIN_SESSION_SECRET)
        .update(body)
        .digest('base64url'));

    if (providedSignature.length !== expectedSignature.length ||
        !crypto.timingSafeEqual(providedSignature, expectedSignature)) {
        return null;
    }

    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch {
        return null;
    }
}

function adminReady(req, res, next) {
    if (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_SESSION_SECRET ||
        process.env.ADMIN_SESSION_SECRET.length < 32) {
        return res.status(503).json({
            message: 'Admin is not configured. Set ADMIN_PASSWORD and an ADMIN_SESSION_SECRET of at least 32 characters.'
        });
    }
    next();
}

function requireAdmin(req, res, next) {
    const session = readAdminCookie(req);
    if (!session) return res.status(401).json({ message: 'กรุณาเข้าสู่ระบบใหม่' });
    req.adminSession = session;
    next();
}

function requireAdminCsrf(req, res, next) {
    const origin = req.get('origin');
    if (origin) {
        try {
            if (new URL(origin).host !== req.get('host')) {
                return res.status(403).json({ message: 'คำขอมาจากเว็บไซต์ที่ไม่รู้จัก' });
            }
        } catch {
            return res.status(403).json({ message: 'Origin ไม่ถูกต้อง' });
        }
    }

    if (!req.adminSession || !req.get('x-admin-csrf') ||
        req.get('x-admin-csrf') !== req.adminSession.csrf) {
        return res.status(403).json({ message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
    }
    next();
}

function validPlayerInput(body) {
    const steamId = String(body.steamId || '').trim();
    const displayName = String(body.displayName || '').trim();
    const level = Number(body.level);
    const experience = Number(body.experience);
    const gold = Number(body.gold);
    const gem = Number(body.gem);

    if (!/^\d{17}$/.test(steamId)) return { error: 'SteamID ต้องเป็นตัวเลข 17 หลัก' };
    if (!displayName || displayName.length > 64) return { error: 'ชื่อผู้เล่นต้องมี 1–64 ตัวอักษร' };
    for (const [label, value] of [['Level', level], ['EXP', experience], ['Gold', gold], ['Gem', gem]]) {
        if (!Number.isSafeInteger(value) || value < 0) return { error: `${label} ต้องเป็นเลขจำนวนเต็มตั้งแต่ 0 ขึ้นไป` };
    }
    if (level < 1) return { error: 'Level ต้องมีค่าอย่างน้อย 1' };
    return { steamId, displayName, level, experience, currency: { gold, gem } };
}

app.post('/admin/api/login', adminReady, async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempts = adminLoginAttempts.get(clientIp);
    if (attempts && attempts.resetAt > now && attempts.count >= 10) {
        return res.status(429).json({ message: 'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที' });
    }

    const supplied = Buffer.from(String(req.body?.password || ''));
    const expected = Buffer.from(process.env.ADMIN_PASSWORD);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        const current = attempts && attempts.resetAt > now
            ? attempts
            : { count: 0, resetAt: now + 15 * 60 * 1000 };
        current.count += 1;
        adminLoginAttempts.set(clientIp, current);
        return res.status(401).json({ message: 'รหัสผ่านไม่ถูกต้อง' });
    }
    adminLoginAttempts.delete(clientIp);

    const csrf = crypto.randomBytes(24).toString('base64url');
    const payload = {
        exp: Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SECONDS,
        csrf
    };
    res.cookie(ADMIN_COOKIE, signAdminPayload(payload), {
        httpOnly: true,
        secure: req.secure,
        sameSite: 'strict',
        path: '/admin',
        maxAge: ADMIN_SESSION_TTL_SECONDS * 1000
    });
    return res.json({ csrf });
});

app.get('/admin/api/session', adminReady, requireAdmin, (req, res) => {
    res.json({ csrf: req.adminSession.csrf });
});

app.get('/admin/api/launcher', adminReady, requireAdmin, async (req, res) => {
    try {
        const db = mongoose.connection.useDb(MONGO_DB_NAME);
        const settings = await db.collection('serverinfo').findOne({});
        if (settings?.IsOnline === false && settings.ClosedUntil &&
            new Date(settings.ClosedUntil).getTime() <= Date.now()) {
            await db.collection('serverinfo').updateOne(
                { _id: settings._id },
                { $set: { IsOnline: true, ClosedUntil: null } }
            );
            settings.IsOnline = true;
            settings.ClosedUntil = null;
        }
        res.json({
            isOnline: settings?.IsOnline ?? true,
            closedUntil: settings?.ClosedUntil ?? null
        });
    } catch (err) {
        console.error('[admin/launcher] Read failed:', err.message);
        res.status(500).json({ message: 'อ่านสถานะ Launcher ไม่สำเร็จ' });
    }
});

app.put('/admin/api/launcher', adminReady, requireAdmin, requireAdminCsrf, async (req, res) => {
    if (typeof req.body?.isOnline !== 'boolean') {
        return res.status(400).json({ message: 'สถานะไม่ถูกต้อง' });
    }
    let closedUntil = null;
    if (!req.body.isOnline) {
        const minutes = Number(req.body.closedMinutes);
        if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 10080) {
            return res.status(400).json({ message: 'กำหนดเวลาปิดตั้งแต่ 1 ถึง 10,080 นาที' });
        }
        closedUntil = new Date(Date.now() + minutes * 60 * 1000);
    }
    try {
        const db = mongoose.connection.useDb(MONGO_DB_NAME);
        const collection = db.collection('serverinfo');
        const settings = await collection.findOne({});
        if (settings) {
            await collection.updateOne(
                { _id: settings._id },
                { $set: { IsOnline: req.body.isOnline, ClosedUntil: closedUntil } }
            );
        } else {
            await collection.insertOne({ IsOnline: req.body.isOnline, ClosedUntil: closedUntil });
        }
        res.json({ isOnline: req.body.isOnline, closedUntil });
    } catch (err) {
        console.error('[admin/launcher] Update failed:', err.message);
        res.status(500).json({ message: 'เปลี่ยนสถานะ Launcher ไม่สำเร็จ' });
    }
});

app.post('/admin/api/logout', adminReady, requireAdmin, requireAdminCsrf, (req, res) => {
    res.clearCookie(ADMIN_COOKIE, {
        httpOnly: true,
        secure: req.secure,
        sameSite: 'strict',
        path: '/admin'
    });
    res.json({ ok: true });
});

app.get('/admin/api/players', adminReady, requireAdmin, async (req, res) => {
    try {
        const query = String(req.query.q || '').trim().slice(0, 64);
        const filter = query
            ? { $or: [
                { steamId: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
                { displayName: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
            ] }
            : {};
        const players = await Player.find(filter)
            .select('steamId displayName level experience currency createdAt updatedAt')
            .sort({ updatedAt: -1 })
            .limit(100)
            .lean();
        res.json({ players, limit: 100 });
    } catch (err) {
        console.error('[admin/players] List failed:', err.message);
        res.status(500).json({ message: 'อ่านข้อมูลผู้เล่นไม่สำเร็จ' });
    }
});

app.post('/admin/api/players', adminReady, requireAdmin, requireAdminCsrf, async (req, res) => {
    const player = validPlayerInput(req.body || {});
    if (player.error) return res.status(400).json({ message: player.error });
    try {
        const created = await Player.create(player);
        res.status(201).json({ player: created });
    } catch (err) {
        if (err?.code === 11000) return res.status(409).json({ message: 'SteamID นี้มีอยู่แล้ว' });
        console.error('[admin/players] Create failed:', err.message);
        res.status(500).json({ message: 'เพิ่มผู้เล่นไม่สำเร็จ' });
    }
});

app.put('/admin/api/players/:steamId', adminReady, requireAdmin, requireAdminCsrf, async (req, res) => {
    const player = validPlayerInput({ ...req.body, steamId: req.params.steamId });
    if (player.error) return res.status(400).json({ message: player.error });
    try {
        const updated = await Player.findOneAndUpdate(
            { steamId: req.params.steamId },
            { $set: { displayName: player.displayName, level: player.level, experience: player.experience, currency: player.currency } },
            { new: true, runValidators: true }
        );
        if (!updated) return res.status(404).json({ message: 'ไม่พบผู้เล่น' });
        res.json({ player: updated });
    } catch (err) {
        console.error('[admin/players] Update failed:', err.message);
        res.status(500).json({ message: 'บันทึกข้อมูลไม่สำเร็จ' });
    }
});

app.delete('/admin/api/players/:steamId', adminReady, requireAdmin, requireAdminCsrf, async (req, res) => {
    if (!/^\d{17}$/.test(req.params.steamId)) return res.status(400).json({ message: 'SteamID ไม่ถูกต้อง' });
    try {
        const deleted = await Player.findOneAndDelete({ steamId: req.params.steamId });
        if (!deleted) return res.status(404).json({ message: 'ไม่พบผู้เล่น' });
        res.json({ ok: true });
    } catch (err) {
        console.error('[admin/players] Delete failed:', err.message);
        res.status(500).json({ message: 'ลบผู้เล่นไม่สำเร็จ' });
    }
});

// ==========================================
// 3. Steam Authentication Guard
// ต้องเพิ่ม Middleware ตรวจสอบ Steam จริง
// ก่อนใช้งาน Player API
// ==========================================

function requireVerifiedSteamUser(req, res, next) {
    const steamId = req.user?.steamId;

    if (
        typeof steamId !== 'string' ||
        !/^\d{17}$/.test(steamId)
    ) {
        return res.status(401).json({
            code: 401,
            message: 'Steam authentication required',
            status: false
        });
    }

    next();
}

// ==========================================
// 4. Check Game Version
// ==========================================

app.get('/live/checkversion', async (req, res) => {
    try {
        const db = mongoose.connection.useDb(MONGO_DB_NAME);

        const serverInfo = await db
            .collection('serverinfo')
            .findOne({});

        let isOnline = serverInfo?.IsOnline ?? true;
        let closedUntil = serverInfo?.ClosedUntil ?? null;
        if (!isOnline && closedUntil && new Date(closedUntil).getTime() <= Date.now()) {
            await db.collection('serverinfo').updateOne(
                { _id: serverInfo._id },
                { $set: { IsOnline: true, ClosedUntil: null } }
            );
            isOnline = true;
            closedUntil = null;
        }

        return res.json({
            code: 0,
            message: 'Version valid',
            status: true,
            correctversion:
                serverInfo?.correctversion ?? true,
            serverVersion:
                serverInfo?.serverVersion ?? '1.0.6.0',
            ServerDevVersion:
                serverInfo?.ServerDevVersion ?? '0.0.0.1',
            IsOnline: isOnline,
            ClosedUntil: closedUntil,
            serverTime: Date.now()
        });
    } catch (err) {
        console.error(
            '[checkversion] Query failed:',
            err.message
        );

        return res.status(500).json({
            code: 500,
            message: 'Version check failed',
            status: false,
            serverTime: Date.now()
        });
    }
});

// ==========================================
// 5. Get Player Data
// ใช้ได้เมื่อมี Middleware ยืนยัน Steam แล้ว
// ==========================================

app.get(
    '/live/player/getdata',
    requireVerifiedSteamUser,
    async (req, res) => {
        try {
            const steamId = req.user.steamId;

            let player = await Player.findOne({ steamId });

            if (!player) {
                player = await Player.create({ steamId });
            }

            return res.json({
                code: 0,
                message: 'Success',
                data: {
                    uid: player.steamId,
                    name: player.displayName,
                    level: player.level,
                    exp: player.experience,
                    currency: {
                        gold: player.currency.gold,
                        gem: player.currency.gem
                    }
                }
            });
        } catch (err) {
            // กู้คืนกรณีคำขอสร้างผู้เล่นซ้ำพร้อมกัน
            if (err?.code === 11000 && req.user?.steamId) {
                try {
                    const player = await Player.findOne({
                        steamId: req.user.steamId
                    });

                    if (player) {
                        return res.json({
                            code: 0,
                            message: 'Success',
                            data: {
                                uid: player.steamId,
                                name: player.displayName,
                                level: player.level,
                                exp: player.experience,
                                currency: {
                                    gold: player.currency.gold,
                                    gem: player.currency.gem
                                }
                            }
                        });
                    }
                } catch (lookupErr) {
                    console.error(
                        '[player/getdata] Recovery failed:',
                        lookupErr.message
                    );
                }
            }

            console.error(
                '[player/getdata] Failed:',
                err.message
            );

            return res.status(500).json({
                code: 500,
                message: 'Unable to load player data',
                status: false
            });
        }
    }
);

// ==========================================
// 6. Steam Configuration
// ไม่เปิดเผย Steam API Key
// ==========================================

app.get('/live/steam/info', (req, res) => {
    res.json({
        code: 0,
        message: 'Steam Config Success',
        appId: STEAM_APP_ID,
        hasApiKey: hasSteamApiKey
    });
});

// ==========================================
// 7. Health Check
// ==========================================

app.get('/', (req, res) => {
    res.status(200).send(
        'HSHO Ultimate Private Server is running.'
    );
});

app.get('/health', (req, res) => {
    const connected =
        mongoose.connection.readyState === 1;

    res.status(connected ? 200 : 503).json({
        status: connected ? 'ok' : 'database_disconnected',
        database: connected ? 'connected' : 'disconnected'
    });
});

// ==========================================
// 8. Unknown API Routes
// ==========================================

app.use('/live', (req, res) => {
    res.status(404).json({
        code: 404,
        message: 'API endpoint not found',
        status: false
    });
});

// ==========================================
// 9. Start Server
// ==========================================

async function startServer() {
    if (!MONGO_URI) {
        console.error(
            '[Startup Error] MONGO_URI is missing.'
        );
        console.error(
            'Set MONGO_URI in Render Environment or local .env.'
        );
        process.exit(1);
    }

    if (
        !MONGO_URI.startsWith('mongodb://') &&
        !MONGO_URI.startsWith('mongodb+srv://')
    ) {
        console.error(
            '[Startup Error] MONGO_URI must start with ' +
            'mongodb:// or mongodb+srv://'
        );
        process.exit(1);
    }

    if (!MONGO_DB_NAME) {
        console.error(
            '[Startup Error] MONGO_DB_NAME is empty.'
        );
        process.exit(1);
    }

    try {
        await mongoose.connect(MONGO_URI, {
            dbName: MONGO_DB_NAME,
            serverSelectionTimeoutMS: 15000
        });

        console.log(
            `[MongoDB] Connected to database: ${MONGO_DB_NAME}`
        );

        console.log(
            `[Steam] App ID configured: ${STEAM_APP_ID}`
        );

        console.log(
            `[Steam] API key configured: ${hasSteamApiKey}`
        );

        console.log(
            '[Notice] Player API requires verified Steam authentication.'
        );

        app.listen(PORT, '0.0.0.0', () => {
            console.log(
                `[Server] Backend running on port ${PORT}`
            );
        });
    } catch (err) {
        console.error(
            '[MongoDB] Connection failed:',
            err.message
        );

        process.exit(1);
    }
}

startServer();
