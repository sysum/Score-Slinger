import { serve } from "@hono/node-server";
import app from "./app";

const port = parseInt(process.env.PORT || "5000", 10);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on http://localhost:${port}`);
});
