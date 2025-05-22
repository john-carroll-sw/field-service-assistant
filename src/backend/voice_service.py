# filepath: /Users/johncarroll/Projects/field-service-assistant/src/backend/voice_service.py
import os
import json
import base64
import asyncio
from aiohttp import web, WSMsgType
import websockets


class VoiceService:
    def __init__(self, app):
        self.app = app
        self.active_connections = {}
        
        # Register the WebSocket route using aiohttp pattern
        app.router.add_route('GET', '/voice', self.voice_endpoint)
    
    async def voice_endpoint(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        
        connection_id = id(ws)
        self.active_connections[connection_id] = ws
        
        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    message_type = data.get("type")
                    
                    if message_type == "stt_start":
                        await self._handle_stt(ws, data)
                    elif message_type == "tts_request":
                        await self._handle_tts(ws, data)
                elif msg.type == WSMsgType.ERROR:
                    print(f"WebSocket connection closed with exception {ws.exception()}")
        
        finally:
            if connection_id in self.active_connections:
                del self.active_connections[connection_id]
            print(f"WebSocket connection {connection_id} closed")
        
        return ws

    async def _handle_stt(self, websocket, data):
        # Connect to Azure STT service using websockets
        azure_ws_url = f"{os.environ.get('AZURE_OPENAI_STT_TTS_ENDPOINT').replace('https', 'wss')}/openai/realtime?api-version=2025-04-01-preview&intent=transcription"
        headers = {"api-key": os.environ.get("AZURE_OPENAI_STT_TTS_KEY")}

        try:
            async with websockets.connect(
                azure_ws_url, extra_headers=headers
            ) as azure_ws:
                # Send initial configuration
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
                await azure_ws.send(json.dumps(session_config))

                # Start two-way communication
                # Forward audio from client to Azure
                audio_task = asyncio.create_task(
                    self._forward_audio(websocket, azure_ws)
                )
                # Forward transcription from Azure to client
                transcription_task = asyncio.create_task(
                    self._forward_transcription(azure_ws, websocket)
                )

                # Wait for either task to complete
                await asyncio.gather(audio_task, transcription_task)
        except Exception as e:
            print(f"Error connecting to Azure STT service: {e}")
            await websocket.send_str(
                json.dumps({"type": "stt_error", "error": str(e)})
            )

    async def _forward_audio(self, client_ws, azure_ws):
        try:
            async for msg in client_ws:
                if msg.type == WSMsgType.TEXT:
                    data = json.loads(msg.data)

                    if data.get("type") == "audio_data":
                        # Forward audio data to Azure
                        await azure_ws.send(
                            json.dumps(
                                {
                                    "type": "input_audio_buffer.append",
                                    "audio": data.get("audio"),
                                }
                            )
                        )
                    elif data.get("type") == "stt_stop":
                        break
        except Exception as e:
            print(f"Error in audio forwarding: {e}")

    async def _forward_transcription(self, azure_ws, client_ws):
        try:
            while True:
                message = await azure_ws.recv()
                data = json.loads(message)
                event_type = data.get("type", "")

                if event_type == "conversation.item.input_audio_transcription.delta":
                    # Forward incremental transcript
                    await client_ws.send_str(
                        json.dumps(
                            {"type": "transcript_delta", "text": data.get("delta", "")}
                        )
                    )
                elif (
                    event_type
                    == "conversation.item.input_audio_transcription.completed"
                ):
                    # Forward completed transcript
                    await client_ws.send_str(
                        json.dumps(
                            {
                                "type": "transcript_complete",
                                "text": data.get("transcript", ""),
                            }
                        )
                    )
                    break
        except Exception as e:
            print(f"Error in transcription forwarding: {e}")

    async def _handle_tts(self, websocket, data):
        from openai import AsyncAzureOpenAI

        client = AsyncAzureOpenAI(
            azure_endpoint=os.environ.get("AZURE_OPENAI_STT_TTS_ENDPOINT"),
            api_key=os.environ.get("AZURE_OPENAI_STT_TTS_KEY"),
            api_version="2025-03-01-preview",
        )

        text = data.get("text", "")
        voice = data.get("voice", "coral")

        try:
            async with client.audio.speech.with_streaming_response.create(
                model="gpt-4o-mini-tts", voice=voice, input=text, response_format="pcm"
            ) as response:
                # Stream audio chunks back to client
                async for chunk in response.iter_bytes():
                    base64_chunk = base64.b64encode(chunk).decode("utf-8")
                    await websocket.send_str(
                        json.dumps({"type": "tts_chunk", "audio": base64_chunk})
                    )

                # Signal end of stream
                await websocket.send_str(json.dumps({"type": "tts_complete"}))

        except Exception as e:
            print(f"Error in TTS: {e}")
            await websocket.send_str(
                json.dumps({"type": "tts_error", "error": str(e)})
            )
