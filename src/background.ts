// ponytail: minimal SW — content scripts are self-sufficient, SW only exists to avoid "inactive" UI label
chrome.runtime.onInstalled.addListener(() => {
	console.log("[AI Sidebar] SW installed");
});
self.addEventListener("install", () => {
	console.log("[AI Sidebar] SW install");
});
self.addEventListener("activate", () => {
	console.log("[AI Sidebar] SW activate");
});
