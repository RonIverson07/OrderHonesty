"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface OrderSnapshotProps {
  onCapture: (blob: Blob | null) => void;
  onSkip: () => void;
}

export default function OrderSnapshot({ onCapture, onSkip }: OrderSnapshotProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [countdown, setCountdown] = useState(5);
  const [state, setState] = useState<"requesting" | "counting" | "captured" | "denied">("requesting");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      onCapture(null);
      return;
    }

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      onCapture(null);
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        stopStream();
        if (blob) {
          setPreviewUrl(URL.createObjectURL(blob));
          setState("captured");
          onCapture(blob);
        } else {
          onCapture(null);
        }
      },
      "image/jpeg",
      0.8
    );
  }, [onCapture, stopStream]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    let cancelled = false;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("denied");
        return;
      }

      // Try with facing mode first, fall back to any camera if that fails
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch {
        try {
          // Fallback: request any camera (works better on some production environments)
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch {
          if (!cancelled) setState("denied");
          return;
        }
      }

      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        setState("denied");
        return;
      }

      video.srcObject = stream;
      video.muted = true;

      // Wait for the video to have real frame data before starting countdown
      await new Promise<void>((resolve) => {
        const onReady = () => {
          video.removeEventListener("loadedmetadata", onReady);
          resolve();
        };
        video.addEventListener("loadedmetadata", onReady);
        // If already has metadata, resolve immediately
        if (video.readyState >= 1) resolve();
      });

      try {
        await video.play();
      } catch {
        // play() can throw on some browsers; ignore and continue
      }

      if (cancelled) return;

      setState("counting");

      let count = 5;
      setCountdown(count);
      timer = setInterval(() => {
        count--;
        setCountdown(count);
        if (count <= 0) {
          clearInterval(timer);
          capture();
        }
      }, 1000);
    }

    startCamera();

    return () => {
      cancelled = true;
      clearInterval(timer);
      stopStream();
    };
  }, [capture, stopStream]);

  if (state === "denied") {
    // Auto-skip after a moment
    setTimeout(() => onSkip(), 1500);
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="card p-6 text-center max-w-sm mx-4 animate-slide-in">
          <p className="text-2xl mb-2">📷</p>
          <p className="text-gray-600 text-sm mb-3">
            Camera not available — no worries!
          </p>
          <p className="text-xs text-gray-400">Submitting your order...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="card p-6 text-center max-w-sm mx-4 animate-slide-in">
        {state === "requesting" && (
          <>
            <p className="text-2xl mb-2">📷</p>
            <p className="text-gray-500 text-sm">Setting up camera...</p>
          </>
        )}

        {state === "counting" && (
          <>
            <p className="text-sm text-gray-500 mb-3">
              😊 Smile! Taking your order snapshot in...
            </p>
            <div className="relative rounded-xl overflow-hidden mb-3 bg-gray-100">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full rounded-xl mirror"
                style={{ transform: "scaleX(-1)" }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-6xl font-bold text-white drop-shadow-lg">
                  {countdown}
                </span>
              </div>
            </div>
            <button
              onClick={() => {
                stopStream();
                onSkip();
              }}
              className="text-sm text-gray-400 hover:text-gray-600 underline"
            >
              Skip photo
            </button>
          </>
        )}

        {state === "captured" && previewUrl && (
          <>
            <p className="text-sm text-emerald-600 font-medium mb-3">
              ✨ Got it! Great shot!
            </p>
            <img
              src={previewUrl}
              alt="Order snapshot"
              className="w-full rounded-xl mb-3"
              style={{ transform: "scaleX(-1)" }}
            />
            <p className="text-xs text-gray-400">Submitting your order...</p>
          </>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}
