import { useState, useRef, useCallback, useEffect } from "react";
import { createWebSocket, analyzeAudio } from "../api";

const CHUNK_INTERVAL_MS = 3000;

/**
 * AudioRecorder — handles both file upload and real-time mic recording.
 * Exposes live analysis updates via onLiveUpdate and final result via onResult.
 */
export default function AudioRecorder({ onLiveUpdate, onResult, onAnalyzing }) {
    const [mode, setMode] = useState("upload"); // "upload" | "record"
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [uploadedFile, setUploadedFile] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const [status, setStatus] = useState("idle"); // "idle" | "recording" | "processing" | "error"
    const [errorMsg, setErrorMsg] = useState("");
    const [waveformBars, setWaveformBars] = useState(Array(32).fill(4));

    const fileInputRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const wsRef = useRef(null);
    const streamRef = useRef(null);
    const timerRef = useRef(null);
    const chunkTimerRef = useRef(null);
    const startTimeRef = useRef(null);
    const analyserRef = useRef(null);
    const animFrameRef = useRef(null);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopAllMedia();
        };
    }, []);

    function stopAllMedia() {
        if (timerRef.current) clearInterval(timerRef.current);
        if (chunkTimerRef.current) clearInterval(chunkTimerRef.current);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.close();
        }
    }

    // Animate waveform using AnalyserNode
    function animateWaveform(analyser) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        const step = Math.floor(data.length / 32);

        function frame() {
            analyser.getByteFrequencyData(data);
            const bars = Array.from({ length: 32 }, (_, i) => {
                const val = data[i * step] || 0;
                return Math.max(4, Math.round((val / 255) * 60));
            });
            setWaveformBars(bars);
            animFrameRef.current = requestAnimationFrame(frame);
        }
        animFrameRef.current = requestAnimationFrame(frame);
    }

    // ── File Upload ──────────────────────────────────────────────────────────

    function handleDrop(e) {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelect(file);
    }

    function handleFileSelect(file) {
        if (!file) return;
        const allowed = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/webm", "audio/ogg", "audio/mp4"];
        if (!allowed.includes(file.type) && !file.name.match(/\.(mp3|wav|webm|ogg|m4a)$/i)) {
            setErrorMsg("Please upload an audio file (mp3, wav, webm, ogg).");
            return;
        }
        setErrorMsg("");
        setUploadedFile(file);
        setStatus("idle");
        onLiveUpdate(null);
        onResult(null);
    }

    async function handleUploadAnalyze() {
        if (!uploadedFile) return;
        setStatus("processing");
        onAnalyzing(true);
        setErrorMsg("");

        try {
            // Get duration
            const duration = await getAudioDuration(uploadedFile);
            const result = await analyzeAudio(uploadedFile, duration);
            onResult(result);
        } catch (err) {
            console.error(err);
            setErrorMsg(err?.response?.data?.detail || "Analysis failed. Is the backend running?");
        } finally {
            setStatus("idle");
            onAnalyzing(false);
        }
    }

    function getAudioDuration(file) {
        return new Promise((resolve) => {
            const audio = new Audio();
            audio.onloadedmetadata = () => resolve(audio.duration || 30);
            audio.onerror = () => resolve(30);
            audio.src = URL.createObjectURL(file);
        });
    }

    // ── Mic Recording ────────────────────────────────────────────────────────

    async function startRecording() {
        setErrorMsg("");
        onLiveUpdate(null);
        onResult(null);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            // Set up analyser for waveform
            const ctx = new AudioContext();
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserRef.current = analyser;
            animateWaveform(analyser);

            // Open WebSocket
            const ws = createWebSocket();
            wsRef.current = ws;

            ws.onopen = () => {
                setStatus("recording");
                setIsRecording(true);
                startTimeRef.current = Date.now();

                // Timer
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

            ws.onerror = (e) => {
                setErrorMsg("WebSocket error. Ensure backend is running.");
                stopRecording();
            };

            ws.onclose = () => {
                if (isRecording) stopRecording();
            };

            // MediaRecorder — send chunks every 3s
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
        } catch (err) {
            if (err.name === "NotAllowedError") {
                setErrorMsg("Microphone permission denied. Please allow mic access.");
            } else {
                setErrorMsg(`Could not start recording: ${err.message}`);
            }
            setStatus("idle");
        }
    }

    function stopRecording() {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
        }
        if (timerRef.current) clearInterval(timerRef.current);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());

        setWaveformBars(Array(32).fill(4));
        setIsRecording(false);
        setStatus("processing");
        onAnalyzing(true);

        // Signal backend to finalize
        setTimeout(() => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send("DONE");
            }
        }, 500);
    }

    const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

    return (
        <div className="glass-card p-6 animate-fade-in">
            <p className="section-title">Audio Input</p>

            {/* Mode Tabs */}
            <div className="flex gap-2 mb-6">
                {["upload", "record"].map((m) => (
                    <button
                        key={m}
                        onClick={() => { setMode(m); setErrorMsg(""); setUploadedFile(null); onResult(null); onLiveUpdate(null); }}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${mode === m
                                ? "bg-primary text-white shadow-lg shadow-primary/25"
                                : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/10"
                            }`}
                    >
                        {m === "upload" ? "📁 Upload File" : "🎙️ Live Record"}
                    </button>
                ))}
            </div>

            {/* ── Upload Mode ── */}
            {mode === "upload" && (
                <div className="space-y-4">
                    <div
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-300 ${isDragging
                                ? "border-primary bg-primary/10 scale-[1.01]"
                                : "border-white/15 hover:border-primary/40 hover:bg-white/5"
                            }`}
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="audio/*"
                            className="hidden"
                            onChange={(e) => handleFileSelect(e.target.files[0])}
                        />
                        <div className="text-5xl mb-3">{uploadedFile ? "🎵" : "☁️"}</div>
                        {uploadedFile ? (
                            <>
                                <p className="text-white font-semibold">{uploadedFile.name}</p>
                                <p className="text-gray-400 text-sm mt-1">
                                    {(uploadedFile.size / 1024).toFixed(0)} KB — click to change
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="text-gray-300 font-medium">Drop audio file here or click to browse</p>
                                <p className="text-gray-500 text-sm mt-1">Supports mp3, wav, webm, ogg</p>
                            </>
                        )}
                    </div>

                    <button
                        onClick={handleUploadAnalyze}
                        disabled={!uploadedFile || status === "processing"}
                        className="btn-primary w-full justify-center"
                    >
                        {status === "processing" ? (
                            <>
                                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                </svg>
                                Analyzing…
                            </>
                        ) : (
                            <> <span>🔍</span> Analyze Audio </>
                        )}
                    </button>
                </div>
            )}

            {/* ── Record Mode ── */}
            {mode === "record" && (
                <div className="space-y-5">
                    {/* Waveform */}
                    <div className="flex items-center justify-center gap-[2px] h-16 px-4 bg-black/20 rounded-xl overflow-hidden">
                        {waveformBars.map((h, i) => (
                            <div
                                key={i}
                                className={`w-1.5 rounded-full transition-all duration-75 ${isRecording ? "bg-primary" : "bg-white/20"
                                    }`}
                                style={{ height: `${h}px` }}
                            />
                        ))}
                    </div>

                    {/* Timer */}
                    <div className="text-center">
                        <span className={`text-4xl font-mono font-bold tabular-nums ${isRecording ? "text-primary" : "text-gray-500"}`}>
                            {formatTime(recordingTime)}
                        </span>
                        {isRecording && (
                            <div className="flex items-center justify-center gap-2 mt-1">
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                <span className="text-red-400 text-sm font-medium">Recording</span>
                            </div>
                        )}
                        {status === "processing" && (
                            <p className="text-primary-light text-sm mt-1 animate-pulse">Processing your recording…</p>
                        )}
                    </div>

                    {/* Buttons */}
                    <div className="flex gap-3">
                        {!isRecording ? (
                            <button
                                onClick={startRecording}
                                disabled={status === "processing"}
                                className="btn-primary flex-1 justify-center"
                            >
                                <span>🎙️</span> Start Recording
                            </button>
                        ) : (
                            <button onClick={stopRecording} className="btn-danger flex-1 justify-center">
                                <span>⏹️</span> Stop & Analyze
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Error */}
            {errorMsg && (
                <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-start gap-2">
                    <span className="mt-0.5">⚠️</span>
                    <span>{errorMsg}</span>
                </div>
            )}
        </div>
    );
}
