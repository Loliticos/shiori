const EventEmitter = require("events");
const Websocket = require("ws");
const Erlpack = require("erlpack");

const Constants = require("../../utils/Constants")

module.exports = class Shard extends EventEmitter {
  constructor (manager, id) {
    super();

    this.manager = manager;
    this.id = id;

    this.sequence = -1;
    this.sessionId = null;
    this.lastHeartbeatAcked = true;
    this.heartbeatInterval = null;

    this.status = "IDLE";

    Object.defineProperty(this, 'connection', { value: null, writable: true });
  }

  async connect() {
    this.connection = new Websocket(this.manager.url, { perMessageDeflate: false })

    this.status = "CONNECTED";

    this.connection.on("message", (data) => this.websocketMessageReceive(data));
    this.connection.on("open", () => this.websocketConnectionOpen());
    this.connection.on("error", (error) => console.error(error));
    this.connection.on("close", (...args) => this.websocketCloseConnection(...args));
  }

  async websocketCloseConnection(error) {
    this.status = "CLOSED";

    console.error(`Código de erro: ${error}`);
  }

  async websocketMessageReceive(data) {
    data = Erlpack.unpack(data);

    this.packetReceive(data);
  }

  async websocketConnectionOpen() {
    console.log("Conexão aberta")
  }

  async packetReceive(packet) {
    if (packet.s) this.sequence = packet.s;

    switch (packet.t) {
      case "READY": {
        this.sessionId = packet.d.session_id;

        console.log("Conectado!");

        this.status = "READY";

        this.lastHeartbeatAcked = true;
        this.sendHeartbeat();
        break;
      }
    }

    switch (packet.op) {
      case Constants.OP_CODES.HEARTBEAT: {
        this.sendHeartbeat();
        break;
      }
      case Constants.OP_CODES.HEARTBEAT_ACK: {
        this.lastHeartbeatAck = true;
        this.lastHeartbeatReceived = Date.now();
        break;
      }
      case Constants.OP_CODES.HELLO: {
        if (packet.d?.heartbeat_interval) {
          if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

          this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), packet.d.heartbeat_interval);
        }

        if (this.sessionId) {
          console.log("mandando status resume")

          this.sendWebsocketMessage({
            op: Constants.OP_CODES.RESUME,
            d: {
              token: this.manager.client.token,
              session_id: this.sessionId,
              seq: this.sequence
            }
         });
       } else {
         this.identify();
         this.sendHeartbeat();
       }
       break;
      }
      case Constants.OP_CODES.INVALID_SESSION: {
        this.sessionId = null;
        this.sequence = 0;

        if (packet.d) return this.identify();

        break;
      }
    }
  }

  async identify() {
    const { client } = this.manager;

    const d = {
      token: client.token,
      intents: client.options.intents,
      shard: [this.id, client.options.shardCount],
      v: 9,
      properties: {
        os: process.platform,
        browser: "hitomi",
        device: "hitomi"
      }
    };

    return this.sendWebsocketMessage({ op: Constants.OP_CODES.IDENTIFY, d });
  }

  sendHeartbeat() {
    this.lastHeartbeatAcked = false;

    this.sendWebsocketMessage({ op: Constants.OP_CODES.HEARTBEAT, d: this.sequence });
  }

  sendWebsocketMessage(data) {
    if (this.status !== "CLOSED") this.connection.send(Erlpack.pack(data), (err) => console.error(err));
  }
}
