/**
 * tsconfig.main.json has rootDir="src", so src/main/server.ts compiles to
 * dist/main/main/server.js (the src/main/ subfolder is preserved). But
 * ecosystem.config.js (PM2 production config) hardcodes the flat path
 * dist/main/server.js, and that file must NOT be edited via git — the VM
 * has a locally-modified copy with different filesystem paths, and a
 * `git pull` would overwrite it and break DB/log paths.
 *
 * So instead of changing rootDir (which would require restructuring
 * src/server and src/shared under src/main) or ecosystem.config.js, this
 * generates a one-line re-export wrapper at the flat path. A plain copy
 * would break server.js's relative requires (e.g. require('./database')
 * resolves against its own directory); this wrapper requires the real
 * file in place so its relative requires still resolve correctly.
 */
const fs = require('fs');
const path = require('path');

const wrapperPath = path.join(__dirname, '..', 'dist', 'main', 'server.js');
fs.writeFileSync(wrapperPath, "require('./main/server.js');\n");
