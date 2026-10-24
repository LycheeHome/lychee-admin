// What the add page reads from GET /api/sites/new: the facts a server render
// used to bake into the form. Type-only, imported by both sides.
export type AddSitePayload = {
  domain: string;
  portOwners: Record<string, string>;
  paths: { caddyfilePath: string; tunnelConfigPath: string };
  steps: { id: string; label: string }[];
  caddyfileError: string | null;
};
