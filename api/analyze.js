// Vercel 서버리스 함수: POST /api/analyze
// 메뉴 사진(A)과 실제 음식 사진(B)을 받아 Claude API로 비교하고, 결과(JSON)를 돌려줍니다.
// API 키는 여기(서버)에만 있고 브라우저에는 절대 노출되지 않습니다.
import { SYSTEM_PROMPT } from "./prompt.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 3);      // 1인(IP)당 하루 무료 비교 횟수
const MAX_BASE64 = 2_000_000;                                     // 사진 한 장당 약 1.5MB까지
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 받아요." });
  }

  // 다른 사이트에서 우리 API를 몰래 쓰지 못하게 막기 (설정한 경우에만)
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed && req.headers.origin && req.headers.origin !== allowed) {
    return res.status(403).json({ error: "허용되지 않은 주소에서 온 요청이에요." });
  }

  const { menuImage, realImage } = req.body || {};
  for (const [img, name] of [[menuImage, "메뉴 사진"], [realImage, "실제 음식 사진"]]) {
    if (!img || typeof img.data !== "string" || !ALLOWED_TYPES.includes(img.mediaType)) {
      return res.status(400).json({ error: `${name}을 JPG, PNG, WEBP로 올려주세요.` });
    }
    if (img.data.length > MAX_BASE64) {
      return res.status(413).json({ error: `${name} 용량이 너무 커요. 더 작은 사진으로 올려주세요.` });
    }
  }

  // 하루 사용 횟수 제한 (Upstash Redis를 연결한 경우)
  const ip = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const remaining = await checkRateLimit(ip);
  if (remaining < 0) {
    return res.status(429).json({ error: `오늘 무료 비교 ${DAILY_LIMIT}회를 모두 썼어요. 내일 다시 이용해주세요.` });
  }

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "사진 A: 메뉴판/배달앱에 올린 메뉴 사진" },
            { type: "image", source: { type: "base64", media_type: menuImage.mediaType, data: menuImage.data } },
            { type: "text", text: "사진 B: 실제로 손님에게 나가는 음식 사진" },
            { type: "image", source: { type: "base64", media_type: realImage.mediaType, data: realImage.data } },
            { type: "text", text: "두 사진을 비교 기준에 따라 비교해주세요. JSON만 출력해주세요." }
          ]
        }]
      })
    });

    if (!apiRes.ok) {
      console.error("Claude API error", apiRes.status, await apiRes.text());
      return res.status(502).json({ error: "지금은 비교할 수 없어요. 잠시 뒤에 다시 시도해주세요." });
    }

    const data = await apiRes.json();
    // 비용 확인용 로그: Vercel 대시보드 > Logs 에서 볼 수 있어요.
    console.log("usage", JSON.stringify(data.usage));

    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    const result = parseResult(text);
    if (!result) {
      return res.status(502).json({ error: "비교 결과를 읽지 못했어요. 다시 시도해주세요." });
    }
    // 사진은 어디에도 저장하지 않고 결과만 돌려줍니다.
    return res.status(200).json({ ...result, remaining });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "알 수 없는 오류가 났어요. 잠시 뒤에 다시 시도해주세요." });
  }
}

// AI 답변에서 JSON만 꺼내고, 형식이 이상하면 바로잡기
export function parseResult(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const r = JSON.parse(text.slice(start, end + 1));
    const score = Math.max(0, Math.min(100, Math.round(Number(r.match_score) || 0)));
    return {
      both_food: r.both_food !== false,
      same_dish: r.same_dish !== false,
      match_score: score,
      level: levelOf(score),
      summary: String(r.summary || ""),
      differences: Array.isArray(r.differences) ? r.differences.slice(0, 6).map((d) => ({
        aspect: String(d.aspect || ""),
        severity: String(d.severity || "중간"),
        menu_photo: String(d.menu_photo || ""),
        real_photo: String(d.real_photo || ""),
        customer_impact: String(d.customer_impact || ""),
        fix: String(d.fix || "")
      })) : [],
      matches: Array.isArray(r.matches) ? r.matches.slice(0, 3).map(String) : [],
      verdict: String(r.verdict || ""),
      next_step: String(r.next_step || "")
    };
  } catch {
    return null;
  }
}

function levelOf(score) {
  if (score >= 80) return "거의 같아요";
  if (score >= 60) return "조금 달라요";
  if (score >= 40) return "차이가 커요";
  return "다른 음식처럼 보여요";
}

// Upstash Redis REST API로 IP별 하루 횟수를 셉니다. 남은 횟수를 돌려주고, 초과하면 -1.
// 환경변수를 넣지 않으면 서버 쪽 제한 없이 동작합니다(브라우저 쪽 제한만 적용).
async function checkRateLimit(ip) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return DAILY_LIMIT;
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:${ip}:${day}`;
  try {
    const r = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify([["INCR", key], ["EXPIRE", key, "86400"]])
    });
    const [incr] = await r.json();
    const used = Number(incr.result);
    return used > DAILY_LIMIT ? -1 : DAILY_LIMIT - used;
  } catch (e) {
    console.error("rate limit check failed", e);
    return DAILY_LIMIT; // 제한 서버에 문제가 있어도 서비스는 계속 동작
  }
}
