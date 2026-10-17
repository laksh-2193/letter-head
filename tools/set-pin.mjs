// Sets the PIN for Letterhead Docs: writes k/<pbkdf2(pin)> in this repo and in the
// lakshaykumar.com/letterhead copy (if present), replacing any old PIN file.
// Run: npm run set-pin, then commit & push.
import { pbkdf2Sync } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SALT = 'lakshaykumar.com/letterhead:v1' // must match PIN_SALT in src/app.js
const ITER = 310000                            // must match PIN_ITER in src/app.js
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dirs = [join(root, 'k'), join(root, '../lakshaykumar.com/letterhead/k')]

function ask(q) {
  return new Promise(res => {
    process.stdout.write(q)
    const stdin = process.stdin
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8')
    let s = ''
    const on = ch => {
      if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stdout.write('\n'); res(s) }
      else if (ch === '\u0003') process.exit(1)
      else if (ch === '\u007f') { if (s) { s = s.slice(0, -1); process.stdout.write('\b \b') } }
      else { s += ch; process.stdout.write('•') }
    }
    stdin.on('data', on)
  })
}

const pin = await ask('New PIN: ')
if (pin.length < 4) { console.error('PIN must be at least 4 characters.'); process.exit(1) }
if (await ask('Repeat PIN: ') !== pin) { console.error('PINs do not match.'); process.exit(1) }
const hash = pbkdf2Sync(pin, SALT, ITER, 32, 'sha256').toString('hex')
for (const dir of dirs) {
  if (dir !== dirs[0] && !existsSync(join(dir, '..'))) continue
  mkdirSync(dir, { recursive: true })
  for (const f of readdirSync(dir)) rmSync(join(dir, f))
  writeFileSync(join(dir, hash), 'ok\n')
  console.log('Wrote', join(dir, hash.slice(0, 12) + '…'))
}
console.log('PIN set. Commit and push for it to take effect.')
