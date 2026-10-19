require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

const PORT = Number(process.env.PORT) || 3000;
const STEAM_APP_ID = (process.env.STEAM_APP_ID || '1898080').trim();
const hasSteamApiKey = Boolean((process.env.STEAM_API_KEY || '').trim());
const ADMIN_COOKIE = 'hsho_admin_session';
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
const adminLoginAttempts = new Map();
let supabase;

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

function db() {
    if (!supabase) throw new Error('Supabase client is not initialized');
    return supabase;
}

function signAdminPayload(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET)
        .update(body).digest('base64url');
    return `${body}.${signature}`;
}

function readAdminCookie(req) {
    const cookie = (req.headers.cookie || '').split(';').map(x => x.trim())
        .find(x => x.startsWith(`${ADMIN_COOKIE}=`));
    if (!cookie || !process.env.ADMIN_SESSION_SECRET) return null;
    const token = cookie.slice(ADMIN_COOKIE.length + 1);
    const split = token.lastIndexOf('.');
    if (split < 1) return null;
    const body = token.slice(0, split);
    const provided = Buffer.from(token.slice(split + 1));
    const expected = Buffer.from(crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET)
        .update(body).digest('base64url'));
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        return payload.exp >= Math.floor(Date.now() / 1000) ? payload : null;
    } catch {
        return null;
    }
}

