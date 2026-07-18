import type { WebSocket } from "ws";

const clients = new Set<WebSocket>();

export function addClient(socket: WebSocket) {
  clients.add(socket);
  socket.on("close", () => clients.delete(socket));
  socket.send(JSON.stringify({ type: "hello", clients: clients.size }));
}

export function broadcast(event: Record<string, unknown>) {
  const data = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === 1) client.send(data);
  }
}
