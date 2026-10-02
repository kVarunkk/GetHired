"use client";

import { deductInterviewSessionCreditsAction } from "@/app/actions/deduct-interview-session-credits";
import {
  heartbeatInterviewSessionAction,
  releaseInterviewSessionAction,
} from "@/app/actions/interview-session-lock";
import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useRef, useState } from "react";

const SAMPLE_RATE = 16000;

export type Line = {
  role: string;
  turn_id: string;
  text: string;
  streaming?: boolean;
  interrupted?: boolean;
};

export type Status = "idle" | "connecting" | "live" | "error" | "stopped";

type Turn = {
  turn_id: string;
  [key: string]: Json;
};

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

type Options = {
  // Drops mic frames while the AI is speaking.
  // Kills echo but also disables barge-in.
  muteMicWhilePlaying?: boolean;
};

export function useVoiceAgent(interviewId: string, opts: Options = {}) {
  const { muteMicWhilePlaying = false } = opts;

  const [status, setStatus] = useState<Status>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  // IMPORTANT:
  // Keep capture and playback in separate AudioContexts.
  const captureCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micNodeRef = useRef<AudioWorkletNode | null>(null);

  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextTimeRef = useRef(0);

  const utteranceEndedRef = useRef(false);

  const runIdRef = useRef(0);
  const startingRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const sessionLockLostRef = useRef(false);

  const muteRef = useRef(muteMicWhilePlaying);
  muteRef.current = muteMicWhilePlaying;

  const turnsRef = useRef<Turn[]>([]);
  const saveChainRef = useRef(Promise.resolve());

  const saveTurns = async () => {
    const supabase = await createClient();

    saveChainRef.current = saveChainRef.current.then(async () => {
      const { error } = await supabase
        .from("interviews")
        .update({ turns: turnsRef.current })
        .eq("id", interviewId);

      if (error) {
        console.error("Failed to save turns:", error);
      }
    });

    return saveChainRef.current;
  };

  const releaseSession = useCallback(() => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    sessionIdRef.current = null;
    void releaseInterviewSessionAction(interviewId, sessionId)
      .then((result) => {
        if (!result.success) {
          console.error("[INTERVIEW_SESSION_RELEASE_FAILED]:", result.error);
        }
      })
      .catch((error: unknown) => {
        console.error("[INTERVIEW_SESSION_RELEASE_FAILED]:", error);
      });
  }, [interviewId]);

  const stopPlayback = useCallback(() => {
    sourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {}
    });

    sourcesRef.current = [];

    const ctx = playbackCtxRef.current;

    if (ctx) {
      nextTimeRef.current = ctx.currentTime;
    }
  }, []);

  const cleanup = useCallback(() => {
    runIdRef.current += 1;
    startingRef.current = false;
    releaseSession();

    // stopPlayback();

    if (micNodeRef.current) {
      micNodeRef.current.port.onmessage = null;

      try {
        micNodeRef.current.disconnect();
      } catch {}

      micNodeRef.current = null;
    }

    if (micSourceRef.current) {
      try {
        micSourceRef.current.disconnect();
      } catch {}

      micSourceRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());

    streamRef.current = null;

    if (wsRef.current) {
      const ws = wsRef.current;

      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;

      try {
        ws.close();
      } catch {}

      wsRef.current = null;
    }

    if (captureCtxRef.current && captureCtxRef.current.state !== "closed") {
      captureCtxRef.current.close().catch(() => {});
    }

    if (playbackCtxRef.current && playbackCtxRef.current.state !== "closed") {
      playbackCtxRef.current.close().catch(() => {});
    }

    captureCtxRef.current = null;
    playbackCtxRef.current = null;

    utteranceEndedRef.current = false;
  }, [releaseSession, stopPlayback]);

  const sendPlaybackComplete = () => {
    const ws = wsRef.current;

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          control: "playback_complete",
        }),
      );
    }

    utteranceEndedRef.current = false;
  };

  const playChunk = (buf: ArrayBuffer) => {
    const ctx = playbackCtxRef.current;

    if (!ctx) {
      return;
    }

    const pcm = new Int16Array(buf);

    const audioBuffer = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);

    const channel = audioBuffer.getChannelData(0);

    for (let i = 0; i < pcm.length; i++) {
      channel[i] = pcm[i] / 32768;
    }

    const source = ctx.createBufferSource();

    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    sourcesRef.current.push(source);

    source.onended = () => {
      sourcesRef.current = sourcesRef.current.filter((s) => s !== source);

      if (sourcesRef.current.length === 0 && utteranceEndedRef.current) {
        sendPlaybackComplete();
      }
    };

    /*
     * Match the working script:
     *
     * - no extra initial playback buffer
     * - if we underrun, restart at currentTime
     * - otherwise schedule chunks back-to-back
     */
    if (nextTimeRef.current < ctx.currentTime) {
      nextTimeRef.current = ctx.currentTime;
    }

    source.start(nextTimeRef.current);

    nextTimeRef.current += audioBuffer.duration;
  };

  const start = useCallback(async () => {
    if (wsRef.current || startingRef.current) {
      return;
    }

    startingRef.current = true;

    const runId = ++runIdRef.current;

    const stale = () => runIdRef.current !== runId;

    setStatus("connecting");
    setErrorMessage(null);
    setLines([]);
    sessionLockLostRef.current = false;

    try {
      /*
       * IMPORTANT:
       *
       * Separate contexts exactly like the working HTML:
       *
       * captureCtx:
       *   forced to 16 kHz
       *
       * playbackCtx:
       *   Firefox -> browser default
       *   Chrome/Edge -> 16 kHz
       */
      const captureCtx = new AudioContext({
        sampleRate: SAMPLE_RATE,
      });

      const playbackCtx = new AudioContext(
        navigator.userAgent.includes("Firefox")
          ? {}
          : {
              sampleRate: SAMPLE_RATE,
            },
      );

      captureCtxRef.current = captureCtx;
      playbackCtxRef.current = playbackCtx;

      await captureCtx.resume();
      await playbackCtx.resume();

      console.log("Capture context sample rate:", captureCtx.sampleRate);

      console.log("Playback context sample rate:", playbackCtx.sampleRate);

      nextTimeRef.current = playbackCtx.currentTime;

      const res = await fetch("/api/interview/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          interviewId,
        }),
      });

      if (!res.ok) {
        const response = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(response?.error ?? "Failed to start the interview.");
      }

      const { wsUrl, sessionId } = (await res.json()) as {
        wsUrl: string;
        sessionId: string;
      };

      sessionIdRef.current = sessionId;

      if (stale()) {
        releaseSession();
        return;
      }

      const ws = new WebSocket(wsUrl);

      ws.binaryType = "arraybuffer";

      wsRef.current = ws;

      ws.onopen = async () => {
        if (stale()) {
          return;
        }

        try {
          /*
           * Match the working script exactly:
           * no autoGainControl and no later applyConstraints().
           */
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
            },
          });

          if (stale()) {
            stream.getTracks().forEach((track) => track.stop());

            return;
          }

          streamRef.current = stream;

          const track = stream.getAudioTracks()[0];

          console.log("Recording from device:", track.label);

          console.log("Track settings:", track.getSettings());

          /*
           * Worklet runs on the capture AudioContext.
           */
          await captureCtx.audioWorklet.addModule("/mic-worklet.js");

          if (stale()) {
            return;
          }

          const micNode = new AudioWorkletNode(
            captureCtx,
            "mic-capture-processor",
          );

          micNodeRef.current = micNode;

          micNode.port.onmessage = (event) => {
            if (ws.readyState !== WebSocket.OPEN) {
              return;
            }

            /*
             * Optional application-level mic mute.
             */
            if (muteRef.current && sourcesRef.current.length > 0) {
              return;
            }

            ws.send(event.data);
          };

          const micSource = captureCtx.createMediaStreamSource(stream);

          micSourceRef.current = micSource;

          const chargeResult = await deductInterviewSessionCreditsAction(
            interviewId,
            sessionId,
          );

          if (!chargeResult.success) {
            throw new Error(chargeResult.error);
          }

          if (stale()) {
            return;
          }

          /*
           * Capture graph is NOT connected
           * to captureCtx.destination.
           */
          micSource.connect(micNode);

          console.log("Mic capture graph initialized.");

          setStatus("live");
        } catch (err) {
          console.error(err);

          if (!stale()) {
            setErrorMessage(
              err instanceof Error
                ? err.message
                : "Failed to start the interview.",
            );
            cleanup();
            setStatus("error");
          }
        }
      };

      ws.onerror = () => {
        if (!stale()) {
          setErrorMessage("The voice connection failed.");
          setStatus("error");
        }
      };

      // ws.onclose = () => {
      //   saveTurns();

      //   if (stale()) {
      //     return;
      //   }

      //   const finish = () => {
      //     cleanup();
      //     setStatus(sessionLockLostRef.current ? "error" : "stopped");
      //   };

      //   /*
      //    * Preserve the existing behavior:
      //    * wait until playback sources drain before
      //    * performing teardown.
      //    */
      //   if (sourcesRef.current.length > 0) {
      //     const checkInterval = setInterval(() => {
      //       if (sourcesRef.current.length === 0) {
      //         clearInterval(checkInterval);
      //         finish();
      //       }
      //     }, 100);
      //   } else {
      //     finish();
      //   }
      // };
      ws.onclose = () => {
        saveTurns();

        if (stale()) {
          return;
        }

        const finish = () => {
          cleanup();
          setStatus(sessionLockLostRef.current ? "error" : "stopped");
        };

        // Ensure we wait for all audio chunks to finish playing before tearing down
        const checkInterval = setInterval(() => {
          if (sourcesRef.current.length === 0) {
            clearInterval(checkInterval);
            finish();
          }
        }, 100);
      };

      ws.onmessage = (event) => {
        /*
         * Binary = TTS PCM.
         */
        if (typeof event.data !== "string") {
          playChunk(event.data);
          return;
        }

        const signal = JSON.parse(event.data);

        if (signal.control === "clear_speaker_buffer") {
          stopPlayback();
        }

        if (signal.control === "utterance_end") {
          utteranceEndedRef.current = true;

          if (sourcesRef.current.length === 0) {
            sendPlaybackComplete();
          }
        }

        if (signal.transcript_chunk) {
          const { role, turn_id, text, replace } = signal.transcript_chunk;

          setLines((prev) => {
            const i = prev.findIndex(
              (line) =>
                line.role === role &&
                line.turn_id === turn_id &&
                line.streaming,
            );

            if (i === -1) {
              return [
                ...prev,
                {
                  role,
                  turn_id,
                  text,
                  streaming: true,
                },
              ];
            }

            const next = [...prev];
            const current = next[i];

            next[i] = {
              ...current,
              text: replace ? text : `${current.text} ${text}`.trim(),
            };

            return next;
          });
        }

        if (signal.transcript) {
          const { role, turn_id, text } = signal.transcript;

          setLines((prev) => {
            const i = prev.findIndex(
              (line) =>
                line.role === role &&
                line.turn_id === turn_id &&
                line.streaming,
            );

            if (i === -1) {
              return [
                ...prev,
                {
                  role,
                  turn_id,
                  text,
                  streaming: false,
                },
              ];
            }

            const next = [...prev];

            next[i] = {
              ...next[i],
              text,
              streaming: false,
            };

            return next;
          });
        }

        if (signal.turn?.interrupted) {
          setLines((prev) =>
            prev.map((line) =>
              line.role === "assistant" && line.turn_id === signal.turn.turn_id
                ? {
                    ...line,
                    streaming: false,
                    interrupted: true,
                  }
                : line,
            ),
          );
        }

        if (signal.turn) {
          turnsRef.current = [
            ...turnsRef.current.filter(
              (turn) => turn.turn_id !== signal.turn.turn_id,
            ),
            signal.turn,
          ];

          saveTurns();
        }
      };
    } catch (err) {
      console.error(err);

      if (!stale()) {
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to start the interview.",
        );
        cleanup();
        setStatus("error");
      }
    } finally {
      if (!stale()) {
        startingRef.current = false;
      }
    }
  }, [interviewId, cleanup, releaseSession, stopPlayback]);

  useEffect(() => {
    if (status !== "live") return;

    let active = true;
    let heartbeatInFlight = false;
    const heartbeat = window.setInterval(async () => {
      if (sessionLockLostRef.current) return;

      const sessionId = sessionIdRef.current;
      if (!sessionId || heartbeatInFlight) return;

      heartbeatInFlight = true;
      try {
        const result = await heartbeatInterviewSessionAction(
          interviewId,
          sessionId,
        );
        if (!active || sessionIdRef.current !== sessionId) return;

        if (result.status === "lost") {
          sessionLockLostRef.current = true;
          setErrorMessage(
            result.error ?? "The interview session lock was lost.",
          );
        } else if (result.status === "error") {
          console.error("[INTERVIEW_SESSION_HEARTBEAT_RETRY]:", result.error);
        }
      } catch (error) {
        if (!active || sessionIdRef.current !== sessionId) return;

        console.error("[INTERVIEW_SESSION_HEARTBEAT_RETRY]:", error);
      } finally {
        heartbeatInFlight = false;
      }
    }, 20_000);

    return () => {
      active = false;
      window.clearInterval(heartbeat);
    };
  }, [status, interviewId, cleanup]);

  const stop = useCallback(() => {
    cleanup();
    setStatus("stopped");
  }, [cleanup]);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return {
    status,
    errorMessage,
    lines,
    start,
    stop,
  };
}
