from .base import BasePlugin
from stt import transcribe_file

class STTPlugin(BasePlugin):
    def process(self, file_path: str):
        """
        Processes a single audio chunk and returns the transcribed text.
        Raises an exception if transcription fails so the caller can handle it.
        """
        if not file_path:
            return ""
        
        # We let exceptions bubble up for the websocket to catch and report
        result = transcribe_file(file_path)
        return result.get("transcript", "")
