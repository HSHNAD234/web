async function findSteamIdByDiscord(discordId) {
  const id = String(discordId ?? "").trim();

  if (!id) {
    throw new Error("Missing Discord ID");
  }

  const { data, error } = await supabase
    .from("players")
    .select("steam_id, discord_id, discord_tag")
    .eq("discord_id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return data;
}
