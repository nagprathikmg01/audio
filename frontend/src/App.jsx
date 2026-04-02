import React, { useState, useRef, useEffect } from 'react';
import { RealtimeWebSocket } from './websocket';
import { AudioRecorder } from './recorder';
import './index.css';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [finalReport, setFinalReport] = useState(null);
  
  const [similarity, setSimilarity] = useState({ 
    score: 0.0, 
    label: "LOW", 
    reason: "",
    matched_question: "None", 
    rolling_max: 0.0, 
    top_matches: [] 
  });

  const [aiDetection, setAiDetection] = useState({
    local_score: 0.0,
    api_score: 0.0,
    final_score: 0.0,
    label: "UNCERTAIN",
    reason: "Awaiting sufficient data..."
  });
  
  const wsRef = useRef(null);
  const recorderRef = useRef(null);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  const handleWebSocketMessage = (data) => {
    if (data.type === 'partial' || data.type === 'transcript') {
      window.requestAnimationFrame(() => {
          setTranscript(data.transcript);
          if (data.similarity) {
              setSimilarity(data.similarity);
          }
          if (data.ai_detection) {
              setAiDetection(data.ai_detection);
          }
      });
    } else if (data.type === 'final') {
      window.requestAnimationFrame(() => {
          if (data.report) {
              setFinalReport(data.report);
          }
      });
    } else if (data.type === 'error') {
      console.error("Backend error:", data.message);
    }
  };

  const handleAudioChunk = (blob) => {
    if (wsRef.current) {
      wsRef.current.sendAudioBytes(blob);
    }
  };

  const startRecording = async () => {
    setFinalReport(null);
    setTranscript('');
    setSimilarity({ score: 0.0, label: "LOW", reason: "Analyzing speech...", matched_question: "None", rolling_max: 0.0, top_matches: [] });
    setAiDetection({ local_score: 0, api_score: 0, final_score: 0, label: "UNCERTAIN", reason: "Gathering baseline context..."});
    
    const wsUrl = "ws://localhost:8000/ws";
    wsRef.current = new RealtimeWebSocket(wsUrl, handleWebSocketMessage);
    wsRef.current.connect();

    recorderRef.current = new AudioRecorder(handleAudioChunk);
    const success = await recorderRef.current.start();
    
    if (success) {
      setIsRecording(true);
    } else {
      alert("Microphone access denied or error occurred.");
    }
  };

  const stopRecording = () => {
    if (recorderRef.current) {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.sendText("DONE");
      setTimeout(() => {
         if (wsRef.current) {
             wsRef.current.close();
             wsRef.current = null;
         }
      }, 1500);
    }

    setIsRecording(false);
  };

  const downloadReport = () => {
    if (!finalReport) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(finalReport, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "interview_integrity_report.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const renderSimilarityIndicator = () => {
    let colorClass = "bg-green-500 shadow-green-500/50";
    if (similarity.label === "HIGH") colorClass = "bg-red-500 shadow-red-500/80 animate-pulse";
    else if (similarity.label === "MODERATE") colorClass = "bg-yellow-500 shadow-yellow-500/50";
    
    return (
      <div className="flex flex-col gap-2 w-full mt-4">
        <div className="flex items-center gap-4 bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-lg w-full">
          <div className={`w-14 h-14 min-w-[56px] min-h-[56px] rounded-full flex flex-col items-center justify-center text-white font-bold shadow-lg ${colorClass}`}>
            <span className="text-xl leading-none">{Math.round(similarity.score * 100)}</span>
            <span className="text-[10px] leading-none opacity-80">%</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-center mb-1">
                <h3 className="text-gray-400 font-semibold text-xs uppercase tracking-wider">Semantic Similarity • {similarity.label}</h3>
                <span className="text-gray-500 text-xs font-mono ml-2 whitespace-nowrap">Max: {Math.round((similarity.rolling_max || 0) * 100)}%</span>
            </div>
            <p className="text-gray-100 text-sm font-medium leading-tight truncate">
              {similarity.matched_question !== "None" ? `Match: ${similarity.matched_question}` : "No significant matches detected."}
            </p>
            {similarity.reason && (
                <p className="text-gray-500 text-xs mt-1.5 italic font-medium">{similarity.reason}</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderAiIndicator = () => {
    let colorClass = "bg-yellow-500 shadow-yellow-500/50";
    if (aiDetection.label === "AI_LIKELY") colorClass = "bg-red-500 shadow-red-500/80 animate-pulse";
    else if (aiDetection.label === "HUMAN_LIKELY") colorClass = "bg-green-500 shadow-green-500/50";
    
    return (
      <div className="flex flex-col gap-2 w-full mt-4">
        <div className="flex items-center gap-4 bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-lg w-full">
          <div className={`w-14 h-14 min-w-[56px] min-h-[56px] rounded-full flex flex-col items-center justify-center text-white font-bold shadow-lg ${colorClass}`}>
             <span className="text-xl leading-none">{Math.round(aiDetection.final_score * 100)}</span>
             <span className="text-[10px] leading-none opacity-80">%</span>
          </div>
          <div className="flex-1 min-w-0">
             <div className="flex justify-between items-center mb-1">
                 <h3 className="text-gray-400 font-semibold text-xs uppercase tracking-wider">AI Likelihood • {aiDetection.label.replace('_', ' ')}</h3>
                 <span className="text-gray-500 text-xs font-mono ml-2 whitespace-nowrap">API: {Math.round(aiDetection.api_score * 100)}% | Local: {Math.round(aiDetection.local_score * 100)}%</span>
             </div>
             <p className="text-gray-100 text-sm font-medium leading-tight truncate">
               {aiDetection.reason}
             </p>
          </div>
        </div>
      </div>
    );
  };

  if (finalReport) {
      let verdictColor = "text-green-400";
      if (finalReport.verdict === "LIKELY SCRIPTED / AI-GENERATED") verdictColor = "text-red-500 animate-pulse drop-shadow-md";
      else if (finalReport.verdict === "SUSPICIOUS") verdictColor = "text-yellow-400";

      return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-8">
            <div className="max-w-4xl w-full flex flex-col items-center gap-6">
                 <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent text-center mb-2">
                  Final Interview Report
                 </h1>
                 
                 <div className="flex w-full justify-between items-center text-gray-400 text-xs px-2 mb-0 font-mono uppercase tracking-wider">
                    <span>⏱ {finalReport.metadata?.duration}</span>
                    <span>📝 {finalReport.metadata?.total_words} Words</span>
                    <span>🔍 {finalReport.metadata?.chunks_processed} Chunks Analyzed</span>
                 </div>

                 <div className="w-full bg-gray-800 rounded-xl p-8 shadow-2xl border border-gray-700 text-center relative overflow-hidden">
                     <span className="text-gray-400 uppercase tracking-widest text-sm font-semibold">Integrity Verdict</span>
                     <h2 className={`text-3xl md:text-5xl font-black mt-2 mb-4 tracking-tight ${verdictColor}`}>{finalReport.verdict}</h2>
                     <div className="flex justify-center flex-wrap gap-4 mt-8 mb-6">
                        <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700 min-w-[150px]">
                            <span className="text-gray-400 text-xs uppercase">Combined Score</span>
                            <div className="text-2xl font-bold text-white mt-1">{Math.round(finalReport.final_score * 100)}%</div>
                        </div>
                        <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700 min-w-[150px]">
                            <span className="text-gray-400 text-xs uppercase">Confidence Level</span>
                            <div className="text-2xl font-bold text-blue-400 mt-1">{finalReport.confidence}</div>
                        </div>
                     </div>
                     <p className="text-gray-300 text-lg max-w-2xl mx-auto leading-relaxed italic border-l-4 border-blue-500 pl-4 text-left font-medium">
                        "{finalReport.explanation?.final_reason}"
                     </p>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                     <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg flex flex-col justify-start">
                         <h3 className="text-gray-400 text-xs uppercase font-bold mb-3 border-b border-gray-700 pb-2">Semantic Similarities</h3>
                         <div className="text-white text-lg font-medium">Peak Similarity: <span className="text-red-400 font-bold ml-1">{Math.round((finalReport.timeline_insight?.peak_similarity || 0) * 100)}%</span></div>
                         <p className="text-gray-400 text-sm mt-3">{finalReport.explanation?.similarity_reason}</p>
                     </div>
                     <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg flex flex-col justify-start">
                         <h3 className="text-gray-400 text-xs uppercase font-bold mb-3 border-b border-gray-700 pb-2">Behavior & AI Signals</h3>
                         <div className="text-white text-lg font-medium">Peak AI Probability: <span className="text-orange-400 font-bold ml-1">{Math.round((finalReport.timeline_insight?.peak_ai_score || 0) * 100)}%</span></div>
                         <p className="text-gray-400 text-sm mt-3">{finalReport.explanation?.ai_reason}</p>
                     </div>
                 </div>

                 <div className="w-full bg-gray-800 rounded-xl p-6 shadow-2xl border border-gray-700 mt-2">
                     <h3 className="text-gray-400 text-xs uppercase font-bold mb-3 border-b border-gray-700 pb-2">Full Speech Transcript</h3>
                     <p className="text-gray-300 leading-relaxed font-serif tracking-wide">{finalReport.transcript}</p>
                 </div>

                 <div className="flex gap-4 mt-6 mb-12 flex-wrap justify-center">
                     <button
                        onClick={() => setFinalReport(null)}
                        className="px-6 py-3 rounded-full font-semibold text-gray-300 bg-gray-700 hover:bg-gray-600 transition-colors shadow-lg"
                     >
                        Analyze Another Session
                     </button>
                     <button
                        onClick={downloadReport}
                        className="px-6 py-3 rounded-full font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/30 transition-all flex items-center gap-2"
                     >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                        Download JSON Report
                     </button>
                 </div>
            </div>
        </div>
      );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-8">
      <div className="max-w-4xl w-full flex flex-col items-center gap-6">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent text-center">
          Live Interview Analyzer
        </h1>
        
        <button
          onClick={isRecording ? stopRecording : startRecording}
          className={`px-8 py-4 rounded-full font-semibold text-lg transition-all duration-300 shadow-lg ${
            isRecording 
              ? 'bg-red-500 hover:bg-red-600 shadow-red-500/50 animate-pulse' 
              : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/50'
          }`}
        >
          {isRecording ? 'Stop Recording' : 'Start Recording'}
        </button>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
            {renderSimilarityIndicator()}
            {renderAiIndicator()}
        </div>

        <div className="w-full bg-gray-800 rounded-xl p-6 shadow-2xl border border-gray-700 min-h-[300px] flex flex-col mt-4">
          <h2 className="text-xl font-semibold mb-4 text-gray-300 border-b border-gray-700 pb-2">Live Transcript</h2>
          <div className="flex-1 overflow-y-auto w-full">
            {transcript ? (
              <p className="text-lg leading-relaxed text-gray-100 whitespace-pre-wrap">{transcript}</p>
            ) : (
              <p className="text-gray-500 italic">Waiting for speech...</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
