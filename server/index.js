import "dotenv/config";
import express from "express";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 3001;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const SYSTEM_PROMPT =
  "You are a helpful, concise assistant. Use Markdown for code and lists.";

if (!process.env.GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY in server/.env");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const app = express();
app.use(express.json({ limit: "1mb" }));

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  // 1. Validate input
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array" });
  }

  // 2. Translate our roles to Gemini's roles ("assistant" -> "model")
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.content) }],
  }));

  // 3. Open a streaming (SSE) response
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // 4. Notice if the browser disconnects, so we stop wasting work
  let clientClosed = false;
  res.on("close", () => {
    clientClosed = true;
  });

  try {
    const stream = await ai.models.generateContentStream({
      model: MODEL,
      contents,
      config: { systemInstruction: SYSTEM_PROMPT },
    });

    // 5. Forward each piece to the browser as it arrives
    for await (const chunk of stream) {
      if (clientClosed) break;
      if (chunk.text) {
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
    }

    if (!clientClosed) res.write("data: [DONE]\n\n");
  } catch (err) {
    console.error("Gemini error:", err);
    if (!clientClosed) {
      res.write(
        `data: ${JSON.stringify({ error: "The model request failed. Try again." })}\n\n`
      );
    }
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});