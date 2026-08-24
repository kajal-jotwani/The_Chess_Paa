"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PALETTE, css } from "../core/palette";
import { director, input, starsFor, type StationDef } from "./gameState";
import { unlockAudio, isAudioReady, toggleMuted, isMuted } from "@/lib/audio";
import { startSoundscape } from "@/lib/audio/soundscape";
import { startScore, setMusicMood } from "@/lib/audio/score";
import { speakAsChessPaa, stopChessPaa } from "@/lib/audio/chessPaaVoice";

/**
 * THE GAME'S CHROME — and there is barely any, on purpose.
 *
 * A speech card where ChessPaa talks, one big friendly button when a door is
 * near, a joystick that only exists under a thumb, and two small round
 * buttons. No navbar, no menus over the painting. The world is the UI.
 */

const font = "var(--font-park)";
const wood = css(PALETTE.walnut);
const cream = css(PALETTE.cream);
const ink = css(PALETTE.ink);

function useDirector<T>(read: () => T): T {
  const get = useCallback(read, [read]);
  return useSyncExternalStore(
    useCallback((cb) => director.subscribe(cb), []),
    get,
    get
  );
}

/* ------------------------------------------------------------------ */
/* pieces of chrome                                                    */
/* ------------------------------------------------------------------ */

function RoundButton({ label, onClick, title }: { label: string; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 52, height: 52, borderRadius: "50%",
        border: `3px solid ${wood}`,
        background: `linear-gradient(${cream}, ${css(PALETTE.creamPale)})`,
        boxShadow: "0 6px 16px rgba(46,30,40,.35)",
        fontSize: 24, cursor: "pointer", pointerEvents: "auto",
      }}
    >
      {label}
    </button>
  );
}

/** The one big friendly door button. Also fires on E — the label says so. */
function PromptButton() {
  const prompt = useDirector(() => director.prompt);
  const atStation = useDirector(() => director.atStation);
  if (director.mode === "riding" && atStation) return <StationPanel station={atStation} />;
  if (director.mode !== "explore" || !prompt) return null;
  return (
    <button
      onClick={() => { input.interact = true; }}
      style={{
        pointerEvents: "auto",
        display: "flex", alignItems: "center", gap: 12,
        padding: "16px 26px", borderRadius: 999,
        border: `4px solid ${css(PALETTE.honeyDeep)}`,
        background: `linear-gradient(${cream}, ${css(PALETTE.honey)}44)`,
        color: ink, fontFamily: font, fontWeight: 800, fontSize: 22,
        boxShadow: "0 12px 30px rgba(46,30,40,.4)",
        cursor: "pointer", animation: "cp3d-breathe 1.6s ease-in-out infinite",
      }}
    >
      <span style={{ fontSize: 28 }}>{prompt.icon}</span>
      {prompt.label}
      <span style={{
        fontSize: 13, fontWeight: 700, opacity: 0.65,
        border: `2px solid ${ink}55`, borderRadius: 8, padding: "2px 8px",
      }}>E</span>
    </button>
  );
}

/**
 * Universal lesson escape hatch — the HUD guarantees no lesson can ever trap
 * a child, whatever the lesson itself renders. Escape key or the corner door.
 */
