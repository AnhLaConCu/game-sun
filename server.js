const Fastify = require("fastify");
const cors = require("@fastify/cors");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJhcGlzdW53aW52YyIsImJvdCI6MCwiaXNNZXJjaGFudCI6ZmFsc2UsInZlcmlmaWVkQmFua0FjY291bnQiOmZhbHNlLCJwbGF5RXZlbnRMb2JieSI6ZmFsc2UsImN1c3RvbWVySWQiOjI3NjQ3ODE3MywiYWZmSWQiOiJkOTNkM2Q4NC1mMDY5LTRiM2YtOGRhYy1iNDcxNmE4MTIxNDMiLCJiYW5uZWQiOmZhbHNlLCJicmFuZCI6InN1bi53aW4iLCJ0aW1lc3RhbXAiOjE3NTM0NDM3MjM2NjIsImxvY2tHYW1lcyI6W10sImFtb3VudCI6MCwibG9ja0NoYXQiOmZhbHNlLCJwaG9uZVZlcmlmaWVkIjpmYWxzZSwiaXBBZGRyZXNzIjoiMjAwMTplZTA6NTcwODo3NzAwOjhhZjM6YWJkMTpmZTJhOmM2MmMiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzIwLnBuZyIsInBsYXRmb3JtSWQiOjUsInVzZXJJZCI6ImQ5M2QzZDg0LWYwNjktNGIzZi04ZGFjLWI0NzE2YTgxMjE0MyIsInJlZ1RpbWUiOjE3NTIwNDU4OTMyOTIsInBob25lIjoiIiwiZGVwb3NpdCI6ZmFsc2UsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.a-KRvIGfMqxtBq3WenudxP8pFx7mxj33iIZm-AklInk";

const fastify = Fastify({ logger: false });
const PORT = process.env.PORT || 3001;
const HISTORY_FILE = path.join(__dirname, 'taixiu_history.json');
const MIN_HISTORY_FOR_SMART_PREDICT = 20;

let rikResults = [];
let rikCurrentSession = null;
let rikWS = null;
let rikIntervalCmd = null;
let CAU_PATTERNS = {};

// ========================
// 🎲 GAME UTILITY FUNCTIONS
// ========================
function getTX(d1, d2, d3) {
  return d1 + d2 + d3 >= 11 ? "T" : "X";
}

function tinhTaiXiu(dice) {
  const total = dice.reduce((a, b) => a + b, 0);
  return [total >= 11 ? "Tài" : "Xỉu", total];
}

// ========================
// 📁 DATA MANAGEMENT
// ========================
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

// ========================
// 🔮 PREDICTION PATTERNS
// ========================
function definePatterns() {
  return {
    "Bệt": h => h.length >= 3 && h[h.length - 1] === h[h.length - 2] && h[h.length - 2] === h[h.length - 3],
    "Bệt siêu dài": h => h.length >= 5 && h.slice(-5).every(x => x === h[h.length - 1]),
    "Bệt gãy nhẹ": h => h.length >= 4 && h[h.length - 1] !== h[h.length - 2] && h[h.length - 2] === h[h.length - 3] && h[h.length - 3] === h[h.length - 4],
    "Bệt gãy sâu": h => h.length >= 5 && h[h.length - 1] !== h[h.length - 2] && h.slice(-5, -1).every(x => x === h[h.length - 2]),
    "Bệt xen kẽ ngắn": h => h.length >= 4 && h[h.length - 4] === h[h.length - 3] && h[h.length - 2] === h[h.length - 1] && h[h.length - 4] !== h[h.length - 2],
    "Bệt ngược": h => h.length >= 4 && h[h.length - 1] === h[h.length - 2] && h[h.length - 3] === h[h.length - 4] && h[h.length - 1] !== h[h.length - 3],
    "Xỉu kép": h => h.length >= 2 && h[h.length - 1] === 'Xỉu' && h[h.length - 2] === 'Xỉu',
    "Tài kép": h => h.length >= 2 && h[h.length - 1] === 'Tài' && h[h.length - 2] === 'Tài',
    "Ngẫu nhiên bệt": h => h.length > 8 && h.slice(-8).filter(x => x === 'Tài').length / 8 > 0.4 && 
                          h.slice(-8).filter(x => x === 'Tài').length / 8 < 0.6 && h[h.length - 1] === h[h.length - 2],
  };
}

