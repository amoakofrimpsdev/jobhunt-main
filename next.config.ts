import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server in .next/standalone, which the desktop app ships (scripts/build-dmg.sh).
  output: "standalone",
  outputFileTracingRoot: __dirname,
  // pdf-parse loads its PDF worker from disk, which only works when Node requires the package itself.
  serverExternalPackages: ["pdf-parse"],
  // The PDF reader loads its worker by file name at run time, which file tracing cannot see.
  // The reads of data/ go through process.cwd(), which makes file tracing sweep the whole project folder into the
  // build. The database and the other build folders must stay out: the database alone is hundreds of megabytes.
  // The patterns also match inside node_modules, so none of them may name a folder a package uses (dist, src, legacy).
  outputFileTracingExcludes: {
    "/*": ["./.data/**/*", "./.cache/**/*", "./dist/*.dmg", "./desktop/**/*"],
  },
  outputFileTracingIncludes: {
    "/api/resume": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
};

export default nextConfig;
