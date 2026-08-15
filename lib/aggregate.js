import { toRecord } from "./record";

// detectionsの生データ + bird_masterの画像を、種目録ページ用の形にまとめる
export function buildSpeciesList(detections, birdImages) {
  const imageByName = new Map(birdImages.map((b) => [b.common_name, b.image_url]));
  const bySpecies = new Map();

  for (const d of detections) {
    const record = toRecord(d);
    if (!bySpecies.has(record.species)) {
      bySpecies.set(record.species, {
        name: record.species,
        scientificName: record.scientificName,
        imageUrl: imageByName.get(record.species) || null,
        records: [],
        locations: new Set(),
      });
    }
    const entry = bySpecies.get(record.species);
    entry.records.push(record);
    entry.locations.add(record.location);
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
    const record = toRecord(d);
    if (!byLocation.has(record.location)) {
      byLocation.set(record.location, {
        name: record.location,
        species: new Set(),
        recordCount: 0,
        lastIsoDate: null,
        lastDate: null,
        latitude: record.latitude,
        longitude: record.longitude,
      });
    }
    const entry = byLocation.get(record.location);
    entry.species.add(record.species);
    entry.recordCount += 1;
    if (!entry.lastIsoDate || (record.isoDate && record.isoDate > entry.lastIsoDate)) {
      entry.lastIsoDate = record.isoDate;
      entry.lastDate = record.date;
    }
    if (entry.latitude == null && record.latitude != null) {
      entry.latitude = record.latitude;
      entry.longitude = record.longitude;
    }
  }

  return Array.from(byLocation.values()).map((l) => ({
    name: l.name,
    speciesCount: l.species.size,
    recordCount: l.recordCount,
    lastSeen: l.lastDate ?? "―",
    latitude: l.latitude,
    longitude: l.longitude,
  }));
}

// detectionsの生データを、観測日タブ用に集計する
export function buildDateList(detections) {
  const byDate = new Map();

  for (const d of detections) {
    const record = toRecord(d);
    if (!record.isoDate) continue;
    if (!byDate.has(record.isoDate)) {
      byDate.set(record.isoDate, {
        isoDate: record.isoDate,
        date: record.date,
        species: new Set(),
        recordCount: 0,
        locations: new Set(),
      });
    }
    const entry = byDate.get(record.isoDate);
    entry.species.add(record.species);
    entry.recordCount += 1;
    entry.locations.add(record.location);
  }

  return Array.from(byDate.values())
    .map((e) => ({
      isoDate: e.isoDate,
      date: e.date,
      speciesCount: e.species.size,
      recordCount: e.recordCount,
      locations: Array.from(e.locations).join("・"),
    }))
    .sort((a, b) => (a.isoDate < b.isoDate ? 1 : -1));
}
