import { Router } from "express";
import { db } from "@workspace/db";
import { panels, panelWhitelist, panelBlacklist, panelKeys } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { obfuscateLua } from "../bot/utils/obfuscate.js";

const router = Router();

// GET /api/loader/:panelName/:key?hwid=...
// Called by Roblox executor — returns obfuscated script for whitelisted users
router.get("/loader/:panelName/:key", async (req, res) => {
  const panelName = req.params.panelName.toLowerCase();
  const key = req.params.key.toUpperCase();
  const hwid = (req.query.hwid as string | undefined)?.trim() || null;

  try {
    const [panel] = await db.select().from(panels)
      .where(eq(panels.name, panelName));

    if (!panel) {
      return res.status(404).send(`-- Error: Panel not found`);
    }

    if (!panel.scriptContent) {
      return res.status(404).send(`-- Error: No script configured for this panel`);
    }

    // Verify whitelist entry with matching key
    const [wl] = await db.select().from(panelWhitelist)
      .where(and(
        eq(panelWhitelist.panelId, panel.id),
        eq(panelWhitelist.keyCode, key),
      ));

    if (!wl) {
      return res.status(403).send(`-- Error: Invalid key or not whitelisted`);
    }

    // Check whitelist expiry
    if (wl.expiresAt && wl.expiresAt <= new Date()) {
      return res.status(403).send(`-- Error: Your access has expired. Contact an admin to renew.`);
    }

    // Check blacklist
    const [bl] = await db.select().from(panelBlacklist)
      .where(and(
        eq(panelBlacklist.panelId, panel.id),
        eq(panelBlacklist.userId, wl.userId),
        eq(panelBlacklist.active, true),
      ));

    if (bl) {
      return res.status(403).send(`-- Error: You are blacklisted. Reason: ${bl.reason}`);
    }

    // Check key expiry from panelKeys table
    const [keyRecord] = await db.select().from(panelKeys)
      .where(eq(panelKeys.keyCode, key));

    if (keyRecord) {
      if (!keyRecord.active) {
        return res.status(403).send(`-- Error: Your key has been revoked.`);
      }
      if (keyRecord.expiresAt && keyRecord.expiresAt <= new Date()) {
        return res.status(403).send(`-- Error: Your key has expired. Contact an admin to renew.`);
      }
    }

    // HWID locking
    if (hwid && hwid !== "unknown") {
      if (wl.hwid && wl.hwid !== hwid) {
        return res.status(403).send(`-- Error: HWID mismatch. Reset your HWID via the panel in Discord.`);
      }
      if (!wl.hwid) {
        await db.update(panelWhitelist)
          .set({ hwid })
          .where(eq(panelWhitelist.id, wl.id));
      }
    }

    // Return obfuscated script
    const obfuscated = obfuscateLua(panel.scriptContent);
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Cache-Control", "no-store");
    return res.send(obfuscated);
  } catch (err) {
    return res.status(500).send(`-- Error: Internal server error`);
  }
});

// Legacy route with query params (fallback)
router.get("/loader/:panelName", async (req, res) => {
  const panelName = req.params.panelName.toLowerCase();
  const key = ((req.query.key as string) || "").toUpperCase();
  const hwid = ((req.query.hwid as string) || "").trim();
  if (!key) return res.status(400).send(`-- Error: Missing key`);
  const hwidParam = hwid ? `?hwid=${encodeURIComponent(hwid)}` : "";
  res.redirect(`/api/loader/${encodeURIComponent(panelName)}/${encodeURIComponent(key)}${hwidParam}`);
});

export default router;
