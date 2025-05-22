# Voice Integration Implementation Plan

This document outlines the steps required to implement continuous voice listening in the Field Service Assistant application using Azure OpenAI's speech services with server-side VAD (Voice Activity Detection).

## Overview

We're updating the voice integration feature to match the working example in `scripts/gpt-4o-mini-transcribe_websocket.py`, which uses the `websocket-client` library (imported as `websocket`) rather than the `websockets` asyncio library. This approach maintains continuous listening capability with Azure's server-side VAD to automatically detect when a user stops speaking.

## Implementation Steps

### Backend Changes

- [x] Added `websocket-client` to requirements.txt
- [x] Switched from `websockets` to `websocket-client` in the voice service implementation
- [x] Updated the voice service backend implementation using a threading approach
- [x] Fixed WebSocket header format (`header=headers` instead of `extra_headers=headers`)
- [x] Configured session with `server_vad` for turn detection
- [x] Implemented thread-based communication with queues
- [ ] Final testing of backend implementation

### Frontend Changes

- [x] Add continuous mode toggle in the UI
- [x] Configure microphone connection to remain active between queries
- [x] Properly handle transcript completion events while staying in listening mode
- [x] Show visual indicators for continuous listening mode
- [x] Implement clean resource management for audio streams with proper cleanup handlers

### Backend Implementation Details

```python
# Example of the key session configuration with server VAD
session_config = {
    "type": "transcription_session.update",
    "session": {
        "input_audio_format": "pcm16",
        "input_audio_transcription": {
            "model": "gpt-4o-mini-transcribe",
            "prompt": "Respond in English.",
        },
        "input_audio_noise_reduction": {"type": "near_field"},
        "turn_detection": {"type": "server_vad"},
    },
}
```

The `server_vad` configuration automatically detects when the user has stopped speaking, returning a "complete" event without requiring explicit stop commands.

## Progress

### May 22, 2025

- Identified key differences between working example and current implementation
- Created this tracking document
- Added `websocket-client` to requirements.txt
- Observed that `server_vad` configuration is already in place
- Implemented the backend threading approach with websocket-client
- Added queue-based communication between the thread and async contexts
- Replaced the async implementation with a hybrid approach matching the working example
- Added continuous mode toggle and visual indicators to the frontend component
- Implemented proper resource management for continuous listening
- Added handling to continue listening after a transcript is complete

## Technical Approach

1. Because our application uses `aiohttp` (asyncio-based), while the working example uses the synchronous `websocket-client`, we need to create a hybrid approach where:
   - The main web service remains asyncio-based with `aiohttp`
   - The WebSocket connection to Azure uses `websocket-client` running in a separate thread
   - Communication between the thread and the asyncio context uses queues

2. The continuous listening approach:
   - User activates the microphone once
   - Audio is continuously streamed to Azure
   - When a pause in speech is detected by server VAD, the transcript is submitted
   - The microphone remains active and listening for the next query
   - A toggle allows switching between continuous and single-query modes

## Next Actions

1. Test the integrated solution
2. Verify the server VAD auto-detection is working properly
3. Ensure continuous mode correctly keeps the microphone active between queries
4. Check resource cleanup when switching from continuous to single-query mode
5. Document the complete implementation for future reference