function LessonEscape() {
  const mode = useDirector(() => director.mode);
  useEffect(() => {
    if (mode !== "lesson") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        director.say("Off you pop! The park was getting lonely without you.", "warm");
        director.closeLesson();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);
  if (mode !== "lesson") return null;
  return (
    <div style={{ position: "absolute", top: 16, left: 16, pointerEvents: "auto" }}>
      <button
        onClick={() => {
          director.say("Off you pop! The park was getting lonely without you.", "warm");
          director.closeLesson();
        }}
        title="Back to the park (Esc)"
        style={{
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          padding: "10px 18px", borderRadius: 999,
          border: `4px solid ${wood}`, background: `${cream}f2`,
          color: ink, fontFamily: font, fontWeight: 800, fontSize: 16,
          boxShadow: "0 10px 24px rgba(46,30,40,.35)",
        }}
      >
        ↩ Back to the park
      </button>
    </div>
  );
}

/** The storybook panel that opens when the train pulls into a station. */
function StationPanel({ station }: { station: StationDef }) {
  const stars = station.lesson ? starsFor(station.lesson) : 0;
  return (
    <div
      style={{
        pointerEvents: "auto",
        background: `linear-gradient(${cream}, ${css(PALETTE.creamPale)})`,
        border: `5px solid ${wood}`, borderRadius: 26,
        boxShadow: "0 18px 44px rgba(46,30,40,.5)",
        padding: "20px 26px", maxWidth: 420, textAlign: "center",
        fontFamily: font, color: ink,
      }}
    >
      <div style={{ fontSize: 40 }}>{station.icon}</div>
      <div style={{ fontSize: 24, fontWeight: 800, margin: "4px 0 2px" }}>
        {station.level ? `Level ${station.level} — ` : ""}{station.name}
      </div>
      {station.lesson && (
        <div style={{ fontSize: 18, letterSpacing: 2, margin: "2px 0 8px" }}>
          {"★".repeat(Math.min(3, stars))}{"☆".repeat(Math.max(0, 3 - stars))}
        </div>
      )}
      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 10 }}>
        {station.lesson && (
          <button
            onClick={() => { const st = station; director.hopOff(); director.openLesson(st.lesson!, st); }}
            style={{
              padding: "12px 22px", borderRadius: 999, cursor: "pointer",
              border: `4px solid ${css(PALETTE.tealDeep)}`,
              background: css(PALETTE.teal), color: "#fff",
              fontFamily: font, fontWeight: 800, fontSize: 18,
            }}
          >
            Hop off &amp; learn
          </button>
        )}
        <button
          onClick={() => director.keepRiding()}
          style={{
            padding: "12px 22px", borderRadius: 999, cursor: "pointer",
            border: `4px solid ${wood}`, background: cream, color: ink,
            fontFamily: font, fontWeight: 800, fontSize: 18,
          }}
        >
          Keep riding 🚂
        </button>
      </div>
    </div>
  );
}

/** ChessPaa's words, typed on gently. Bottom-left, never over the board. */
function Speech() {
  const text = useDirector(() => director.speech);
  const seq = useDirector(() => director.speechKey);
  const [shown, setShown] = useState("");
  useEffect(() => {
    setShown("");
    if (!text) return;
    let i = 0;
    const iv = setInterval(() => {
      i += 2;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(iv);
    }, 22);
    return () => clearInterval(iv);
  }, [text, seq]);
  if (!text) return null;
  return (
    <div
      style={{
        maxWidth: 480, pointerEvents: "none",
        background: `linear-gradient(${cream}f2, ${css(PALETTE.creamPale)}f2)`,
        border: `4px solid ${wood}`, borderRadius: "22px 22px 22px 8px",
        boxShadow: "0 14px 34px rgba(46,30,40,.45)",
        padding: "14px 18px", fontFamily: font, color: ink,
        fontSize: 19, fontWeight: 700, lineHeight: 1.45,
      }}
    >
      <span style={{ color: css(PALETTE.scarfRed), marginRight: 8 }}>ChessPaa</span>
      {shown}
    </div>
  );
}

