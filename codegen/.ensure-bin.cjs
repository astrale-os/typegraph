const fs = require('fs')
const path = require('path')

const bin = path.join(__dirname, 'dist', 'cli.js')
if (!fs.existsSync(bin)) {
  fs.mkdirSync(path.dirname(bin), { recursive: true })
  fs.writeFileSync(bin, '#!/usr/bin/env node\n')
}
