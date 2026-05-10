/*
  IoT Dashboard Server
  Connects to HiveMQ public broker, forwards data
  to web dashboard via WebSocket.
  
  Deploy this to Railway (free) for a public URL.
*/

const express   = require("express");
const http      = require("http");
const WebSocket = require("ws");
const mqtt      = require("mqtt");
const path      = require("path");

// ─── CONFIG ──────────────────────────────────────────
// Must match TOPIC_PREFIX in your Arduino sketches
const TOPIC_PREFIX = process.env.TOPIC_PREFIX || "myiot";
const PORT         = process.env.PORT || 3000;
const MQTT_BROKER  = "mqtt://broker.hivemq.com:1883";

// ─── STATION INFO (fake GPS for Tashkent) ────────────
const STATIONS = {
  station1: {
    label:   "Station 1 — Health Monitor",
    lat:     41.2995,
    lng:     69.2401,
    address: "Building A, Tashkent",
    sensors: "DHT22 · Pulse Sensor · OLED",
    color:   "#38bdf8"
  },
  station2: {
    label:   "Station 2 — Environment Monitor",
    lat:     41.3111,
    lng:     69.2797,
    address: "Building B, Tashkent",
    sensors: "DHT11 · MQ-2 Smoke · Rain Sensor",
    color:   "#34d399"
  }
};

// ─── STATE ───────────────────────────────────────────
const state = {
  station1: {
    temperature: null, humidity: null, pulse: null,
    status: "offline", lastSeen: null,
    info: STATIONS.station1,
    history: { temperature: [], humidity: [], pulse: [] }
  },
  station2: {
    temperature: null, humidity: null,
    smoke: null, smoke_alert: false,
    rain_detected: false,
    status: "offline", lastSeen: null,
    info: STATIONS.station2,
    history: { temperature: [], humidity: [], smoke: [] }
  }
};

function addHistory(station, key, value) {
  const arr = state[station].history[key];
  if (!arr) return;
  arr.push({ t: Date.now(), v: value });
  if (arr.length > 40) arr.shift();
}

// ─── EXPRESS ─────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
app.use(express.static(path.join(__dirname, "public")));
app.get("/api/state", (_, res) => res.json(state));

// ─── WEBSOCKET ───────────────────────────────────────
const wss = new WebSocket.Server({ server });

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

wss.on("connection", ws => {
  ws.send(JSON.stringify({ type: "init", state }));
});

// ─── MQTT ────────────────────────────────────────────
const client = mqtt.connect(MQTT_BROKER, {
  clientId: "iot_dashboard_" + Math.random().toString(16).slice(2, 8)
});

client.on("connect", () => {
  console.log("MQTT connected to HiveMQ");
  client.subscribe(TOPIC_PREFIX + "/station1/#");
  client.subscribe(TOPIC_PREFIX + "/station2/#");
});

client.on("message", (topic, payload) => {
  const val   = payload.toString();
  const parts = topic.split("/");
  // parts: [prefix, station, key]
  if (parts.length < 3) return;
  const station = parts[1];
  const key     = parts[2];

  if (!state[station]) return;

  const numericKeys = ["temperature", "humidity", "pulse", "smoke"];
  const boolKeys    = ["smoke_alert", "rain_detected"];

  if (numericKeys.includes(key)) {
    const n = parseFloat(val);
    if (!isNaN(n)) {
      state[station][key] = n;
      addHistory(station, key, n);
    }
  } else if (boolKeys.includes(key)) {
    state[station][key] = val === "1";
  } else if (key === "status") {
    state[station].status = val;
  }

  if (key !== "status") state[station].lastSeen = Date.now();

  broadcast({ type: "update", station, key, val, state });
});

client.on("error", e => console.error("MQTT error:", e.message));

// ─── START ───────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`MQTT topic prefix: ${TOPIC_PREFIX}`);
});
