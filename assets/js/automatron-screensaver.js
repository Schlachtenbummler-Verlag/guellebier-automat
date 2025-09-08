/*! Automatron Screensaver – Bugs mit Mini-Game (Zerquetschen)
    Anforderungen:
    - Bug4 (Trefferframe) bleibt sichtbar, bis der Screensaver endet.
    - HUD zeigt NUR die Anzahl zerquetschter Käfer.
    - Finale Einblendung (3s, zentriert): 
      "Glückwunsch du hast X Rübenklemmer zerquetscht. Das macht gesamt Y Punkte!"
      Punkte = Summe über (Geschwindigkeit_des_geclickten_Käfers / 10), gerundet.
    - Klick ins Leere beendet den Screensaver und zeigt die finale Einblendung.
    - Konfig: startBurst (Anzahl Start-Käfer), spawnEveryMs, bugSize, Geschwindigkeiten, Sounds.
*/
(function (global) {
  "use strict";

  const TAU = Math.PI * 2;

  const SS = {
    _inited:false, _opts:null,
    _timer:null, _failsafe:null,
    _overlay:null, _styles:null, _sceneCleanup:null, _rafId:0,
    _active:false,
    _hud:null, _game:null,
    _finalShowing:false, _finalTimer:null,

    /* ===================== Public API ===================== */
    init(opts = {}){
      if (this._inited) return this;

      // ---- Defaults ----
      const defaults = {
        autoStopMs: null,               // automatisch beenden nach X ms (null = aus)
        mount: document.body,           // wohin mounten
        inactivityMs: 30000,            // nach Inaktivität starten
        scene: "bugs",

        // Spawning
        startBurst: 1,                  // wie viele Käfer sofort beim Start
        spawnEveryMs: 3000,             // Spawnrate (ms)

        // Käfer Animation
        bugFps: 10,
        bugSize: 200,                   // unitlos, px (über CSS-Var)
        speedMin: 50,
        speedMax: 1000,
        bobAmpMin: 6,
        bobAmpMax: 20,
        bobFreqMin: 0.18,
        bobFreqMax: 0.35,

        // Mini-Game
        minigame: true,
        minigameHud: true,

        // Assets
        assets: {
          bug:  "assets/img/bug.png",
          bug1: "assets/img/bug1.png",
          bug2: "assets/img/bug2.png",
          bug3: "assets/img/bug3.png",
          bug4: "assets/img/bug4.png", // Trefferframe (bleibt liegen)
          snd: {
            grabel: "assets/snd/grabel.mp3", // Laufgeräusch (Loop)
            hit:    "assets/snd/hit.mp3"     // Treffer
          }
        }
      };

      // Mount + Optionen mergen
      let mount = opts.mount || defaults.mount;
      if (typeof mount === "string") mount = document.querySelector(mount) || document.body;

      const mergedAssets = { ...defaults.assets, ...(opts.assets||{}) };
      mergedAssets.snd = { ...(defaults.assets.snd||{}), ...((opts.assets && opts.assets.snd)||{}) };

      this._opts = { ...defaults, ...opts, assets: mergedAssets, mount };

      // CSS einmalig einhängen
      this._styles = document.createElement("style");
      this._styles.setAttribute("data-ss","automatron");
      this._styles.textContent = `
        .at-ss-overlay{
          position:fixed; inset:0; z-index:2147483606; display:none;
          background:rgba(0,0,0,.08);
        }
        .at-ss-overlay.active{ display:block; }
        .at-ss-scene{ position:absolute; inset:0; overflow:hidden; }

        /* Käfercontainer: Größe über --bug-size (unitlos, px) */
        .at-bug{
          position:absolute; left:0; top:0;
          width: calc(var(--bug-size, 72) * 1px);
          height: calc(var(--bug-size, 72) * 1px);
          will-change: transform;
          filter: drop-shadow(0 4px 8px rgba(0,0,0,.35));
        }
        .at-bug__inner{ width:100%; height:100%; transform-origin:50% 50%; will-change: transform; }
        .at-bug__sprite{
          width:100%; height:100%;
          background-repeat:no-repeat;
          background-position:center;
          background-size:contain;
        }
        .at-bug.dead{ cursor:default; }
        .at-bug.dead .at-bug__inner{ filter: drop-shadow(0 6px 12px rgba(0,0,0,.55)); }

        /* === Mini-Game HUD (nur Kill-Count) === */
        .at-ss-hud{
          position:absolute; left:12px; top:12px;
          padding:8px 12px; border-radius:10px;
          background:rgba(0,0,0,.35); color:#fff;
          font: 900 16px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Helvetica,Arial,sans-serif;
          text-shadow: 0 1px 3px rgba(0,0,0,.6);
          pointer-events:none; z-index:10;
        }

        /* === Finale Einblendung (zentriert, 3s) === */
        .at-ss-final{
          position:absolute; left:50%; top:50%;
          transform:translate(-50%,-50%);
          width:min(92vw, 1000px);
          padding:20px 24px;
          border-radius:16px;
          background:rgba(0,0,0,.65);
          color:#fff;
          text-align:center;
          font: 900 clamp(18px, 3vw, 30px)/1.35 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Helvetica,Arial,sans-serif;
          text-shadow: 0 2px 6px rgba(0,0,0,.7);
          z-index: 20;
          pointer-events:none;
          animation: ss-final-fade 3000ms ease-out forwards;
        }
        @keyframes ss-final-fade {
          0%   { opacity: 0; transform:translate(-50%,-50%) scale(.97); }
          6%   { opacity: 1; transform:translate(-50%,-50%) scale(1); }
          85%  { opacity: 1; transform:translate(-50%,-50%) scale(1); }
          100% { opacity: 0; transform:translate(-50%,-50%) scale(1.02); }
        }
      `;
      document.head.appendChild(this._styles);

      // Overlay + Szene
      this._overlay = document.createElement("div");
      this._overlay.className = "at-ss-overlay";
      this._overlay.innerHTML = `<div class="at-ss-scene"></div>`;
      // Käfergröße vererben
      this._overlay.style.setProperty("--bug-size", String(this._opts.bugSize || 72));

      // Klick ins Leere = finale Einblendung + Stop
      const fastStopOnEmpty = (e) => {
        const path = e.composedPath ? e.composedPath() : null;
        const clickedBug = path
          ? path.some(n => n && n.classList && n.classList.contains("at-bug"))
          : !!(e.target && e.target.closest && e.target.closest(".at-bug"));

        if (!clickedBug) {
          e.stopPropagation();
          e.preventDefault();
          if (this._opts.minigame && this._active && !this._finalShowing){
            this._showFinalAndStop();
          } else if (!this._finalShowing) {
            this.stop();
          }
        }
      };
      // WICHTIG: Listener registrieren (vor Idle-Reset-Block)
      this._overlay.addEventListener('pointerdown', fastStopOnEmpty, { capture: true });

      // Interaktionen schalten Idle-Timer wieder scharf – aber nur, wenn NICHT aktiv
      const reset = () => this.bumpIdle();

      // sanft gedrosselt – reagiert auch auf Touch/Scroll/Tasten/Formulare
      const throttle = (fn, ms = 300) => {
        let t = 0;
        return () => { const n = performance.now(); if (n - t > ms) { t = n; fn(); } };
      };

      // Viele Events → zuverlässiger Idle-Reset
   ['pointermove','pointerdown','pointerup','touchstart','touchmove','touchend','keydown','wheel','scroll']
  .forEach(ev => document.addEventListener(ev, throttle(reset, 600), { passive: true, capture: true }));

      document.addEventListener('visibilitychange', () => { if (!document.hidden) reset(); });
      window.addEventListener('focus', reset);

      this._inited = true;
      return this;
    },

    autowireIdle(){ this._armIdle(); return this; },

    // Öffentliche Herzschlag-API: von deiner App bei Aktionen aufrufen
    bumpIdle(){
      if (!this._inited) return this;
      if (this._active) return this;   // wenn Saver läuft, nicht resetten
      this._armIdle();
      return this;
    },

    start(){
      if (!this._ssOn()) return this; // gesperrt → gar nicht starten
      if(!this._inited) this.init();
      clearTimeout(this._timer); clearTimeout(this._failsafe);
      clearTimeout(this._finalTimer); this._finalTimer = null;
      this._finalShowing = false;

      const root = this._opts.mount;
      if (!this._overlay.isConnected) root.appendChild(this._overlay);

      this._overlay.classList.add("active");
      this._active = true;

      // Mini-Game Session
      if (this._opts.minigame){
        this._game = { score:0, kills:0, startedAt: performance.now()/1000 };
        if (this._opts.minigameHud !== false){
          this._hud = document.createElement('div');
          this._hud.className = 'at-ss-hud';
          this._hud.textContent = 'Rübenklemmer zerquetscht: 0';
          this._overlay.appendChild(this._hud);
        } else {
          this._hud = null;
        }
      } else {
        this._game = null;
        this._hud = null;
      }

      const scene = this._overlay.querySelector(".at-ss-scene");
      scene.innerHTML = "";

      // Szene starten
      this._sceneCleanup = this._sceneBugs(scene);

      // Failsafe
      const fs = Number(this._opts.autoStopMs);
      clearTimeout(this._failsafe);
      if (Number.isFinite(fs) && fs > 0) {
        this._failsafe = setTimeout(() => this.stop(), fs);
      }
      return this;
    },

    stop(){
      if(!this._inited) return this;

      if (this._overlay) this._overlay.classList.remove("active");
      this._active = false;

      clearTimeout(this._failsafe);
      clearTimeout(this._finalTimer);
      this._finalTimer = null;
      this._finalShowing = false;

      cancelAnimationFrame(this._rafId);
      this._rafId = 0;

      if (this._sceneCleanup){ try{ this._sceneCleanup(); }catch{} this._sceneCleanup = null; }

      if (this._hud){ try{ this._hud.remove(); }catch{} this._hud = null; }
      const finalEl = this._overlay.querySelector('.at-ss-final');
      if (finalEl){ try{ finalEl.remove(); }catch{} }

      this._game = null;

      this._armIdle();
      return this;
    },

    /* ===================== intern ===================== */
    _armIdle(){
      if (this._active) return;
      if (!this._ssOn()) return; 
      const ms = (this._opts && this._opts.inactivityMs) || 30000;
      clearTimeout(this._timer);
      this._timer = setTimeout(()=> { if (!this._active) this.start(); }, ms);
    },

    _soundOn(){
      const v = getComputedStyle(document.documentElement).getPropertyValue("--sound-enabled").trim();
      return (v === "" || v === "1"); // default an
    },
    _ssOn(){
      const v = getComputedStyle(document.documentElement).getPropertyValue('--ss-enabled').trim();
      return (v === '' || v === '1');
    },

    _addKill(speedPxPerSec){
      if (!this._game) return;
      // Punkte = Geschwindigkeit / 10, gerundet (laut Anforderung)
      const pts = Math.round((Number(speedPxPerSec)||0) / 10);
      this._game.kills = (this._game.kills|0) + 1;
      this._game.score = (this._game.score|0) + pts;
      if (this._hud) this._hud.textContent = `Rübenklemmer zerquetscht: ${this._game.kills}`;
    },

    _showFinalAndStop(){
      if (!this._game){ this.stop(); return; }
      this._finalShowing = true;

      const k = this._game.kills|0;
      const s = this._game.score|0;

      const final = document.createElement('div');
      final.className = 'at-ss-final';
      final.textContent = `Glückwunsch du hast ${k} Rübenklemmer zerquetscht. Das macht gesamt ${s} Punkte!`;
      this._overlay.appendChild(final);

      // Nach 3s beenden
      this._finalTimer = setTimeout(()=> this.stop(), 3000);
    },

    /* ---------- Szene: horizontale Läufer mit Bobbing ---------- */
    _sceneBugs(scene){
      const opts = this._opts;
      const bugs = new Set();
      let loopAudio = null;
      let spawnTimer = 0;
      let lastTs = 0;

      // Laufgeräusch starten (wenn erlaubt)
      if (this._soundOn() && opts.assets.snd && opts.assets.snd.grabel) {
        try {
          loopAudio = new Audio(opts.assets.snd.grabel);
          loopAudio.loop = true;
          loopAudio.volume = 0.35;
          loopAudio.play().catch(()=>{});
        } catch {}
      }

      const frames = [opts.assets.bug, opts.assets.bug1, opts.assets.bug2, opts.assets.bug3].filter(Boolean);
      const hitFrame = opts.assets.bug4 || frames[0];

      const spawnBug = () => {
        const el = document.createElement("div");
        el.className = "at-bug";

        const inner = document.createElement("div");
        inner.className = "at-bug__inner";

        const spr = document.createElement("div");
        spr.className = "at-bug__sprite";
        spr.style.backgroundImage = `url("${frames[0]}")`;

        inner.appendChild(spr);
        el.appendChild(inner);
        scene.appendChild(el);

        // Bewegungs-Parameter
        const vh = scene.clientHeight || window.innerHeight;
        const vw = scene.clientWidth  || window.innerWidth;

        const dir  = Math.random() < 0.5 ? +1 : -1;           // links->rechts oder rechts->links
        const speed= rand(opts.speedMin, opts.speedMax);      // px/s
        const yMid = rand(0.10 * vh, 0.90 * vh);              // mittlere Höhe
        const amp  = rand(opts.bobAmpMin, opts.bobAmpMax);    // Bobbing-Amplitude
        const freq = rand(opts.bobFreqMin, opts.bobFreqMax);  // Hz
        const phase= Math.random() * TAU;

        // Startposition x0 knapp außerhalb
        const margin = 80;
        const x0 = (dir > 0) ? -margin : (vw + margin);

        // Sprite-Animation
        let f = 0, frameAcc = 0, frameDt = 1 / Math.max(1, opts.bugFps);

        // Zustandsobjekt
        const bug = {
          el, inner, spr, dir, speed, yMid, amp, freq, phase, x0,
          t0: performance.now()/1000, dead:false
        };
        bugs.add(bug);

        // Klick auf Käfer: einfrieren + Punkte, BUG BLEIBT LIEGEN
        el.addEventListener("pointerdown", (e)=>{
          e.stopPropagation();                // Overlay-Leerklick nicht auslösen
          if (bug.dead) return;
          bug.dead = true;

          // Sound „hit“ einmalig
          try {
            if (SS._soundOn() && opts.assets.snd && opts.assets.snd.hit) {
              const a = new Audio(opts.assets.snd.hit);
              a.play().catch(()=>{});
            }
          } catch {}

          // Trefferframe setzen (bleibt sichtbar)
          spr.style.backgroundImage = `url("${hitFrame}")`;
          el.classList.add("dead");

          // Punkte addieren (speed / 10)
          if (SS._opts.minigame && SS._game){
            SS._addKill(bug.speed);
          }

          // KEIN Entfernen des Käfers – er bleibt bis zum Stop sichtbar
        });

        // Initial platzieren
        el.style.transform = `translate(${x0}px, ${yMid}px)`;
        inner.style.transform = `rotate(${dir>0 ? 90 : -90}deg)`;

        // Frame-Stepper
        bug.step = (dt, now) => {
          if (bug.dead) return; // eingefroren: liegen lassen

          const t = now - bug.t0;
          const x = x0 + dir * speed * t;
          const y = yMid + amp * Math.sin(TAU * freq * t + phase);

          // Richtung (Kopf voran: Sprite schaut nach oben → +90°)
          const vx = dir * speed;
          const vy = amp * TAU * freq * Math.cos(TAU * freq * t + phase);
          const angleDeg = Math.atan2(vy, vx) * 180/Math.PI + 90;

          el.style.transform   = `translate(${x}px, ${y}px)`;
          inner.style.transform= `rotate(${angleDeg.toFixed(2)}deg)`;

          // Sprite-Frames
          frameAcc += dt;
          if (frameAcc >= frameDt) {
            frameAcc -= frameDt;
            f = (f + 1) % frames.length;
            spr.style.backgroundImage = `url("${frames[f]}")`;
          }

          // Raus scrollen → entfernen (nur solange lebendig)
          const vw2 = scene.clientWidth || window.innerWidth;
          if ((dir > 0 && x > vw2 + 120) || (dir < 0 && x < -120)) {
            try { el.remove(); } catch {}
            bugs.delete(bug);
          }
        };
      };

      // Anfangs-Burst
      const burst = Math.max(0, Number(this._opts.startBurst ?? 3) | 0);
      for(let i=0; i<burst; i++) spawnBug();

      // RAF-Loop
      const tick = (ts) => {
        SS._rafId = requestAnimationFrame(tick);
        const now = ts/1000;
        const dt = lastTs ? (now - lastTs) : 0;
        lastTs = now;

        // Spawner
        spawnTimer += dt*1000;
        if (spawnTimer >= opts.spawnEveryMs) {
          spawnTimer = 0;
          spawnBug();
        }

        // Alle Käfer updaten
        bugs.forEach(b => b.step && b.step(dt, now));
      };
      SS._rafId = requestAnimationFrame(tick);

      // Cleanup
      return () => {
        cancelAnimationFrame(SS._rafId);
        SS._rafId = 0;
        bugs.forEach(b => { try{ b.el.remove(); }catch{} });
        bugs.clear();
        if (loopAudio){
          try{ loopAudio.pause(); loopAudio.currentTime = 0; }catch{}
          loopAudio = null;
        }
      };
    }
  };

  // Helpers
  function rand(min, max){ return min + Math.random()*(max-min); }

  // Export
  global.AutomatronScreensaver = SS;

})(window);
