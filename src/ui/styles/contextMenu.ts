export const CONTEXT_MENU_CSS = `
	.ai-sidebar-ctx {
		position: fixed;
		z-index: 999999;
		min-width: 196px;
		background: rgba(255,255,255,0.98);
		border: 1px solid rgba(0,0,0,0.10);
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0,0,0,0.14);
		padding: 4px 0;
		font-family: Inter,system-ui,sans-serif;
		font-size: 13px;
		color: #374151;
		user-select: none;
	}
	.ai-sidebar-ctx-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		cursor: pointer;
		border-radius: 4px;
		margin: 0 4px;
	}
	.ai-sidebar-ctx-item:hover { background: rgba(0,0,0,0.05); }
	.ai-sidebar-ctx-sep {
		height: 1px;
		background: rgba(0,0,0,0.06);
		margin: 4px 8px;
	}
	.ai-sidebar-ctx-sub {
		display: none;
		position: absolute;
		left: 100%;
		top: 0;
		min-width: 160px;
		background: rgba(255,255,255,0.98);
		border: 1px solid rgba(0,0,0,0.10);
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0,0,0,0.14);
		padding: 4px 0;
	}
	.ai-sidebar-ctx-sub-item {
		display: flex;
		align-items: center;
		padding: 6px 12px;
		cursor: pointer;
		border-radius: 4px;
		margin: 0 4px;
	}
	.ai-sidebar-ctx-sub-item:hover { background: rgba(0,0,0,0.05); }
	.ai-sidebar-ctx-sub-item.active { color: #4d7cff; font-weight: 500; }
	.ai-sidebar-ctx-trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}
	.ai-sidebar-ctx-arrow { font-size: 10px; opacity: 0.5; }
`;
