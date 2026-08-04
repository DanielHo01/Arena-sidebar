// UI constants — CSS styles and SVG icons.
// All UI modules import from here so style tweaks only need to change one file.

export const UI_STYLES = /* css */ `
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

  .list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 6px 8px; }
  .list::-webkit-scrollbar { width: 6px; }
  .list::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.30); border-radius: 999px; }

  .item {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    margin-bottom: 4px;
    padding: 7px 8px;
    border: none;
    border-radius: 10px;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s ease;
    color: inherit;
    font: inherit;
  }
  .item:hover { background: rgba(0, 0, 0, 0.03); }
  .item:active { background: rgba(0, 0, 0, 0.05); }

  .item.current {
    background: var(--arena-blue-alpha);
  }
  .item.current::after {
    content: "";
    position: absolute;
    top: 6px;
    bottom: 6px;
    right: 0;
    width: 2px;
    border-radius: 999px;
    background: var(--arena-blue);
  }

  .item-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    min-width: 0;
  }

  .item-meta-label {
    min-width: 0;
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: 0.03em;
    color: #b0b7c3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-actions { display: none; align-items: center; gap: 1px; flex-shrink: 0; }
  .item:hover .item-actions { display: inline-flex; }

  .item-action {
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: #9ca3af;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    line-height: 1;
    padding: 0;
    transition: background 0.10s ease, color 0.10s ease;
  }
  .item-action:hover { background: rgba(0, 0, 0, 0.06); color: #374151; }

  .item-title {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 11px;
    line-height: 1.40;
    color: #1f2937;
    word-break: break-word;
  }

  /* Sprint 8: assistant preview row — lighter secondary text */
  .item-assistant-preview {
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 10.5px;
    line-height: 1.35;
    color: #8b95a7;
    margin-top: 2px;
    word-break: break-word;
  }

  .empty {
    padding: 16px 8px;
    color: #b0b7c3;
    font-size: 11px;
    text-align: center;
  }

  .summary-modal {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(15, 23, 42, 0.40);
    backdrop-filter: blur(6px);
  }

  .summary-box {
    width: min(1100px, 92vw);
    height: min(88vh, 920px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border-radius: var(--arena-radius);
    background: rgba(255, 255, 255, 0.96);
    border: 1px solid rgba(0, 0, 0, 0.07);
    box-shadow: 0 20px 48px rgba(15, 23, 42, 0.20);
  }

  .summary-title { font-size: 13.5px; font-weight: 600; color: #111827; }

  .summary-actions { display: flex; gap: 8px; flex-wrap: wrap; }

  .summary-actions button {
    border: 1px solid rgba(0, 0, 0, 0.07);
    background: rgba(248, 250, 252, 0.96);
    color: #374151;
    border-radius: 8px;
    padding: 6px 11px;
    font-size: 11.5px;
    cursor: pointer;
  }
  .summary-actions button:hover { background: rgba(241, 245, 249, 1); }
  .summary-actions button.primary {
    background: var(--arena-blue);
    border-color: var(--arena-blue);
    color: white;
  }
  .summary-actions button.primary:hover { opacity: 0.90; }

  .summary-text {
    flex: 1;
    min-height: 0;
    width: 100%;
    resize: none;
    border-radius: 8px;
    border: 1px solid rgba(0, 0, 0, 0.06);
    background: white;
    color: #111827;
    padding: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.50;
    outline: none;
  }

`;

export const ICON_MESSAGE_SVG =
	'<svg viewBox="0 0 24 24" fill="none" stroke="hsl(222, 89%, 55%)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

export const ICON_X_SVG =
	'<svg viewBox="0 0 24 24" fill="none" stroke="hsl(0, 0%, 45%)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
