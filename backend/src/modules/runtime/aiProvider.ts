import { config } from "../../infra/config";


//  AI generative reply

export async function generateAiReply(prompt: string): Promise<string> {

    if (!config.GEMINI_API_KEY) throw new Error("AI API Key is not configured")

    const model = "gemini-3.6-flash"
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