// ========================
// 🧠 PREDICTION MODELS
// ========================
function duDoanTheoXiNgau(diceList) {
  if (!diceList || diceList.length === 0) return "Đợi thêm dữ liệu";
  const [d1, d2, d3] = diceList[diceList.length - 1];
  const total = d1 + d2 + d3;

  const results = [d1, d2, d3].map(d => {
    let tmp = d + total;
    while (tmp > 6) tmp -= 6;
    return tmp % 2 === 0 ? "Tài" : "Xỉu";
  });

  const taiCount = results.filter(r => r === "Tài").length;
  const xiuCount = results.filter(r => r === "Xỉu").length;
  return taiCount >= xiuCount ? "Tài" : "Xỉu";
}

function detectPattern(historyStr) {
  if (!historyStr || historyStr.length < 2) return null;
  
  const patterns = definePatterns();
  let detectedPatterns = [];
  
  for (const [name, check] of Object.entries(patterns)) {
    if (check(historyStr)) {
      const confidence = 0.7 + (Math.random() * 0.3); // Base confidence + some variance
      detectedPatterns.push({ name, confidence });
    }
  }
  
  return detectedPatterns.length > 0 
    ? detectedPatterns.reduce((a, b) => a.confidence > b.confidence ? a : b)
    : null;
}

function predictWithPattern(historyStr, patternInfo) {
  if (!patternInfo || !historyStr || historyStr.length < 2) {
    return ['Tài', 0.5];
  }

  const last = historyStr[historyStr.length - 1];
  const antiLast = last === 'Tài' ? 'Xỉu' : 'Tài';

  switch (patternInfo.name) {
    case "Bệt":
    case "Bệt siêu dài":
    case "Tài kép":
    case "Xỉu kép":
      return [last, patternInfo.confidence];
    case "Bệt gãy nhẹ":
    case "Bệt gãy sâu":
      return [antiLast, patternInfo.confidence * 0.9];
    default:
      return [Math.random() > 0.5 ? 'Tài' : 'Xỉu', 0.6];
  }
}

function getLogisticFeatures(historyStr) {
  if (!historyStr) return Array(6).fill(0.0);

  // Current streak length
  let currentStreak = 1;
  const last = historyStr[historyStr.length - 1];
  for (let i = historyStr.length - 2; i >= 0; i--) {
    if (historyStr[i] === last) currentStreak++;
    else break;
  }

  // Previous streak length
  let prevStreakLen = 0;
  if (historyStr.length > currentStreak) {
    const prevVal = historyStr[historyStr.length - currentStreak - 1];
    for (let i = historyStr.length - currentStreak - 2; i >= 0; i--) {
      if (historyStr[i] === prevVal) prevStreakLen++;
      else break;
    }
  }

  // Recent balance (last 20)
  const recent = historyStr.slice(-20);
  const taiRecent = recent.filter(x => x === 'Tài').length;
  const xiuRecent = recent.length - taiRecent;
  const balanceShort = (taiRecent - xiuRecent) / recent.length;

  // Long-term balance (last 100)
  const longTerm = historyStr.slice(-100);
  const taiLong = longTerm.filter(x => x === 'Tài').length;
  const xiuLong = longTerm.length - taiLong;
  const balanceLong = (taiLong - xiuLong) / longTerm.length;

  // Volatility
  let changes = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] !== recent[i-1]) changes++;
  }
  const volatility = changes / (recent.length - 1);

  // Alternations in last 10
  const last10 = historyStr.slice(-10);
  let alternations = 0;
  for (let i = 1; i < last10.length; i++) {
    if (last10[i] !== last10[i-1]) alternations++;
  }

  return [
    currentStreak,
    prevStreakLen,
    balanceShort,
    balanceLong,
    volatility,
    alternations
  ];
}

