const Fastify = require("fastify");
const cors = require("@fastify/cors");
const WebSocket = require("ws");

const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsImdlbmRlciI6MCwiZGlzcGxheU5hbWUiOiJhcGlzdW53aW52YyIsInBob25lVmVyaWZpZWQiOmZhbHNlLCJib3QiOjAsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8yMC5wbmciLCJ1c2VySWQiOiJkOTNkM2Q4NC1mMDY5LTRiM2YtOGRhYy1iNDcxNmE4MTIxNDMiLCJyZWdUaW1lIjoxNzUyMDQ1ODkzMjkyLCJwaG9uZSI6IiIsImN1c3RvbWVySWQiOjI3NjQ3ODE3MywiYnJhbmQiOiJzdW4ud2luIiwidXNlcm5hbWUiOiJTQ19hcGlzdW53aW4xMjMiLCJ0aW1lc3RhbXAiOjE3NTI4NTQ4NjY1OTJ9.CUtQHHxKv-Rk9O-BY0m6UnS61JfIAO_SJt1c19W4xfM";

const fastify = Fastify({ logger: false });
const PORT = process.env.PORT || 3001;

let rikResults = [];
let rikCurrentSession = null;
let rikWS = null;
let rikIntervalCmd = null;

// Binary message decoder
function decodeBinaryMessage(buffer) {
  try {
    // First try to parse as JSON
    const str = buffer.toString();
    if (str.startsWith("[")) {
      return JSON.parse(str);
    }
    
    // If not JSON, try to parse as binary message
    let position = 0;
    const result = [];
    
    while (position < buffer.length) {
      const type = buffer.readUInt8(position++);
      
      if (type === 1) { // String
        const length = buffer.readUInt16BE(position);
        position += 2;
        const str = buffer.toString('utf8', position, position + length);
        position += length;
        result.push(str);
      } 
      else if (type === 2) { // Number
        const num = buffer.readInt32BE(position);
        position += 4;
        result.push(num);
      }
      else if (type === 3) { // Object
        const length = buffer.readUInt16BE(position);
        position += 2;
        const objStr = buffer.toString('utf8', position, position + length);
        position += length;
        result.push(JSON.parse(objStr));
      }
      else if (type === 4) { // Array
        const length = buffer.readUInt16BE(position);
        position += 2;
        const arrStr = buffer.toString('utf8', position, position + length);
        position += length;
        result.push(JSON.parse(arrStr));
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
  return sum >= 11 ? "T" : "X";
}

function sendRikCmd1005() {
  if (rikWS && rikWS.readyState === WebSocket.OPEN) {
    const payload = [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }];
    rikWS.send(JSON.stringify(payload));
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
        "info": "{\"ipAddress\":\"14.191.224.110\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsImdlbmRlciI6MCwiZGlzcGxheU5hbWUiOiJhcGlzdW53aW52YyIsInBob25lVmVyaWZpZWQiOmZhbHNlLCJib3QiOjAsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8yMC5wbmciLCJ1c2VySWQiOiJkOTNkM2Q4NC1mMDY5LTRiM2YtOGRhYy1iNDcxNmE4MTIxNDMiLCJyZWdUaW1lIjoxNzUyMDQ1ODkzMjkyLCJwaG9uZSI6IiIsImN1c3RvbWVySWQiOjI3NjQ3ODE3MywiYnJhbmQiOiJzdW4ud2luIiwidXNlcm5hbWUiOiJTQ19hcGlzdW53aW4xMjMiLCJ0aW1lc3RhbXAiOjE3NTI4NTQ4NjY1OTJ9.CUtQHHxKv-Rk9O-BY0m6UnS61JfIAO_SJt1c19W4xfM\",\"userId\":\"d93d3d84-f069-4b3f-8dac-b4716a812143\\",\"username\":\"SC_apisunwin123\",\"timestamp\":1752854866592}",
        "signature": "6099DBA6FDBA7D5CA88084542CC1A1F0E2E923B5BE0EE3C18AF7FC9956418868A620B9A8348021D7A86D6E3261A359D14250FEC3746DABD0FC73A299D9C880893EAF2BDFFD3B16CB2F081E021E8B19AF87354FA4F0F27631CCBD5DA3767A75E014BEDEEABF9DD4BEF9D38376082CAECF79B306D902F76C65AE7E077271A98241",
        "pid": 5,
        "subi": true
      }
    ];
    rikWS.send(JSON.stringify(authPayload));
    clearInterval(rikIntervalCmd);
    rikIntervalCmd = setInterval(sendRikCmd1005, 5000);
  });

  rikWS.on("message", (data) => {
    try {
      // Handle both binary and text messages
      const json = typeof data === 'string' ? JSON.parse(data) : decodeBinaryMessage(data);

      if (!json) return;

      // Nhận phiên mới realtime
      if (Array.isArray(json) && json[3]?.res?.d1 && json[3]?.res?.sid) {
        const result = json[3].res;
        
        if (!rikCurrentSession || result.sid > rikCurrentSession) {
          rikCurrentSession = result.sid;

          rikResults.unshift({
            sid: result.sid,
            d1: result.d1,
            d2: result.d2,
            d3: result.d3
          });

          if (rikResults.length > 50) rikResults.pop();

          console.log(`📥 Phiên mới ${result.sid} → ${getTX(result.d1, result.d2, result.d3)}`);
          
          setTimeout(() => {
            if (rikWS) rikWS.close();
            connectRikWebSocket();
          }, 1000);
        }
      }

      // Nhận lịch sử ban đầu
      else if (Array.isArray(json) && json[1]?.htr) {
        const history = json[1].htr
          .map((item) => ({
            sid: item.sid,
            d1: item.d1,
            d2: item.d2,
            d3: item.d3,
          }))
          .sort((a, b) => b.sid - a.sid);

        rikResults = history.slice(0, 50);
        console.log("📦 Đã tải lịch sử các phiên gần nhất.");
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

connectRikWebSocket();

fastify.register(cors);

fastify.get("/api/taixiu/sunwin", async () => {
  const validResults = rikResults.filter(item => item.d1 && item.d2 && item.d3);

  if (validResults.length === 0) {
    return { message: "Không có dữ liệu." };
  }

  const current = validResults[0];
  const sum = current.d1 + current.d2 + current.d3;
  const ket_qua = sum >= 11 ? "Tài" : "Xỉu";

  return {
    phien: current.sid,
    xuc_xac_1: current.d1,
    xuc_xac_2: current.d2,
    xuc_xac_3: current.d3,
    tong: sum,
    ket_qua: ket_qua
  };
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
