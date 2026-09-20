"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, CircleMarker, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";

// 🔥 webpackでLeafletのデフォルトピン画像が壊れる問題への対処（LocationMap と同じ）
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const JAPAN_CENTER = [36.2, 138.2];

// 地図をタップした場所を、選んだ場所にする
function ClickToPick({ onPick }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// 検索結果を選んだとき、その場所まで地図を動かす
function FlyTo({ focus }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lon], Math.max(map.getZoom(), 15), { duration: 0.8 });
  }, [focus, map]);
  return null;
}

// タブの切り替えなどで、地図の入れ物の大きさが変わっても、地図が崩れないようにする
function KeepSize() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

// 最初に、これまでの場所が全部見える範囲にする（まだ場所を選んでいないときだけ・1回だけ）
function FitExisting({ points, hasPick }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || hasPick || points.length === 0) return;
    done.current = true;
    map.fitBounds(
      points.map((p) => [p.latitude, p.longitude]),
      { padding: [20, 20], maxZoom: 10 }
    );
  }, [points, hasPick, map]);
  return null;
}

// 🔥 新しい場所を、地図で指定する部品。
//    ・地図をタップ、または青いピンをドラッグして、場所を指定
//    ・灰色の点は、これまでに登録した場所（重複の確認用）
//    position：[緯度, 経度] か null、onPick(緯度, 経度)：指定されたとき、focus：{ lat, lon }（検索結果を選んだとき）
export default function LocationPicker({ position, onPick, focus, points }) {
  return (
    <div className="rounded-xl overflow-hidden border-[3px] border-cardBorder" style={{ height: 240 }}>
      <MapContainer
        center={position ?? JAPAN_CENTER}
        zoom={position ? 14 : 6}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickToPick onPick={onPick} />
        <FlyTo focus={focus} />
        <KeepSize />
        <FitExisting points={points} hasPick={!!position} />
        {points.map((p) => (
          <CircleMarker
            key={p.name}
            center={[p.latitude, p.longitude]}
            radius={5}
            pathOptions={{ color: "#8b8b8b", weight: 1, fillColor: "#b5b5b5", fillOpacity: 0.85 }}
          >
            <Tooltip>{p.name}</Tooltip>
          </CircleMarker>
        ))}
        {position && (
          <Marker
            position={position}
            draggable
            eventHandlers={{
              dragend(e) {
                const p = e.target.getLatLng();
                onPick(p.lat, p.lng);
              },
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}
