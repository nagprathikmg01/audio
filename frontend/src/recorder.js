export class AudioRecorder {
    constructor(onChunk) {
        this.mediaRecorder = null;
        this.stream = null;
        this.onChunk = onChunk; // Callback to send data to websocket
    }

    async start() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Prefer webm/opus if available
            let options = { mimeType: 'audio/webm;codecs=opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options = { mimeType: 'audio/webm' };
            }

            this.mediaRecorder = new MediaRecorder(this.stream, options);

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0 && this.onChunk) {
                    this.onChunk(event.data);
                }
            };

            // Emit data every 2000ms
            this.mediaRecorder.start(2000);
            return true;
        } catch (error) {
            console.error('Error accessing microphone:', error);
            return false;
        }
    }

    stop() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
    }
}
