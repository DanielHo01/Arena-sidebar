// ui/styles/base.ts — design tokens and the FAB / panel shell.
//
// Split out of the single ui/styles.ts in Phase 5 so no one file carries every
// stylesheet at once. ui/styles.ts concatenates the parts; a test asserts the
// concatenation covers every surface.
//
// ── Why the tokens are on :host and not :root ──────────────────────────────
// This stylesheet is injected INSIDE a closed shadow root (panel/skeleton's
// ensureStyles). In shadow DOM, :root matches nothing — it is the document
// root, not the host. The token block used to live on :root, so every token
// was inert and every fallback-less usage died with it: `.fab` lost its
// box-shadow AND `.panel` its background (invalid-at-computed-value-time →
// transparent). That is issue #8 ("FAB 浮动按钮图标看不见") — a white
// semi-transparent, shadowless button on a white page is genuinely invisible.
// Tokens now hang off :host (the correct hook, and the only one a dark-mode
// attribute override can key off), and EVERY var() usage carries a light-mode
// fallback so a missing token can never again silently delete a style.
//
// ── Dark mode (#9) ────────────────────────────────────────────────────────
// features/theme.ts resolves the effective theme (page class="dark" /
// data-theme / OS) and mirrors it onto the host as data-ai-sidebar-theme;
// the :host([data-…="dark"]) block below flips every token at once. The
// per-component stylesheets (list.ts) only ever reference var(--arena-*),
// so they pick dark up for free.

