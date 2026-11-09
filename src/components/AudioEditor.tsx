import { saveBlob } from '../platform/saveFile'
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  AudioLines,
  Check,
  Download,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Upload,
  Volume2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";

type PlaybackMode = "source" | "selection" | null;

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00.00";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function safeBaseName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*]/g, "_").trim() || "音频片段";
}

function encodeWav(
  buffer: AudioBuffer,
  startSeconds: number,
  endSeconds: number,
  volume: number,
  fadeIn: number,
  fadeOut: number,
) {
  const startFrame = Math.max(0, Math.floor(startSeconds * buffer.sampleRate));
  const endFrame = Math.min(buffer.length, Math.ceil(endSeconds * buffer.sampleRate));
  const frameCount = Math.max(1, endFrame - startFrame);
  const channels = Math.min(buffer.numberOfChannels, 2);
  const bytesPerSample = 2;
  const dataSize = frameCount * channels * bytesPerSample;
  const wav = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wav);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1)
      view.setUint8(offset + index, value.charCodeAt(index));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);

  const selectionDuration = frameCount / buffer.sampleRate;
  const channelData = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index));
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const elapsed = frame / buffer.sampleRate;
    const remaining = selectionDuration - elapsed;
    const fadeGain = Math.min(
      1,
      fadeIn > 0 ? elapsed / fadeIn : 1,
      fadeOut > 0 ? remaining / fadeOut : 1,
    );
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][startFrame + frame] * volume * fadeGain));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return new Blob([wav], { type: "audio/wav" });
}

function Waveform({
  buffer,
  start,
  end,
  currentTime,
}: {
  buffer: AudioBuffer;
  start: number;
  end: number;
  currentTime: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(bounds.width * ratio));
      canvas.height = Math.max(1, Math.round(bounds.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      const width = bounds.width;
      const height = bounds.height;
      const styles = getComputedStyle(document.documentElement);
      const line = styles.getPropertyValue("--line").trim();
      const faint = styles.getPropertyValue("--faint").trim();
      const brand = styles.getPropertyValue("--brand").trim();
      const accent = styles.getPropertyValue("--accent-soft").trim();
      context.clearRect(0, 0, width, height);

      const startX = (start / buffer.duration) * width;
      const endX = (end / buffer.duration) * width;
      context.fillStyle = accent;
      context.fillRect(startX, 0, Math.max(1, endX - startX), height);
      context.strokeStyle = line;
      context.beginPath();
      context.moveTo(0, height / 2);
      context.lineTo(width, height / 2);
      context.stroke();

      const data = buffer.getChannelData(0);
      const columns = Math.max(1, Math.floor(width));
      const step = Math.max(1, Math.floor(data.length / columns));
      for (let x = 0; x < columns; x += 1) {
        let peak = 0;
        const offset = x * step;
        for (let sample = 0; sample < step; sample += 1)
          peak = Math.max(peak, Math.abs(data[offset + sample] ?? 0));
        context.strokeStyle = x >= startX && x <= endX ? brand : faint;
        context.beginPath();
        context.moveTo(x + 0.5, height / 2 - peak * height * 0.43);
        context.lineTo(x + 0.5, height / 2 + peak * height * 0.43);
        context.stroke();
      }

      const playheadX = (currentTime / buffer.duration) * width;
      context.strokeStyle = brand;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(playheadX, 0);
      context.lineTo(playheadX, height);
      context.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    const themeObserver = new MutationObserver(draw);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      observer.disconnect();
      themeObserver.disconnect();
    };
  }, [buffer, currentTime, end, start]);

  return <canvas ref={canvasRef} className="audio-editor-waveform" aria-label="音频波形与当前选区" />;
}

