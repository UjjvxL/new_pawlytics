import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Cctv, MapPin, Pause, Play, Radio, ScanLine, X } from "lucide-react";

export default function CctvDemo({ close }: { close: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  function togglePlayback() {
    if (!video.current) return;
    if (video.current.paused) void video.current.play();
    else video.current.pause();
  }

  return (
    <div className="cctv-scrim" role="dialog" aria-modal="true" aria-label="CCTV dog detection concept demo">
      <section className="cctv-console">
        <header className="cctv-header">
          <div className="cctv-title-icon"><Cctv /></div>
          <div><span>PAWLYTICS VISION</span><h2>Public Camera Intelligence</h2></div>
          <div className="cctv-concept"><i /> CONCEPT DEMO</div>
          <button onClick={close} aria-label="Close CCTV demo"><X /></button>
        </header>

        <div className="cctv-layout">
          <div className="cctv-feed-wrap">
            <video
              ref={video}
              src="/demo/cctv-dog-detection.mp4"
              autoPlay muted loop playsInline
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(event) => setSeconds(event.currentTarget.currentTime)}
            />
            <div className="cctv-scanlines" />
            <div className="cctv-feed-top">
              <span><Radio /> CAM · NCR-047</span>
              <span>GREATER NOIDA · PUBLIC ROAD</span>
              <time>14:32:{String(Math.floor(seconds)).padStart(2, "0")} IST</time>
            </div>
            <div className={`cctv-detection${playing ? " tracking" : ""}`}>
              <span>DOG · ID 01 <b>{Math.round(93 + (seconds % 3))}%</b></span>
              <i className="corner tl"/><i className="corner tr"/><i className="corner bl"/><i className="corner br"/>
            </div>
            <div className="cctv-reticle"><ScanLine /></div>
            <div className="cctv-feed-bottom">
              <button onClick={togglePlayback} aria-label={playing ? "Pause CCTV demo" : "Play CCTV demo"}>{playing ? <Pause /> : <Play />}</button>
              <span>FRAME {String(Math.floor(seconds * 30)).padStart(4, "0")}</span>
              <span>EDGE INFERENCE · 30 FPS</span>
            </div>
          </div>

          <aside className="cctv-insights">
            <div className="cctv-live-label"><i /> AI ANALYTICS ACTIVE</div>
            <section className="cctv-metrics">
              <article><small>ANIMALS DETECTED</small><strong>01</strong><span>Dog · Track stable</span></article>
              <article><small>MODEL CONFIDENCE</small><strong>{Math.round(93 + (seconds % 3))}<em>%</em></strong><span>Above 85% threshold</span></article>
            </section>
            <section className="cctv-classification">
              <header><span>CLASSIFICATION</span><b>LIVE</b></header>
              <div><i style={{ width: "95%" }}/><span>Dog</span><strong>0.95</strong></div>
              <div><i style={{ width: "4%" }}/><span>Person</span><strong>0.04</strong></div>
              <div><i style={{ width: "1%" }}/><span>Other</span><strong>0.01</strong></div>
            </section>
            <section className="cctv-pipeline">
              <article className="done"><Camera /><div><strong>Camera signal received</strong><span>Privacy-first edge processing</span></div><CheckCircle2 /></article>
              <article className="done"><ScanLine /><div><strong>Dog track confirmed</strong><span>12 consecutive frames</span></div><CheckCircle2 /></article>
              <article className="active"><MapPin /><div><strong>Map alert prepared</strong><span>Human verification before publish</span></div><i /></article>
            </section>
            <div className="cctv-future-note"><strong>Future integration vision</strong><span>Designed to connect consented public-camera feeds with Pawlytics safety maps.</span></div>
          </aside>
        </div>

        <footer className="cctv-disclaimer">
          <span><i /> PRERECORDED FOOTAGE</span>
          This is a simulated product concept. No live CCTV network or automated map publishing is connected.
          <a href="https://www.pexels.com/video/stray-dogs-roaming-city-streets-in-rain-33515265/" target="_blank" rel="noreferrer">Footage: Swapnil Shiwalay / Pexels</a>
        </footer>
      </section>
    </div>
  );
}
