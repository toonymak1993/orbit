import assert from 'node:assert/strict'
import {
  normalizeXboxProductId,
  parseXboxInstallRequestStatus,
  parseXboxProductInstallProgress
} from '../src/main/xbox/xboxInstallRequest.ts'

assert.equal(normalizeXboxProductId(' 9nblggh4r315 '), '9NBLGGH4R315')
assert.throws(() => normalizeXboxProductId('short'), /Invalid Xbox product identifier/)
assert.throws(() => normalizeXboxProductId('9NBLGGH4R31!'), /Invalid Xbox product identifier/)

assert.equal(parseXboxInstallRequestStatus('ORBIT_XBOX_INSTALL_RESULT:queued\r\n'), 'queued')
assert.equal(parseXboxInstallRequestStatus('noise\nORBIT_XBOX_INSTALL_RESULT:unsupported\n'), 'unsupported')
assert.equal(parseXboxInstallRequestStatus('ORBIT_XBOX_INSTALL_RESULT:failed\n'), 'failed')
assert.equal(parseXboxInstallRequestStatus(''), 'failed')

assert.deepEqual(
  parseXboxProductInstallProgress(
    'ORBIT_XBOX_INSTALL_PROGRESS:{"productId":"9NBLGGH4R315","phase":"downloading","progress":0.42,"bytesDownloaded":420,"bytesTotal":1000}'
  ),
  {
    productId: '9NBLGGH4R315',
    phase: 'downloading',
    progress: 0.42,
    bytesDownloaded: 420,
    bytesTotal: 1000
  }
)
assert.equal(
  parseXboxProductInstallProgress(
    'ORBIT_XBOX_INSTALL_PROGRESS:{"productId":"bad","phase":"downloading","progress":2}'
  ),
  null
)

console.log('Xbox direct-install request verification passed.')
