
const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");

const STEAM_ID_PATTERN = /^[0-9]{17}$/;

function validSteamId(value) {
  return typeof value === "string" &&
    STEAM_ID_PATTERN.test(value);
}

// อ่านข้อมูลผู้เล่น
router.get("/players/:steamId", async (req, res) => {
  const { steamId } = req.params;

  if (!validSteamId(steamId)) {
    return res.status(400).json({
      error: "Invalid Steam ID"
    });
  }

  try {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("steam_id", steamId)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        error: "Player not found"
      });
    }

    return res.json({ player: data });
  } catch (error) {
    console.error("Read player failed:", error.message);

    return res.status(500).json({
      error: "Unable to read player"
    });
  }
});

// อ่านสถานะเซิร์ฟเวอร์
router.get("/server-settings", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("server_settings")
      .select("*")
      .eq("id", "main")
      .maybeSingle();

    if (error) throw error;

    return res.json({ settings: data });
  } catch (error) {
    console.error("Read server settings failed:", error.message);

    return res.status(500).json({
      error: "Unable to read server settings"
    });
  }
});

// อ่านสถิติผู้เล่น
router.get("/players/:steamId/stats", async (req, res) => {
  const { steamId } = req.params;

  if (!validSteamId(steamId)) {
    return res.status(400).json({
      error: "Invalid Steam ID"
    });
  }

  try {
    const { data, error } = await supabase
      .from("player_stats")
      .select("*")
      .eq("steam_id", steamId)
      .maybeSingle();

    if (error) throw error;

    return res.json({ stats: data });
  } catch (error) {
    console.error("Read player stats failed:", error.message);

    return res.status(500).json({
      error: "Unable to read player stats"
    });
  }
});

module.exports = router;