/** Tokens, floating action button, panel shell, header and search field. */
export const PANEL_BASE_CSS = /* css */ `
  /* Sprint 6: Arena-fused design — Arena 12px / oklch blue / glass-md blur / compact items */
  :host {
    all: initial;
    color-scheme: light;

    /* ── Arena blue — oklch(0.55 0.18 255) → sRGB ≈ #4d7cff ── */
    --arena-blue: #4d7cff;
    --arena-blue-alpha: rgba(77, 124, 255, 0.06);
    --arena-blue-alpha-strong: rgba(77, 124, 255, 0.10);
    --arena-bg: rgba(255, 255, 255, 0.88);
    --arena-border: rgba(0, 0, 0, 0.07);
    --arena-header-border: rgba(0, 0, 0, 0.05);
    --arena-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 8px rgba(0, 0, 0, 0.04), 0 12px 24px rgba(0, 0, 0, 0.04);
    --arena-radius: 12px;
    --arena-glass: blur(12px);

    /* Text ramp and surfaces — the values list.ts / modals used to hard-code */
    --arena-fg-strong: #111827;
    --arena-fg: #374151;
    --arena-fg-muted: #9ca3af;
    --arena-fg-faint: #b0b7c3;
    --arena-fg-dim: #8b95a7;
    --arena-placeholder: #c4c9d4;
    --arena-hover-faint: rgba(0, 0, 0, 0.03);
    --arena-hover: rgba(0, 0, 0, 0.04);
    --arena-hover-strong: rgba(0, 0, 0, 0.06);
    --arena-active: rgba(0, 0, 0, 0.05);
    --arena-bg-input: rgba(255, 255, 255, 0.65);
    --arena-bg-input-focus: rgba(255, 255, 255, 0.88);
    --arena-input-border: rgba(0, 0, 0, 0.06);
    --arena-btn-surface: rgba(248, 250, 252, 0.96);
    --arena-btn-surface-hover: rgba(241, 245, 249, 1);
    --arena-modal-bg: rgba(255, 255, 255, 0.96);
    --arena-modal-scrim: rgba(15, 23, 42, 0.40);
    --arena-scrollbar: rgba(156, 163, 175, 0.30);

    /* #8: the FAB is the one surface that must never be see-through — a
       drag handle over arbitrary page content needs its own opaque plate. */
    --arena-fab-bg: #ffffff;
    --arena-fab-bg-hover: #ffffff;
    --arena-fab-border: rgba(0, 0, 0, 0.14);
  }

  :host([data-ai-sidebar-theme="dark"]) {
    color-scheme: dark;

    --arena-blue: #6c92ff;
    --arena-blue-alpha: rgba(108, 146, 255, 0.10);
    --arena-blue-alpha-strong: rgba(108, 146, 255, 0.16);
    --arena-bg: rgba(17, 24, 39, 0.90);
    --arena-border: rgba(255, 255, 255, 0.14);
    --arena-header-border: rgba(255, 255, 255, 0.08);
    --arena-shadow: 0 1px 2px rgba(0, 0, 0, 0.30), 0 4px 8px rgba(0, 0, 0, 0.28), 0 12px 24px rgba(0, 0, 0, 0.26);

    --arena-fg-strong: #f3f4f6;
    --arena-fg: #d1d5db;
    --arena-fg-muted: #9ca3af;
    --arena-fg-faint: #6b7280;
    --arena-fg-dim: #8b95a7;
    --arena-placeholder: #6b7280;
    --arena-hover-faint: rgba(255, 255, 255, 0.05);
    --arena-hover: rgba(255, 255, 255, 0.08);
    --arena-hover-strong: rgba(255, 255, 255, 0.12);
    --arena-active: rgba(255, 255, 255, 0.10);
    --arena-bg-input: rgba(255, 255, 255, 0.06);
    --arena-bg-input-focus: rgba(255, 255, 255, 0.10);
    --arena-input-border: rgba(255, 255, 255, 0.12);
    --arena-btn-surface: rgba(255, 255, 255, 0.06);
    --arena-btn-surface-hover: rgba(255, 255, 255, 0.12);
    --arena-modal-bg: rgba(17, 24, 39, 0.97);
    --arena-modal-scrim: rgba(0, 0, 0, 0.60);
    --arena-scrollbar: rgba(156, 163, 175, 0.35);

    --arena-fab-bg: rgba(17, 24, 39, 0.98);
    --arena-fab-bg-hover: rgba(30, 41, 59, 0.98);
    --arena-fab-border: rgba(255, 255, 255, 0.24);
  }

  * { box-sizing: border-box; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }

  .fab {
    position: fixed;
    right: 16px;
    top: 50%;
    transform: translateY(-50%);
    width: 40px;
    height: 40px;
    border: 1px solid var(--arena-fab-border, rgba(0, 0, 0, 0.14));
    border-radius: 999px;
    background: var(--arena-fab-bg, #ffffff);
    backdrop-filter: blur(10px);
    box-shadow: var(--arena-shadow, 0 4px 12px rgba(15, 23, 42, 0.24));
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 2147483647;
    transition: transform 0.15s ease, background 0.15s ease;
    padding: 0;
  }
  .fab:hover { transform: translateY(-50%) scale(1.04); background: var(--arena-fab-bg-hover, #ffffff); }
  .fab:active { transform: translateY(-50%) scale(0.97); }
  .fab svg { width: 18px; height: 18px; color: var(--arena-blue, #4d7cff); }

  .panel {
    position: fixed;
    top: 88px;
    bottom: 88px;
    right: 16px;
    width: 256px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: var(--arena-radius, 12px);
    border: 1px solid var(--arena-border, rgba(0, 0, 0, 0.07));
    background: var(--arena-bg, rgba(255, 255, 255, 0.88));
    backdrop-filter: var(--arena-glass, blur(12px));
    -webkit-backdrop-filter: var(--arena-glass, blur(12px));
    box-shadow: var(--arena-shadow, 0 4px 12px rgba(15, 23, 42, 0.24));
    z-index: 2147483647;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 10px 10px 8px;
    border-bottom: 1px solid var(--arena-header-border, rgba(0, 0, 0, 0.05));
    flex-shrink: 0;
  }

  .panel-title {
    min-width: 0;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--arena-fg-strong, #111827);
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
    color: var(--arena-fg-muted, #9ca3af);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    line-height: 1;
    transition: background 0.12s ease, color 0.12s ease;
    padding: 0;
  }
  .summary-btn:hover { background: var(--arena-hover, rgba(0, 0, 0, 0.04)); color: var(--arena-fg, #374151); }
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
    color: var(--arena-fg-muted, #9ca3af);
    padding: 0;
    flex-shrink: 0;
  }
  .close-btn:hover { background: var(--arena-hover, rgba(0, 0, 0, 0.04)); color: var(--arena-fg, #374151); }
  .close-btn svg { width: 13px; height: 13px; }

  .search-input {
    width: calc(100% - 16px);
    margin: 6px 8px;
    padding: 7px 9px;
    border: 1px solid var(--arena-input-border, rgba(0, 0, 0, 0.06));
    border-radius: 8px;
    background: var(--arena-bg-input, rgba(255, 255, 255, 0.65));
    color: var(--arena-fg-strong, #111827);
    font-size: 11.5px;
    outline: none;
    transition: border-color 0.12s ease, background 0.12s ease;
    flex-shrink: 0;
  }
  .search-input::placeholder { color: var(--arena-placeholder, #c4c9d4); }
  .search-input:focus { border-color: var(--arena-blue-alpha-strong, rgba(77, 124, 255, 0.10)); background: var(--arena-bg-input-focus, rgba(255, 255, 255, 0.88)); }
`;
