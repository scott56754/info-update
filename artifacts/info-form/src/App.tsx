import { useState } from "react";

const DEFAULT_FIELDS = [
  { key: "DISCORD_CLIENT_ID", value: "" },
  { key: "DISCORD_GUILD_ID", value: "" },
  { key: "DISCORD_TOKEN", value: "" },
];

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function UserLockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3z"/>
      <path d="M8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3z"/>
      <path d="M8 14c-4 0-6 2-6 3v1h9"/>
      <rect x="14" y="14" width="8" height="6" rx="1"/>
      <path d="M16 14v-2a2 2 0 0 1 4 0v2"/>
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

export default function App() {
  const [fields, setFields] = useState(DEFAULT_FIELDS);
  const [showValues, setShowValues] = useState(false);

  const updateValue = (index: number, val: string) => {
    setFields((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], value: val };
      return next;
    });
  };

  return (
    <div style={{ minHeight: "100vh", background: "#1e1e2e", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: "420px" }}>
        <div style={{ background: "#2a2a3e", border: "1px solid #3a3a55", borderRadius: "10px", overflow: "hidden" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "14px 16px", borderBottom: "1px solid #3a3a55" }}>
            <span style={{ color: "#9a9ab0" }}><LockIcon /></span>
            <span style={{ color: "#d4d4e8", fontWeight: 600, fontSize: "14px" }}>Secrets</span>
          </div>

          {/* Column headers */}
          <div style={{ display: "flex", gap: "8px", padding: "10px 16px 6px 16px" }}>
            <div style={{ flex: "0 0 160px", color: "#7a7a95", fontSize: "12px", fontWeight: 500 }}>Key</div>
            <div style={{ flex: 1, color: "#7a7a95", fontSize: "12px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px" }}>
              Value
              <button
                onClick={() => setShowValues((v) => !v)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#7a7a95", padding: 0, display: "flex", alignItems: "center" }}
              >
                <EyeIcon />
              </button>
            </div>
          </div>

          {/* Rows */}
          <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: "6px" }}>
            {fields.map((field, i) => (
              <div key={i} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {/* Key input */}
                <input
                  type="text"
                  value={field.key}
                  onChange={(e) => setFields((prev) => {
                    const next = [...prev];
                    next[i] = { ...next[i], key: e.target.value };
                    return next;
                  })}
                  style={{
                    flex: "0 0 160px",
                    background: "#1e1e2e",
                    border: "1px solid #3a3a55",
                    borderRadius: "6px",
                    padding: "8px 10px",
                    color: "#9a9ab0",
                    fontSize: "12px",
                    outline: "none",
                    fontFamily: "monospace",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                />
                {/* Value input + icon */}
                <div style={{ flex: 1, display: "flex", alignItems: "center", background: "#1e1e2e", border: "1px solid #3a3a55", borderRadius: "6px", overflow: "hidden" }}>
                  <input
                    type={showValues ? "text" : "password"}
                    value={field.value}
                    onChange={(e) => updateValue(i, e.target.value)}
                    placeholder=""
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      padding: "8px 10px",
                      color: "#d4d4e8",
                      fontSize: "12px",
                      outline: "none",
                      fontFamily: "monospace",
                      minWidth: 0,
                    }}
                  />
                  <span style={{ padding: "0 10px", color: "#7a7a95", display: "flex", alignItems: "center" }}>
                    <UserLockIcon />
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 16px" }}>
            <button
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "#4a4a8a",
                border: "none",
                borderRadius: "6px",
                padding: "8px 18px",
                color: "#a0a0d0",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#5a5a9a")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#4a4a8a")}
            >
              <KeyIcon />
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
