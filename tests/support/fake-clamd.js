import net from "node:net";

// Minimal clamd stand-in speaking the INSTREAM protocol over TCP, for tests.
// mode: clean | infected | error | garbage | hang | close (drop the connection after the stream).
export async function startFakeClamd({
  mode = "clean",
  signature = "Test-Signature",
} = {}) {
  const state = { mode, signature, connections: 0, streams: [] };
  const sockets = new Set();
  const server = net.createServer((socket) => {
    state.connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    let started = false;
    const payload = [];
    let framingOk = true;
    socket.on("error", () => {});
    socket.on("data", (data) => {
      pending = Buffer.concat([pending, data]);
      if (!started) {
        const header = Buffer.from("zINSTREAM\0");
        if (pending.length < header.length) return;
        if (!pending.subarray(0, header.length).equals(header)) {
          framingOk = false;
          return socket.end("UNKNOWN COMMAND\0");
        }
        pending = pending.subarray(header.length);
        started = true;
      }
      while (pending.length >= 4) {
        const size = pending.readUInt32BE(0);
        if (size === 0) {
          state.streams.push({
            bytes: Buffer.concat(payload),
            framingOk,
            trailing: pending.length - 4,
          });
          return reply(socket, state);
        }
        if (pending.length < 4 + size) return;
        payload.push(pending.subarray(4, 4 + size));
        pending = pending.subarray(4 + size);
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.port = server.address().port;
  state.close = () =>
    new Promise((resolve) => {
      server.close(resolve);
      for (const socket of sockets) socket.destroy();
    });
  return state;
}

function reply(socket, state) {
  if (state.mode === "hang") return;
  if (state.mode === "close") return socket.destroy();
  const answers = {
    clean: "stream: OK\0",
    infected: `stream: ${state.signature} FOUND\0`,
    error: "INSTREAM size limit exceeded. ERROR\0",
    garbage: "this is not clamd\0",
  };
  socket.end(answers[state.mode]);
}

// A port with nothing listening, to simulate clamd being down.
export async function closedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}
