/**
 * The storybook HUD: ChessPaa's speech bubble, the top bar, side panels,
 * modals and toasts.  Plain DOM — no framework — so it stays tiny and fast.
 */
export interface Action { label: string; onClick: () => void; kind?: "sun" | "teal" | "berry" | "ghost"; }
export type PromotionPiece = "q" | "r" | "b" | "n";

export class UI {
  readonly root: HTMLElement;
  private paa: HTMLElement; private paaText: HTMLElement; private paaActions: HTMLElement; private paaWho: HTMLElement;
  private panel: HTMLElement; private modal: HTMLElement; private modalWrap: HTMLElement; private toastEl: HTMLElement;
  private topbar: HTMLElement; private hudRight: HTMLElement;
  private typing: number | null = null;
  /** actions the current speech will show once it finishes typing */
  private pendingActions: Action[] = [];
  /** resolver of an open promotion picker, so dismissing the modal can settle it with null */
  private promoResolve: ((p: PromotionPiece | null) => void) | null = null;
  onHome?: () => void;
  onQuality?: () => void;
  onMute?: () => void;
  onTheme?: (t: "dawn" | "day" | "dusk" | "night" | "cloudy" | "rain" | "rain_night" | "auto") => void;
  private base: string;

  constructor(base: string) {
    this.base = base;
    this.root = document.getElementById("ui")!;
    this.root.innerHTML = `
      <div class="topbar">
        <div class="brand">ChessPaa's Chess Wonderland<small>ride • learn • play</small></div>
        <div class="spacer"></div>
        <div class="pill" id="pill-stars">⭐ <span id="stars">0</span></div>
        <div class="pill" id="pill-tickets">🎟 <span id="tickets">0</span></div>
        <div class="pill theme-pill" id="theme-pill" title="Time of day & weather">
          <button data-t="auto" title="Match my time & weather">🕒</button><button data-t="dawn" title="Sunrise">🌅</button><button data-t="day" title="Sunny day">☀️</button><button data-t="dusk" title="Golden evening">🌇</button><button data-t="night" title="Starry night">🌙</button><button data-t="cloudy" title="Cloudy">⛅</button><button data-t="rain" title="Rain">🌧️</button>
        </div>
        <button class="btn ghost icon-btn" id="btn-mute" title="Sound">🔊</button>
        <button class="btn ghost icon-btn" id="btn-quality" title="Graphics quality">✨</button>
        <button class="btn berry" id="btn-home">🏠 Park map</button>
      </div>
      <div class="panel hidden" id="panel"></div>
      <div class="hud-bottom-right" id="hud-right"></div>
      <div class="paa hidden" id="paa">
        <div class="paa-portrait"><img src="${base}/ui/chesspaa_portrait.png" alt="ChessPaa" /></div>
        <div class="bubble"><div class="who" id="paa-who">ChessPaa</div><div class="text" id="paa-text"></div><div class="actions" id="paa-actions"></div></div>
      </div>
      <div class="modal-wrap hidden" id="modal-wrap"><div class="modal" id="modal"></div></div>
      <div class="toast" id="toast"></div>`;
    this.paa = this.q("#paa"); this.paaText = this.q("#paa-text"); this.paaActions = this.q("#paa-actions"); this.paaWho = this.q("#paa-who");
    this.panel = this.q("#panel"); this.modal = this.q("#modal"); this.modalWrap = this.q("#modal-wrap"); this.toastEl = this.q("#toast");
    this.topbar = this.q(".topbar"); this.hudRight = this.q("#hud-right");
    this.q("#btn-home").onclick = () => this.onHome?.();
    this.q("#btn-quality").onclick = () => this.onQuality?.();
    this.q("#btn-mute").onclick = () => this.onMute?.();
    this.root.querySelectorAll<HTMLButtonElement>("#theme-pill button").forEach((b) => { b.onclick = () => this.onTheme?.(b.dataset.t as any); });
  }
  private q<T extends HTMLElement = HTMLElement>(sel: string): T { return this.root.querySelector(sel) as T; }

  private lastStars = 0; private lastTickets = 0; private booted = 0;
  setStars(n: number) { this.bumpPill("#pill-stars", "#stars", n, n - this.lastStars, "⭐"); this.lastStars = n; }
  setTickets(n: number) { this.bumpPill("#pill-tickets", "#tickets", n, n - this.lastTickets, "🎟"); this.lastTickets = n; }
  /** Every counter change bumps its pill and floats a "+N" — except the initial fill from localStorage. */
  private bumpPill(pillSel: string, spanSel: string, n: number, delta: number, glyph: string) {
    this.q(spanSel).textContent = String(n);
    if (this.booted < 2) { this.booted++; return; } // the App constructor's first setStars + setTickets pair
    const pill = this.q(pillSel);
    pill.classList.remove("bump"); void pill.offsetWidth; pill.classList.add("bump");
    if (delta > 0) {
      const f = document.createElement("span"); f.className = "float"; f.textContent = `+${delta} ${glyph}`;
      f.addEventListener("animationend", () => f.remove());
      pill.appendChild(f);
    }
  }
  /** True while ChessPaa's bubble is still typing out — callers that would interrupt mid-sentence can wait. */
  isTyping() { return this.typing !== null; }
  setMuted(m: boolean) { this.q("#btn-mute").textContent = m ? "🔇" : "🔊"; }
  setQualityLabel(q: string) { this.q("#btn-quality").title = `Graphics: ${q} (click to change)`; }
  setThemeLabel(theme: string, auto: boolean) {
    this.root.querySelectorAll<HTMLButtonElement>("#theme-pill button").forEach((b) => { b.classList.toggle("on", b.dataset.t === (auto ? "auto" : theme) || (!auto && b.dataset.t === theme) || (auto && b.dataset.t === theme)); });
  }
  showHome(show: boolean) { (this.q("#btn-home") as HTMLElement).style.display = show ? "" : "none"; }

