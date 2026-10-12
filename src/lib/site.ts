// Public address of the site, used for canonical links, robots.txt and the sitemap.
export function siteUrl() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