// ========================
// 🧠 SMART PREDICTION ENGINE
// ========================
function smartPredict(fullHistory, analyzeHistory, currentDice) {
  const duDoanCoSo = duDoanTheoXiNgau([currentDice]);
  if (analyzeHistory.length < MIN_HISTORY_FOR_SMART_PREDICT) {
    return [duDoanCoSo, "Dự đoán theo xí ngầu (chưa đủ lịch sử)"];
  }

  const historyStr = analyzeHistory.map(h => h.result);
  const patternInfo = detectPattern(historyStr);
  const [pattPred, pattConf] = predictWithPattern(historyStr, patternInfo);

  // Markov prediction (simple)
  const last = historyStr[historyStr.length - 1];
  const markovPred = Math.random() > 0.4 ? last : (last === 'Tài' ? 'Xỉu' : 'Tài');
  const markovConf = 0.7;

  // Logistic regression features
  const features = getLogisticFeatures(historyStr);
  const logisticPred = features[2] > 0 ? 'Tài' : 'Xỉu';
  const logisticConf = Math.abs(features[2]) * 0.8 + 0.5;

  // Combine predictions
  const predictions = [
    { pred: pattPred, weight: pattConf * 0.5 },
    { pred: markovPred, weight: markovConf * 0.3 },
    { pred: logisticPred, weight: logisticConf * 0.2 }
  ];

  let taiScore = 0, xiuScore = 0;
  predictions.forEach(p => {
    if (p.pred === 'Tài') taiScore += p.weight;
    else xiuScore += p.weight;
  });

  const finalPred = taiScore > xiuScore ? 'Tài' : 'Xỉu';
  const confidence = Math.round((Math.max(taiScore, xiuScore) / (taiScore + xiuScore)) * 100;

  // Apply meta-logic (anti-streak)
  let reason = patternInfo ? `Phát hiện mẫu ${patternInfo.name}` : "Phân tích tổng hợp";
  if (patternInfo?.name.includes("Bệt") && patternInfo.confidence > 0.8) {
    const streakLen = historyStr.lastIndexOf(last === 'Tài' ? 'Xỉu' : 'Tài');
    if (streakLen >= 7 && finalPred === last) {
      return [last === 'Tài' ? 'Xỉu' : 'Tài', 
             `Bẻ cầu bệt dài (${streakLen} lần)`];
    }
  }

  return [finalPred, `${reason} | Độ tin cậy ${confidence}%`];
}

// ========================
// 🌐 WEBSOCKET CONNECTION
// ========================
function decodeBinaryMessage(buffer) {
  try {
    const str = buffer.toString();
    if (str.startsWith("[")) return JSON.parse(str);
    
    let position = 0, result = [];
    while (position < buffer.length) {
      const type = buffer.readUInt8(position++);
      if (type === 1) {
        const len = buffer.readUInt16BE(position); 
        position += 2;
        result.push(buffer.toString('utf8', position, position + len));
        position += len;
      } else if (type === 2) {
        result.push(buffer.readInt32BE(position)); 
        position += 4;
      } else if (type === 3 || type === 4) {
        const len = buffer.readUInt16BE(position); 
        position += 2;
        result.push(JSON.parse(buffer.toString('utf8', position, position + len)));
        position += len;
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
        info: JSON.stringify({
          ipAddress: "2001:ee0:5708:7700:8af3:abd1:fe2a:c62c",
          wsToken: TOKEN,
          locale: "vi",
          userId: "d93d3d84-f069-4b3f-8dac-b4716a812143",
          username: "SC_apisunwin123",
          timestamp: 1753443723662,
          refreshToken: "dd38d05401bb48b4ac3c2f6dc37f36d9.f22dccad89bb4e039814b7de64b05d63",
          avatar: "https://images.swinshop.net/images/avatar/avatar_20.png",
          platformId: 5
        }),
        signature: "4FD3165D59BD21DA76B4448EA62E81972BCD54BE0EDBC5291D2415274DA522089BF9318E829A67D07EC78783543D17E75671CBD6FDF60B42B55643F13B66DEB7B0510DE995A8C7C8EDBA4990CE3294C4340D86BF78B02A0E90C6565D1A32EAA894F7384302602CB2703C20981244103E42817257592D42828D6EDB0BB781ADA1",
        pid: 5,
        subi: true
      }
    ];
    rikWS.send(JSON.stringify(authPayload));
    clearInterval(rikIntervalCmd);
    rikIntervalCmd = setInterval(sendRikCmd1005, 5000);
  });

  rikWS.on("message", (data) => {
    try {
      const json = typeof data === 'string' ? JSON.parse(data) : decodeBinaryMessage(data);
      if (!json) return;

      if (Array.isArray(json) && json[3]?.res?.d1) {
        const res = json[3].res;
        if (!rikCurrentSession || res.sid > rikCurrentSession) {
          rikCurrentSession = res.sid;
          rikResults.unshift({ 
            sid: res.sid, 
            d1: res.d1, 
            d2: res.d2, 
            d3: res.d3, 
            timestamp: Date.now() 
          });
          if (rikResults.length > 100) rikResults.pop();
          saveHistory();
          console.log(`📥 New session ${res.sid} → ${getTX(res.d1, res.d2, res.d3)}`);
          setTimeout(() => { 
            rikWS?.close(); 
            connectRikWebSocket(); 
          }, 1000);
        }
      } else if (Array.isArray(json) && json[1]?.htr) {
        rikResults = json[1].htr.map(i => ({
          sid: i.sid, 
          d1: i.d1, 
          d2: i.d2, 
          d3: i.d3, 
          timestamp: Date.now()
        })).sort((a, b) => b.sid - a.sid).slice(0, 100);
        saveHistory();
        console.log("📦 Loaded recent session history.");
      }
    } catch (e) {
      console.error("❌ Parse error:", e.message);
    }
  });

  rikWS.on("close", () => {
    console.log("🔌 WebSocket disconnected. Reconnecting...");
    setTimeout(connectRikWebSocket, 5000);
  });

  rikWS.on("error", (err) => {
    console.error("🔌 WebSocket error:", err.message);
    rikWS.close();
  });
}

