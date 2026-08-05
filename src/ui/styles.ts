// UI constants — CSS styles and SVG icons.
// Sprint B: minimal bookmark navigator — narrow, light, always-available.

export const UI_STYLES = /* css */ `
  :host { all: initial; color-scheme: light; }
  * { box-sizing: border-box; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }

  :root {
    --blue: #4d7cff;
    --blue-alpha: rgba(77, 124, 255, 0.08);
    --blue-alpha-strong: rgba(77, 124, 255, 0.14);
    --panel-bg: rgba(255, 255, 255, 0.82);
    --panel-border: rgba(0, 0, 0, 0.06);
    --panel-shadow: 0 2px 12px rgba(0, 0, 0, 0.06), 0 8px 24px rgba(0, 0, 0, 0.04);
    --panel-radius: 10px;
  }

  /* FAB — always visible, right-middle */
  .fab {
    position: fixed;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    width: 36px;
    height: 36px;
    border: 1px solid rgba(0, 0, 0, 0.06);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.88);
    backdrop-filter: blur(10px);
    box-shadow: var(--panel-shadow);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 2147483647;
    transition: transform 0.15s ease, background 0.15s ease, opacity 0.15s ease;
    padding: 0;
    opacity: 0.7;
  }
  .fab:hover { transform: translateY(-50%) scale(1.05); opacity: 1; background: rgba(255, 255, 255, 0.98); }
  .fab:active { transform: translateY(-50%) scale(0.97); }
  .fab svg { width: 16px; height: 16px; color: var(--blue); }

  /* Panel — narrow floating bookmark */
  .panel {
    position: fixed;
    top: auto;
    bottom: 48px;
    right: 14px;
    width: 192px;
    max-height: calc(100vh - 120px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: var(--panel-radius);
    border: 1px solid var(--panel-border);
    background: var(--panel-bg);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow: var(--panel-shadow);
    z-index: 2147483647;
    opacity: 0.82;
    transition: opacity 0.2s ease;
  }
  .panel:hover { opacity: 1; }

  /* Header */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    padding: 7px 8px 6px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.04);
    flex-shrink: 0;
  }

  .panel-title {
    min-width: 0;
    font-size: 10.5px;
    font-weight: 600;
    color: #374151;
    letter-spacing: 0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Ghost close */
  .close-btn {
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #d1d5db;
    padding: 0;
    flex-shrink: 0;
    transition: color 0.12s ease, background 0.12s ease;
  }
  .close-btn:hover { color: #6b7280; background: rgba(0, 0, 0, 0.04); }
  .close-btn svg { width: 11px; height: 11px; }

  /* Search */
  .search-input {
    width: calc(100% - 14px);
    margin: 5px 7px;
    padding: 5px 8px;
    border: 1px solid rgba(0, 0, 0, 0.05);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.6);
    color: #1f2937;
    font-size: 10.5px;
    outline: none;
    transition: border-color 0.12s ease, background 0.12s ease;
    flex-shrink: 0;
  }
  .search-input::placeholder { color: #c4c9d4; }
  .search-input:focus { border-color: var(--blue-alpha-strong); background: rgba(255, 255, 255, 0.88); }

  /* Round list */
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 3px 5px 6px;
  }
  .list::-webkit-scrollbar { width: 5px; }
  .list::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.25); border-radius: 999px; }

  /* Round item — compact mixed outline */
  .item {
    position: relative;
    display: grid;
    grid-template-columns: 18px 1fr;
    grid-template-rows: auto auto;
    column-gap: 6px;
    row-gap: 1px;
    align-items: start;
    width: 100%;
    margin-bottom: 3px;
    padding: 5px 6px;
    border: none;
    border-radius: 7px;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background 0.10s ease;
    color: inherit;
    font: inherit;
  }
  .item:hover { background: rgba(0, 0, 0, 0.03); }
  .item:active { background: rgba(0, 0, 0, 0.05); }

  /* Current item — thin left accent bar */
  .item.current { background: var(--blue-alpha); }
  .item.current::before {
    content: "";
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 0;
    width: 2px;
    border-radius: 999px;
    background: var(--blue);
  }

  /* Round number badge */
  .round-num {
    grid-row: 1 / 3;
    grid-column: 1;
    font-size: 9px;
    font-weight: 600;
    color: #c4c9d4;
    letter-spacing: 0.02em;
    padding-top: 2px;
    white-space: nowrap;
    user-select: none;
  }
  .item.current .round-num { color: var(--blue); }

  /* Main text — user preview or round title */
  .main-text {
    grid-column: 2;
    grid-row: 1;
    font-size: 10.5px;
    font-weight: 500;
    color: #1f2937;
    line-height: 1.35;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
  }

  /* Sub text — assistant preview, muted */
  .sub-text {
    grid-column: 2;
    grid-row: 2;
    font-size: 9.5px;
    color: #9ca3af;
    line-height: 1.30;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
  }

  /* Empty state */
  .empty {
    padding: 14px 6px;
    color: #b0b7c3;
    font-size: 10px;
    text-align: center;
    line-height: 1.5;
  }
`;

export const ICON_MESSAGE_SVG =
	'<svg viewBox="0 0 24 24" fill="none" stroke="hsl(222, 89%, 55%)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

export const ICON_X_SVG =
	'<svg viewBox="0 0 24 24" fill="none" stroke="hsl(0, 0%, 45%)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
