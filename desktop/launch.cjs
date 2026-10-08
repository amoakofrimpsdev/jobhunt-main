// Started by the desktop shell with its stdin held open. When the shell goes away, for any reason, stdin closes and
// the server exits with it, so no server is ever left running behind a closed app.
process.stdin.on("end", () => process.exit(0));
process.stdin.on("error", () => process.exit(0));
process.stdin.resume();
require("./server.js");
