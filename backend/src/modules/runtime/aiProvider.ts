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
export async function generateJson(prompt: string): Promise<any> {
    if (!config.GEMINI_API_KEY) throw new Error("AI API Key is not configured");

    const model = "gemini-3.5-flash";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-type": "application/json",
            "x-goog-api-key": config.GEMINI_API_KEY,
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI API Error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    let text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("AI returned no text");

    // Strip ```json fences if the model added them despite JSON mode.
    text = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

    try {
        return JSON.parse(text);
    } catch {
        throw new Error("AI returned invalid JSON");
    }
}