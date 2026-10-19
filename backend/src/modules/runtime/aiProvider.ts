import { config } from "../../infra/config";


//  AI generative reply

export async function generateAiReply(prompt: string): Promise<string> {

    if (!config.GEMINI_API_KEY) throw new Error("AI API Key is not configured")

    const model = "gemini-3.8-flash"
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-type": "application/json",
            "x-goog-api-key": config.GEMINI_API_KEY
        },
        body: JSON.stringify({
            contents: [{
                parts: [{
                    text: prompt
                }]
            }]
        })
    })


    if (!response.ok) {
        const errText = await response.text()
        throw new Error(`AI API Error:  ${response.status} ${errText}`)
    }

    const data = await response.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text  // -------------------->>>>>>>>>> extracting text out of the response 

    if (!text) throw new Error("AI returned no text")
    return text.trim()



}

// Ask Gemini for a JSON response (used by the AI journey generator). Uses the
// model's JSON response mode so we get parseable output, and strips any
// stray code fences before parsing.
export async function generateJson(
    prompt: string,
    opts: { temperature?: number; maxOutputTokens?: number } = {}
): Promise<any> {
    if (!config.GEMINI_API_KEY) throw new Error("AI API Key is not configured");

    const model = "gemini-3.8-flash";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-type": "application/json",
            "x-goog-api-key": config.GEMINI_API_KEY,
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                temperature: opts.temperature ?? 0.4,
                // Large diagrams produce large workflows; without an explicit
                // limit the default can cut the JSON off mid-way.
                maxOutputTokens: opts.maxOutputTokens ?? 32768,
            },
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI API Error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    if (candidate?.finishReason === "MAX_TOKENS") {
        throw new Error("AI_OUTPUT_TRUNCATED: the generated flow was too long and got cut off");
    }
    // Join all text parts (long answers can be split across several).
    let text: string | undefined = (candidate?.content?.parts ?? [])
        .map((p: any) => p?.text ?? "")
        .join("") || undefined;
    if (!text) throw new Error("AI returned no text");

    // Strip ```json fences if the model added them despite JSON mode.
    text = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

    try {
        return JSON.parse(text);
    } catch {
        throw new Error("AI returned invalid JSON");
    }
}