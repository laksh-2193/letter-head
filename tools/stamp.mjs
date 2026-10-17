// Adds ?v=<build time> to app.js / styles.css in index.html so browsers fetch fresh files after a deploy.
import { readFileSync, writeFileSync } from 'node:fs'
const v = Date.now().toString(36)
const p = new URL('../index.html', import.meta.url)
writeFileSync(p, readFileSync(p, 'utf8').replace(/(href="styles\.css|src="app\.js)(\?v=[a-z0-9]+)?"/g, `$1?v=${v}"`))
