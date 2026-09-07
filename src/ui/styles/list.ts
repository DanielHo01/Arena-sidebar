// ui/styles/list.ts — the round list: rows, metadata, hover actions, previews.

/** .list / .item / .item-meta / .item-actions / preview rows. */
export const PANEL_LIST_CSS = /* css */ `
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
