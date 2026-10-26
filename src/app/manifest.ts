import type { MetadataRoute } from "next";

/** Lets a paired phone keep Jobhunt on its home screen and open it full screen, like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jobhunt",
    short_name: "Jobhunt",
    description: "Your job search, from the Jobhunt app on your computer.",
    start_url: "/",
    display: "standalone",
    background_color: "#fffaf0",
    theme_color: "#fffaf0",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
