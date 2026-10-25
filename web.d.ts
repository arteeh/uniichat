// Files Server.ts imports, typed for tsc: as files (Bun gives their
// paths) the app's page, script, styles, icons, manifest, service worker
// and installer; as text, the chat's first message. (Bun's own types take
// any .html for an HTML bundle; with { type: "file" } it is a path.)
declare module "*.png" { const path: string; export default path; }
declare module "*.webmanifest" { const path: string; export default path; }
declare module "*/sw.js" { const path: string; export default path; }
declare module "*/app.js" { const path: string; export default path; }
declare module "*/index.html" { const path: string; export default path; }
declare module "*.css" { const path: string; export default path; }
declare module "*.svg" { const path: string; export default path; }
declare module "*.sh" { const path: string; export default path; }
declare module "*.md" { const text: string; export default text; }
