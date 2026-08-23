"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { tickets } from "@/lib/progress";

/**
 * ChessPaa's Wonderland — the living park map.
 * Every attraction is drawn by hand, animates on its own, and IS the
 * navigation: tap the coaster to ride tactics, the wheel for endgames,
 * the train for puzzle rush, the carousel for openings, the castle to
 * meet the pieces, and ChessPaa's gazebo to play a real game.
 */
export default function ParkMap() {
  const router = useRouter();
  const [tix, setTix] = useState(0);

  useEffect(() => {
    setTix(tickets());
    const onP = () => setTix(tickets());
    window.addEventListener("chesspaa:progress", onP);
    return () => window.removeEventListener("chesspaa:progress", onP);
  }, []);

  const go = (href: string) => () => router.push(href);
  const key = (href: string) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(href); }
  };

  return (
    <div className="park-map-wrap relative mx-auto w-full max-w-7xl select-none">
      <svg
        viewBox="0 0 1600 950"
        role="img"
        aria-label="ChessPaa's Wonderland park map. Choose a ride to start learning."
        className="h-auto w-full"
      >
        <defs>
          <linearGradient id="pkSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#cdeafd" />
            <stop offset="70%" stopColor="#e8f6fd" />
            <stop offset="100%" stopColor="#fdf6e3" />
          </linearGradient>
          <linearGradient id="pkGround" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f7e3b2" />
            <stop offset="100%" stopColor="#f0d093" />
          </linearGradient>
          <linearGradient id="pkPath" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbf0d2" />
            <stop offset="100%" stopColor="#f3ddb0" />
          </linearGradient>
          <radialGradient id="pkSun" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff7c9" />
            <stop offset="60%" stopColor="#fde68a" />
            <stop offset="100%" stopColor="#facc15" />
          </radialGradient>
          <path id="coasterTrack" d="M 880 470 C 900 380 960 330 1030 330 C 1120 330 1140 420 1090 445 C 1050 465 1020 430 1035 395 C 1055 350 1130 310 1210 310 C 1310 310 1340 420 1285 448 C 1243 468 1210 430 1228 393 C 1247 352 1330 305 1420 320 C 1500 334 1530 400 1520 470"
          />
          <path id="trainTrack" d="M -180 858 C 200 838 500 872 800 858 C 1100 844 1400 872 1780 856" />
        </defs>

        {/* ---------- sky ---------- */}
        <rect x="0" y="0" width="1600" height="720" fill="url(#pkSky)" />

        {/* sun */}
        <g className="pk-slowspin" style={{ transformOrigin: "130px 120px" }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <rect key={i} x="126" y="30" width="8" height="34" rx="4" fill="#fcd34d"
              transform={`rotate(${i * 30} 130 120)`} />
          ))}
        </g>
        <circle cx="130" cy="120" r="52" fill="url(#pkSun)" />

        {/* clouds */}
        <g className="pk-cloud pk-cloud-a" fill="#ffffff" opacity="0.95">
          <ellipse cx="420" cy="105" rx="58" ry="26" />
          <ellipse cx="470" cy="92" rx="44" ry="22" />
          <ellipse cx="380" cy="92" rx="36" ry="18" />
        </g>
        <g className="pk-cloud pk-cloud-b" fill="#ffffff" opacity="0.9">
          <ellipse cx="1030" cy="80" rx="64" ry="26" />
          <ellipse cx="1085" cy="68" rx="46" ry="20" />
          <ellipse cx="985" cy="66" rx="38" ry="17" />
        </g>
        <g className="pk-cloud pk-cloud-c" fill="#ffffff" opacity="0.85">
          <ellipse cx="1420" cy="140" rx="48" ry="20" />
          <ellipse cx="1460" cy="128" rx="34" ry="16" />
        </g>

        {/* hills */}
        <path d="M0 620 Q 260 520 560 600 T 1140 590 T 1600 610 L 1600 720 L 0 720 Z" fill="#bfe3ab" />
        <path d="M0 660 Q 300 590 700 645 T 1600 650 L 1600 730 L 0 730 Z" fill="#a8d894" />

        {/* ground */}
        <rect x="0" y="700" width="1600" height="250" fill="url(#pkGround)" />

        {/* bunting across the top */}
        <path d="M0 30 Q 400 78 800 42 T 1600 36" fill="none" stroke="#b45309" strokeWidth="3" />
        {[60, 148, 236, 324, 412, 500, 588, 676, 764, 852, 940, 1028, 1116, 1204, 1292, 1380, 1468, 1556].map((x, i) => {
          const y = 30 + Math.sin((x / 1600) * Math.PI) * 26 + (x > 800 ? 4 : 8);
          const colors = ["#ef4444", "#facc15", "#25A9B4", "#ec4899", "#8b5cf6"];
          return <path key={x} d={`M ${x} ${y} l 13 30 l 13 -30 Z`} fill={colors[i % colors.length]} opacity="0.92" />;
        })}

        {/* hanging title sign */}
        <g className="pk-sway" style={{ transformOrigin: "800px 40px" }}>
          <line x1="730" y1="42" x2="750" y2="88" stroke="#8a5a33" strokeWidth="4" />
          <line x1="870" y1="42" x2="850" y2="88" stroke="#8a5a33" strokeWidth="4" />
          <rect x="612" y="86" width="376" height="66" rx="14" fill="#a26b3f" stroke="#7c4a24" strokeWidth="4" />
          <rect x="624" y="96" width="352" height="46" rx="9" fill="#fdf1d7" />
          <text x="800" y="128" textAnchor="middle" fontSize="27" fontWeight="800"
            fill="#7c4a24" style={{ fontFamily: "var(--font-park)" }}>
            ChessPaa&apos;s Wonderland
          </text>
        </g>

        {/* walkways */}
        <path d="M 800 950 C 790 830 760 790 690 760 C 560 710 420 660 330 585" fill="none" stroke="url(#pkPath)" strokeWidth="46" strokeLinecap="round" />
        <path d="M 800 950 C 810 840 870 780 990 745 C 1120 707 1210 700 1265 685" fill="none" stroke="url(#pkPath)" strokeWidth="46" strokeLinecap="round" />
        <path d="M 800 950 C 800 850 780 700 745 640" fill="none" stroke="url(#pkPath)" strokeWidth="52" strokeLinecap="round" />
        <path d="M 800 950 C 830 870 890 800 950 770" fill="none" stroke="url(#pkPath)" strokeWidth="40" strokeLinecap="round" />
        <path d="M 760 700 C 900 640 1050 570 1150 520" fill="none" stroke="url(#pkPath)" strokeWidth="34" strokeLinecap="round" />

        {/* ============ FERRIS WHEEL → endgames ============ */}
        <g
          className="pk-ride"
          role="link"
          tabIndex={0}
          aria-label="Endgame Ferris Wheel — tricky endgames, easy wins"
          onClick={go("/adventure/endgames")}
          onKeyDown={key("/adventure/endgames")}
        >
          <ellipse cx="285" cy="600" rx="150" ry="16" fill="#00000012" />
          {/* stand */}
          <path d="M 285 385 L 225 592 L 255 592 L 285 425 L 315 592 L 345 592 Z" fill="#177f89" />
          <circle cx="285" cy="385" r="16" fill="#0f5f66" />
          {/* rotating wheel */}
          <g className="pk-wheel" style={{ transformOrigin: "285px 385px" }}>
            <circle cx="285" cy="385" r="150" fill="none" stroke="#f4a83a" strokeWidth="10" />
            <circle cx="285" cy="385" r="112" fill="none" stroke="#f7bd6b" strokeWidth="5" />
            {Array.from({ length: 8 }).map((_, i) => {
              const a = (i * Math.PI) / 4;
              const x = 285 + Math.cos(a) * 150;
              const y = 385 + Math.sin(a) * 150;
              return <line key={i} x1="285" y1="385" x2={x} y2={y} stroke="#f4a83a" strokeWidth="6" />;
            })}
            {/* cabins counter-rotate so they hang upright */}
            {Array.from({ length: 8 }).map((_, i) => {
              const a = (i * Math.PI) / 4;
              const x = 285 + Math.cos(a) * 150;
              const y = 385 + Math.sin(a) * 150;
              const colors = ["#ef4444", "#facc15", "#25A9B4", "#ec4899"];
              return (
                <g key={i} className="pk-cabin" style={{ transformOrigin: `${x}px ${y}px` }}>
                  <line x1={x} y1={y} x2={x} y2={y + 12} stroke="#7c4a24" strokeWidth="3" />
                  <rect x={x - 17} y={y + 12} width="34" height="26" rx="8" fill={colors[i % 4]} stroke="#00000022" />
                  <rect x={x - 9} y={y + 18} width="18" height="10" rx="4" fill="#ffffffcc" />
                </g>
              );
            })}
            <circle cx="285" cy="385" r="14" fill="#fde68a" stroke="#f4a83a" strokeWidth="5" />
          </g>
          {/* signpost */}
          <g className="pk-label">
            <rect x="180" y="622" width="212" height="40" rx="10" fill="#a26b3f" stroke="#7c4a24" strokeWidth="3" />
            <text x="286" y="649" textAnchor="middle" fontSize="21" fontWeight="800" fill="#fff7e5" style={{ fontFamily: "var(--font-park)" }}>
              🎡 Endgame Wheel
            </text>
          </g>
        </g>

        {/* ============ ROLLER COASTER → tactics ============ */}
        <g
          className="pk-ride"
          role="link"
          tabIndex={0}
          aria-label="Tactics Rollercoaster — forks, pins and sneaky checks"
          onClick={go("/adventure/tactics")}
          onKeyDown={key("/adventure/tactics")}
        >
          <ellipse cx="1200" cy="480" rx="330" ry="18" fill="#00000010" />
          {/* support pillars — tops tucked under the track line */}
          {[
            [905, 440], [1000, 350], [1090, 452], [1180, 330], [1285, 455], [1370, 325], [1470, 400],
          ].map(([x, y], i) => (
            <g key={i}>
              <line x1={x} y1={y} x2={x} y2={478} stroke="#e8956a" strokeWidth="9" />
              <line x1={x - 22} y1={478} x2={x + 22} y2={478} stroke="#e8956a" strokeWidth="8" strokeLinecap="round" />
            </g>
          ))}
          {/* track */}
          <use href="#coasterTrack" fill="none" stroke="#c97b2d" strokeWidth="14" strokeLinecap="round" />
          <use href="#coasterTrack" fill="none" stroke="#f4a83a" strokeWidth="8" strokeLinecap="round" />
          <use href="#coasterTrack" fill="none" stroke="#fde1ae" strokeWidth="2.5" strokeDasharray="4 14" strokeLinecap="round" />
          {/* the car — rides the exact track path */}
          <g>
            <g transform="translate(-24,-16)">
              <rect x="0" y="0" width="48" height="22" rx="9" fill="#ef4444" stroke="#b91c1c" strokeWidth="3" />
              <circle cx="12" cy="24" r="7" fill="#334155" />
              <circle cx="36" cy="24" r="7" fill="#334155" />
              <circle cx="15" cy="2" r="8" fill="#fcd9b8" />
              <circle cx="33" cy="2" r="8" fill="#f8c890" />
              <animateMotion dur="9s" repeatCount="indefinite" rotate="auto">
                <mpath href="#coasterTrack" />
              </animateMotion>
            </g>
          </g>
          <g className="pk-label">
            <rect x="1080" y="500" width="240" height="40" rx="10" fill="#a26b3f" stroke="#7c4a24" strokeWidth="3" />
            <text x="1200" y="527" textAnchor="middle" fontSize="21" fontWeight="800" fill="#fff7e5" style={{ fontFamily: "var(--font-park)" }}>
              🎢 Tactics Coaster
            </text>
          </g>
        </g>

        {/* ============ CASTLE → know your pieces ============ */}
        <g
          className="pk-ride"
          role="link"
          tabIndex={0}
          aria-label="Castle of Pieces — meet every piece, hear its song"
          onClick={go("/pieces")}
          onKeyDown={key("/pieces")}
        >
          <ellipse cx="712" cy="628" rx="180" ry="16" fill="#00000012" />
          {/* side towers (rook-shaped!) */}
          {[600, 812].map((tx) => (
            <g key={tx}>
              <rect x={tx - 34} y="470" width="68" height="158" rx="6" fill="#fdf1d7" stroke="#e5c491" strokeWidth="3" />
              <path d={`M ${tx - 40} 470 h 14 v -16 h 12 v 16 h 14 v -16 h 12 v 16 h 14 v -16 h 12 v 16 h 2 v 22 h -80 Z`} fill="#c99df0" stroke="#a874d6" strokeWidth="2.5" />
              <rect x={tx - 10} y="530" width="20" height="30" rx="9" fill="#8a5a33" />
            </g>
          ))}
          {/* main keep */}
          <rect x="646" y="440" width="132" height="188" rx="8" fill="#fdf6e3" stroke="#e5c491" strokeWidth="3" />
          <path d="M 640 440 L 712 372 L 784 440 Z" fill="#b78ae0" stroke="#9d67cf" strokeWidth="3" />
          {/* gate */}
          <path d="M 684 628 v -64 a 28 28 0 0 1 56 0 v 64 Z" fill="#8a5a33" stroke="#6d4426" strokeWidth="3" />
          <path d="M 684 628 v -64 a 28 28 0 0 1 56 0 v 64" fill="none" stroke="#fde68a" strokeWidth="2" strokeDasharray="3 8" />
          {/* windows */}
          <circle cx="712" cy="480" r="12" fill="#7cc5cc" stroke="#4f9ba3" strokeWidth="3" />
          {/* waving flags */}
          <line x1="712" y1="372" x2="712" y2="330" stroke="#7c4a24" strokeWidth="4" />
          <path className="pk-flag" style={{ transformOrigin: "712px 334px" }} d="M 712 330 q 26 4 44 -2 q -14 12 0 22 q -24 -6 -44 2 Z" fill="#ef4444" />
          {[600, 812].map((tx) => (
            <g key={`f${tx}`}>
              <line x1={tx} y1="454" x2={tx} y2="424" stroke="#7c4a24" strokeWidth="3.5" />
              <path className="pk-flag" style={{ transformOrigin: `${tx}px 428px` }} d={`M ${tx} 424 q 20 3 34 -2 q -11 10 0 18 q -19 -5 -34 2 Z`} fill="#facc15" />
            </g>
          ))}
          {/* chess pieces peeking at the gate */}
          <text x="676" y="622" fontSize="30" fill="#fdf6e3" aria-hidden>♞</text>
          <text x="726" y="622" fontSize="30" fill="#fdf6e3" aria-hidden>♛</text>
          <g className="pk-label">
            <rect x="596" y="648" width="232" height="40" rx="10" fill="#a26b3f" stroke="#7c4a24" strokeWidth="3" />
            <text x="712" y="675" textAnchor="middle" fontSize="21" fontWeight="800" fill="#fff7e5" style={{ fontFamily: "var(--font-park)" }}>
              🏰 Meet the Pieces
            </text>
          </g>
        </g>

        {/* ============ CAROUSEL → openings ============ */}
        <g
          className="pk-ride"
          role="link"
          tabIndex={0}
          aria-label="Opening Carousel — learn openings round and round"
          onClick={go("/adventure/openings")}
          onKeyDown={key("/adventure/openings")}
        >
          <ellipse cx="1265" cy="702" rx="150" ry="16" fill="#00000012" />
          {/* platform */}
          <ellipse cx="1265" cy="688" rx="128" ry="26" fill="#f472b6" stroke="#db2777" strokeWidth="3" />
          <ellipse cx="1265" cy="678" rx="128" ry="24" fill="#fbcfe8" />
          {/* center pole */}
          <rect x="1259" y="560" width="12" height="120" rx="5" fill="#e0a83c" />
          {/* canopy */}
          <path d="M 1140 610 Q 1265 520 1390 610 L 1390 616 Q 1265 560 1140 616 Z" fill="#f9739b" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <path
              key={i}
              d={`M ${1148 + i * 39} ${612 - Math.sin((i / 5) * Math.PI) * 0} q 20 -12 39 0 l 0 6 q -19 -9 -39 0 Z`}
              fill={i % 2 ? "#ffffff" : "#f9739b"}
              opacity="0.95"
            />
          ))}
          <path d="M 1265 528 l 0 -20 q 14 6 24 -2 l 0 18 q -12 8 -24 4 Z" fill="#facc15" />
          <circle cx="1265" cy="545" r="10" fill="#fde68a" stroke="#e0a83c" strokeWidth="3" />
          {/* horses bobbing */}
          {[
            { x: 1195, delay: "0s", c: "#177f89" },
            { x: 1265, delay: "0.5s", c: "#d97706" },
            { x: 1335, delay: "1s", c: "#b91c1c" },
          ].map((h, i) => (
            <g key={i} className="pk-horse" style={{ animationDelay: h.delay }}>
              <line x1={h.x} y1="600" x2={h.x} y2="668" stroke="#e0a83c" strokeWidth="5" />
              {/* a knight-shaped steed */}
              <text x={h.x} y="666" textAnchor="middle" fontSize="46" fill={h.c} stroke="#ffffff" strokeWidth="2" paintOrder="stroke" aria-hidden>♞</text>
            </g>
          ))}
          <g className="pk-label">
            <rect x="1142" y="722" width="246" height="40" rx="10" fill="#a26b3f" stroke="#7c4a24" strokeWidth="3" />
            <text x="1265" y="749" textAnchor="middle" fontSize="21" fontWeight="800" fill="#fff7e5" style={{ fontFamily: "var(--font-park)" }}>
              🎠 Opening Carousel
            </text>
          </g>
        </g>

        {/* ============ GAZEBO + CHESSPAA → play ============ */}
        <g
          className="pk-ride"
          role="link"
          tabIndex={0}
          aria-label="Play with ChessPaa — a real game with grandpa coaching every move"
          onClick={go("/play")}
          onKeyDown={key("/play")}
        >
          <ellipse cx="950" cy="800" rx="200" ry="20" fill="#00000012" />
          {/* umbrella like the poster */}
          <line x1="950" y1="656" x2="950" y2="775" stroke="#8a5a33" strokeWidth="7" />
          <path d="M 855 700 Q 950 616 1045 700 Q 950 668 855 700 Z" fill="#7cc5cc" stroke="#4f9ba3" strokeWidth="3" />
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M ${859 + i * 46} ${697 - [4, 10, 10, 4][i]} q 23 -14 45 0 l 1 4 q -23 -8 -46 0 Z`} fill={i % 2 ? "#ffffff" : "#7cc5cc"} opacity="0.9" />
          ))}
          {/* chess table */}
          <rect x="870" y="752" width="160" height="16" rx="8" fill="#a26b3f" />
          <rect x="938" y="768" width="24" height="30" rx="6" fill="#8a5a33" />
          {/* board on table */}
          <g transform="translate(886 722)">
            {Array.from({ length: 16 }).map((_, i) => {
              const cx = i % 4, cy = Math.floor(i / 4);
              return <rect key={i} x={cx * 32} y={cy * 8} width="32" height="8" fill={(cx + cy) % 2 ? "#7cc5cc" : "#fdf4e0"} />;
            })}
            <rect x="0" y="0" width="128" height="32" fill="none" stroke="#8a5a33" strokeWidth="3" rx="2" />
            <text x="30" y="4" fontSize="22" aria-hidden>♚</text>
            <text x="80" y="2" fontSize="20" aria-hidden>♜</text>
          </g>
          {/* ChessPaa himself */}
          <g className="pk-bob">
            <image href="/ChessPaa.png" x="1022" y="628" width="146" height="146" />
          </g>
          {/* two stools */}
          <rect x="830" y="782" width="34" height="10" rx="5" fill="#e0a83c" />
          <rect x="840" y="792" width="12" height="16" rx="4" fill="#c98a2e" />
          <g className="pk-label">
            <rect x="820" y="822" width="260" height="42" rx="10" fill="#ef4444" stroke="#b91c1c" strokeWidth="3" />
            <text x="950" y="850" textAnchor="middle" fontSize="22" fontWeight="800" fill="#ffffff" style={{ fontFamily: "var(--font-park)" }}>
              ♟️ Play with ChessPaa
            </text>
          </g>
        </g>

        {/* ============ PUZZLE TRAIN → puzzle rush ============ */}
        <g
          className="pk-ride"
          role="link"
          tabIndex={0}
          aria-label="Puzzle Train — solve as many puzzles as you can"
          onClick={go("/adventure/puzzles")}
          onKeyDown={key("/adventure/puzzles")}
        >
          {/* rails */}
          <use href="#trainTrack" fill="none" stroke="#b08850" strokeWidth="10" />
          <use href="#trainTrack" fill="none" stroke="#8a5a33" strokeWidth="3" strokeDasharray="16 20" />
          {/* the whole train follows the rails */}
          <g>
            <g transform="translate(-150,-58)">
              {/* locomotive */}
              <rect x="96" y="6" width="66" height="44" rx="9" fill="#e5484d" stroke="#b91c1c" strokeWidth="3" />
              <rect x="140" y="-12" width="30" height="30" rx="6" fill="#ef4444" stroke="#b91c1c" strokeWidth="3" />
              <rect x="104" y="-6" width="18" height="16" rx="4" fill="#334155" />
              {/* smoke puffs */}
              <circle className="pk-smoke" cx="113" cy="-14" r="7" fill="#e8eef2" />
              <circle className="pk-smoke pk-smoke-2" cx="120" cy="-20" r="9" fill="#eef3f6" />
              <circle className="pk-smoke pk-smoke-3" cx="108" cy="-26" r="6" fill="#f4f7f9" />
              <rect x="146" y="-4" width="18" height="14" rx="3" fill="#7cc5cc" stroke="#4f9ba3" strokeWidth="2" />
              {/* carriages */}
              <rect x="18" y="14" width="66" height="36" rx="8" fill="#facc15" stroke="#d9a406" strokeWidth="3" />
              <text x="34" y="42" fontSize="24" aria-hidden>🧩</text>
              <rect x="-60" y="14" width="66" height="36" rx="8" fill="#25A9B4" stroke="#177f89" strokeWidth="3" />
              <text x="-46" y="42" fontSize="24" aria-hidden>♟️</text>
              {/* couplings */}
              <line x1="84" y1="34" x2="96" y2="34" stroke="#64748b" strokeWidth="5" />
              <line x1="6" y1="34" x2="18" y2="34" stroke="#64748b" strokeWidth="5" />
              {/* wheels */}
              {[30, 62, 112, 146, -48, -16].map((wx, i) => (
                <g key={i} className="pk-wheelspin" style={{ transformOrigin: `${wx}px 54px` }}>
                  <circle cx={wx} cy="54" r="10" fill="#334155" />
                  <line x1={wx - 7} y1="54" x2={wx + 7} y2="54" stroke="#94a3b8" strokeWidth="2.5" />
                  <line x1={wx} y1="47" x2={wx} y2="61" stroke="#94a3b8" strokeWidth="2.5" />
                </g>
              ))}
              <animateMotion dur="26s" repeatCount="indefinite">
                <mpath href="#trainTrack" />
              </animateMotion>
            </g>
          </g>
          <g className="pk-label">
            <rect x="60" y="880" width="212" height="40" rx="10" fill="#a26b3f" stroke="#7c4a24" strokeWidth="3" />
            <text x="166" y="907" textAnchor="middle" fontSize="21" fontWeight="800" fill="#fff7e5" style={{ fontFamily: "var(--font-park)" }}>
              🚂 Puzzle Train
            </text>
          </g>
        </g>

        {/* balloons */}
        {[
          { x: 940, y: 240, c: "#ef4444", cls: "pk-balloon" },
          { x: 985, y: 275, c: "#facc15", cls: "pk-balloon pk-balloon-2" },
          { x: 505, y: 250, c: "#ec4899", cls: "pk-balloon pk-balloon-3" },
        ].map((b, i) => (
          <g key={i} className={b.cls}>
            <path d={`M ${b.x} ${b.y + 26} q 6 26 -4 44`} fill="none" stroke="#64748b" strokeWidth="2" />
            <ellipse cx={b.x} cy={b.y} rx="17" ry="22" fill={b.c} />
            <path d={`M ${b.x - 5} ${b.y + 20} l 5 8 l 5 -8 Z`} fill={b.c} />
            <ellipse cx={b.x - 5} cy={b.y - 7} rx="5" ry="8" fill="#ffffff55" />
          </g>
        ))}

        {/* chess-piece topiary bushes */}
        {[
          { x: 430, y: 712, s: 1 }, { x: 800, y: 660, s: 0.8 }, { x: 1450, y: 770, s: 1.1 },
        ].map((t, i) => (
          <g key={i} transform={`translate(${t.x} ${t.y}) scale(${t.s})`}>
            <ellipse cx="0" cy="26" rx="30" ry="8" fill="#00000010" />
            <text x="-19" y="20" fontSize="46" fill="#4d9e58" stroke="#3c7f46" strokeWidth="1.5" aria-hidden>♟</text>
          </g>
        ))}

        {/* ticket booth (shows earned tickets) */}
        <g aria-label={`Ticket booth: ${tix} tickets earned`}>
          <ellipse cx="1480" cy="880" rx="86" ry="12" fill="#00000012" />
          <rect x="1418" y="770" width="124" height="108" rx="10" fill="#fdf1d7" stroke="#e5c491" strokeWidth="3" />
          <path d="M 1408 770 h 144 l -12 -34 h -120 Z" fill="#ef4444" />
          {[0, 1, 2].map((i) => (
            <path key={i} d={`M ${1412 + i * 48} 770 h 48 l -6 14 h -36 Z`} fill={i % 2 ? "#ffffff" : "#ef4444"} />
          ))}
          <rect x="1436" y="792" width="88" height="44" rx="8" fill="#7cc5cc" stroke="#4f9ba3" strokeWidth="3" />
          <text x="1480" y="822" textAnchor="middle" fontSize="22" fontWeight="800" fill="#053b3f" style={{ fontFamily: "var(--font-park)" }}>
            🎟 {tix}
          </text>
          <text x="1480" y="862" textAnchor="middle" fontSize="15" fontWeight="700" fill="#8a5a33" style={{ fontFamily: "var(--font-park)" }}>
            your tickets
          </text>
        </g>
      </svg>
    </div>
  );
}
