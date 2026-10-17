// Sets the PIN for Letterhead Docs: writes lakshaykumar.com/letterhead/k/<pbkdf2(pin)>
// and removes any old PIN file. Run: npm run set-pin   (then commit & push the site repo)
import { pbkdf2Sync } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SALT = 'lakshaykumar.com/letterhead:v1' // must match PIN_SALT in src/app.js
const ITER = 310000                            // must match PIN_ITER in src/app.js
const dir = join(dirname(fileURLToPath(import.meta.url)), '../../lakshaykumar.com/letterhead/k')

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
mkdirSync(dir, { recursive: true })
for (const f of readdirSync(dir)) rmSync(join(dir, f))
writeFileSync(join(dir, hash), 'ok\n')
console.log('PIN set. Now commit and push the lakshaykumar.com repo for it to take effect.')
