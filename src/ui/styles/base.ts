// ui/styles/base.ts — design tokens and the FAB / panel shell.
//
// Split out of the single ui/styles.ts in Phase 5 so no one file carries every
// stylesheet at once. ui/styles.ts concatenates the parts; a test asserts the
// concatenation is byte-identical to the pre-split string.

/** Tokens, floating action button, panel shell, header and search field. */
export const PANEL_BASE_CSS = /* css */ `
  /* Sprint 6: Arena-fused design — Arena 12px / oklch blue / glass-md blur / compact items */
  :host { all: initial; color-scheme: light; }
  * { box-sizing: border-box; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }

  /* ── Arena blue — oklch(0.55 0.18 255) → sRGB ≈ #4d7cff ── */
  :root {
    --arena-blue: #4d7cff;
    --arena-blue-alpha: rgba(77, 124, 255, 0.06);
    --arena-blue-alpha-strong: rgba(77, 124, 255, 0.10);
    --arena-bg: rgba(255, 255, 255, 0.88);
    --arena-border: rgba(0, 0, 0, 0.07);
    --arena-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 8px rgba(0, 0, 0, 0.04), 0 12px 24px rgba(0, 0, 0, 0.04);
    --arena-radius: 12px;
    --arena-glass: blur(12px);
  }

  .fab {
    position: fixed;
    right: 16px;
    top: 50%;
    transform: translateY(-50%);
    width: 40px;
    height: 40px;
    border: 1px solid rgba(0, 0, 0, 0.07);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.90);
    backdrop-filter: blur(10px);
    box-shadow: var(--arena-shadow);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 2147483647;
    transition: transform 0.15s ease, background 0.15s ease;
    padding: 0;
  }
  .fab:hover { transform: translateY(-50%) scale(1.04); background: rgba(255, 255, 255, 0.98); }
  .fab:active { transform: translateY(-50%) scale(0.97); }
  .fab svg { width: 18px; height: 18px; color: var(--arena-blue); }

  .panel {
    position: fixed;
    top: 88px;
    bottom: 88px;
    right: 16px;
    width: 256px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: var(--arena-radius);
    border: 1px solid var(--arena-border);
    background: var(--arena-bg);
    backdrop-filter: var(--arena-glass);
    -webkit-backdrop-filter: var(--arena-glass);
    box-shadow: var(--arena-shadow);
    z-index: 2147483647;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 10px 10px 8px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
    flex-shrink: 0;
  }

  .panel-title {
    min-width: 0;
    font-size: 11.5px;
    font-weight: 600;
    color: #111827;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .summary-btn {
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #9ca3af;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    line-height: 1;
    transition: background 0.12s ease, color 0.12s ease;
    padding: 0;
  }
  .summary-btn:hover { background: rgba(0, 0, 0, 0.04); color: #374151; }
  .summary-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  .close-btn {
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #9ca3af;
    padding: 0;
    flex-shrink: 0;
  }
  .close-btn:hover { background: rgba(0, 0, 0, 0.04); color: #374151; }
  .close-btn svg { width: 13px; height: 13px; }

  .search-input {
    width: calc(100% - 16px);
    margin: 6px 8px;
    padding: 7px 9px;
    border: 1px solid rgba(0, 0, 0, 0.06);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.65);
    color: #111827;
    font-size: 11.5px;
    outline: none;
    transition: border-color 0.12s ease, background 0.12s ease;
    flex-shrink: 0;
  }
  .search-input::placeholder { color: #c4c9d4; }
  .search-input:focus { border-color: var(--arena-blue-alpha-strong); background: rgba(255, 255, 255, 0.88); }
`;
