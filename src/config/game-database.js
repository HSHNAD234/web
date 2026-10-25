
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const supabase = require("./supabase");

const STEAM_ID_RE = /^[0-9]{17}$/;
const MAX_VALUE = 2147483647;

function authorized(req, res, next) {
  const expected = process.env.HSHONAD_GAME_API_TOKEN || "";
  const header = req.get("authorization") || "";
  const supplied = header.replace(/^Bearer\s+/i, "");

  if (expected.length < 32) {
    return res.status(503).json({ error: "Game API token is not configured" });
  }

  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

function validSteamId(id) {
  return typeof id === "string" && STEAM_ID_RE.test(id);
}

function validateNumber(value, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_VALUE) {
    throw new Error(`${field} must be an integer between 0 and ${MAX_VALUE}`);
  }
}

router.get("/players/:steamId", authorized, async (req, res) => {
  const steamId = req.params.steamId;

  if (!validSteamId(steamId)) {
    return res.status(400).json({ error: "Invalid Steam ID" });
  }

  try {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("steam_id", steamId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Player not found" });

    res.set("Cache-Control", "no-store");
    return res.json({ player: data });
  } catch (err) {
    console.error("GET player failed:", err.message);
    return res.status(500).json({ error: "Unable to read player" });
  }
});

router.put("/players/:steamId", authorized, async (req, res) => {
  const steamId = req.params.steamId;

  if (!validSteamId(steamId)) {
    return res.status(400).json({ error: "Invalid Steam ID" });
  }

  const body = req.body || {};
  const updates = { updated_at: new Date().toISOString() };

  try {
    // รับเฉพาะฟิลด์ที่อนุญาต ไม่รับ steam_id, is_banned หรือข้อมูลสิทธิ์จาก client
    for (const field of ["level", "experience", "gold", "gem", "coin"]) {
      if (body[field] !== undefined) {
        validateNumber(body[field], field);
        updates[field] = body[field];
      }
    }

    if (body.displayName !== undefined) {
      if (typeof body.displayName !== "string" ||
          body.displayName.trim().length < 1 ||
          body.displayName.trim().length > 64) {
        return res.status(400).json({ error: "Invalid displayName" });
      }
      updates.display_name = body.displayName.trim();
    }

    if (body.role !== undefined) {
      if (typeof body.role !== "string" ||
          !["survivor", "admin", "moderator"].includes(body.role)) {
        return res.status(400).json({ error: "Invalid role" });
      }
      updates.role = body.role;
    }

    if (body.isWhitelisted !== undefined) {
      if (typeof body.isWhitelisted !== "boolean") {
        return res.status(400).json({ error: "isWhitelisted must be boolean" });
      }
      updates.is_whitelisted = body.isWhitelisted;
    }

    if (body.inventory !== undefined) {
      if (!body.inventory || typeof body.inventory !== "object" ||
          Array.isArray(body.inventory)) {
        return res.status(400).json({ error: "inventory must be an object" });
      }

      if (Buffer.byteLength(JSON.stringify(body.inventory), "utf8") > 200000) {
        return res.status(413).json({ error: "Inventory is too large" });
      }

      updates.inventory = body.inventory;
    }

    if (Object.keys(updates).length === 1) {
      return res.status(400).json({ error: "No supported fields supplied" });
    }

    // ไม่สร้างผู้เล่นใหม่โดยอัตโนมัติ: ป้องกัน client สร้างข้อมูลผู้เล่นปลอม
    const { data: existing, error: findError } = await supabase
      .from("players")
      .select("steam_id")
      .eq("steam_id", steamId)
      .maybeSingle();

    if (findError) throw findError;
    if (!existing) return res.status(404).json({ error: "Player not found" });

    const { data, error } = await supabase
      .from("players")
      .update(updates)
      .eq("steam_id", steamId)
      .select("*")
      .single();

    if (error) throw error;

    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, player: data });
  } catch (err) {
    if (/must be an integer/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }

    console.error("PUT player failed:", err.message);
    return res.status(500).json({ error: "Unable to update player" });
  }
});

router.get("/players/:steamId/stats", authorized, async (req, res) => {
  const steamId = req.params.steamId;

  if (!validSteamId(steamId)) {
    return res.status(400).json({ error: "Invalid Steam ID" });
  }

  try {
    const { data, error } = await supabase
      .from("player_stats")
      .select("*")
      .eq("steam_id", steamId)
      .maybeSingle();

    if (error) throw error;

    res.set("Cache-Control", "no-store");
    return res.json({ stats: data });
  } catch (err) {
    console.error("GET player stats failed:", err.message);
    return res.status(500).json({ error: "Unable to read stats" });
  }
});

module.exports = router;
