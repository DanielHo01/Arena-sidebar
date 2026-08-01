(() => {
	// 固定原生引用
	const _origFetch = window.fetch.bind(window);

	// 判断 RSC URL（只旁路观察，不主动请求）
	const isRscUrl = (u) => typeof u === "string" && /\/agent\?_rsc=/.test(u);

	// 发出 CustomEvent
	const emitRsc = (payload) => {
		try {
			document.documentElement.dispatchEvent(
				new CustomEvent("__aiSidebarRsc", {
					detail: JSON.stringify(payload),
				}),
			);
		} catch {}
	};

	// 每个请求独立的读取分支（局部 buffer，不串流）
	async function readRscBranch(stream, url, status) {
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		let text = "";

		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				if (value) {
					text += decoder.decode(value, { stream: true });
					if (text.length >= 500000) break; // 调试截断
				}
			}
			text += decoder.decode(); // 收尾
			if (text.length > 100) {
				emitRsc({
					url: url.slice(0, 500),
					status,
					ts: Date.now(),
					body: text,
				});
			}
		} catch (e) {
			emitRsc({
				url: url.slice(0, 500),
				status,
				ts: Date.now(),
				error: String(e),
				body: text.slice(0, 500000),
			});
		}
	}

	// fetch 拦截：用 tee() 分叉，旁路观察 RSC 流
	window.fetch = async function (url, init) {
		const urlStr = typeof url === "string" ? url : (url && url.url) || "";
		const response = await _origFetch(url, init);

		if (isRscUrl(urlStr) && response.body) {
			try {
				const [forPage, forTap] = response.body.tee();
				void readRscBranch(forTap, urlStr, response.status);
				return new Response(forPage, {
					status: response.status,
					statusText: response.statusText,
					headers: new Headers(response.headers),
				});
			} catch {
				return response;
			}
		}
		return response;
	};

	document.documentElement.dataset.aiSideHookReady = "1";
})();
