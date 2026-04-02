export class RealtimeWebSocket {
    constructor(url, onMessage, onError, onClose) {
        this.url = url;
        this.ws = null;
        this.onMessage = onMessage;
        this.onError = onError;
        this.onClose = onClose;
    }

    connect() {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            console.log("WebSocket connected.");
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (this.onMessage) this.onMessage(data);
            } catch (err) {
                console.error("Message parsing error:", err);
            }
        };

        this.ws.onerror = (error) => {
            console.error("WebSocket error:", error);
            if (this.onError) this.onError(error);
        };

        this.ws.onclose = () => {
            console.log("WebSocket closed.");
            if (this.onClose) this.onClose();
        };
    }

    sendAudioBytes(blob) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(blob);
        }
    }

    sendText(text) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(text);
        }
    }

    close() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
