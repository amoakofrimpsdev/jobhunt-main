/** Runs once when the server starts: leaves a note of where it is listening for the Claude Desktop connector. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { writeRunFile } = await import("./lib/connector");
  writeRunFile();
}
