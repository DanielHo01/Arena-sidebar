// Floating action button — renders the FAB, handles drag-to-move, and persists position.
// Public exports:
//   buildFab       — () => HTMLElement
//   saveFabPosition — (x: number, y: number) => void

import { fab, panel } from "../state";
import { storageSet } from "../platform/storage";
import { ICON_MESSAGE_SVG } from "./styles";

let fabDragX = 0;
let fabDragY = 0;

// ─── Position persistence ─────────────────────────────────────────────────────────────

export function saveFabPosition(x: number, y: number) {
	fab.position = { x, y };
	// Fire and forget: a failed write loses only the saved position, and the
	// adapter never rejects, so this cannot break the drag handler.
	void storageSet("fabPosition", fab.position);
}

// ─── FAB builder ─────────────────────────────────────────────────────────────────

export function buildFab(roundCount: number): HTMLElement {
	const btn = document.createElement("button");
	btn.className = "fab";
	if (fab.position) {
		btn.style.right = "auto";
		btn.style.left = fab.position.x + "px";
		btn.style.top = fab.position.y + "px";
		btn.style.transform = "none";
	}
	btn.setAttribute(
		"aria-label",
		"Open message navigator (" + roundCount + " rounds loaded)",
	);
	btn.title = roundCount + " rounds loaded";

	// Inject SVG via insertAdjacentHTML — ICON_MESSAGE_SVG is a hardcoded constant (no XSS risk).
	// pi-lens-ignore: no-innerhtml
	btn.insertAdjacentHTML("beforeend", ICON_MESSAGE_SVG);

	btn.onclick = () => {
		panel.isOpen = true;
	};

	// Drag-to-move: mousemove/mouseup are attached to document so FAB can be dragged outside its bounds.
	btn.addEventListener("mousedown", (e) => {
		if ((e.target as HTMLElement).closest(".fab") !== btn) return;
		e.preventDefault();
		panel.isDragging = true;
		fabDragX = e.clientX;
		fabDragY = e.clientY;
		const move = (me: MouseEvent) => {
			const dx = me.clientX - fabDragX;
			const dy = me.clientY - fabDragY;
			fabDragX = me.clientX;
			fabDragY = me.clientY;
			const r = btn.getBoundingClientRect();
			btn.style.left = r.left + dx + "px";
			btn.style.top = r.top + dy + "px";
			btn.style.right = "auto";
			btn.style.transform = "none";
		};
		const up = () => {
			document.removeEventListener("mousemove", move);
			document.removeEventListener("mouseup", up);
			panel.isDragging = false;
			if (!btn.isConnected) return;
			const r = btn.getBoundingClientRect();
			saveFabPosition(r.left, r.top);
		};
		document.addEventListener("mousemove", move);
		document.addEventListener("mouseup", up);
	});

	return btn;
}
