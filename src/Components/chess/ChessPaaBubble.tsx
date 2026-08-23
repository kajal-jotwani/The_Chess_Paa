"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { speak, stopSpeaking, voiceOn, setVoiceOn } from "@/lib/sound";

/**
 * ChessPaa himself: his portrait plus a speech bubble that types out his
 * words and (optionally) reads them aloud. Used on every ride.
 */
export default function ChessPaaBubble({
  text,
  mood = "😊",
  autoSpeak = true,
  size = "md",
  children,
}: {
  text: string;
  mood?: string;
  autoSpeak?: boolean;
  size?: "sm" | "md";
  children?: React.ReactNode;
}) {
  const [shown, setShown] = useState("");
  const [voice, setVoice] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setVoice(voiceOn()); }, []);

  useEffect(() => {
    setShown("");
    if (!text) return;
    let i = 0;
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      i += 2;
      setShown(text.slice(0, i));
      if (i >= text.length && timer.current) clearInterval(timer.current);
    }, 24);
    if (autoSpeak) speak(text);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [text, autoSpeak]);

  const img = size === "sm" ? 72 : 108;

  return (
    <div className="flex items-start gap-3">
      <div className="relative shrink-0">
        <Image
          src="/ChessPaa.png"
          alt="ChessPaa"
          width={img}
          height={img}
          className="drop-shadow-lg select-none"
          priority
        />
        <span className="absolute -right-1 -bottom-1 text-xl" aria-hidden>{mood}</span>
      </div>
      <div className="relative flex-1 rounded-3xl rounded-tl-md border-2 border-chess-sand bg-white/95 p-4 shadow-card">
        <p className="text-sm md:text-base font-medium text-chess-text leading-relaxed min-h-[3.2em] whitespace-pre-wrap">
          {shown}
          {shown.length < text.length && <span className="animate-pulse">▍</span>}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const v = !voice;
              setVoice(v);
              setVoiceOn(v);
              if (v) speak(text); else stopSpeaking();
            }}
            className="rounded-full bg-chess-sky px-3 py-1 text-xs font-bold text-chess-text shadow-sm hover:brightness-105"
            aria-pressed={voice}
            title={voice ? "ChessPaa's voice is ON" : "ChessPaa's voice is OFF"}
          >
            {voice ? "🔊 Voice on" : "🔇 Voice off"}
          </button>
          {voice && (
            <button
              type="button"
              onClick={() => speak(text)}
              className="rounded-full bg-chess-sky px-3 py-1 text-xs font-bold text-chess-text shadow-sm hover:brightness-105"
              title="Say it again"
            >
              🔁 Again
            </button>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
