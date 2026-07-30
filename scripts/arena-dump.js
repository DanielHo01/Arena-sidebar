// Arena Page Dump v2 — 健壮版（多重 fallback：剪贴板 → 文件下载 → console）
// 跑法：F12 → Console → 粘贴 → 回车
// 结果：自动下载 arena-dump-xxx.json 到 Downloads，文件名带页面路径

(async function() {
  const SENSITIVE = /key|token|secret|password|auth|cookie|bearer|session/i;
  const trunc = (s, n) => (s || '').length > n ? (s || '').slice(0, n) + '...[+' + ((s || '').length - n) + ']' : (s || '');

  const out = { url: location.href, title: document.title, ts: new Date().toISOString() };

  out.framework = {};
  ['__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__'].forEach(k => {
    if (window[k]) try { out.framework[k] = trunc(typeof window[k] === 'string' ? window[k] : JSON.stringify(window[k]), 30000); } catch(e) {}
  });

  const grabStore = (s) => {
    const o = {};
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i), v = s.getItem(k) || '';
      o[k] = { size: v.length, preview: SENSITIVE.test(k) ? '[REDACTED, size=' + v.length + ']' : trunc(v, 400) };
    }
    return o;
  };
  out.localStorage = grabStore(localStorage);
  out.sessionStorage = grabStore(sessionStorage);
  out.cookies = document.cookie || '[empty]';

  try { out.indexedDB = indexedDB.databases ? (await indexedDB.databases()).map(d => `${d.name} v${d.version}`) : '[unsupported]'; } catch(e) { out.indexedDB = '[err]'; }

  const grabEl = (sel) => {
    const el = document.querySelector(sel); if (!el) return null;
    return { tag: el.tagName, cls: String(el.className || '').slice(0, 200), text: trunc(el.innerText, 1500), html: trunc(el.outerHTML, 4000) };
  };
  out.sidebar  = grabEl('[class*="sidebar" i], aside, nav');
  out.main     = grabEl('main, [class*="main" i], [role="main"]');
  out.header   = grabEl('header');
  out.footer   = grabEl('footer');
  out.inputBox = grabEl('textarea, [contenteditable], [class*="composer" i]');

  out.nav = Array.from(document.querySelectorAll('button, a, [role="button"]')).slice(0, 100).map(el => ({
    tag: el.tagName, text: trunc((el.innerText || '').trim(), 60), href: el.href || null, aria: el.getAttribute('aria-label')
  })).filter(b => b.text || b.aria || b.href);

  out.inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable]')).slice(0, 30).map(el => ({
    tag: el.tagName, type: el.type, placeholder: el.placeholder, aria: el.getAttribute('aria-label')
  }));

  const json = JSON.stringify(out, null, 2);
  console.log('===ARENA_DUMP_START===\n' + json + '\n===ARENA_DUMP_END===');
  console.log('📊 ' + json.length + ' chars');

  let saved = false;
  try { await navigator.clipboard.writeText(json); console.log('✅ [1/3] Clipboard (navigator.clipboard)'); saved = true; } catch(e) {}
  if (!saved) try { copy(json); console.log('✅ [2/3] Clipboard (copy())'); saved = true; } catch(e) {}
  if (!saved) try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = 'arena-dump' + location.pathname.replace(/[^a-z0-9]/gi, '_') + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    console.log('✅ [3/3] Downloaded: ' + a.download);
    saved = true;
  } catch(e) {}
  if (!saved) console.log('❌ All failed — 手动复制 ===ARENA_DUMP_START=== 和 ===之间=== 的内容');
})();