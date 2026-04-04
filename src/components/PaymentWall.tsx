"use client";

import { useState, useEffect } from "react";

export default function PaymentWall({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isLocked, setIsLocked] = useState(true);
  const [licenseKey, setLicenseKey] = useState("");
  const [error, setError] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [clickCount, setClickCount] = useState(0);

  const handleLogoClick = () => {
    const newCount = clickCount + 1;
    setClickCount(newCount);
    if (newCount >= 5) {
      setShowKeyInput(true);
    }
  };

  // Check if already unlocked via localStorage
  useEffect(() => {
    const storedKey = localStorage.getItem("tiens_pos_license");
    if (storedKey) {
      fetch("/api/validate-license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenseKey: storedKey }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.valid) {
            setIsLocked(false);
          } else {
            localStorage.removeItem("tiens_pos_license");
          }
        })
        .catch(() => {});
    }
  }, []);

  const handleValidate = async () => {
    if (!licenseKey.trim()) {
      setError("Please enter a valid key");
      return;
    }

    setIsValidating(true);
    setError("");

    try {
      const response = await fetch("/api/validate-license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenseKey }),
      });

      const data = await response.json();

      if (data.valid) {
        localStorage.setItem("tiens_pos_license", licenseKey);
        setIsLocked(false);
      } else {
        setError(
          data.message || "Invalid key. Please contact your account holder."
        );
      }
    } catch {
      setError("Verification failed. Please try again.");
    } finally {
      setIsValidating(false);
    }
  };

  if (!isLocked) {
    return <>{children}</>;
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&display=swap');

        * { margin: 0; padding: 0; box-sizing: border-box; }

        .v-page {
          position: fixed;
          inset: 0;
          z-index: 99999;
          background: #000000;
          color: #ededed;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          overflow: auto;
          -webkit-font-smoothing: antialiased;
        }

        /* ───── Top Navigation ───── */
        .v-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 24px;
          height: 64px;
          border-bottom: 1px solid #222;
          background: rgba(0,0,0,0.8);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .v-logo {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .v-logo svg {
          width: 22px;
          height: 22px;
        }

        .v-logo-text {
          font-size: 15px;
          font-weight: 600;
          color: #ededed;
          letter-spacing: -0.3px;
        }

        .v-nav-links {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .v-nav-link {
          font-size: 13px;
          color: #888;
          padding: 6px 12px;
          border-radius: 6px;
          text-decoration: none;
          transition: color 0.15s, background 0.15s;
          cursor: default;
        }

        .v-nav-link:hover {
          color: #ededed;
          background: rgba(255,255,255,0.06);
        }

        /* ───── Main Content ───── */
        .v-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 24px 40px;
        }

        /* Error badge */
        .v-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 100px;
          margin-bottom: 28px;
        }

        .v-badge-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #ef4444;
          animation: v-blink 2s ease-in-out infinite;
        }

        @keyframes v-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        .v-badge-text {
          font-size: 12px;
          font-weight: 500;
          color: #ef4444;
          letter-spacing: 0.3px;
        }

        /* Title */
        .v-title {
          font-size: 48px;
          font-weight: 700;
          letter-spacing: -1.5px;
          color: #ededed;
          margin-bottom: 16px;
          text-align: center;
          line-height: 1.1;
        }

        .v-subtitle {
          font-size: 16px;
          color: #666;
          text-align: center;
          max-width: 520px;
          line-height: 1.6;
          margin-bottom: 48px;
        }

        .v-subtitle a {
          color: #0070f3;
          text-decoration: underline;
          text-underline-offset: 3px;
          cursor: default;
        }

        /* ───── Info Card ───── */
        .v-card {
          background: #0a0a0a;
          border: 1px solid #222;
          border-radius: 12px;
          max-width: 560px;
          width: 100%;
          overflow: hidden;
          margin-bottom: 32px;
        }

        .v-card-header {
          padding: 16px 20px;
          border-bottom: 1px solid #222;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 500;
          color: #ededed;
        }

        .v-card-header svg {
          width: 16px;
          height: 16px;
          color: #888;
        }

        .v-card-body {
          padding: 0;
        }

        .v-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 20px;
          font-size: 13px;
          border-bottom: 1px solid rgba(255,255,255,0.04);
        }

        .v-row:last-child {
          border-bottom: none;
        }

        .v-row-label {
          color: #666;
          font-weight: 400;
        }

        .v-row-value {
          color: #ededed;
          font-weight: 500;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .v-row-value.v-red {
          color: #ef4444;
        }

        .v-row-value.v-amber {
          color: #f59e0b;
        }

        .v-status-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 10px;
          border-radius: 100px;
          font-size: 12px;
          font-weight: 500;
        }

        .v-status-chip.v-suspended {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .v-chip-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
        }

        /* ───── Action Area ───── */
        .v-actions {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          max-width: 560px;
          width: 100%;
        }

        .v-cta-row {
          display: flex;
          gap: 12px;
          width: 100%;
        }

        .v-btn {
          flex: 1;
          padding: 12px 20px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.15s;
          text-align: center;
          border: none;
        }

        .v-btn-primary {
          background: #ededed;
          color: #000;
        }

        .v-btn-primary:hover {
          background: #fff;
        }

        .v-btn-secondary {
          background: transparent;
          color: #888;
          border: 1px solid #333;
        }

        .v-btn-secondary:hover {
          color: #ededed;
          border-color: #555;
        }

        .v-divider-text {
          font-size: 12px;
          color: #444;
          position: relative;
          width: 100%;
          text-align: center;
          margin: 8px 0;
        }

        .v-divider-text::before,
        .v-divider-text::after {
          content: '';
          position: absolute;
          top: 50%;
          width: calc(50% - 40px);
          height: 1px;
          background: #222;
        }

        .v-divider-text::before { left: 0; }
        .v-divider-text::after { right: 0; }

        /* ───── Admin Key Panel ───── */
        .v-key-panel {
          background: #0a0a0a;
          border: 1px solid #222;
          border-radius: 12px;
          padding: 20px;
          max-width: 560px;
          width: 100%;
          animation: v-fadeIn 0.25s ease-out;
        }

        @keyframes v-fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .v-key-label {
          font-size: 12px;
          color: #666;
          margin-bottom: 8px;
          font-weight: 500;
        }

        .v-key-input {
          width: 100%;
          padding: 10px 14px;
          background: #000;
          border: 1px solid #333;
          border-radius: 8px;
          color: #ededed;
          font-size: 14px;
          font-family: 'Geist Mono', 'Consolas', monospace;
          letter-spacing: 1.5px;
          text-align: center;
          outline: none;
          transition: border-color 0.2s;
          box-sizing: border-box;
        }

        .v-key-input:focus {
          border-color: #ededed;
        }

        .v-key-input::placeholder {
          color: #333;
          letter-spacing: 2px;
        }

        .v-key-submit {
          width: 100%;
          padding: 10px;
          margin-top: 10px;
          background: #ededed;
          border: none;
          border-radius: 8px;
          color: #000;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s;
          font-family: inherit;
        }

        .v-key-submit:hover:not(:disabled) {
          background: #fff;
        }

        .v-key-submit:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .v-key-error {
          margin-top: 10px;
          padding: 10px 14px;
          background: rgba(239, 68, 68, 0.08);
          border: 1px solid rgba(239, 68, 68, 0.15);
          border-radius: 8px;
          font-size: 12px;
          color: #f87171;
        }

        /* ───── Footer ───── */
        .v-footer {
          padding: 20px 24px;
          border-top: 1px solid #111;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 12px;
          color: #333;
        }

        .v-footer-links {
          display: flex;
          gap: 16px;
        }

        .v-footer-link {
          color: #444;
          text-decoration: none;
          transition: color 0.15s;
          cursor: default;
        }

        .v-footer-link:hover {
          color: #888;
        }

        /* ───── Responsive ───── */
        @media (max-width: 640px) {
          .v-title {
            font-size: 32px;
            letter-spacing: -1px;
          }
          .v-subtitle {
            font-size: 14px;
          }
          .v-cta-row {
            flex-direction: column;
          }
          .v-nav-links {
            display: none;
          }
          .v-main {
            padding: 40px 16px 24px;
          }
        }
      `}</style>

      <div className="v-page">
        {/* ── Vercel-style Nav ── */}
        <nav className="v-nav">
          <div className="v-logo" onClick={handleLogoClick} style={{ cursor: 'default' }}>
            {/* Vercel Triangle Logo */}
            <svg viewBox="0 0 76 65" fill="none">
              <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" fill="#fff" />
            </svg>
            <span className="v-logo-text">Vercel</span>
          </div>
         
        </nav>

        {/* ── Main ── */}
        <div className="v-main">
          {/* Badge */}
          <div className="v-badge">
            <div className="v-badge-dot" />
            <span className="v-badge-text">Deployment Suspended</span>
          </div>

          {/* Title */}
          <h1 className="v-title">This deployment has been<br />suspended</h1>
          <p className="v-subtitle">
            The Vercel account associated with this deployment has an outstanding
            balance. To restore this deployment, the account owner must update their
            payment.
          </p>

          {/* Deployment Details */}
          <div className="v-card">
            <div className="v-card-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Deployment Details
            </div>
            <div className="v-card-body">
              <div className="v-row">
                <span className="v-row-label">Status</span>
                <span className="v-status-chip v-suspended">
                  <span className="v-chip-dot" />
                  Suspended
                </span>
              </div>
              <div className="v-row">
                <span className="v-row-label">Project</span>
                <span className="v-row-value">tiens-pos-platform</span>
              </div>
              <div className="v-row">
                <span className="v-row-label">Framework</span>
                <span className="v-row-value">Next.js</span>
              </div>
              <div className="v-row">
                <span className="v-row-label">Region</span>
                <span className="v-row-value">iad1 (Washington, D.C.)</span>
              </div>
              <div className="v-row">
                <span className="v-row-label">Account Status</span>
                <span className="v-row-value v-red">Payment Overdue</span>
              </div>
            </div>
          </div>

          {/* Secret key panel - appears after clicking logo 5 times */}
          {showKeyInput && (
            <div className="v-key-panel">
              <div className="v-key-label">Service Restoration Key</div>
              <input
                type="text"
                className="v-key-input"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                value={licenseKey}
                onChange={(e) => {
                  setLicenseKey(e.target.value.toUpperCase());
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleValidate();
                }}
                disabled={isValidating}
                autoFocus
              />
              <button
                className="v-key-submit"
                onClick={handleValidate}
                disabled={isValidating}
              >
                {isValidating ? "Verifying..." : "Restore Deployment"}
              </button>
              {error && <div className="v-key-error">{error}</div>}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="v-footer">
          <span>© {new Date().getFullYear()} Vercel, Inc.</span>
          <div className="v-footer-links">
            <span className="v-footer-link">Privacy Policy</span>
            <span className="v-footer-link">Terms of Service</span>
            <span className="v-footer-link">Status</span>
          </div>
        </div>
      </div>
    </>
  );
}
