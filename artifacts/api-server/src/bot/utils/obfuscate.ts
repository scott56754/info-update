import crypto from "node:crypto";

export function generateKey(): string {
  const seg = () => crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}

export function obfuscateLua(script: string): string {
  const bytes = Buffer.from(script, "utf8");
  const nums = Array.from(bytes).join(",");
  return [
    `local _b={${nums}}`,
    `local _s=""`,
    `for _i=1,#_b do _s=_s..string.char(_b[_i])end`,
    `loadstring(_s)()`,
  ].join(";");
}

export function buildLoader(panelName: string, username: string, key: string, apiBase: string): string {
  return [
    `--// Light Hub | Project: ${panelName}`,
    `--// Licensed to: ${username}`,
    `--// Do not share this script`,
    ``,
    `script_key = "${key}"`,
    ``,
    `local _hwid = pcall(function()`,
    `    return game:GetService("RbxAnalyticsService"):GetClientId()`,
    `end) and game:GetService("RbxAnalyticsService"):GetClientId() or "unknown"`,
    ``,
    `loadstring(game:HttpGet("${apiBase}/api/loader/${encodeURIComponent(panelName)}?key="..script_key.."&hwid=".._hwid))()`,
  ].join("\n");
}