  /** ChessPaa speaks; text types out. Returns roughly how long it takes to read. */
  say(text: string, actions: Action[] = [], who = "ChessPaa"): number {
    this.paa.classList.remove("hidden");
    this.paaWho.textContent = who;
    if (this.typing) { clearInterval(this.typing); this.typing = null; }
    this.paaText.innerHTML = "";
    this.paaActions.innerHTML = "";
    this.pendingActions = actions;
    let i = 0;
    const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    // keep <b> tags for emphasis via **word**
    const html = safe.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    const plain = html.replace(/<[^>]+>/g, "");
    this.typing = window.setInterval(() => {
      i += 2;
      if (i >= plain.length) { this.paaText.innerHTML = html; clearInterval(this.typing!); this.typing = null; this.renderActions(this.pendingActions); return; }
      this.paaText.textContent = plain.slice(0, i);
    }, 16);
    if (actions.length) this.renderActions(actions);
    return Math.min(9, 1.2 + plain.length / 28);
  }
  /** Swap the buttons under the current speech without re-saying it (survives the type-out). */
  setActions(actions: Action[]) { this.pendingActions = actions; this.renderActions(actions); }
  private renderActions(actions: Action[]) {
    this.paaActions.innerHTML = "";
    for (const a of actions) {
      const b = document.createElement("button");
      b.className = `btn small ${a.kind ?? "sun"}`;
      b.textContent = a.label;
      b.onclick = a.onClick;
      this.paaActions.appendChild(b);
    }
  }
  hush() { this.paa.classList.add("hidden"); }

  /** Right-hand panel with arbitrary HTML; returns the element for wiring. */
  showPanel(html: string): HTMLElement {
    this.panel.innerHTML = `<button class="panel-tab" aria-label="Toggle panel" title="Tuck the panel away"><span class="open">›</span><span class="closed">🗺️</span></button>` + html;
    this.panel.classList.remove("hidden", "collapsed");
    (this.panel.querySelector(".panel-tab") as HTMLButtonElement).onclick = () => this.panel.classList.toggle("collapsed");
    return this.panel;
  }
  hidePanel() { this.panel.classList.add("hidden"); this.panel.classList.remove("collapsed"); }
  panelEl() { return this.panel; }

  /** Bottom-right HUD (timers, streaks, buttons). */
  setHud(html: string): HTMLElement { this.hudRight.innerHTML = html; return this.hudRight; }
  clearHud() { this.hudRight.innerHTML = ""; }

  showModal(html: string): HTMLElement { this.modal.innerHTML = html; this.modalWrap.classList.remove("hidden"); return this.modal; }
  hideModal() {
    const r = this.promoResolve; this.promoResolve = null; // null first so a re-entrant hide can't double-resolve
    this.modalWrap.classList.add("hidden");
    r?.(null);
  }

  toast(text: string, ms = 1800) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add("show");
    window.setTimeout(() => this.toastEl.classList.remove("show"), ms);
  }

  /** Promotion picker — resolves with the chosen piece letter, or null if the modal is dismissed (e.g. Home). */
  choosePromotion(color: "w" | "b"): Promise<PromotionPiece | null> {
    return new Promise((resolve) => {
      this.hideModal(); // settles any earlier picker with null before we take its place
      this.promoResolve = resolve;
      const glyph = color === "w" ? { q: "♕", r: "♖", b: "♗", n: "♘" } : { q: "♛", r: "♜", b: "♝", n: "♞" };
      const m = this.showModal(`<h1>Promotion time!</h1><p>Your pawn reached the last rank. What should it become?</p><div class="promo">${(["q", "r", "b", "n"] as const).map((p) => `<button data-p="${p}">${glyph[p]}</button>`).join("")}</div>`);
      m.querySelectorAll("button").forEach((b) => { (b as HTMLButtonElement).onclick = () => { this.promoResolve = null; this.hideModal(); resolve((b as HTMLButtonElement).dataset.p as PromotionPiece); }; });
    });
  }

  clearAll() { this.hush(); this.hidePanel(); this.hideModal(); this.clearHud(); }
}

/** Local-only progress: stars per attraction, tickets, best streak. */
export class Progress {
  private data: { stars: Record<string, number>; tickets: number; bestRush: number; solved: string[] } = { stars: {}, tickets: 0, bestRush: 0, solved: [] };
  constructor() { try { const raw = localStorage.getItem("cw.progress"); if (raw) this.data = { ...this.data, ...JSON.parse(raw) }; } catch { /* ignore */ } }
  private save() { try { localStorage.setItem("cw.progress", JSON.stringify(this.data)); } catch { /* ignore */ } }
  get stars() { return Object.values(this.data.stars).reduce((a, b) => a + b, 0); }
  get tickets() { return this.data.tickets; }
  get bestRush() { return this.data.bestRush; }
  starsFor(key: string) { return this.data.stars[key] ?? 0; }
  addStar(key: string, n = 1) { this.data.stars[key] = (this.data.stars[key] ?? 0) + n; this.save(); }
  addTicket(n = 1) { this.data.tickets += n; this.save(); }
  markSolved(id: string) { if (!this.data.solved.includes(id)) { this.data.solved.push(id); this.save(); } }
  isSolved(id: string) { return this.data.solved.includes(id); }
  setBestRush(n: number) { if (n > this.data.bestRush) { this.data.bestRush = n; this.save(); } }
}
