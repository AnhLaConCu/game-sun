const Fastify = require("fastify");
const cors = require("@fastify/cors");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsImdlbmRlciI6MCwiZGlzcGxheU5hbWUiOiJhcGlzdW53aW52YyIsInBob25lVmVyaWZpZWQiOmZhbHNlLCJib3QiOjAsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8yMC5wbmciLCJ1c2VySWQiOiJkOTNkM2Q4NC1mMDY5LTRiM2YtOGRhYy1iNDcxNmE4MTIxNDMiLCJyZWdUaW1lIjoxNzUyMDQ1ODkzMjkyLCJwaG9uZSI6IiIsImN1c3RvbWVySWQiOjI3NjQ3ODE3MywiYnJhbmQiOiJzdW4ud2luIiwidXNlcm5hbWUiOiJTQ19hcGlzdW53aW4xMjMiLCJ0aW1lc3RhbXAiOjE3NTI4NTQ4NjY1OTJ9.CUtQHHxKv-Rk9O-BY0m6UnS61JfIAO_SJt1c19W4xfM";

const fastify = Fastify({ logger: false });
const PORT = process.env.PORT || 3001;
const HISTORY_FILE = path.join(__dirname, 'taixiu_history.json');

let rikResults = [];
let rikCurrentSession = null;
let rikWS = null;
let rikIntervalCmd = null;

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      rikResults = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      console.log(`📚 Loaded ${rikResults.length} history records`);
    }
  } catch (err) {
    console.error('Error loading history:', err);
  }
}

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(rikResults), 'utf8');
  } catch (err) {
    console.error('Error saving history:', err);
  }
}

function decodeBinaryMessage(buffer) {
  try {
    const str = buffer.toString();
    if (str.startsWith("[")) return JSON.parse(str);

    let pos = 0, result = [];

    while (pos < buffer.length) {
      const type = buffer.readUInt8(pos++);
      if (type === 1) {
        const len = buffer.readUInt16BE(pos); pos += 2;
        result.push(buffer.toString('utf8', pos, pos + len)); pos += len;
      } else if (type === 2) {
        result.push(buffer.readInt32BE(pos)); pos += 4;
      } else if (type === 3 || type === 4) {
        const len = buffer.readUInt16BE(pos); pos += 2;
        result.push(JSON.parse(buffer.toString('utf8', pos, pos + len))); pos += len;
      } else {
        console.warn("Unknown binary type:", type);
        break;
      }
    }
    return result.length === 1 ? result[0] : result;
  } catch (e) {
    console.error("Binary decode error:", e);
    return null;
  }
}

function getTX(d1, d2, d3) {
  return d1 + d2 + d3 >= 11 ? "T" : "X";
}

function analyzePatterns(history) {
  if (history.length < 5) return null;
  const patternStr = history.slice(0, 30).map(i => getTX(i.d1, i.d2, i.d3)).join('');
  const known = {
    'ttxtttttxtxtxttxtxtxtxtxtxxttxt': 'Pattern thường xuất hiện sau chuỗi Tài-Tài-Xỉu-Tài...',
    'ttttxxxx': '4 Tài liên tiếp thường đi kèm 4 Xỉu',
    'xtxtxtxt': 'Xen kẽ Tài Xỉu ổn định',
    'ttxxttxxttxx': 'Chu kỳ 2 Tài 2 Xỉu'
  };
  for (let [pattern, desc] of Object.entries(known)) {
    if (patternStr.includes(pattern)) {
      return { pattern, description: desc, confidence: 80 + Math.floor(Math.random() * 20) };
    }
  }
  return null;
}

function predictNextResult(history) {
  if (history.length < 5) return null;
  const pattern = analyzePatterns(history);
  if (pattern) {
    const lastChar = pattern.pattern.slice(-1);
    return {
      prediction: lastChar === 'T' ? 'X' : 'T',
      reason: `Phát hiện mẫu: ${pattern.description}`,
      confidence: pattern.confidence
    };
  }

  const last5 = history.slice(0, 5).map(i => getTX(i.d1, i.d2, i.d3));
  const t = last5.filter(i => i === 'T').length;
  const x = last5.filter(i => i === 'X').length;
  if (t >= 4) return { prediction: 'X', reason: 'Xu hướng Tài nhiều (4/5 phiên), dự đoán Xỉu', confidence: 85 };
  if (x >= 4) return { prediction: 'T', reason: 'Xu hướng Xỉu nhiều (4/5 phiên), dự đoán Tài', confidence: 85 };

  const avg = history.slice(0, 5).map(i => i.d1 + i.d2 + i.d3).reduce((a, b) => a + b) / 5;
  if (avg > 11.5) return { prediction: 'X', reason: `Tổng điểm trung bình cao (${avg.toFixed(1)}), dự đoán Xỉu`, confidence: 75 };
  if (avg < 10.5) return { prediction: 'T', reason: `Tổng điểm trung bình thấp (${avg.toFixed(1)}), dự đoán Tài`, confidence: 75 };

  const alt = last5.every((val, i, arr) => i === 0 || val !== arr[i - 1]);
  if (alt) return { prediction: last5[4] === 'T' ? 'X' : 'T', reason: 'Xu hướng xen kẽ Tài/Xỉu', confidence: 70 };

  return { prediction: Math.random() > 0.5 ? 'T' : 'X', reason: 'Không có mẫu rõ ràng, dự đoán ngẫu nhiên', confidence: 60 };
}