function adminReady(req, res, next) {
    if (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_SESSION_SECRET ||
        process.env.ADMIN_SESSION_SECRET.length < 32) {
        return res.status(503).json({ message: 'ตั้งค่า ADMIN_PASSWORD และ ADMIN_SESSION_SECRET (อย่างน้อย 32 ตัวอักษร) ใน Environment ก่อน' });
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
    if (!req.adminSession || req.get('x-admin-csrf') !== req.adminSession.csrf) {
        return res.status(403).json({ message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
    }
    next();
}

function validatePlayer(body) {
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
    return { steam_id: steamId, display_name: displayName, level, experience, gold, gem, updated_at: new Date().toISOString() };
}

function toLauncherPlayer(player) {
    return {
        uid: player.steam_id,
        name: player.display_name,
        level: player.level,
        exp: player.experience,
        currency: { gold: player.gold, gem: player.gem }
    };
}

async function getServerSettings() {
    const { data, error } = await db().from('server_settings').select('*').eq('id', 'main').maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (!data.is_online && data.closed_until && new Date(data.closed_until).getTime() <= Date.now()) {
        const { error: updateError } = await db().from('server_settings')
            .update({ is_online: true, closed_until: null, updated_at: new Date().toISOString() })
            .eq('id', 'main');
        if (updateError) throw updateError;
        return { ...data, is_online: true, closed_until: null };
    }
    return data;
}

app.post('/admin/api/login', adminReady, (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempts = adminLoginAttempts.get(ip);
    if (attempts && attempts.resetAt > now && attempts.count >= 10) {
        return res.status(429).json({ message: 'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที' });
    }
    const supplied = Buffer.from(String(req.body?.password || ''));
    const expected = Buffer.from(process.env.ADMIN_PASSWORD);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        const window = attempts && attempts.resetAt > now ? attempts : { count: 0, resetAt: now + 15 * 60 * 1000 };
        window.count += 1;
        adminLoginAttempts.set(ip, window);
        return res.status(401).json({ message: 'รหัสผ่านไม่ถูกต้อง' });
    }
    adminLoginAttempts.delete(ip);
    const csrf = crypto.randomBytes(24).toString('base64url');
    const payload = { exp: Math.floor(now / 1000) + ADMIN_SESSION_TTL_SECONDS, csrf };
    res.cookie(ADMIN_COOKIE, signAdminPayload(payload), {
        httpOnly: true, secure: req.secure, sameSite: 'strict', path: '/admin',
        maxAge: ADMIN_SESSION_TTL_SECONDS * 1000
    });
    res.json({ csrf });
});

app.get('/admin/api/session', adminReady, requireAdmin, (req, res) => res.json({ csrf: req.adminSession.csrf }));

app.post('/admin/api/logout', adminReady, requireAdmin, requireAdminCsrf, (req, res) => {
    res.clearCookie(ADMIN_COOKIE, { httpOnly: true, secure: req.secure, sameSite: 'strict', path: '/admin' });
    res.json({ ok: true });
});

app.get('/admin/api/launcher', adminReady, requireAdmin, async (req, res) => {
    try {
        const settings = await getServerSettings();
        res.json({ isOnline: settings?.is_online ?? true, closedUntil: settings?.closed_until ?? null });
    } catch (error) {
        console.error('[admin/launcher] Read failed:', error.message);
        res.status(500).json({ message: 'อ่านสถานะ Launcher ไม่สำเร็จ' });
    }
});

app.put('/admin/api/launcher', adminReady, requireAdmin, requireAdminCsrf, async (req, res) => {
    if (typeof req.body?.isOnline !== 'boolean') return res.status(400).json({ message: 'สถานะไม่ถูกต้อง' });
    let closedUntil = null;
    if (!req.body.isOnline) {
        const minutes = Number(req.body.closedMinutes);
        if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 10080) {
            return res.status(400).json({ message: 'กำหนดเวลาปิดตั้งแต่ 1 ถึง 10,080 นาที' });
        }
        closedUntil = new Date(Date.now() + minutes * 60000).toISOString();
    }
    try {
        const { error } = await db().from('server_settings').upsert({
            id: 'main', is_online: req.body.isOnline, closed_until: closedUntil,
            updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
        if (error) throw error;
        res.json({ isOnline: req.body.isOnline, closedUntil });
    } catch (error) {
        console.error('[admin/launcher] Update failed:', error.message);
        res.status(500).json({ message: 'เปลี่ยนสถานะ Launcher ไม่สำเร็จ' });
    }
});

app.get('/admin/api/players', adminReady, requireAdmin, async (req, res) => {
    try {
        const query = String(req.query.q || '').trim().slice(0, 64);
        let request = db().from('players').select('steam_id,display_name,discord_id,discord_tag,whitelisted_at,level,experience,gold,gem,is_banned,banned_until,ban_reason,created_at,updated_at')
            .order('updated_at', { ascending: false }).limit(100);
        if (query) {
            const safeQuery = query.replace(/[^\p{L}\p{N}_ -]/gu, '').trim();
            if (!safeQuery) return res.json({ players: [], limit: 100 });
            request = request.or(`steam_id.ilike.%${safeQuery}%,display_name.ilike.%${safeQuery}%,discord_tag.ilike.%${safeQuery}%,discord_id.ilike.%${safeQuery}%`);
        }
        const { data, error } = await request;
        if (error) throw error;
        res.json({
            players: (data || []).map(player => ({
                steamId: player.steam_id,
                displayName: player.display_name,
                discordId: player.discord_id,
                discordTag: player.discord_tag,
                whitelistedAt: player.whitelisted_at,
                isBanned: player.is_banned,
                bannedUntil: player.banned_until,
                banReason: player.ban_reason,
                level: player.level,
                experience: player.experience,
                currency: { gold: player.gold, gem: player.gem },
                createdAt: player.created_at,
                updatedAt: player.updated_at
            })),
            limit: 100
        });
    } catch (error) {
        console.error('[admin/players] List failed:', error.message);
        res.status(500).json({ message: 'อ่านข้อมูลผู้เล่นไม่สำเร็จ' });
    }
});

app.put('/admin/api/players/:steamId/ban', adminReady, requireAdmin, requireAdminCsrf, async (req, res) => {
    if (!/^\d{17}$/.test(req.params.steamId)) return res.status(400).json({ message: 'SteamID ไม่ถูกต้อง' });
    const permanent = req.body?.permanent === true;
    const minutes = Number(req.body?.minutes);
    if (!permanent && (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 525600)) {
        return res.status(400).json({ message: 'กำหนดเวลาแบน 1–525,600 นาที หรือเลือกแบนถาวร' });
    }
    const reason = String(req.body?.reason || '').trim().slice(0, 300) || null;
    const bannedUntil = permanent ? null : new Date(Date.now() + minutes * 60000).toISOString();
    try {
        const { data, error } = await db().from('players').update({
            is_banned: true, banned_until: bannedUntil, ban_reason: reason, updated_at: new Date().toISOString()
        }).eq('steam_id', req.params.steamId).select('steam_id,is_banned,banned_until,ban_reason').maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: 'ไม่พบผู้เล่น' });
        res.json({ ok: true, player: data });
    } catch (error) {
        console.error('[admin/player-ban] Update failed:', error.message);
        res.status(500).json({ message: 'แบนผู้เล่นไม่สำเร็จ' });
    }
});

app.put('/admin/api/players/:steamId/unban', adminReady, requireAdmin, requireAdminCsrf, async (req, res) => {
    if (!/^\d{17}$/.test(req.params.steamId)) return res.status(400).json({ message: 'SteamID ไม่ถูกต้อง' });
    try {
        const { data, error } = await db().from('players').update({
            is_banned: false, banned_until: null, ban_reason: null, updated_at: new Date().toISOString()
        }).eq('steam_id', req.params.steamId).select('steam_id,is_banned').maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: 'ไม่พบผู้เล่น' });
        res.json({ ok: true });
    } catch (error) {
        console.error('[admin/player-unban] Update failed:', error.message);
        res.status(500).json({ message: 'ปลดแบนผู้เล่นไม่สำเร็จ' });
    }
});

