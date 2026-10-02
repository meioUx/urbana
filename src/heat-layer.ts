import L from "leaflet";

// Density uses equal weight per occurrence; priority and status stay in the filters.
export function heatLayer(points: [number, number][]) {
  const Heat = L.Layer.extend({
    onAdd(map: L.Map) {
      this.map = map;
      this.canvas = L.DomUtil.create("canvas", "territorial-heat-layer");
      this.canvas.style.pointerEvents = "none";
      map.getPane("overlayPane")!.appendChild(this.canvas);
      map.on("moveend zoomend resize", this.draw, this);
      this.draw();
    },
    onRemove(map: L.Map) {
      map.off("moveend zoomend resize", this.draw, this);
      this.canvas.remove();
    },
    draw() {
      const map: L.Map = this.map;
      const size = map.getSize();
      const canvas: HTMLCanvasElement = this.canvas;
      canvas.width = size.x; canvas.height = size.y;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      const context = canvas.getContext("2d")!;
      const radius = 42;
      for (const point of points) {
        const p = map.latLngToContainerPoint(point);
        if (p.x < -radius || p.y < -radius || p.x > size.x + radius || p.y > size.y + radius) continue;
        const gradient = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
        gradient.addColorStop(0, "rgba(0,0,0,0.32)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        context.fillStyle = gradient;
        context.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
      }
      const ramp = document.createElement("canvas"); ramp.width = 256; ramp.height = 1;
      const rampContext = ramp.getContext("2d")!;
      const gradient = rampContext.createLinearGradient(0, 0, 256, 0);
      gradient.addColorStop(0, "#2374e1"); gradient.addColorStop(0.3, "#24cbb1");
      gradient.addColorStop(0.55, "#e6ed45"); gradient.addColorStop(0.8, "#f89b28"); gradient.addColorStop(1, "#db2929");
      rampContext.fillStyle = gradient; rampContext.fillRect(0, 0, 256, 1);
      const palette = rampContext.getImageData(0, 0, 256, 1).data;
      if (!size.x || !size.y) return;
      const pixels = context.getImageData(0, 0, size.x, size.y);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const alpha = pixels.data[i + 3];
        if (!alpha) continue;
        const index = Math.min(255, Math.round(alpha * 1.8)) * 4;
        pixels.data[i] = palette[index]; pixels.data[i + 1] = palette[index + 1]; pixels.data[i + 2] = palette[index + 2];
        pixels.data[i + 3] = Math.min(200, alpha * 2);
      }
      context.putImageData(pixels, 0, 0);
    },
  });
  return new Heat() as L.Layer;
}
