/**
 * AvatarCropModal — Premium interactive image crop with circular viewport.
 * 
 * Zero dependencies — uses pure HTML Canvas + CSS + touch/mouse events.
 * 
 * Features:
 *   - Circular crop viewport with dark overlay
 *   - Drag to pan (mouse & touch)
 *   - Pinch-to-zoom on mobile
 *   - Scroll-wheel zoom on desktop
 *   - Slider zoom control
 *   - Live circular preview
 *   - Outputs 800×800 square JPEG
 *   - Glassmorphism dark UI matching app aesthetic
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { X, ZoomIn, ZoomOut, Check, RotateCcw } from 'lucide-react';

const OUTPUT_SIZE = 800; // Final avatar dimensions (800×800)
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

export default function AvatarCropModal({ imageFile, onConfirm, onCancel }) {
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const containerRef = useRef(null);

  // Transform state
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [viewportSize, setViewportSize] = useState(280);

  // Drag state (refs for performance — no re-renders during drag)
  const isDragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef(0);
  const currentOffset = useRef({ x: 0, y: 0 });
  const currentZoom = useRef(1);

  // Load image from file
  useEffect(() => {
    if (!imageFile) return;
    const url = URL.createObjectURL(imageFile);
    const img = new window.Image();
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);

      // Calculate initial zoom so image fills the viewport circle
      const container = containerRef.current;
      if (container) {
        const vp = Math.min(container.offsetWidth, container.offsetHeight) * 0.75;
        setViewportSize(Math.min(vp, 320));
      }
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  // Recalculate initial fit when image loads
  useEffect(() => {
    if (!imageLoaded || !imageRef.current) return;
    const img = imageRef.current;
    const vp = viewportSize;

    // Scale so the shorter side fills the viewport
    const scaleX = vp / img.width;
    const scaleY = vp / img.height;
    const fitZoom = Math.max(scaleX, scaleY);

    // Normalize to 1.0 = fitted
    const baseScale = fitZoom;
    currentZoom.current = 1;
    currentOffset.current = { x: 0, y: 0 };
    setZoom(1);
    setOffset({ x: 0, y: 0 });

    // Store base scale for rendering
    imageRef.current._baseScale = baseScale;
  }, [imageLoaded, viewportSize]);

  // ── Render loop ───────────────────────────────────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !img._baseScale) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const vp = viewportSize;
    const scale = img._baseScale * currentZoom.current;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Draw image centered + offset
    const imgW = img.width * scale;
    const imgH = img.height * scale;
    const drawX = (w - imgW) / 2 + currentOffset.current.x;
    const drawY = (h - imgH) / 2 + currentOffset.current.y;

    ctx.drawImage(img, drawX, drawY, imgW, imgH);

    // Draw dark overlay with circular cutout
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, w, h);
    // Cut out circle
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, vp / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Draw circle border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, vp / 2, 0, Math.PI * 2);
    ctx.stroke();

    // Inner subtle glow
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, vp / 2 + 3, 0, Math.PI * 2);
    ctx.stroke();
  }, [viewportSize]);

  useEffect(() => {
    if (imageLoaded) render();
  }, [imageLoaded, zoom, offset, render]);

  // ── Mouse/Touch handlers ──────────────────────────────────────────
  const handlePointerDown = (e) => {
    e.preventDefault();
    isDragging.current = true;
    const pt = e.touches ? e.touches[0] : e;
    lastPointer.current = { x: pt.clientX, y: pt.clientY };

    if (e.touches && e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
    }
  };

  const handlePointerMove = (e) => {
    if (!isDragging.current) return;
    e.preventDefault();

    // Pinch zoom
    if (e.touches && e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (lastPinchDist.current > 0) {
        const scale = dist / lastPinchDist.current;
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentZoom.current * scale));
        currentZoom.current = newZoom;
        setZoom(newZoom);
      }
      lastPinchDist.current = dist;
      render();
      return;
    }

    // Pan
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - lastPointer.current.x;
    const dy = pt.clientY - lastPointer.current.y;
    currentOffset.current = {
      x: currentOffset.current.x + dx,
      y: currentOffset.current.y + dy
    };
    lastPointer.current = { x: pt.clientX, y: pt.clientY };
    setOffset({ ...currentOffset.current });
    render();
  };

  const handlePointerUp = () => {
    isDragging.current = false;
    lastPinchDist.current = 0;
  };

  // Scroll wheel zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentZoom.current + delta));
    currentZoom.current = newZoom;
    setZoom(newZoom);
    render();
  };

  // Slider zoom
  const handleSliderZoom = (e) => {
    const val = parseFloat(e.target.value);
    currentZoom.current = val;
    setZoom(val);
    render();
  };

  // Reset to center
  const handleReset = () => {
    currentOffset.current = { x: 0, y: 0 };
    currentZoom.current = 1;
    setOffset({ x: 0, y: 0 });
    setZoom(1);
    render();
  };

  // ── Export cropped image ──────────────────────────────────────────
  const handleConfirm = () => {
    const img = imageRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    const scale = img._baseScale * currentZoom.current;
    const vp = viewportSize;

    // Calculate the source rectangle in original image coordinates
    const imgW = img.width * scale;
    const imgH = img.height * scale;
    const drawX = (canvas.width - imgW) / 2 + currentOffset.current.x;
    const drawY = (canvas.height - imgH) / 2 + currentOffset.current.y;

    // Viewport circle center and radius in canvas coords
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const r = vp / 2;

    // Map viewport square to original image coords
    const srcX = (cx - r - drawX) / scale;
    const srcY = (cy - r - drawY) / scale;
    const srcW = vp / scale;
    const srcH = vp / scale;

    // Create output canvas
    const out = document.createElement('canvas');
    out.width = OUTPUT_SIZE;
    out.height = OUTPUT_SIZE;
    const outCtx = out.getContext('2d');

    // Draw cropped region
    outCtx.drawImage(
      img,
      Math.max(0, srcX), Math.max(0, srcY), srcW, srcH,
      0, 0, OUTPUT_SIZE, OUTPUT_SIZE
    );

    // Convert to base64 JPEG
    const base64 = out.toDataURL('image/jpeg', 0.9);
    onConfirm(base64);
  };

  // Canvas sizing
  const canvasSize = Math.min(400, viewportSize + 80);

  if (!imageFile) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div 
        className="relative w-[95vw] max-w-[440px] bg-zinc-900/95 border border-zinc-700/50 rounded-3xl overflow-hidden shadow-2xl shadow-black/60"
        style={{ backdropFilter: 'blur(20px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h3 className="text-white font-semibold text-base">Crop Avatar</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 transition-colors"
              title="Reset position"
            >
              <RotateCcw className="w-4 h-4 text-zinc-400" />
            </button>
            <button
              onClick={onCancel}
              className="p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 transition-colors"
            >
              <X className="w-4 h-4 text-zinc-400" />
            </button>
          </div>
        </div>

        {/* Canvas Area */}
        <div 
          ref={containerRef}
          className="relative flex items-center justify-center"
          style={{ 
            height: `${canvasSize + 40}px`,
            background: 'radial-gradient(ellipse at center, rgba(6,182,212,0.03) 0%, transparent 70%)'
          }}
        >
          <canvas
            ref={canvasRef}
            width={canvasSize * 2}   // 2x for retina
            height={canvasSize * 2}
            style={{
              width: `${canvasSize}px`,
              height: `${canvasSize}px`,
              cursor: isDragging.current ? 'grabbing' : 'grab',
              touchAction: 'none'
            }}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
            onWheel={handleWheel}
          />

          {!imageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Instructions overlay */}
          {imageLoaded && (
            <div className="absolute bottom-3 left-0 right-0 text-center pointer-events-none">
              <span className="text-[11px] text-white/40 font-medium">
                Drag to reposition • Pinch or scroll to zoom
              </span>
            </div>
          )}
        </div>

        {/* Zoom Slider */}
        <div className="px-6 py-3 border-t border-zinc-800/50">
          <div className="flex items-center gap-3">
            <ZoomOut className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            <div className="flex-1 relative">
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={handleSliderZoom}
                className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:w-5
                  [&::-webkit-slider-thumb]:h-5
                  [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-cyan-400
                  [&::-webkit-slider-thumb]:shadow-lg
                  [&::-webkit-slider-thumb]:shadow-cyan-400/30
                  [&::-webkit-slider-thumb]:border-2
                  [&::-webkit-slider-thumb]:border-white/20
                  [&::-webkit-slider-thumb]:cursor-pointer
                  [&::-moz-range-thumb]:w-5
                  [&::-moz-range-thumb]:h-5
                  [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:bg-cyan-400
                  [&::-moz-range-thumb]:border-2
                  [&::-moz-range-thumb]:border-white/20
                  [&::-moz-range-thumb]:cursor-pointer
                  [&::-moz-range-track]:bg-zinc-700
                  [&::-moz-range-track]:rounded-full
                  [&::-moz-range-track]:h-1.5
                "
              />
              {/* Zoom percentage label */}
              <div className="absolute -top-0.5 right-0 text-[10px] text-zinc-500 tabular-nums">
                {Math.round(zoom * 100)}%
              </div>
            </div>
            <ZoomIn className="w-4 h-4 text-zinc-500 flex-shrink-0" />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-zinc-800">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!imageLoaded}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-semibold text-sm transition-all shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            Save Avatar
          </button>
        </div>
      </div>
    </div>
  );
}
