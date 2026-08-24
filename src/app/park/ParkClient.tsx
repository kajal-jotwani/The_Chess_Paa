"use client";

import dynamic from "next/dynamic";

// The whole 3D stage is client-only — it touches WebGL, canvas 2D and audio.
const Stage = dynamic(() => import("@/three/Stage"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "linear-gradient(#6C5C8A, #A87F8B 55%, #E8A97E)",
        display: "grid", placeItems: "center",
        color: "#F3E4C6", fontFamily: "var(--font-park)", fontSize: 22,
      }}
    >
      lighting the lanterns…
    </div>
  ),
});

export default function ParkClient() {
  return <Stage />;
}
