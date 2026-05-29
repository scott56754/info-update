import { Router } from "express";
import { db } from "@workspace/db";
import { panels, panelWhitelist, panelBlacklist } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { obfuscateLua } from "../bot/utils/obfuscate.js";

const router = Router();

// GET /api/loader/:panelName?key=XXX&hwid=XXX
// Returns obfuscated Lua script for whitelisted users
router.get("/loader/:panelName", async (req, res) => {
  const { panelName } = req.params;
  const { key, hwid } = req.query as { key?: string; hwid?: string };

  if (!key || !hwid) {
    return res.status(400).send('-- Error: Missing key or hwid parameter');
  }

  const [panel] = await db.select().from(panels)
    .where(eq(panels.name, panelName.toLowerCase()));

  if (!panel) {
    return res.status(404).send('-- Error: Panel not found');
  }

  if (!panel.scriptContent) {
    return res.status(404).send('-- Error: No script configured for this panel');
  }

  // Check blacklist
  const [bl] = await db.select().from(panelBlacklist)
    .where(and(
      eq(panelBlacklist.panelId, panel.id),
      eq(panelBlacklist.active, true)
    ));

  // Check whitelist + key match
  const [wl] = await db.select().from(panelWhitelist)
    .where(and(
      eq(panelWhitelist.panelId, panel.id),
      eq(panelWhitelist.keyCode, key.toUpperCase())
    ));

  if (!wl) {
    return res.status(403).send('-- Error: Not whitelisted or invalid key');
  }

  // HWID lock
  if (wl.hwid && wl.hwid !== hwid) {
    return res.status(403).send('-- Error: HWID mismatch. Reset your HWID via the panel.');
  }

  // Lock HWID if not set
  if (!wl.hwid && hwid !== "unknown") {
    await db.update(panelWhitelist)
      .set({ hwid })
      .where(eq(panelWhitelist.id, wl.id));
  }

  const obfuscated = obfuscateLua(panel.scriptContent);
  res.setHeader("Content-Type", "text/plain");
  res.send(obfuscated);
});

export default router;