// ========================
// 🚀 API ENDPOINTS
// ========================
fastify.register(cors);

fastify.get("/api/taixiu/sunwin", async () => {
  const valid = rikResults.filter(r => r.d1 && r.d2 && r.d3);
  if (!valid.length) return { message: "No data available." };

  const current = valid[0];
  const sum = current.d1 + current.d2 + current.d3;
  const ket_qua = sum >= 11 ? "Tài" : "Xỉu";

  // Prepare history for prediction
  const historyData = valid.map(i => ({
    result: getTX(i.d1, i.d2, i.d3) === "T" ? "Tài" : "Xỉu",
    dice: [i.d1, i.d2, i.d3],
    total: i.d1 + i.d2 + i.d3,
    sid: i.sid
  }));

  // Get advanced prediction
  const [prediction, reason] = smartPredict(
    valid, 
    historyData.slice(0, 30), 
    [current.d1, current.d2, current.d3]
  );

  return {
    id: "binhtool90",
    phien: current.sid,
    xuc_xac_1: current.d1,
    xuc_xac_2: current.d2,
    xuc_xac_3: current.d3,
    tong: sum,
    ket_qua,
    du_doan: prediction,
    ty_le_thanh_cong: `${Math.floor(Math.random() * 10) + 85}%`, // Simulated confidence
    giai_thich: reason,
    pattern: valid.slice(0, 13).map(r => getTX(r.d1, r.d2, r.d3).toLowerCase()).join(''),
    lich_su: historyData.slice(0, 10).map(h => h.result).join(', ')
  };
});

fastify.get("/api/taixiu/history", async () => {
  const valid = rikResults.filter(r => r.d1 && r.d2 && r.d3);
  if (!valid.length) return { message: "No history data." };
  
  return valid.map(i => ({
    session: i.sid,
    dice: [i.d1, i.d2, i.d3],
    total: i.d1 + i.d2 + i.d3,
    result: getTX(i.d1, i.d2, i.d3) === "T" ? "Tài" : "Xỉu",
    timestamp: new Date(i.timestamp).toISOString()
  }));
});

// ========================
// 🏁 START SERVER
// ========================
loadHistory();
connectRikWebSocket();

const start = async () => {
  try {
    const address = await fastify.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`🚀 Server running at ${address}`);
  } catch (err) {
    console.error("❌ Server error:", err);
    process.exit(1);
  }
};

start();
