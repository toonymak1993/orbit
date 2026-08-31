const { resolve } = require('node:path')
const { app, utilityProcess } = require('electron')

const expectedVersion = '1.10.18687'
const workerPath = resolve(__dirname, '..', 'out', 'main', 'discordSocialWorker.js')
const sdkPath = resolve(
  process.cwd(),
  'resources',
  'discord-social-sdk',
  'win32-x64',
  'discord_partner_sdk.dll'
)

let finished = false
const fail = (message) => {
  if (finished) return
  finished = true
  console.error(message)
  app.exit(1)
}

app.whenReady().then(() => {
  const child = utilityProcess.fork(workerPath, [sdkPath, String(process.pid)], {
    serviceName: 'ORBIT Discord Social Verification',
    stdio: 'pipe'
  })
  const timer = setTimeout(() => fail('Discord utility worker verification timed out'), 15_000)
  let ready = false
  let probed = false
  let refreshed = false
  let chatContract = false
  let inboxContract = false

  child.stderr?.on('data', (chunk) => fail(`Discord utility worker stderr: ${chunk}`))
  child.on('message', (message) => {
    if (message?.type === 'ready') {
      if (message.version !== expectedVersion) {
        fail(`Unexpected worker SDK version: ${message.version}`)
        return
      }
      ready = true
      child.postMessage({ type: 'request', id: 1, command: 'probe' })
      child.postMessage({
        type: 'request',
        id: 2,
        command: 'refresh',
        applicationId: '1526906410359848990'
      })
      child.postMessage({
        type: 'request',
        id: 4,
        command: 'chat-history',
        applicationId: '1526906410359848990',
        recipientId: '1526906410359848991',
        limit: 50
      })
      child.postMessage({
        type: 'request',
        id: 5,
        command: 'chat-inbox',
        applicationId: '1526906410359848990'
      })
      return
    }
    if (message?.type !== 'response') return
    if (message.id === 1) {
      probed = message.ok === true && message.version === expectedVersion
    }
    if (message.id === 2) {
      refreshed = message.ok === true && message.snapshot?.state === 'not-connected'
    }
    if (message.id === 4) {
      chatContract =
        message.ok === true &&
        message.chatHistory?.state === 'unavailable' &&
        message.chatHistory?.messages?.length === 0 &&
        message.clearTokens === true
    }
    if (message.id === 5) {
      inboxContract =
        message.ok === true &&
        message.chatInbox?.state === 'unavailable' &&
        message.chatInbox?.conversations?.length === 0 &&
        message.clearTokens === true
    }
    if (ready && probed && refreshed && chatContract && inboxContract) {
      child.postMessage({ type: 'request', id: 3, command: 'dispose' })
    }
    if (message.id === 3 && message.ok === true) {
      clearTimeout(timer)
      finished = true
      console.log(`Discord utility worker ${expectedVersion} verified`)
      child.kill()
      app.quit()
    }
  })
  child.once('exit', (code) => {
    if (!finished) fail(`Discord utility worker exited early (${code})`)
  })
})

app.on('window-all-closed', () => app.quit())
