import { env } from "./env";
import { createBridgeServer } from "./server";

const server = createBridgeServer(env.port);
console.log(`[bridge] listening on ${server.url}`);
console.log(`[bridge] public base URL: ${env.baseUrl}`);
