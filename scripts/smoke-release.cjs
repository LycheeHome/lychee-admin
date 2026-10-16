// Loads the assembled release tree on the oldest glibc the host might run, so
// a native module built against a newer one fails here and not on lychee.
//   node /smoke.cjs /app
const path = require("node:path");

// Cost-4 bcrypt hash of "lychee-smoke", generated once and committed.
const HASH = "$2b$04$9kEcXFY1gvOoAqyK.OmdDeRnQ4dgJK6VzOKbtcJVReGjfBtN/JREG";

const tree = path.resolve(process.argv[2] ?? "/app");
process.chdir(tree);

const bcrypt = require(path.join(tree, "node_modules", "bcrypt"));
if (bcrypt.compareSync("lychee-smoke", HASH) !== true) {
  console.error("smoke: bcrypt compareSync did not match");
  process.exit(1);
}
// config.js throws at import without these; the values are never used.
process.env.ADMIN_USERNAME ??= "smoke";
process.env.ADMIN_PASSWORD_HASH ??= HASH;
process.env.DOMAIN ??= "smoke.invalid";
require(path.join(tree, "dist", "app"));
console.log("smoke ok");