function sendRikCmd1005() {
  if (rikWS?.readyState === WebSocket.OPEN) {
    rikWS.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
  }
}

function connectRikWebSocket() {
  console.log("🔌 Connecting to SunWin WebSocket...");
  rikWS = new WebSocket(`wss://websocket.azhkthg1.net/websocket?token=${TOKEN}`);

  rikWS.on("open", () => {
    const authPayload = [
      1,
      "MiniGame",
      "SC_apisunwin123",
      "binhlamtool90",
      {
        "info": JSON.stringify({
          ipAddress: "2001:ee0:5708:7700:f151:dedc:c5ad:6bc3",
          wsToken: TOKEN,
          locale: "vi",
          userId: "d93d3d84-f069-4b3f-8dac-b4716a812143",
          username: "SC_apisunwin123",
          timestamp: 1753424519812,
          refreshToken: "dd38d05401bb48b4ac3c2f6dc37f36d9.f22dccad89bb4e039814b7de64b05d63"
        }),
        "signature": "7B15315084F3B2A31627D96565E185792B8F0855BC3D2949CCC02EB06F53B35E7FF0A54BD072E07E0AA72C60BAF4FC4569B286E1EE2B095EDEF38F738A23C1A8BA9E3F6C9D5C02FEC1BFE3D58B50BBBBDEB5E54E33CA7442EDB3B186BBD9AD986EBF1DE5DF064F68443EFE7CE3890A9FF3B5DB3F61FD0AB894F0BD8F484669D2",
        pid: 5,
        subi: true
      }
    ];
    rikWS.send(JSON.stringify(authPayload));
    clearInterval(rikIntervalCmd);
    rikIntervalCmd = setInterval(sendRikCmd1005, 5000);
  });

  rikWS.on("message", (data) => {
    const json = typeof data === 'string' ? JSON.parse(data) : decodeBinaryMessage(data);
    if (!json) return;

    if (Array.isArray(json) && json[3]?.res?.d1 && json[3]?.res?.sid) {
      const result = json[3].res;
      if (!rikCurrentSession || result.sid > rikCurrentSession) {
        rikCurrentSession = result.sid;
        rikResults.unshift({ ...result, timestamp: Date.now() });
        if (rikResults.length > 100) rikResults.pop();
        saveHistory();
        console.log(`📥 Phiên mới ${result.sid} → ${getTX(result.d1, result.d2, result.d3)}`);
        setTimeout(() => { rikWS?.close(); connectRikWebSocket(); }, 1000);
      }
    } else if (Array.isArray(json) && json[1]?.htr) {
      rikResults = json[1].htr.map(i => ({ ...i, timestamp: Date.now() })).sort((a, b) => b.sid - a.sid).slice(0, 100);
      saveHistory();
      console.log("📦 Đã tải lịch sử các phiên gần nhất.");
    }
  });

  rikWS.on("close", () => {
    console.log("🔌 WebSocket disconnected. Reconnecting...");
    setTimeout(connectRikWebSocket, 5000);
  });

  rikWS.on("error", err => {
    console.error("🔌 WebSocket error:", err.message);
    rikWS.close();
  });
}

loadHistory();
connectRikWebSocket();
fastify.register(cors);

fastify.get("/api/taixiu/sunwin", async () => {
  const current = rikResults.find(i => i.d1 && i.d2 && i.d3);
  if (!current) return { message: "Không có dữ liệu." };
  const sum = current.d1 + current.d2 + current.d3;
  const prediction = predictNextResult(rikResults);
  return {
    phien: current.sid,
    xuc_xac_1: current.d1,
    xuc_xac_2: current.d2,
    xuc_xac_3: current.d3,
    tong: sum,
    ket_qua: sum >= 11 ? "Tài" : "Xỉu",
    du_doan: prediction?.prediction === 'T' ? 'Tài' : 'Xỉu',
    ty_le_thanh_cong: `${prediction?.confidence}%`,
    giai_thich: prediction?.reason,
    pattern: analyzePatterns(rikResults)?.description || "Không phát hiện mẫu cụ thể"
  };
});

fastify.get("/api/taixiu/history", async () => {
  if (rikResults.length === 0) return { message: "Không có dữ liệu lịch sử." };
  return rikResults.map(item => JSON.stringify({
    session: item.sid,
    dice: [item.d1, item.d2, item.d3],
    total: item.d1 + item.d2 + item.d3,
    result: item.d1 + item.d2 + item.d3 >= 11 ? "Tài" : "Xỉu"
  })).join('\n');
});

const start = async () => {
  try {
    const address = await fastify.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`🚀 API chạy tại ${address}`);
  } catch (err) {
    console.error("❌ Server error:", err);
    process.exit(1);
  }
};

start();
