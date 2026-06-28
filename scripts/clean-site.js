const fs = require("node:fs");
const path = require("node:path");

fs.rmSync(path.join(process.cwd(), "_site"), { recursive: true, force: true });
