const Fastify = require("fastify");
const cors = require("@fastify/cors");
const WebSocket = require("ws");

const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsImdlbmRlciI6MCwiZGlzcGxheU5hbWUiOiJhcGlzdW53aW52YyIsInBob25lVmVyaWZpZWQiOmZhbHNlLCJib3QiOjAsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8yMC5wbmciLCJ1c2VySWQiOiJkOTNkM2Q4NC1mMDY5LTRiM2YtOGRhYy1iNDcxNmE4MTIxNDMiLCJyZWdUaW1lIjoxNzUyMDQ1ODkzMjkyLCJwaG9uZSI6IiIsImN1c3RvbWVySWQiOjI3NjQ3ODE3MywiYnJhbmQiOiJzdW4ud2luIiwidXNlcm5hbWUiOiJTQ19hcGlzdW53aW4xMjMiLCJ0aW1lc3RhbXAiOjE3NTI4NTQ4NjY1OTJ9.CUtQHHxKv-Rk9O-BY0m6UnS61JfIAO_SJt1c19W4xfM";

const fastify = Fastify({ logger: false });
const PORT = process.env.PORT || 3001;

// Biến lưu trữ dữ liệu
let rikResults = [];
let rikCurrentSession = null;
let currentSessionData = null;
let rikWS = null;
let rikInterval = null;

