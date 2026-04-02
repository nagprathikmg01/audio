import axios from "axios";

const api = axios.create({
    baseURL: import.meta.env.DEV ? "" : "http://localhost:8000",
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
    if (import.meta.env.DEV) {
        return new WebSocket("ws://localhost:8000/ws");
    }
    let wsBase = import.meta.env.VITE_WS_URL;
    if (!wsBase) {
        // Fallback: If no explicit WS URL, derive from window location
        const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        wsBase = `${wsProtocol}//${window.location.host}`;
    }
    // Remove trailing slash if present
    wsBase = wsBase.replace(/\/$/, "");
    return new WebSocket(`${wsBase}/ws`);
}
