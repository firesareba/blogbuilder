"use strict";

/**
 * Google (Gemini) AI Provider
 * --------------------------
 * Native implementation for Gemini's API format.
 */

async function generateOperations({ apiKey, model, instruction, elements }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-1.5-flash"}:generateContent?key=${apiKey}`;
  
  const systemPrompt = `You are a visual website builder assistant. 
Return ONLY a JSON array of operations. No markdown, no preamble.
Elements available: ${JSON.stringify(elements)}`;

  const body = {
    contents: [{
      parts: [{ text: `${systemPrompt}\n\nInstruction: ${instruction}` }]
    }]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Gemini API error");

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  // Strip potential markdown code fences
  const jsonStr = text.replace(/```json|```/g, "").trim();
  return JSON.parse(jsonStr);
}

async function articleAssist({ apiKey, model, action, text, context }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-1.5-flash"}:generateContent?key=${apiKey}`;
  
  const prompts = {
    continue: "Continue writing this blog post naturally:",
    rewrite: "Rewrite this text to be clearer and more engaging:",
    shorten: "Make this text significantly more concise:",
    expand: "Expand on these ideas with more detail and examples:",
    fix_grammar: "Fix any grammar or spelling errors in this text:",
    change_tone: "Change the tone of this text to be more professional yet accessible:",
    brainstorm: "Brainstorm 5 related ideas or sections for this blog post:",
    generate_outline: "Generate a structured outline for a post based on this text:",
    generate_title: "Suggest 5 punchy, SEO-friendly titles for this post:"
  };

  const prompt = prompts[action] || prompts.rewrite;
  const body = {
    contents: [{
      parts: [{ text: `${prompt}\n\nContext (Title): ${context}\n\nText: ${text}` }]
    }]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Gemini API error");

  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

module.exports = { generateOperations, articleAssist };
