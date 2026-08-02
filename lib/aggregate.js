import { parseWavFilename } from "./parseWav";

// detectionsの生データ + bird_masterの画像を、種目録ページ用の形にまとめる
export function buildSpeciesList(detections, birdImages) {
  const imageByName = new Map(birdImages.map((b) => [b.common_name, b.image_url]));
  const bySpecies = new Map();

  for (const d of detections) {
    if (!bySpecies.has(d.common_name)) {
      bySpecies.set(d.common_name, {
        name: d.common_name,
        scientificName: d.scientific_name,
        imageUrl: imageByName.get(d.common_name) || null,
        records: [],
        locations: new Set(),
      });
    }
    const entry = bySpecies.get(d.common_name);
    const parsed = parseWavFilename(d.wav_filename);
    entry.records.push({
      id: String(d.id),
      confidence: Math.round(d.confidence * 100),
      date: parsed?.date ?? "―",
      time: parsed?.time ?? "―",
      location: d.location_name,
    });
    entry.locations.add(d.location_name);
  }

  return Array.from(bySpecies.values()).map((s) => {
    const avgConfidence = Math.round(
      s.records.reduce((sum, r) => sum + r.confidence, 0) / s.records.length
    );
    return {
      name: s.name,
      scientificName: s.scientificName,
      imageUrl: s.imageUrl,
      confidence: avgConfidence,
      locationCount: s.locations.size,
      records: s.records.sort((a, b) => (a.date < b.date ? 1 : -1)),
    };
  });
}

// detectionsの生データを、観測地点タブ用に集計する
export function buildLocationList(detections) {
  const byLocation = new Map();

  for (const d of detections) {
    if (!byLocation.has(d.location_name)) {
      byLocation.set(d.location_name, {
        name: d.location_name,
        species: new Set(),
        recordCount: 0,
        lastSeen: null,
      });
    }
    const entry = byLocation.get(d.location_name);
    entry.species.add(d.common_name);
    entry.recordCount += 1;
    if (!entry.lastSeen || d.created_at > entry.lastSeen) {
      entry.lastSeen = d.created_at;
    }
  }

  return Array.from(byLocation.values()).map((l) => ({
    name: l.name,
    speciesCount: l.species.size,
    recordCount: l.recordCount,
    lastSeen: l.lastSeen ? l.lastSeen.slice(5, 10).replace("-", "/") : "―",
  }));
}