app.post('/admin/api/whitelist/sync', adminReady, requireAdmin, requireAdminCsrf, async (req, res) => {
    const apiUrl = (process.env.WHITELIST_API_URL || '').trim();
    const syncToken = (process.env.WHITELIST_SYNC_TOKEN || '').trim();
    if (!apiUrl || !syncToken) {
        return res.status(503).json({ message: 'ตั้งค่า WHITELIST_API_URL และ WHITELIST_SYNC_TOKEN ใน Environment ก่อน' });
    }
    try {
        const endpoint = new URL(apiUrl);
        if (endpoint.protocol !== 'https:') throw new Error('Whitelist URL must use HTTPS');
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'list', token: syncToken }),
            signal: AbortSignal.timeout(20000)
        });
        const raw = await response.text();
        if (!response.ok || raw.length > 2_000_000) throw new Error(`Whitelist endpoint returned HTTP ${response.status}`);
        const payload = JSON.parse(raw);
        if (payload.found !== true || !Array.isArray(payload.data)) throw new Error('Whitelist response is invalid');

        const unique = new Map();
        let skipped = 0;
        for (const row of payload.data) {
            const steamId = String(row?.steamId || '').trim();
            const displayName = String(row?.steamName || '').trim();
            if (!/^\d{17}$/.test(steamId) || !displayName || displayName.length > 64) {
                skipped += 1;
                continue;
            }
            unique.set(steamId, {
                steam_id: steamId,
                display_name: displayName,
                discord_id: String(row.discordId || '').trim() || null,
                discord_tag: String(row.discordTag || '').trim() || null,
                whitelisted_at: String(row.timestamp || '').trim() || null,
                updated_at: new Date().toISOString()
            });
        }
        const records = [...unique.values()];
        for (let offset = 0; offset < records.length; offset += 200) {
            const { error } = await db().from('players').upsert(records.slice(offset, offset + 200), {
                onConflict: 'steam_id', ignoreDuplicates: false
            });
            if (error) throw error;
        }
        res.json({ synced: records.length, skipped });
    } catch (error) {
        console.error('[admin/whitelist-sync] Sync failed:', error.message);
        res.status(502).json({ message: 'ซิงก์ Whitelist ไม่สำเร็จ ตรวจ URL, token และการ Deploy Apps Script' });
    }
});

