// Round grouping logic test — simulates the full extraction → role assignment → grouping flow
// Verifies that 60 alternating messages produce 30 rounds (the expected outcome in arena.ai Direct chat)

function generateAlternating(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: 'msg-' + i,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: i % 2 === 0 ? 'User prompt ' + i : 'Assistant reply ' + i
  }))
}

function groupIntoRounds(messages) {
  const rounds = []
  let current = null
  messages.forEach((msg) => {
    if (msg.role === 'user' && current !== null) {
      rounds.push(current)
      current = null
    }
    if (current === null) {
      current = {
        id: msg.id,
        title: msg.role === 'user' ? msg.content.slice(0, 80) : '(no prompt)',
        messageCount: 0,
      }
    }
    current.messageCount++
  })
  if (current) rounds.push(current)
  return rounds
}

const tests = []

function runTest(label, expected, actual, opts = {}) {
  const passed = expected === actual
  tests.push({ label, expected, actual, passed, ...opts })
}

const msgs60 = generateAlternating(60)
const rounds60 = groupIntoRounds(msgs60)
runTest('60 alternating messages → 30 rounds', 30, rounds60.length, {
  sample: rounds60.slice(0, 3).map(r => ({ id: r.id, title: r.title.slice(0, 40), msgCount: r.messageCount }))
})

const msgs1 = generateAlternating(1)
const rounds1 = groupIntoRounds(msgs1)
runTest('1 message → 1 round', 1, rounds1.length, {
  sample: rounds1
})

const msgs0 = []
const rounds0 = groupIntoRounds(msgs0)
runTest('0 messages → 0 rounds', 0, rounds0.length)

const allAssistant = Array.from({ length: 60 }, (_, i) => ({
  id: 'a-' + i, role: 'assistant', content: 'reply ' + i
}))
const roundsAllAssistant = groupIntoRounds(allAssistant)
runTest('60 all-assistant → 1 round (the bug scenario)', 1, roundsAllAssistant.length, {
  sample: { title: roundsAllAssistant[0].title, msgCount: roundsAllAssistant[0].messageCount }
})

const msgs3 = generateAlternating(3)
const rounds3 = groupIntoRounds(msgs3)
runTest('3 messages (user/assistant/user) → 2 rounds', 2, rounds3.length, {
  detail: rounds3.map(r => ({ msgCount: r.messageCount, title: r.title }))
})

const allUser = Array.from({ length: 60 }, (_, i) => ({
  id: 'u-' + i, role: 'user', content: 'prompt ' + i
}))
const roundsAllUser = groupIntoRounds(allUser)
runTest('60 all-user → 60 rounds (each user message = own round)', 60, roundsAllUser.length)

console.log(JSON.stringify(tests.map(t => ({
  label: t.label,
  expected: t.expected,
  actual: t.actual,
  passed: t.passed,
  ...(t.sample ? { sample: t.sample } : {}),
  ...(t.detail ? { detail: t.detail } : {})
})), null, 2))

const allPassed = tests.every(t => t.passed)
console.log('=== SUMMARY ===')
console.log(JSON.stringify({
  total: tests.length,
  passed: tests.filter(t => t.passed).length,
  allPassed
}))
process.exit(allPassed ? 0 : 1)