// Giải mã tin nhắn binary
function decodeBinaryMessage(buffer) {
  try {
    const str = buffer.toString();
    if (str.startsWith("[")) return JSON.parse(str);
    
    let position = 0;
    const result = [];
    
    while (position < buffer.length) {
      const type = buffer.readUInt8(position++);
      
      if (type === 1) { // String
        const length = buffer.readUInt16BE(position);
        position += 2;
        result.push(buffer.toString('utf8', position, position + length));
        position += length;
      } 
      else if (type === 2) { // Number
        result.push(buffer.readInt32BE(position));
        position += 4;
      }
      else if (type === 3) { // Object
        const length = buffer.readUInt16BE(position);
        position += 2;
        result.push(JSON.parse(buffer.toString('utf8', position, position + length)));
        position += length;
      }
      else {
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
  const sum = d1 + d2 + d3;
  return sum >= 11 ? "Tài" : "Xỉu";
}

// Gửi lệnh lấy lịch sử
function sendCmd1005() {
  if (rikWS?.readyState === WebSocket.OPEN) {
    rikWS.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
  }
}

// Gửi lệnh lấy thông tin phiên hiện tại
function sendCmd1008() {
  if (rikWS?.readyState === WebSocket.OPEN && rikCurrentSession) {
    rikWS.send(JSON.stringify([
      6, 
      "MiniGame", 
      "taixiuPlugin", 
      { 
        cmd: 1008,
        sid: rikCurrentSession 
      }
    ]));
  }
}

// Thuật toán dự đoán
function predictNext(history) {
  if (history.length < 4) {
    return { 
      prediction: history.at(-1) || "Tài", 
      confidence: Math.floor(Math.random() * 46) + 55 
    };
  }

  const last = history.at(-1);

  // Cầu bệt (4 kết quả giống nhau)
  if (history.slice(-4).every(k => k === last)) {
    return { 
      prediction: last, 
      confidence: Math.floor(Math.random() * 21) + 80 
    };
  }

  // Cầu 2-2
  if (history.length >= 4 &&
      history.at(-1) === history.at(-2) &&
      history.at(-3) === history.at(-4) &&
      history.at(-1) !== history.at(-3)) {
    return { 
      prediction: last === "Tài" ? "Xỉu" : "Tài", 
      confidence: 75 
    };
  }

  // Mặc định
  const count = history.reduce((acc, val) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
  
  return { 
    prediction: (count["Tài"] || 0) > (count["Xỉu"] || 0) ? "Xỉu" : "Tài",
    confidence: Math.floor(Math.random() * 21) + 65
  };
}

function connectWebSocket() {
  console.log("🔌 Kết nối WebSocket SunWin...");
  
  rikWS = new WebSocket(`wss://websocket.azhkthg1.net/websocket?token=${TOKEN}`);

  rikWS.on("open", () => {
    console.log("✅ Kết nối thành công");
    
    // Gửi lệnh xác thực
    rikWS.send(JSON.stringify([
      1,
      "MiniGame",
      "SC_apisunwin123",
      "binhtool90",
      {
        "info": "{\"ipAddress\":\"14.191.224.110\",\"wsToken\":\"...\",\"userId\":\"d93d3d84-f069-4b3f-8dac-b4716a812143\"}",
        "signature": "6099DBA6FDBA7D5CA88084542CC1A1F0E2E923B5BE0EE3C18AF7FC9956418868...",
        "pid": 5,
        "subi": true
      }
    ]));

    // Thiết lập interval gửi lệnh
    clearInterval(rikInterval);
    rikInterval = setInterval(() => {
      sendCmd1005(); // Lấy lịch sử
      sendCmd1008(); // Lấy phiên hiện tại
    }, 5000);
  });

  rikWS.on("message", (data) => {
    try {
      const json = typeof data === 'string' ? JSON.parse(data) : decodeBinaryMessage(data);
      if (!json) return;

      // Xử lý lịch sử từ cmd 1005
      if (Array.isArray(json) && json[1]?.htr) {
        rikResults = json[1].htr
          .map(item => ({
            sid: item.sid,
            d1: item.d1,
            d2: item.d2,
            d3: item.d3,
            result: getTX(item.d1, item.d2, item.d3)
          }))
          .sort((a, b) => b.sid - a.sid)
          .slice(0, 50);

        console.log(`📊 Đã cập nhật lịch sử (${rikResults.length} phiên)`);
      }

      // Xử lý phiên hiện tại từ cmd 1008
      if (Array.isArray(json) && json[3]?.res?.sid) {
        const res = json[3].res;
        
        if (!rikCurrentSession || res.sid > rikCurrentSession) {
          rikCurrentSession = res.sid;
          currentSessionData = {
            sid: res.sid,
            d1: res.d1,
            d2: res.d2,
            d3: res.d3,
            result: getTX(res.d1, res.d2, res.d3),
            timestamp: Date.now()
          };

          console.log(`🔄 Phiên hiện tại: ${res.sid} (${currentSessionData.result})`);
        }
      }

    } catch (e) {
      console.error("❌ Lỗi xử lý message:", e);
    }
  });

  rikWS.on("close", () => {
    console.log("🔴 Ngắt kết nối WebSocket. Đang kết nối lại...");
    setTimeout(connectWebSocket, 5000);
  });

  rikWS.on("error", (err) => {
    console.error("🔴 WebSocket error:", err.message);
  });
}

// Khởi tạo API
fastify.register(cors);

fastify.get("/api/taixiu/sunwin", async () => {
  if (!rikCurrentSession || !currentSessionData) {
    return { error: "Đang tải dữ liệu..." };
  }

  const history = rikResults.slice(0, 10).map(r => r.result);
  const { prediction, confidence } = predictNext(history);

  return {
    status: "success",
    current_session: {
      id: rikCurrentSession,
      dice: [currentSessionData.d1, currentSessionData.d2, currentSessionData.d3],
      result: currentSessionData.result,
      timestamp: currentSessionData.timestamp
    },
    history: rikResults.slice(0, 10).map(r => ({
      id: r.sid,
      result: r.result
    })),
    prediction: {
      next_result: prediction,
      confidence: `${confidence}%`,
      pattern: history.map(r => r === "Tài" ? "T" : "X").join("")
    }
  };
});

// Khởi động server
const start = async () => {
  try {
    connectWebSocket();
    await fastify.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`🚀 API đang chạy trên port ${PORT}`);
  } catch (err) {
    console.error("❌ Lỗi khởi động server:", err);
    process.exit(1);
  }
};

start();
