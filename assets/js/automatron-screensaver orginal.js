/*! Automatron Screensaver – Bugs: langsam quer, Kopf voran, sanftes Bobbing, Sprite-Frames */
(function (global) {
  "use strict";

  const TAU = Math.PI * 2;

  const SS = {
    _inited:false, _opts:null, _timer:null, _failsafe:null,
    _overlay:null, _styles:null, _sceneCleanup:null, _rafId:0,

    init(opts = {}){
      if (this._inited) return this;

      // ---- Defaults (sanft & langsam) ----
      const defaults = {
        mount: document.body,
        inactivityMs: 60000,         // nach Inaktivität starten
        scene: "bugs",
        spawnEveryMs: 900,           // ⬅️ schnellere Spawnrate
        bugFps: 10,                  // Frames pro Sekunde (Sprite)
        speedMin: 70,                // ⬅️ langsam
        speedMax: 130,
        bobAmpMin: 6,                // sanftes Auf/Ab in px
        bobAmpMax: 16,
        bobFreqMin: 0.18,            // Hz
        bobFreqMax: 0.35,
        assets: {
          bug:  "assets/img/bug.png",
          bug1: "assets/img/bug1.png",
          bug2: "assets/img/bug2.png",
          bug3: "assets/img/bug3.png",
          bug4: "assets/img/bug4.png",     // Trefferframe
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
        .at-ss-overlay{ position:fixed; inset:0; z-index:2147483606; display:none;
                        background:rgba(0,0,0,.08); }
        .at-ss-overlay.active{ display:block; }
        .at-ss-scene{ position:absolute; inset:0; overflow:hidden; }

        /* Käfercontainer: wird nur verschoben (translate) */
        .at-bug{ position:absolute; left:0; top:0; width:72px; height:72px;
                 will-change: transform; filter: drop-shadow(0 4px 8px rgba(0,0,0,.35)); }
        /* Inner rotiert in Bewegungsrichtung (Sprite schaut nach oben) */
        .at-bug__inner{ width:100%; height:100%; transform-origin:50% 50%; will-change: transform; }
        .at-bug__sprite{ width:100%; height:100%; background-repeat:no-repeat;
                         background-position:center; background-size:contain; }

        /* Eingefrorener Käfer: kein Cursor, leicht stärkere Schatten */
        .at-bug.dead{ cursor:default; }
        .at-bug.dead .at-bug__inner{ filter: drop-shadow(0 6px 12px rgba(0,0,0,.55)); }
      `;
      document.head.appendChild(this._styles);

      // Overlay
      this._overlay = document.createElement("div");
      this._overlay.className = "at-ss-overlay";
      this._overlay.innerHTML = `<div class="at-ss-scene"></div>`;
      // Klick ins Leere = beenden
     // schnell: Capture + composedPath, dann sofort stoppen
const fastStopOnEmpty = (e) => {
  const path = e.composedPath ? e.composedPath() : [];
  const clickedBug = path.some(n => n && n.classList && n.classList.contains("at-bug"));
  if (!clickedBug) {
    e.stopPropagation();   // nichts anderes mehr ausführen
    e.preventDefault();
    this.stop();           // sofort aus
  }
};
this._overlay.addEventListener("pointerdown", fastStopOnEmpty, { capture: true });


      // Interaktionen schalten Idle-Timer wieder scharf
      const reset = () => this._armIdle();
      ["pointerdown","pointermove","keydown","wheel","touchstart"].forEach(ev =>
        document.addEventListener(ev, reset, { passive:true })
      );

      this._inited = true;
      return this;
    },

    autowireIdle(){ this._armIdle(); return this; },

    start(){
      if(!this._inited) this.init();
      clearTimeout(this._timer); clearTimeout(this._failsafe);

      const root = this._opts.mount;
      if (!this._overlay.isConnected) root.appendChild(this._overlay);

      this._overlay.classList.add("active");

      const scene = this._overlay.querySelector(".at-ss-scene");
      scene.innerHTML = "";

      // Szene starten
      this._sceneCleanup = this._sceneBugs(scene);

      // Failsafe (falls nie geklickt wird)
      this._failsafe = setTimeout(()=> this.stop(), 60_000);
    },

   stop(){
  if(!this._inited) return;

  // ⬅️ gleich zu Beginn: visuell weg
  if (this._overlay) this._overlay.classList.remove("active");

  clearTimeout(this._failsafe);
  cancelAnimationFrame(this._rafId);
  this._rafId = 0;

  if (this._sceneCleanup){ try{ this._sceneCleanup(); }catch{} this._sceneCleanup = null; }

  // (optional) Overlay aus dem DOM nehmen:
  // if (this._overlay && this._overlay.parentNode) this._overlay.parentNode.removeChild(this._overlay);

  this._armIdle();
},

    /* intern */
    _armIdle(){
      const ms = (this._opts && this._opts.inactivityMs) || 60000;
      clearTimeout(this._timer);
      this._timer = setTimeout(()=> this.start(), ms);
    },
    _soundOn(){
      const v = getComputedStyle(document.documentElement).getPropertyValue("--sound-enabled").trim();
      return (v === "" || v === "1"); // default an
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
        try { loopAudio = new Audio(opts.assets.snd.grabel); loopAudio.loop = true; loopAudio.volume = 0.35; loopAudio.play().catch(()=>{}); } catch {}
      }

      const frames = [opts.assets.bug, opts.assets.bug1, opts.assets.bug2, opts.assets.bug3].filter(Boolean);
      const hitFrame = opts.assets.bug4 || frames[0];

      function spawnBug(){
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

        const dir = Math.random() < 0.5 ? +1 : -1;           // links->rechts oder rechts->links
        const speed = rand(opts.speedMin, opts.speedMax);     // px/s
        const yMid = rand(0.10 * vh, 0.90 * vh);              // mittlere Höhe
        const amp = rand(opts.bobAmpMin, opts.bobAmpMax);     // Bobbing-Amplitude
        const freq = rand(opts.bobFreqMin, opts.bobFreqMax);  // Hz
        const phase = Math.random() * TAU;

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

        // Klick auf Käfer: einfrieren
        el.addEventListener("pointerdown", (e)=>{
          e.stopPropagation();      // nicht Overlay beenden
          if (bug.dead) return;
          bug.dead = true;

          // Sound „hit“ einmalig
          try {
            if (SS._soundOn() && opts.assets.snd && opts.assets.snd.hit) {
              const a = new Audio(opts.assets.snd.hit);
              a.play().catch(()=>{});
            }
          } catch {}

          // Trefferframe setzen
          spr.style.backgroundImage = `url("${hitFrame}")`;
          el.classList.add("dead");
        });

        // Initial platzieren
        el.style.transform = `translate(${x0}px, ${yMid}px)`;
        inner.style.transform = `rotate(${dir>0 ? 90 : -90}deg)`;

        // Frame-Stepper für dieses Bug-Objekt
        bug.step = (dt, now) => {
          if (bug.dead) return; // eingefroren

          const t = now - bug.t0;
          const x = x0 + dir * speed * t;
          const y = yMid + amp * Math.sin(TAU * freq * t + phase);

          // Geschwindigkeit (für Kopfrotation) – Ableitung des Bobbings
          const vx = dir * speed;
          const vy = amp * TAU * freq * Math.cos(TAU * freq * t + phase);
          const angleDeg = Math.atan2(vy, vx) * 180/Math.PI + 90; // Sprite schaut oben → +90°

          el.style.transform = `translate(${x}px, ${y}px)`;
          inner.style.transform = `rotate(${angleDeg.toFixed(2)}deg)`;

          // Sprite-Frames (nur wenn lebendig)
          frameAcc += dt;
          if (frameAcc >= frameDt) {
            frameAcc -= frameDt;
            f = (f + 1) % frames.length;
            spr.style.backgroundImage = `url("${frames[f]}")`;
          }

          // Aus dem Viewport raus? Entfernen
          const vw2 = scene.clientWidth || window.innerWidth;
          if ((dir > 0 && x > vw2 + 120) || (dir < 0 && x < -120)) {
            try { el.remove(); } catch {}
            bugs.delete(bug);
          }
        };
      }

      // Sofort ein paar Käfer starten
      for(let i=0; i<3; i++) spawnBug();

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
        if (loopAudio){ try{ loopAudio.pause(); loopAudio.currentTime = 0; }catch{} loopAudio = null; }
      };
    }
  };

  // Helpers
  function rand(min, max){ return min + Math.random()*(max-min); }

  global.AutomatronScreensaver = SS;
})(window);
