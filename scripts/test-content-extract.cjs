const { JSDOM } = require('jsdom')

const SELECTORS = [
  '[data-message-author-role]',
  '[data-testid*="conversation-turn"]',
  'div[role="article"]',
  'div.ds-message',
  'div[class*="Message_message"]',
  'div[class*="message-bubble"]',
  'div[class*="ChatMessage"]',
  'div[data-message-id]',
  '[data-role="user"], [data-role="assistant"]',
  'article[data-testid]',
  '.chat-message',
  'main [class*="prose"]:not(nav [class*="prose"])',
]

const ROLE_ATTRS = ['data-message-author-role', 'data-author-role', 'data-role']
const ROLE_CLASSES = { user: 'user', assistant: 'assistant', system: 'system', human: 'user', ai: 'assistant', bot: 'assistant' }

function detectRole(el) {
  for (const attr of ROLE_ATTRS) {
    const v = el.getAttribute(attr)
    if (v) return ROLE_CLASSES[v.toLowerCase()] || 'assistant'
  }
  const cls = (el.className && typeof el.className === 'string' ? el.className : '').toLowerCase()
  if (cls.includes('user') || cls.includes('human')) return 'user'
  if (cls.includes('assistant') || cls.includes('ai') || cls.includes('bot')) return 'assistant'
  if (cls.includes('system')) return 'system'

  const roleChild = el.querySelector('.role-label, [class*="role-label"], [class*="author"], [data-role], [class*="role"]')
  if (roleChild) {
    const txt = (roleChild.textContent || '').trim().toLowerCase().slice(0, 20)
    if (ROLE_CLASSES[txt]) return ROLE_CLASSES[txt]
  }

  return 'assistant'
}

function extractText(el) {
  const clone = el.cloneNode(true)
  clone.querySelectorAll('button, [role="button"], nav, [aria-hidden="true"]').forEach((n) => n.remove())
  return (clone.textContent || '').replace(/\s+/g, ' ').trim()
}

function extractMessages(doc) {
  const all = []
  for (const sel of SELECTORS) {
    try {
      doc.querySelectorAll(sel).forEach((el) => {
        if (all.includes(el)) return
        if (el.getAttribute('aria-hidden') === 'true') return
        all.push(el)
      })
    } catch {}
  }
  const messages = []
  let idx = 0
  for (const el of all) {
    const content = extractText(el)
    if (!content || content.length < 1) continue
    const id = el.getAttribute('data-ai-sidebar-id') || 'msg-' + idx + '-' + Math.random().toString(36).slice(2, 8)
    el.setAttribute('data-ai-sidebar-id', id)
    messages.push({ id, role: detectRole(el), content })
    idx++
  }
  return messages
}

const CHATGPT = '<!doctype html><html><body><div id="chat-area">' +
  '<div data-message-author-role="user" class="ds-message"><p>What is GPT-4 vs Claude 3?</p><button class="copy-btn">copy</button></div>' +
  '<div data-message-author-role="assistant" class="ds-message"><p>GPT-4 verbose, Claude concise.</p></div>' +
  '<div data-message-author-role="user" class="ds-message"><p>Show example.</p></div>' +
  '</div></body></html>'

const ARENA_CLASS = '<!doctype html><html><body><div id="chat-area">' +
  '<div data-message-id="m1" class="ChatMessage_root"><div class="role-label">user</div><p>How does DeepSeek R1 compare to o1?</p></div>' +
  '<div data-message-id="m2" class="ChatMessage_root"><div class="role-label">assistant</div><p>R1 scores ~89% MATH-500, o1 ~94%.</p></div>' +
  '<div data-message-id="m3" class="ChatMessage_root"><div class="role-label">user</div><p>Show trace.</p></div>' +
  '</div></body></html>'

const ARENA_ROLE = '<!doctype html><html><body><div id="chat-area">' +
  '<div data-role="user"><p>Capital of France?</p></div>' +
  '<div data-role="assistant"><p>Paris.</p></div>' +
  '<div data-role="user"><p>Germany?</p></div>' +
  '<div data-role="assistant"><p>Berlin.</p></div>' +
  '</div></body></html>'

const EDGE_CASE = '<!doctype html><html><body><div id="chat-area">' +
  '<p>Preamble should NOT match.</p>' +
  '<div data-message-author-role="user"><p>Hello</p><button>like</button></div>' +
  '<div data-message-author-role="assistant"><p>Hi</p><nav><a>Home</a></nav></div>' +
  '<div aria-hidden="true" data-message-author-role="user"><p>hidden UI</p></div>' +
  '</div></body></html>'

function runTest(html, label, opts) {
  const dom = new JSDOM(html)
  const messages = extractMessages(dom.window.document)
  const checks = {
    countNonZero: messages.length > 0,
    idsSet: messages.every((m) => m.id && m.id.length > 0),
    uniqueIds: new Set(messages.map((m) => m.id)).size === messages.length,
  }
  if (opts.expectCount) checks.expectedCount = messages.length === opts.expectCount
  if (opts.expectRole) checks.roleCorrect = messages.every((m, i) => m.role === opts.expectRole[i])
  if (opts.expectNoButtons) checks.noButtons = !messages.some((m) => m.content.includes('like') || m.content.includes('Home'))
  if (opts.expectNoAriaHidden) checks.noAriaHidden = !messages.some((m) => m.content.includes('hidden UI'))
  const passed = Object.values(checks).every(Boolean)
  console.log(JSON.stringify({ label, count: messages.length, passed, checks, samples: messages.slice(0, 2).map((m) => ({ id: m.id, role: m.role, contentPreview: m.content.slice(0, 50) })) }, null, 2))
  return passed
}

const r1 = runTest(CHATGPT, 'ChatGPT-style', { expectCount: 3, expectRole: ['user', 'assistant', 'user'], expectNoButtons: true })
const r2 = runTest(ARENA_CLASS, 'Arena-class', { expectCount: 3, expectRole: ['user', 'assistant', 'user'] })
const r3 = runTest(ARENA_ROLE, 'Arena-data-role', { expectCount: 4, expectRole: ['user', 'assistant', 'user', 'assistant'] })
const r4 = runTest(EDGE_CASE, 'Edge-cases', { expectCount: 2, expectRole: ['user', 'assistant'], expectNoButtons: true, expectNoAriaHidden: true })

console.log('=== SUMMARY ===')
console.log(JSON.stringify({ chatgpt: r1, arenaClass: r2, arenaDataRole: r3, edgeCases: r4, allPassed: r1 && r2 && r3 && r4 }))
process.exit(r1 && r2 && r3 && r4 ? 0 : 1)
