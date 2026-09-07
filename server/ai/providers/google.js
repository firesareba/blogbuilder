"use strict";
/**
 * Google (Gemini) AI Provider
 * --------------------------
 * Native Gemini API shape, exposing the same chat() interface as the
 * anthropic/openai providers: ({ apiKey, systemPrompt, userPrompt, model })
 * Gemini has no separate system role, so the system prompt is prepended
 * to the user content.
 */

async function chat({ apiKey, systemPrompt, userPrompt, model }) {
  const name = model || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Gemini API error: ${(data && data.error && data.error.message) || res.statusText}`);
  }
  const text = (data.candidates || [])
    .flatMap((c) => (c.content && c.content.parts) || [])
    .map((p) => p.text || "")
    .join("\n");
  return text;
}

module.exports = { chat };
