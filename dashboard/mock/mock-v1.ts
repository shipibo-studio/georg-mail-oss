// The open-source mail client has no workspace API: the mock answers it with a not found, like the
// mail client's Worker does.
import type { IncomingMessage, ServerResponse } from "node:http";

export const mockV1 = {
  reset() {},
  arrive() {},
  async handle(_request: IncomingMessage, response: ServerResponse) {
    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
  },
};
