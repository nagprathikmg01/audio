import { useState, useEffect, useCallback } from "react";
import AudioRecorder from "./components/AudioRecorder";
import LiveTranscriptViewer from "./components/LiveTranscriptViewer";
import SimilarityGauge from "./components/SimilarityGauge";
import RiskIndicator from "./components/RiskIndicator";
import BehaviorStatsPanel from "./components/BehaviorStatsPanel";
import MatchedPhrasesHighlighter from "./components/MatchedPhrasesHighlighter";
import { healthCheck } from "./api";

function Header() {
  return (
    <header className="border-b border-white/5 bg-black/20 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/20 border border-primary/40 flex items-center justify-center text-lg">
            🧠
          </div>
          <div>
            <h1 className="text-white font-bold text-lg leading-none">AI Interview Integrity</h1>
            <p className="text-gray-500 text-xs mt-0.5">Analyzer v1.0</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <BackendStatus />
        </div>
      </div>
    </header>
  );
}

function BackendStatus() {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let active = true;
    healthCheck()
      .then(() => {
        if (active) setStatus("online");
      })
      .catch(() => {
        if (active) setStatus("offline");
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${status === "online"
        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
        : status === "offline"
          ? "bg-red-500/10 border-red-500/30 text-red-400"
          : "bg-gray-500/10 border-gray-500/30 text-gray-400"
      }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === "online" ? "bg-emerald-400 animate-pulse" :
          status === "offline" ? "bg-red-400" : "bg-gray-400 animate-pulse"
        }`} />
      {status === "online" ? "Backend Online" : status === "offline" ? "Backend Offline" : "Connecting…"}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="glass-card p-10 text-center animate-fade-in">
      <div className="text-6xl mb-4 opacity-40">📊</div>
      <h3 className="text-gray-300 font-semibold text-lg mb-2">Awaiting Interview Analytics</h3>
      <p className="text-gray-500 text-sm max-w-xs mx-auto">
        Results strictly calculate and populate during active recording. Press Start to begin.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-3 text-left">
        {[
          { icon: "🎯", label: "Semantic Similarity", desc: "Embedding-based comparison" },
          { icon: "🤖", label: "LLM Evaluation", desc: "Memorization detection" },
          { icon: "📈", label: "Behavioral Analysis", desc: "Speech pattern metrics" },
        ].map((item) => (
          <div key={item.label} className="bg-black/20 rounded-xl p-3 border border-white/5">
            <span className="text-xl block mb-1">{item.icon}</span>
            <p className="text-white text-xs font-semibold">{item.label}</p>
            <p className="text-gray-500 text-xs mt-0.5">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [result, setResult] = useState(null);
  const [liveUpdate, setLiveUpdate] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleResult = useCallback((r) => {
    if (!r) { setResult(null); return; }
    setResult(r);
    setLiveUpdate(null);
  }, []);

  const handleLiveUpdate = useCallback((update) => {
    setLiveUpdate(update);
  }, []);

  const handleStart = () => {
    // Dynamically clear the canvas specifically whenever recording kicks off
    setResult(null);
    setLiveUpdate(null);
    setIsAnalyzing(false);
  };

  const liveVerdict = liveUpdate?.verdict;
  const liveSimilarity = liveUpdate?.semantic_similarity ?? 0;

  return (
    <div className="min-h-screen">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Hero Banner */}
        <div className="mb-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-2">
            Detect{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-400">
              Scripted Answers
            </span>{" "}
            in Real Time
          </h2>
          <p className="text-gray-400 max-w-xl mx-auto text-sm">
            Powered by sentence embeddings, LLM evaluation, and behavioral speech analysis.
          </p>
        </div>

        {/* Top Explicit Control Deck (Horizontal Flow Base) */}
        <AudioRecorder
            onLiveUpdate={handleLiveUpdate}
            onResult={handleResult}
            onAnalyzing={setIsAnalyzing}
            onStart={handleStart}
        />

        {/* Main Grid Floor */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
          {/* ── Left Column (Live Transcript Viewer Explicitly) ── */}
          <div className="xl:col-span-3 space-y-5">
            <LiveTranscriptViewer
              transcript={result?.transcript}
              liveUpdate={liveUpdate}
              isAnalyzing={isAnalyzing}
            />

            {result && (
              <>
                <MatchedPhrasesHighlighter
                  transcript={result.transcript}
                  matchedPhrases={result.matched_phrases}
                  matchedQuestion={result.matched_question}
                />
                <BehaviorStatsPanel
                  metrics={result.speech_metrics}
                  verdict={result.verdict}
                />
              </>
            )}
          </div>

          {/* ── Right Column (Gauges + Verdict) ── */}
          <div className="xl:col-span-2 space-y-5">
            {/* Gauge panel */}
            <div className="glass-card p-6">
              {/* Main gauge */}
              <div className="flex justify-center mb-6">
                <SimilarityGauge
                  score={result?.final_score ?? liveSimilarity}
                  verdict={result?.verdict ?? liveVerdict ?? (isAnalyzing ? "ANALYZING" : "GENUINE")}
                  label={result ? "Final Risk Score" : liveUpdate ? "Live Similarity" : "Risk Score"}
                />
              </div>

              {/* Sub-gauges */}
              {result && (
                <div className="grid grid-cols-3 gap-3 pt-4 border-t border-white/5">
                  {[
                    { label: "Semantic", value: result.semantic_similarity, emoji: "🔍" },
                    { label: "Memory", value: result.memorization_score, emoji: "🧠" },
                    { label: "Behavior", value: result.behavior_score, emoji: "📊" },
                  ].map((s) => (
                    <div key={s.label} className="text-center bg-black/20 rounded-xl p-3 border border-white/5">
                      <div className="text-lg mb-1">{s.emoji}</div>
                      <div className="text-white font-bold text-lg tabular-nums">
                        {Math.round(s.value * 100)}%
                      </div>
                      <div className="text-gray-500 text-xs">{s.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {!result && !isAnalyzing && (
                <p className="text-center text-gray-500 text-sm mt-2">
                  Awaiting analysis…
                </p>
              )}
            </div>

            {/* Verdict */}
            {result ? (
              <RiskIndicator result={result} />
            ) : (
              <EmptyState />
            )}

            {/* Top matches */}
            {result?.all_scores?.length > 0 && (
              <div className="glass-card p-5 animate-slide-up">
                <p className="section-title">Top Similarity Matches</p>
                <div className="space-y-2">
                  {result.all_scores.slice(0, 4).map((s, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-300 text-xs truncate">{s.question}</p>
                        <div className="mt-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-700"
                            style={{ width: `${Math.round(s.score * 100)}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-white text-xs font-mono font-bold tabular-nums">
                        {Math.round(s.score * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reset has been completely removed in favor of organic resets tracking handleStart internally. */}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-16 border-t border-white/5 py-6 text-center text-gray-600 text-xs">
        AI Interview Integrity Analyzer — prototype · Not for production use without proper validation
      </footer>
    </div>
  );
}
