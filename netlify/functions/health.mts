import type { Config } from "@netlify/functions";

export default async () => Response.json({ message: "Welcome to Consensus API", status: "healthy" });

export const config: Config = {
  path: ["/api", "/api/health"],
};