app.get('/admin/api/item-usage', adminReady, requireAdmin, async (req, res) => {
    try {
        const query = String(req.query.q || '').trim().slice(0, 64);
        const page = Math.max(1, Math.min(1000000, Number.parseInt(req.query.page, 10) || 1));
        const pageSize = 100;
        let request = db().from('item_usage_events')
            .select('id,steam_id,item_id,item_name,quantity,used_at', { count: 'exact' })
            .order('used_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
        if (query) {
            const safeQuery = query.replace(/[^\p{L}\p{N}_ -]/gu, '').trim();
            if (!safeQuery) return res.json({ events: [], page, pageSize, total: 0, hasMore: false });
            request = request.or(`steam_id.ilike.%${safeQuery}%,item_id.ilike.%${safeQuery}%,item_name.ilike.%${safeQuery}%`);
        }
        const { data: events, error, count } = await request;
        if (error) throw error;
        const steamIds = [...new Set((events || []).map(event => event.steam_id))];
        let playersById = new Map();
        if (steamIds.length) {
            const { data: players, error: playersError } = await db().from('players')
                .select('steam_id,display_name,discord_tag,discord_id,is_banned,banned_until,ban_reason')
                .in('steam_id', steamIds);
            if (playersError) throw playersError;
            playersById = new Map((players || []).map(player => [player.steam_id, player]));
        }
        res.json({ events: (events || []).map(event => {
            const player = playersById.get(event.steam_id) || {};
            return {
                id: event.id, steamId: event.steam_id,
                displayName: player.display_name || 'Player',
                discordName: player.discord_tag || player.discord_id || '—',
                itemId: event.item_id, itemName: event.item_name,
                quantity: event.quantity, usedAt: event.used_at,
                isBanned: player.is_banned || false, bannedUntil: player.banned_until || null,
                banReason: player.ban_reason || null
            };
        }), page, pageSize, total: count || 0, hasMore: page * pageSize < (count || 0) });
    } catch (error) {
        console.error('[admin/item-usage] List failed:', error.message);
        res.status(500).json({ message: 'อ่านประวัติการใช้ไอเท็มไม่สำเร็จ' });
    }
});

// Call only from a trusted game server. Never put GAME_EVENT_SECRET in a game client/launcher.
app.post('/live/player/item-usage', async (req, res) => {
    const configuredSecret = (process.env.GAME_EVENT_SECRET || '').trim();
    const suppliedSecret = String(req.get('x-game-event-secret') || '');
    const expected = Buffer.from(configuredSecret);
    const supplied = Buffer.from(suppliedSecret);
    if (!configuredSecret || expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
        return res.status(401).json({ ok: false, message: 'Unauthorized' });
    }
    const steamId = String(req.body?.steamId || '').trim();
    const itemId = String(req.body?.itemId || '').trim().slice(0, 120) || null;
    const itemName = String(req.body?.itemName || itemId || '').trim().slice(0, 120);
    const quantity = Number(req.body?.quantity ?? 1);
    const displayName = String(req.body?.displayName || 'Player').trim().slice(0, 64) || 'Player';
    const usedAt = req.body?.usedAt ? new Date(req.body.usedAt) : new Date();
    if (!/^\d{17}$/.test(steamId) || !itemName || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) {
        return res.status(400).json({ ok: false, message: 'Invalid item usage event' });
    }
    if (Number.isNaN(usedAt.getTime())) return res.status(400).json({ ok: false, message: 'Invalid usedAt timestamp' });
    try {
        const { error: playerError } = await db().from('players').upsert({
            steam_id: steamId, display_name: displayName
        }, { onConflict: 'steam_id', ignoreDuplicates: true });
        if (playerError) throw playerError;
        const { data, error } = await db().from('item_usage_events').insert({
            steam_id: steamId, item_id: itemId, item_name: itemName, quantity,
            used_at: usedAt.toISOString()
        }).select('id,used_at').single();
        if (error) throw error;
        res.status(201).json({ ok: true, id: data.id, usedAt: data.used_at });
    } catch (error) {
        console.error('[item-usage] Insert failed:', error.message);
        res.status(500).json({ ok: false, message: 'Could not record item usage' });
    }
});

app.post('/admin/api/players', adminReady, requireAdmin, requireAdminCsrf, async (req, res) => {
    const player = validatePlayer(req.body || {});
    if (player.error) return res.status(400).json({ message: player.error });
    try {
        const { data, error } = await db().from('players').insert(player).select().single();
        if (error?.code === '23505') return res.status(409).json({ message: 'SteamID นี้มีอยู่แล้ว' });
        if (error) throw error;
        res.status(201).json({ player: data });
    } catch (error) {
        console.error('[admin/players] Create failed:', error.message);
        res.status(500).json({ message: 'เพิ่มผู้เล่นไม่สำเร็จ' });
    }
});

app.put('/admin/api/players/:steamId', adminReady, requireAdmin, requireAdminCsrf, async (req, res) => {
    const player = validatePlayer({ ...req.body, steamId: req.params.steamId });
    if (player.error) return res.status(400).json({ message: player.error });
    delete player.steam_id;
    try {
        const { data, error } = await db().from('players').update(player)
            .eq('steam_id', req.params.steamId).select().maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: 'ไม่พบผู้เล่น' });
        res.json({ player: data });
    } catch (error) {
        console.error('[admin/players] Update failed:', error.message);
        res.status(500).json({ message: 'บันทึกข้อมูลไม่สำเร็จ' });
    }
});