export function AudioEditor() {
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [selection, setSelection] = useState<[number, number]>([0, 0]);
  const [volume, setVolume] = useState(100);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const duration = buffer?.duration ?? 0;
  const selectionDuration = Math.max(0, selection[1] - selection[0]);
  const maxFade = Math.min(10, selectionDuration / 2);
  const estimatedSize = buffer
    ? selectionDuration * buffer.sampleRate * Math.min(buffer.numberOfChannels, 2) * 2 + 44
    : 0;

  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);

  const loadFile = async (nextFile: File) => {
    setLoading(true);
    setError("");
    setPlaybackMode(null);
    setBuffer(null);
    const nextUrl = URL.createObjectURL(nextFile);
    setSourceUrl(nextUrl);
    setFile(nextFile);
    try {
      const context = new AudioContext();
      try {
        const decoded = await context.decodeAudioData(await nextFile.arrayBuffer());
        setBuffer(decoded);
        setSelection([0, decoded.duration]);
        setCurrentTime(0);
        setFadeIn(0);
        setFadeOut(0);
        setVolume(100);
      } finally {
        await context.close();
      }
    } catch {
      setBuffer(null);
      setError("无法读取这个音频文件，请尝试 MP3、WAV、M4A、AAC、OGG 或 FLAC。不同系统支持的格式可能略有差异。");
    } finally {
      setLoading(false);
    }
  };

  const pause = () => {
    audioRef.current?.pause();
    setPlaybackMode(null);
  };

  const play = async (mode: Exclude<PlaybackMode, null>) => {
    const audio = audioRef.current;
    if (!audio || !buffer) return;
    if (playbackMode === mode && !audio.paused) {
      pause();
      return;
    }
    audio.currentTime = mode === "selection" ? selection[0] : 0;
    audio.volume = Math.min(1, volume / 100);
    setCurrentTime(audio.currentTime);
    setPlaybackMode(mode);
    try {
      await audio.play();
    } catch {
      setPlaybackMode(null);
      setError("暂时无法播放音频，请重新选择文件后再试。");
    }
  };

  const resetSelection = () => {
    if (!buffer) return;
    pause();
    setSelection([0, buffer.duration]);
    setFadeIn(0);
    setFadeOut(0);
    setCurrentTime(0);
  };

  const exportClip = () => {
    if (!buffer || !file || selectionDuration <= 0) return;
    pause();
    setExporting(true);
    setError("");
    window.setTimeout(async () => {
      try {
        const blob = encodeWav(buffer, selection[0], selection[1], volume / 100, fadeIn, fadeOut);
        await saveBlob(`${safeBaseName(file.name)}-剪辑.wav`, blob);
      } catch {
        setError("导出失败，音频可能过长或设备内存不足。请缩短选区后重试。");
      } finally {
        setExporting(false);
      }
    }, 20);
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const nextFile = event.dataTransfer.files[0];
    if (nextFile) void loadFile(nextFile);
  };

  const fadeSummary = useMemo(() => {
    if (!fadeIn && !fadeOut) return "无淡入淡出";
    return `淡入 ${fadeIn.toFixed(1)}s · 淡出 ${fadeOut.toFixed(1)}s`;
  }, [fadeIn, fadeOut]);

  return (
    <div className="tool-workspace audio-editor">
      <div className="panel-heading">
        <div>
          <h2>音频剪辑器</h2>
          <p>选取需要的片段，微调听感后导出为通用 WAV 音频</p>
        </div>
      </div>
      <audio
        ref={audioRef}
        src={sourceUrl}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          setCurrentTime(audio.currentTime);
          if (playbackMode === "selection" && audio.currentTime >= selection[1]) {
            audio.pause();
            audio.currentTime = selection[0];
            setCurrentTime(selection[0]);
            setPlaybackMode(null);
          }
        }}
        onEnded={() => setPlaybackMode(null)}
      />

      {!buffer ? (
        <button
          className={`audio-editor-dropzone ${loading ? "loading" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          disabled={loading}
        >
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,.flac"
            hidden
            onChange={(event) => {
              const nextFile = event.target.files?.[0];
              if (nextFile) void loadFile(nextFile);
              event.currentTarget.value = "";
            }}
          />
          <span className="audio-editor-drop-icon"><AudioLines size={30} /></span>
          <strong>{loading ? "正在解析音频…" : "选择或拖入音频"}</strong>
          <span>支持常见音频格式，文件只在本机处理</span>
          {!loading && <span className="audio-editor-file-action"><Upload size={14} /> 选择文件</span>}
        </button>
      ) : (
        <div className="audio-editor-shell">
          <div className="audio-editor-main">
            <div className="audio-editor-filebar">
              <span className="audio-editor-file-icon"><AudioLines size={19} /></span>
              <div>
                <strong className="user-content">{file?.name}</strong>
                <span>{file ? formatBytes(file.size) : ""} · {buffer.sampleRate / 1000} kHz · {buffer.numberOfChannels === 1 ? "单声道" : `${buffer.numberOfChannels} 声道`}</span>
              </div>
              <Button variant="outline" className="button secondary" onClick={() => inputRef.current?.click()}>
                <Upload size={15} /> 更换
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept="audio/*,.flac"
                hidden
                onChange={(event) => {
                  const nextFile = event.target.files?.[0];
                  if (nextFile) void loadFile(nextFile);
                  event.currentTarget.value = "";
                }}
              />
            </div>

            <div className="audio-editor-wave-panel">
              <Waveform buffer={buffer} start={selection[0]} end={selection[1]} currentTime={currentTime} />
              <div className="audio-editor-ruler"><span>00:00</span><span>{formatTime(duration / 2)}</span><span>{formatTime(duration)}</span></div>
            </div>

            <div className="audio-editor-selection">
              <div className="audio-editor-selection-heading">
                <span><Scissors size={15} /> 剪辑范围</span>
                <strong>{formatTime(selectionDuration)}</strong>
              </div>
              <Slider
                min={0}
                max={duration}
                step={Math.min(0.01, duration / 1000)}
                value={selection}
                minStepsBetweenThumbs={1}
                onValueChange={(value) => {
                  pause();
                  const next = value as [number, number];
                  setSelection(next);
                  setCurrentTime(next[0]);
                  setFadeIn((current) => Math.min(current, (next[1] - next[0]) / 2));
                  setFadeOut((current) => Math.min(current, (next[1] - next[0]) / 2));
                }}
                aria-label="调整音频剪辑起止时间"
              />
              <div className="audio-editor-time-fields">
                <div><span>开始时间</span><strong>{formatTime(selection[0])}</strong></div>
                <div><span>结束时间</span><strong>{formatTime(selection[1])}</strong></div>
              </div>
            </div>

            <div className="audio-editor-transport">
              <Button variant="outline" className="button secondary" onClick={() => void play("source")}>
                {playbackMode === "source" ? <Pause size={16} /> : <Play size={16} />} {playbackMode === "source" ? "暂停" : "播放原音"}
              </Button>
              <Button className="button primary" onClick={() => void play("selection")}>
                {playbackMode === "selection" ? <Pause size={16} /> : <Play size={16} />} {playbackMode === "selection" ? "暂停试听" : "试听选区"}
              </Button>
              <button className="audio-editor-reset" onClick={resetSelection}><RotateCcw size={14} /> 重置选区</button>
            </div>
          </div>

          <aside className="audio-editor-options">
            <div className="audio-editor-option-heading">
              <span><Volume2 size={17} /></span>
              <div><strong>声音调整</strong><p>只影响导出的音频</p></div>
            </div>
            <label>
              <span>音量 <output>{volume}%</output></span>
              <Slider min={0} max={150} step={1} value={[volume]} onValueChange={(value) => setVolume(value[0])} aria-label="调整导出音量" />
            </label>
            <label>
              <span>淡入 <output>{fadeIn.toFixed(1)}s</output></span>
              <Slider min={0} max={Math.max(0.1, maxFade)} step={0.1} value={[fadeIn]} onValueChange={(value) => setFadeIn(Math.min(value[0], maxFade))} aria-label="调整淡入时长" />
            </label>
            <label>
              <span>淡出 <output>{fadeOut.toFixed(1)}s</output></span>
              <Slider min={0} max={Math.max(0.1, maxFade)} step={0.1} value={[fadeOut]} onValueChange={(value) => setFadeOut(Math.min(value[0], maxFade))} aria-label="调整淡出时长" />
            </label>
            <div className="audio-editor-export-summary">
              <div><span>输出格式</span><strong>WAV · 16-bit</strong></div>
              <div><span>预计大小</span><strong>{formatBytes(estimatedSize)}</strong></div>
              <small>{fadeSummary}</small>
            </div>
            <Button className="button primary audio-editor-export" disabled={exporting || selectionDuration <= 0} onClick={exportClip}>
              <Download size={17} /> {exporting ? "正在导出…" : "导出选中片段"}
            </Button>
          </aside>
        </div>
      )}
      {error && <p className="audio-editor-error" role="alert">{error}</p>}
      <div className="privacy-note"><Check size={16} /> 音频解析、剪辑和导出均在设备本地完成，不会上传文件。</div>
    </div>
  );
}
