"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import Link from "next/link";
import L from "leaflet";

// 🔥 webpackでLeafletのデフォルトピン画像が壊れる問題への対処
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 14);
      return;
    }
    const bounds = points.map((p) => [p.latitude, p.longitude]);
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [points, map]);
  return null;
}

export default function LocationMap({ locations }) {
  const points = locations.filter((l) => l.latitude != null && l.longitude != null);

  if (points.length === 0) {
    return (
      <div className="mx-4 mb-4 rounded-2xl border-[3px] border-cardBorder bg-white h-40 flex items-center justify-center text-xs text-inkMuted">
        座標情報のある観測地点がありません
      </div>
    );
  }

  return (
    <div className="mx-4 mb-4 rounded-2xl overflow-hidden border-[3px] border-cardBorder" style={{ height: 220 }}>
      <MapContainer
        center={[points[0].latitude, points[0].longitude]}
        zoom={12}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {points.map((loc) => (
          <Marker key={loc.name} position={[loc.latitude, loc.longitude]}>
            <Popup>
              <div style={{ fontFamily: "sans-serif", minWidth: 140 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{loc.name}</div>
                <div style={{ fontSize: 12, color: "#555" }}>
                  検出種数 {loc.speciesCount}・記録数 {loc.recordCount}件
                  <br />
                  最終観測 {loc.lastSeen}
                </div>
                <Link
                  href={`/loc/${encodeURIComponent(loc.name)}`}
                  style={{ fontSize: 12, color: "#3F6C74", fontWeight: 700 }}
                >
                  詳細を見る ›
                </Link>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