app.delete('/admin/api/players/:steamId', adminReady, requireAdmin, requireAdminCsrf, async (req, res) => {
    if (!/^\d{17}$/.test(req.params.steamId)) return res.status(400).json({ message: 'SteamID ไม่ถูกต้อง' });
    try {
        const { data, error } = await db().from('players').delete().eq('steam_id', req.params.steamId)
            .select('steam_id').maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: 'ไม่พบผู้เล่น' });
        res.json({ ok: true });
    } catch (error) {
        console.error('[admin/players] Delete failed:', error.message);
        res.status(500).json({ message: 'ลบผู้เล่นไม่สำเร็จ' });
    }
});

// The game API keeps the existing Steam-auth guard. Configure real verified
// Steam authentication before exposing player data to game clients.
function requireVerifiedSteamUser(req, res, next) {
    const steamId = req.user?.steamId;
    if (typeof steamId !== 'string' || !/^\d{17}$/.test(steamId)) {
        return res.status(401).json({ code: 401, message: 'Steam authentication required', status: false });
    }
    next();
}

app.get('/live/checkversion', async (req, res) => {
    try {
        const settings = await getServerSettings();
        res.json({
            code: 0, message: 'Version valid', status: true,
            correctversion: settings?.correct_version ?? true,
            serverVersion: settings?.server_version ?? '1.0.6.0',
            ServerDevVersion: settings?.server_dev_version ?? '0.0.0.1',
            IsOnline: settings?.is_online ?? true,
            ClosedUntil: settings?.closed_until ?? null,
            serverTime: Date.now()
        });
    } catch (error) {
        console.error('[checkversion] Query failed:', error.message);
        res.status(500).json({ code: 500, message: 'Version check failed', status: false, serverTime: Date.now() });
    }
});

app.get('/live/player/getdata', requireVerifiedSteamUser, async (req, res) => {
    try {
        const steamId = req.user.steamId;
        let { data: player, error } = await db().from('players').select('*').eq('steam_id', steamId).maybeSingle();
        if (error) throw error;
        if (!player) {
            const result = await db().from('players').insert({ steam_id: steamId }).select().single();
            if (result.error?.code === '23505') {
                const retry = await db().from('players').select('*').eq('steam_id', steamId).single();
                if (retry.error) throw retry.error;
                player = retry.data;
            } else {
                if (result.error) throw result.error;
                player = result.data;
            }
        }
        if (player.is_banned) {
            const expired = player.banned_until && new Date(player.banned_until).getTime() <= Date.now();
            if (!expired) {
                return res.status(403).json({
                    code: 403, message: 'Player is banned', status: false,
                    bannedUntil: player.banned_until, banReason: player.ban_reason
                });
            }
            const { error: unbanError } = await db().from('players').update({
                is_banned: false, banned_until: null, ban_reason: null, updated_at: new Date().toISOString()
            }).eq('steam_id', steamId);
            if (unbanError) throw unbanError;
        }
        res.json({ code: 0, message: 'Success', data: toLauncherPlayer(player) });
    } catch (error) {
        console.error('[player/getdata] Failed:', error.message);
        res.status(500).json({ code: 500, message: 'Unable to load player data', status: false });
    }
});

app.get('/live/steam/info', (req, res) => {
    res.json({ code: 0, message: 'Steam Config Success', appId: STEAM_APP_ID, hasApiKey: hasSteamApiKey });
});

app.get('/', (req, res) => res.status(200).send('HSHO Player API is running.'));

app.get('/health', async (req, res) => {
    try {
        const { error } = await db().from('server_settings').select('id').limit(1);
        if (error) throw error;
        res.json({ status: 'ok', database: 'connected' });
    } catch {
        res.status(503).json({ status: 'database_disconnected' });
    }
});

app.use('/live', (req, res) => res.status(404).json({ code: 404, message: 'API endpoint not found', status: false }));

function startServer() {
    const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
    const supabaseSecret = (process.env.SUPABASE_SECRET_KEY || '').trim();
    if (!supabaseUrl || !supabaseSecret) {
        console.error('[Startup Error] SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
        process.exit(1);
    }
    try {
        supabase = createClient(supabaseUrl, supabaseSecret, {
            auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
        });
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`[Server] Player API running on port ${PORT}`);
            console.log('[Database] Supabase client initialized');
            console.log(`[Steam] App ID configured: ${STEAM_APP_ID}`);
        });
    } catch (error) {
        console.error('[Startup Error] Supabase initialization failed:', error.message);
        process.exit(1);
    }
}

startServer();
