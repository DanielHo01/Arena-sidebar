(() => {
  try { document.documentElement.dataset.aiSideHookReady = '1'; } catch(e) {}

  const isChatUrl = (u) => typeof u === 'string' && (
    u.indexOf('/nextjs-api/stream/create-evaluation') >= 0 ||
    /\/nextjs-api\/stream\/post-to-evaluation\/[^/?]+/.test(u)
  );

  const writeRequest = (urlStr, init) => {
    try {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      if (!body || typeof body !== 'object') return;
      const m = urlStr.match(/\/post-to-evaluation\/([^/?]+)/);
      const sessionId = m ? m[1] : (body.id || '');
      const req = {
        kind: 'chat-request',
        url: urlStr,
        sessionId,
        mode: body.mode || '',
        modality: body.modality || '',
        modelAId: body.modelAId || '',
        modelBId: body.modelBId || '',
        userMessageId: body.userMessageId || '',
        content: body.userMessage && body.userMessage.content || '',
        attachmentCount: body.userMessage && Array.isArray(body.userMessage.experimental_attachments)
          ? body.userMessage.experimental_attachments.length : 0,
        ts: Date.now(),
      };
      document.documentElement.dataset.aiSideResponse = '';
      document.documentElement.dataset.aiSideRequest = JSON.stringify(req);
    } catch {}
  };

  const parseSseLine = (line, state, flush) => {
    if (!line || line.length < 3) return;
    const who = line.charCodeAt(0); // 'a' or 'b'
    const tag = line.charAt(1);
    const payload = line.slice(3);
    let model = null, event = null;
    if (who === 97) model = state.a;       // 'a'
    else if (who === 98) model = state.b;  // 'b'
    else return;
    if (tag === '0') event = 'text';
    else if (tag === 'g') event = 'reasoning';
    else if (tag === 'd') event = 'done';
    else if (tag === '2') event = 'image';
    else if (tag === '3') event = 'error';
    if (!model || !event) return;
    let data;
    try { data = JSON.parse(payload); } catch { return; }
    if (event === 'text' && typeof data === 'string') {
      model.text += data;
      flush();
    } else if (event === 'reasoning' && typeof data === 'string') {
      model.reasoning += data;
      flush();
    } else if (event === 'done') {
      model.finished = true;
      flush();
    } else if (event === 'error') {
      model.error = String(data);
      flush();
    }
  };

  const wrapStreamResponse = (response) => {
    if (!response || !response.body) return response;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const state = {
      a: { text: '', reasoning: '', finished: false, error: '' },
      b: { text: '', reasoning: '', finished: false, error: '' },
    };
    const flush = () => {
      try {
        document.documentElement.dataset.aiSideResponse = JSON.stringify({
          kind: 'chat-response',
          aText: state.a.text,
          aReasoning: state.a.reasoning,
          aFinished: state.a.finished,
          aError: state.a.error,
          bText: state.b.text,
          bReasoning: state.b.reasoning,
          bFinished: state.b.finished,
          bError: state.b.error,
          ts: Date.now(),
        });
      } catch {}
    };
    const wrapped = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.trim()) parseSseLine(buffer.trim(), state, flush);
            controller.close();
            flush();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.trim()) parseSseLine(line.trim(), state, flush);
          }
          controller.enqueue(value);
        } catch (e) {
          controller.error(e);
        }
      },
      cancel(reason) { reader.cancel(reason); },
    });
    return new Response(wrapped, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  const origFetch = window.fetch;
  window.fetch = async function(url, init) {
    const urlStr = typeof url === 'string' ? url : (url && url.url) || '';
    const chat = isChatUrl(urlStr);
    if (chat && init && init.body) writeRequest(urlStr, init);
    const response = await origFetch.call(window, url, init);
    if (chat) return wrapStreamResponse(response);
    return response;
  };

  const _WS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const ws = protocols ? new _WS(url, protocols) : new _WS(url);
    try {
      const u = typeof url === 'string' ? url : (url ? '' + url : 'unknown');
      document.documentElement.dataset.aiSideWsCreated = u.substring(0, 200);
    } catch(e) {}
    if (typeof url === 'string' && url.indexOf('pusher') >= 0) {
      ws.addEventListener('message', function(ev) {
        try {
          const d = JSON.parse(ev.data);
          if (d.event && d.event.indexOf('pusher:') !== 0 && d.event.indexOf('pusher_internal:') !== 0) {
            document.documentElement.dataset.aiSideWs = JSON.stringify({
              event: d.event, channel: d.channel || '', data: d.data, ts: Date.now()
            });
          }
        } catch(e) {}
      });
    }
    return ws;
  };
  window.WebSocket.prototype = _WS.prototype;
  window.WebSocket.CONNECTING = 0;
  window.WebSocket.OPEN = 1;
  window.WebSocket.CLOSING = 2;
  window.WebSocket.CLOSED = 3;
})();