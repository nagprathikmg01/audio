import axios from "axios";

// Using the exact Render backend URL you provided unconditionally
const PROD_API_URL = "https://audio-1-3e7o.onrender.com";
const PROD_WS_URL = "wss://audio-1-3e7o.onrender.com/ws";

const api = axios.create({
    baseURL: PROD_API_URL, // Always use Render backend, even locally
    timeout: 120000,
});

/**
 * Upload an audio file for full analysis.
 * @param {File} audioFile
 * @param {number} durationSeconds
 * @returns {Promise<AnalysisResult>}
 */
export async function analyzeAudio(audioFile, durationSeconds = 0) {
    const form = new FormData();
    form.append("file", audioFile);
    form.append("duration", String(durationSeconds));

    const response = await api.post("/analyze", form, {
        headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
}

/**
 * Health check
 */
export async function healthCheck() {
    const response = await api.get("/health");
    return response.data;
}

/**
 * Create a WebSocket connection to the streaming endpoint.
 * @returns {WebSocket}
 */
export function createWebSocket() {
    // Always use Render WebSocket, even locally
    return new WebSocket(PROD_WS_URL);
}
