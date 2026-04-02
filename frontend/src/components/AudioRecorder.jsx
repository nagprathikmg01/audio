import { useState, useRef, useEffect } from "react";
import { createWebSocket } from "../api";

const CHUNK_INTERVAL_MS = 3000;

export default function AudioRecorder({ onLiveUpdate, onResult, onAnalyzing, onStart }) {
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [status, setStatus] = useState("idle");
    const [errorMsg, setErrorMsg] = useState("");
    const [waveformBars, setWaveformBars] = useState(Array(32).fill(4));

    const mediaRecorderRef = useRef(null);
    const wsRef = useRef(null);
    const streamRef = useRef(null);
    const timerRef = useRef(null);
    const startTimeRef = useRef(null);
    const animFrameRef = useRef(null);
    const recognitionRef = useRef(null);

    useEffect(() => {
        return () => stopAllMedia();
    }, []);

    function stopAllMedia() {
        if (timerRef.current) clearInterval(timerRef.current);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
        if (recognitionRef.current) {
            recognitionRef.current.stop();
        }
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.close();
        }
    }

    function animateWaveform(analyser) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        const step = Math.floor(data.length / 32);

        function frame() {
            analyser.getByteFrequencyData(data);
            const bars = Array.from({ length: 32 }, (_, i) => {
                const val = data[i * step] || 0;
                return Math.max(4, Math.round((val / 255) * 40));
            });
            setWaveformBars(bars);
            animFrameRef.current = requestAnimationFrame(frame);
        }
        animFrameRef.current = requestAnimationFrame(frame);
    }

    async function startRecording() {
        setErrorMsg("");
        if (onStart) onStart(); // Signal parent to clear old UI state dynamically

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            animateWaveform(analyser);

            const ws = createWebSocket();
            wsRef.current = ws;

            ws.onopen = () => {
                setStatus("recording");
                setIsRecording(true);
                startTimeRef.current = Date.now();
                setRecordingTime(0);

                timerRef.current = setInterval(() => {
                    setRecordingTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
                }, 1000);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === "transcript") {
                        onLiveUpdate(data);
                    } else if (data.type === "final") {
                        onResult(data);
                        onAnalyzing(false);
                    } else if (data.type === "error") {
                        console.warn("WS error:", data.message);
                    }
                } catch (e) {
                    console.error("WS parse error", e);
                }
            };

            ws.onerror = () => {
                setErrorMsg("WebSocket error. Ensure backend is running.");
                stopRecording();
            };

            ws.onclose = () => {
                if (isRecording) stopRecording();
            };

            const recorder = new MediaRecorder(stream, {
                mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                    ? "audio/webm;codecs=opus"
                    : "audio/webm",
            });
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = async (e) => {
                if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
                    const buffer = await e.data.arrayBuffer();
                    ws.send(buffer);
                }
            };

            recorder.start(CHUNK_INTERVAL_MS);

            // True Live Transcription mapping via Browser
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                const recognition = new SpeechRecognition();
                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.lang = 'en-US';

                recognition.onresult = (event) => {
                    let liveTranscript = "";
                    for (let i = 0; i < event.results.length; i++) {
                        liveTranscript += event.results[i][0].transcript;
                    }
                    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ type: "live_text", text: liveTranscript }));
                    }
                };
                
                recognition.onerror = (e) => console.warn("Speech error:", e.error);
                recognition.start();
                recognitionRef.current = recognition;
            }
        } catch (err) {
            setErrorMsg(err.name === "NotAllowedError" ? "Microphone permission denied." : err.message);
            setStatus("idle");
        }
    }

    function stopRecording() {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
        }
        if (recognitionRef.current) {
            recognitionRef.current.stop();
        }
        if (timerRef.current) clearInterval(timerRef.current);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());

        setWaveformBars(Array(32).fill(4));
        setIsRecording(false);
        setStatus("processing");
        onAnalyzing(true);

        setTimeout(() => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send("DONE");
            }
        }, 500);
    }

    const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

    return (
        <div className="glass-card p-4 sm:p-6 mb-6 animate-fade-in flex flex-col sm:flex-row items-center gap-6 shadow-xl border border-white/10 rounded-2xl relative">
            {/* Left: Button Container */}
            <div className="shrink-0 w-full sm:w-auto">
                {!isRecording ? (
                    <button
                        onClick={startRecording}
                        disabled={status === "processing"}
                        className="btn-primary w-full sm:w-56 h-14 text-base justify-center shadow-lg hover:scale-105 active:scale-95 transition-all"
                    >
                        <span className="text-xl mr-2">🟢</span>
                        {status === "processing" ? "Processing..." : "Start Interview"}
                    </button>
                ) : (
                    <button 
                        onClick={stopRecording} 
                        className="btn-danger w-full sm:w-56 h-14 text-base justify-center shadow-lg hover:scale-105 active:scale-95 transition-all"
                    >
                        <span className="text-xl mr-2">⏹️</span> Stop Recording
                    </button>
                )}
            </div>

            {/* Middle: Waveform and Status */}
            <div className="flex-1 w-full flex items-center justify-center sm:justify-start gap-4 mx-4">
                <div className="flex items-center gap-[3px] h-14 px-5 bg-black/40 rounded-xl w-full max-w-sm border border-white/5 shadow-inner">
                    {waveformBars.map((h, i) => (
                        <div
                            key={i}
                            className={`w-1.5 rounded-full transition-all duration-75 ${
                                isRecording ? "bg-primary shadow-[0_0_8px_rgba(var(--primary-rgb),0.6)]" : "bg-white/20"
                            }`}
                            style={{ height: `${h}px` }}
                        />
                    ))}
                </div>
            </div>

            {/* Right: Timer & Error */}
            <div className="shrink-0 text-right flex flex-col items-center sm:items-end min-w-[120px]">
                <span className={`text-4xl font-mono font-bold tabular-nums tracking-tight ${isRecording ? "text-primary drop-shadow-[0_0_12px_rgba(var(--primary-rgb),0.5)]" : "text-gray-600"}`}>
                    {formatTime(recordingTime)}
                </span>
                
                {isRecording && (
                    <div className="flex items-center gap-2 mt-2 bg-red-500/10 px-3 py-1 rounded-full border border-red-500/20">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-red-400 text-xs font-bold tracking-wide uppercase">Live</span>
                    </div>
                )}
            </div>

            {/* Error Message */}
            {errorMsg && (
                <div className="absolute -bottom-14 left-0 right-0 xl:-right-60 xl:left-auto xl:bottom-auto xl:top-0 p-3 bg-red-500/90 backdrop-blur text-white rounded-xl text-sm flex items-center gap-2 shadow-xl z-50 animate-slide-up">
                    <span className="text-lg">⚠️</span>
                    <span className="font-medium">{errorMsg}</span>
                </div>
            )}
        </div>
    );
}
