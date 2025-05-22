import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Tooltip, Switch } from "@fluentui/react-components";
import { Mic20Regular, MicOff20Regular, SpeakerBox20Regular, SpeakerMute20Regular } from "@fluentui/react-icons";
import "./VoiceControl.css";

interface VoiceControlProps {
    onTranscript: (text: string) => void; // Callback when transcript is complete
    responseText: string | null; // Text to synthesize
    isProcessing: boolean; // Is the system processing a request
}

const VoiceControl: React.FC<VoiceControlProps> = ({ onTranscript, responseText, isProcessing }) => {
    const [isListening, setIsListening] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [currentTranscript, setCurrentTranscript] = useState("");
    const [continuousMode, setContinuousMode] = useState(true); // Default to continuous mode
    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioBufferQueue = useRef<AudioBuffer[]>([]);
    const isPlayingRef = useRef<boolean>(false);
    const streamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const audioSetupCompleteRef = useRef<boolean>(false);

    // Function to play audio buffers sequentially - wrapped in useCallback to avoid recreating on every render
    const playNextBuffer = useCallback(() => {
        if (audioBufferQueue.current.length === 0) {
            isPlayingRef.current = false;
            return;
        }

        isPlayingRef.current = true;
        const audioContext = audioContextRef.current!;
        const source = audioContext.createBufferSource();
        source.buffer = audioBufferQueue.current.shift()!;
        source.connect(audioContext.destination);
        source.onended = playNextBuffer;
        source.start();
    }, []);

    // Setup WebSocket connection
    useEffect(() => {
        const connectWebsocket = () => {
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const ws = new WebSocket(`${protocol}//${window.location.host}/voice`);

            ws.onopen = () => {
                console.log("Voice WebSocket connected");
                setIsConnected(true);
            };

            ws.onmessage = event => {
                const data = JSON.parse(event.data);

                if (data.type === "transcript_delta") {
                    // Handle incremental transcript
                    setCurrentTranscript(prev => prev + data.text);
                } else if (data.type === "transcript_complete") {
                    // Handle complete transcript
                    const finalTranscript = data.text || currentTranscript;
                    setCurrentTranscript("");

                    if (finalTranscript.trim()) {
                        onTranscript(finalTranscript);
                    }

                    // In continuous mode, keep listening
                    if (continuousMode) {
                        // Keep the microphone active - already set up
                        console.log("Continuing to listen in continuous mode");
                    } else {
                        // In non-continuous mode, stop listening
                        setIsListening(false);
                        cleanupAudioResources();
                    }
                } else if (data.type === "tts_chunk") {
                    // Handle TTS audio chunk
                    if (!audioContextRef.current) {
                        // Type safe way to handle vendor prefixed API
                        const globalWindow = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
                        const AudioContextClass = globalWindow.AudioContext || globalWindow.webkitAudioContext;
                        audioContextRef.current = new (AudioContextClass as typeof AudioContext)();
                    }

                    const base64Audio = data.audio;
                    const binaryAudio = atob(base64Audio);
                    const arrayBuffer = new ArrayBuffer(binaryAudio.length);
                    const bufferView = new Uint8Array(arrayBuffer);

                    for (let i = 0; i < binaryAudio.length; i++) {
                        bufferView[i] = binaryAudio.charCodeAt(i);
                    }

                    audioContextRef.current.decodeAudioData(arrayBuffer, buffer => {
                        audioBufferQueue.current.push(buffer);
                        if (!isPlayingRef.current) {
                            playNextBuffer();
                        }
                    });
                } else if (data.type === "tts_complete") {
                    // TTS stream complete
                    setIsSpeaking(false);
                }
            };

            ws.onerror = error => {
                console.error("WebSocket error:", error);
            };

            ws.onclose = () => {
                console.log("WebSocket connection closed");
                setIsConnected(false);
                // Try to reconnect in 3 seconds
                setTimeout(connectWebsocket, 3000);
            };

            wsRef.current = ws;
        };

        connectWebsocket();

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            cleanupAudioResources();
        };
    }, [currentTranscript, onTranscript, playNextBuffer, continuousMode]);

    // Function to handle microphone button click
    const toggleListening = async () => {
        if (!isConnected) return;

        if (!isListening) {
            // Start listening
            setIsListening(true);
            setCurrentTranscript("");

            // Request microphone access
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                streamRef.current = stream;

                // Type safe way to handle vendor prefixed API
                const globalWindow = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
                const AudioContextClass = globalWindow.AudioContext || globalWindow.webkitAudioContext;
                const audioContext = new (AudioContextClass as typeof AudioContext)();
                audioContextRef.current = audioContext;

                const source = audioContext.createMediaStreamSource(stream);
                sourceRef.current = source;

                const processor = audioContext.createScriptProcessor(1024, 1, 1);
                processorRef.current = processor;

                source.connect(processor);
                processor.connect(audioContext.destination);

                // Start STT session
                wsRef.current?.send(JSON.stringify({ type: "stt_start" }));

                processor.onaudioprocess = e => {
                    if (!isListening) {
                        // Clean up if we've stopped listening
                        stream.getTracks().forEach(track => track.stop());
                        source.disconnect();
                        processor.disconnect();
                        return;
                    }

                    // Get raw audio data
                    const inputData = e.inputBuffer.getChannelData(0);

                    // Convert to 16-bit PCM
                    const pcm16 = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) {
                        pcm16[i] = Math.min(1, Math.max(-1, inputData[i])) * 32767;
                    }

                    // Send to server
                    const binary = new Uint8Array(pcm16.buffer);
                    const base64 = btoa(String.fromCharCode.apply(null, [...binary]));

                    wsRef.current?.send(
                        JSON.stringify({
                            type: "audio_data",
                            audio: base64
                        })
                    );
                };
            } catch (err) {
                console.error("Error accessing microphone:", err);
                setIsListening(false);
            }
        } else {
            // Stop listening
            setIsListening(false);
            wsRef.current?.send(JSON.stringify({ type: "stt_stop" }));

            // Cleanup audio resources
            cleanupAudioResources();
        }
    };

    const cleanupAudioResources = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        if (sourceRef.current) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
        }

        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }

        audioSetupCompleteRef.current = false;
    };

    // Effect to handle Text-to-Speech when responseText changes
    useEffect(() => {
        if (responseText && wsRef.current && isConnected && !isSpeaking) {
            setIsSpeaking(true);

            // Request TTS for the response
            wsRef.current.send(
                JSON.stringify({
                    type: "tts_request",
                    text: responseText,
                    voice: "coral" // Can be customized
                })
            );
        }
    }, [responseText, isConnected, isSpeaking]);

    return (
        <div className="voice-control-container">
            <div className="voice-buttons">
                <Tooltip content={isListening ? "Stop listening" : "Start listening"} relationship="label">
                    <Button
                        icon={isListening ? <MicOff20Regular /> : <Mic20Regular />}
                        appearance={isListening ? "primary" : "secondary"}
                        disabled={!isConnected || isProcessing}
                        onClick={toggleListening}
                        aria-label={isListening ? "Stop listening" : "Start listening"}
                    />
                </Tooltip>

                <Tooltip content={isSpeaking ? "Speaking..." : "Text to Speech"} relationship="label">
                    <Button
                        icon={isSpeaking ? <SpeakerBox20Regular /> : <SpeakerMute20Regular />}
                        appearance={isSpeaking ? "primary" : "secondary"}
                        disabled={isSpeaking}
                        aria-label={isSpeaking ? "Speaking" : "Text to Speech"}
                    />
                </Tooltip>

                <Switch
                    checked={continuousMode}
                    onChange={() => setContinuousMode(!continuousMode)}
                    label={continuousMode ? "Continuous Mode: On" : "Continuous Mode: Off"}
                />
            </div>

            {isListening && (
                <div className={`transcript-preview${continuousMode ? " continuous" : ""}`}>
                    {currentTranscript || (continuousMode ? "Listening continuously..." : "Listening...")}
                </div>
            )}
        </div>
    );
};

export default VoiceControl;