/** A joystick that only exists under a thumb. Left half of the screen. */
function TouchControls() {
  const [stick, setStick] = useState<null | { ox: number; oy: number; x: number; y: number }>(null);
  const lookLast = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    // Only mount the layer for coarse pointers — a laptop never sees it.
    return () => { input.move.set(0, 0); };
  }, []);
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  if (!coarse) return null;

  const R = 64;
  return (
    <div
      style={{ position: "absolute", inset: 0, pointerEvents: "auto", touchAction: "none" }}
      onPointerDown={(e) => {
        director.cancelCine();
        if (e.clientX < window.innerWidth / 2) {
          setStick({ ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY });
        } else {
          lookLast.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }
      }}
      onPointerMove={(e) => {
        if (stick && e.clientX < window.innerWidth / 2 + 120) {
          const dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
          const len = Math.hypot(dx, dy) || 1;
          const cl = Math.min(len, R);
          setStick({ ...stick, x: stick.ox + (dx / len) * cl, y: stick.oy + (dy / len) * cl });
          input.move.set((dx / len) * (cl / R), -(dy / len) * (cl / R));
        }
        const l = lookLast.current;
        if (l && e.pointerId === l.id) {
          input.look.x += e.clientX - l.x;
          input.look.y += e.clientY - l.y;
          l.x = e.clientX; l.y = e.clientY;
        }
      }}
      onPointerUp={(e) => {
        if (lookLast.current?.id === e.pointerId) lookLast.current = null;
        setStick(null);
        input.move.set(0, 0);
      }}
    >
      {stick && (
        <>
          <div style={{
            position: "absolute", left: stick.ox - R, top: stick.oy - R,
            width: R * 2, height: R * 2, borderRadius: "50%",
            border: `3px solid ${cream}aa`, background: `${ink}22`,
          }} />
          <div style={{
            position: "absolute", left: stick.x - 26, top: stick.y - 26,
            width: 52, height: 52, borderRadius: "50%",
            background: `${cream}dd`, border: `3px solid ${wood}`,
            boxShadow: "0 4px 12px rgba(0,0,0,.35)",
          }} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the HUD                                                             */
/* ------------------------------------------------------------------ */

export default function GameHud() {
  const [muted, setMutedState] = useState(false);
  const [booted, setBooted] = useState(false);

  // Audio can only start on a gesture; the first tap anywhere lights it up.
  useEffect(() => {
    const boot = async () => {
      if (isAudioReady()) return;
      await unlockAudio();
      startSoundscape();
      startScore();
      setMusicMood("plaza");
      setBooted(true);
      speakAsChessPaa("There you are! I've been expecting exactly you. Walk with the arrows or your thumb — and when you're ready, ride with me.", "delighted");
      window.removeEventListener("pointerdown", boot);
      window.removeEventListener("keydown", boot);
    };
    window.addEventListener("pointerdown", boot);
    window.addEventListener("keydown", boot);
    return () => {
      window.removeEventListener("pointerdown", boot);
      window.removeEventListener("keydown", boot);
    };
  }, []);

  useEffect(() => {
    director.say(
      "There you are! I've been expecting exactly you. Walk to me with the arrow keys — or your thumb — and let's ride.",
      "delighted"
    );
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 30 }}>
      <style>{`@keyframes cp3d-breathe { 0%,100% { transform: scale(1);} 50% { transform: scale(1.045);} }`}</style>

      <TouchControls />
      <LessonEscape />

      {/* speech, bottom-left */}
      <div style={{ position: "absolute", left: 18, bottom: 18, right: 18, display: "flex", justifyContent: "flex-start" }}>
        <Speech />
      </div>

      {/* door prompt / station panel, bottom-centre */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 120, display: "flex", justifyContent: "center" }}>
        <PromptButton />
      </div>

      {/* tiny corner buttons */}
      <div style={{ position: "absolute", top: 16, right: 16, display: "flex", gap: 10 }}>
        <RoundButton
          label={muted ? "🔇" : "🔊"}
          title={muted ? "Sound on" : "Sound off"}
          onClick={() => { setMutedState(toggleMuted()); if (isMuted()) stopChessPaa(); }}
        />
      </div>

      {!booted && (
        <div style={{
          position: "absolute", top: 18, left: 0, right: 0,
          display: "flex", justifyContent: "center", pointerEvents: "none",
        }}>
          <div style={{
            fontFamily: font, fontWeight: 800, fontSize: 15, color: ink,
            background: `${cream}ee`, border: `3px solid ${wood}`,
            borderRadius: 999, padding: "8px 18px",
            boxShadow: "0 8px 20px rgba(46,30,40,.3)",
          }}>
            🔊 tap anywhere to light the lanterns &amp; hear ChessPaa
          </div>
        </div>
      )}
    </div>
  );
}
