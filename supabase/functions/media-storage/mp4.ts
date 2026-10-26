export const MAX_STORAGE_VIDEO_BYTES = 50_000_000;

/** A bounded container inspection, not a decoder or transcoder. Only native H.264 MP4 is accepted. */
export function inspectMp4(bytes: Uint8Array) {
  if (bytes.byteLength < 40 || bytes.byteLength > MAX_STORAGE_VIDEO_BYTES)
    throw new Error("Choose an MP4 file no larger than 50 MB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let visited = 0;
  type Box = { type: string; payload: number; end: number };
  const text = (at: number, length: number) => {
    if (at < 0 || at + length > bytes.length) throw new Error("Invalid MP4 container.");
    let value = "";
    for (let i = 0; i < length; i++) value += String.fromCharCode(bytes[at + i]);
    return value;
  };
  function boxes(start: number, end: number): Box[] {
    const result: Box[] = [];
    for (let at = start; at < end;) {
      if (++visited > 4096 || at + 8 > end) throw new Error("Invalid MP4 container.");
      let size = view.getUint32(at);
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) throw new Error("Invalid MP4 container.");
        const wide = view.getBigUint64(at + 8);
        if (wide > BigInt(bytes.length)) throw new Error("Invalid MP4 container.");
        size = Number(wide);
        header = 16;
      } else if (size === 0) size = end - at;
      if (size < header || at + size > end) throw new Error("Invalid MP4 container.");
      result.push({ type: text(at + 4, 4), payload: at + header, end: at + size });
      at += size;
    }
    return result;
  }
  const unique = (items: Box[], type: string) => {
    const found = items.filter((box) => box.type === type);
    if (found.length !== 1) throw new Error("Invalid MP4 container.");
    return found[0];
  };
  function seconds(box: Box) {
    const version = bytes[box.payload];
    if (version !== 0 && version !== 1) throw new Error("Invalid MP4 duration.");
    const scaleAt = box.payload + (version === 1 ? 20 : 12);
    const durationAt = scaleAt + 4;
    if (durationAt + (version === 1 ? 8 : 4) > box.end) throw new Error("Invalid MP4 duration.");
    const scale = view.getUint32(scaleAt);
    const duration =
      version === 1 ? Number(view.getBigUint64(durationAt)) : view.getUint32(durationAt);
    if (!scale || !Number.isSafeInteger(duration) || duration < 1)
      throw new Error("Invalid MP4 duration.");
    const value = duration / scale;
    if (!Number.isFinite(value) || value <= 0 || value > 1200)
      throw new Error("Movies must be no longer than 20 minutes.");
    return value;
  }
  const top = boxes(0, bytes.length);
  const ftyp = unique(top, "ftyp");
  if (top[0] !== ftyp || ftyp.end - ftyp.payload < 8)
    throw new Error("An MP4 container is required.");
  const brand = text(ftyp.payload, 4);
  if (!["isom", "iso2", "mp41", "mp42", "avc1", "M4V "].includes(brand))
    throw new Error("Use a standard H.264 MP4 file.");
  if (!top.some((box) => box.type === "mdat" && box.end > box.payload))
    throw new Error("This MP4 contains no video data.");
  if (top.some((box) => box.type === "moof"))
    throw new Error("Export a complete MP4 file before uploading.");
  const movie = boxes(unique(top, "moov").payload, unique(top, "moov").end);
  if (movie.some((box) => box.type === "mvex"))
    throw new Error("Export a complete MP4 file before uploading.");
  const movieSeconds = seconds(unique(movie, "mvhd"));
  const tracks = movie.filter((box) => box.type === "trak");
  if (tracks.length < 1 || tracks.length > 8) throw new Error("Unsupported MP4 tracks.");
  let videoTracks = 0;
  let maximum = movieSeconds;
  const mediaRanges = top.filter((box) => box.type === "mdat");
  const usedRanges: Array<[number, number]> = [];
  for (const track of tracks) {
    const children = boxes(track.payload, track.end);
    const mdia = unique(children, "mdia");
    const media = boxes(mdia.payload, mdia.end);
    const handler = unique(media, "hdlr");
    if (handler.payload + 12 > handler.end) throw new Error("Invalid MP4 track.");
    const kind = text(handler.payload + 8, 4);
    if (kind !== "vide" && kind !== "soun") throw new Error("Unsupported MP4 track.");
    maximum = Math.max(maximum, seconds(unique(media, "mdhd")));
    const minf = unique(media, "minf");
    const stbl = unique(boxes(minf.payload, minf.end), "stbl");
    const table = boxes(stbl.payload, stbl.end);
    // Validate sample timing and every referenced byte range, rather than trusting codec labels alone.
    const timing = unique(table, "stts");
    const sizes = unique(table, "stsz");
    const mapping = unique(table, "stsc");
    if (
      timing.payload + 8 > timing.end ||
      sizes.payload + 12 > sizes.end ||
      mapping.payload + 8 > mapping.end
    )
      throw new Error("Invalid MP4 sample tables.");
    const timingCount = view.getUint32(timing.payload + 4);
    const mapCount = view.getUint32(mapping.payload + 4);
    const sampleSize = view.getUint32(sizes.payload + 4);
    const sampleCount = view.getUint32(sizes.payload + 8);
    if (
      !timingCount ||
      timingCount > 4096 ||
      timing.payload + 8 + timingCount * 8 !== timing.end ||
      !mapCount ||
      mapCount > 4096 ||
      mapping.payload + 8 + mapCount * 12 !== mapping.end ||
      !sampleCount ||
      sampleCount > 250000 ||
      sizes.payload + 12 + (sampleSize ? 0 : sampleCount * 4) !== sizes.end
    )
      throw new Error("Invalid MP4 sample tables.");
    let timedSamples = 0,
      durationUnits = 0;
    for (let i = 0; i < timingCount; i++) {
      const count = view.getUint32(timing.payload + 8 + i * 8),
        delta = view.getUint32(timing.payload + 12 + i * 8);
      if (!count || !delta) throw new Error("Invalid MP4 sample timing.");
      timedSamples += count;
      durationUnits += count * delta;
    }
    if (timedSamples !== sampleCount || !Number.isSafeInteger(durationUnits))
      throw new Error("Invalid MP4 sample timing.");
    const mdhd = unique(media, "mdhd");
    const timescale = view.getUint32(mdhd.payload + (bytes[mdhd.payload] === 1 ? 20 : 12));
    const sampleSeconds = durationUnits / timescale;
    if (!Number.isFinite(sampleSeconds) || sampleSeconds <= 0 || sampleSeconds > 1200)
      throw new Error("Invalid MP4 sample timing.");
    maximum = Math.max(maximum, sampleSeconds);
    const offsets = table.filter((box) => box.type === "stco" || box.type === "co64");
    if (offsets.length !== 1 || offsets[0].payload + 8 > offsets[0].end)
      throw new Error("Invalid MP4 chunk offsets.");
    const offsetBox = offsets[0],
      wide = offsetBox.type === "co64",
      count = view.getUint32(offsetBox.payload + 4);
    if (
      !count ||
      count > 250000 ||
      offsetBox.payload + 8 + count * (wide ? 8 : 4) !== offsetBox.end
    )
      throw new Error("Invalid MP4 chunk offsets.");
    let sample = 0,
      map = 0,
      previousChunk = 0;
    for (let i = 0; i < mapCount; i++) {
      const at = mapping.payload + 8 + i * 12,
        first = view.getUint32(at);
      if (
        first <= previousChunk ||
        first > count ||
        (i === 0 && first !== 1) ||
        !view.getUint32(at + 4) ||
        view.getUint32(at + 8) !== 1
      )
        throw new Error("Invalid MP4 sample mapping.");
      previousChunk = first;
    }
    for (let i = 0; i < count; i++) {
      if (map + 1 < mapCount && view.getUint32(mapping.payload + 8 + (map + 1) * 12) === i + 1)
        map++;
      const inChunk = view.getUint32(mapping.payload + 12 + map * 12);
      if (sample + inChunk > sampleCount) throw new Error("Invalid MP4 sample mapping.");
      const at = offsetBox.payload + 8 + i * (wide ? 8 : 4);
      const start = wide ? Number(view.getBigUint64(at)) : view.getUint32(at);
      let size = 0;
      for (let j = 0; j < inChunk; j++, sample++) {
        const length = sampleSize || view.getUint32(sizes.payload + 12 + sample * 4);
        if (!length) throw new Error("Invalid MP4 sample size.");
        size += length;
      }
      if (
        !Number.isSafeInteger(start) ||
        !mediaRanges.some((range) => start >= range.payload && start + size <= range.end) ||
        usedRanges.length >= 100000
      )
        throw new Error("Invalid MP4 media extent.");
      usedRanges.push([start, start + size]);
    }
    if (sample !== sampleCount) throw new Error("Invalid MP4 sample mapping.");
    const stsd = unique(table, "stsd");
    if (stsd.payload + 8 > stsd.end || view.getUint32(stsd.payload + 4) !== 1)
      throw new Error("Unsupported MP4 sample descriptions.");
    const description = unique(
      boxes(stsd.payload + 8, stsd.end),
      kind === "vide" ? "avc1" : "mp4a",
    );
    const offset = kind === "vide" ? 78 : 28;
    if (description.payload + offset >= description.end)
      throw new Error("Invalid MP4 codec configuration.");
    const configuration = boxes(description.payload + offset, description.end);
    if (kind === "vide") {
      videoTracks++;
      const avcc = unique(configuration, "avcC");
      if (avcc.payload + 7 > avcc.end || bytes[avcc.payload] !== 1)
        throw new Error("A valid H.264 configuration is required.");
    } else unique(configuration, "esds");
    // External media references could otherwise turn an apparently uploaded file into a network capability.
    const dinf = unique(boxes(minf.payload, minf.end), "dinf");
    const dref = unique(boxes(dinf.payload, dinf.end), "dref");
    if (dref.payload + 8 > dref.end || view.getUint32(dref.payload + 4) !== 1)
      throw new Error("External MP4 data is unsupported.");
    const reference = unique(boxes(dref.payload + 8, dref.end), "url ");
    if (reference.end - reference.payload !== 4 || view.getUint32(reference.payload) !== 1)
      throw new Error("External MP4 data is unsupported.");
  }
  if (videoTracks !== 1) throw new Error("One H.264 video track is required.");
  usedRanges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < usedRanges.length; i++)
    if (usedRanges[i][0] < usedRanges[i - 1][1])
      throw new Error("Invalid MP4 overlapping samples.");
  return { durationSeconds: Math.ceil(maximum), bytes: bytes.byteLength, codec: "h264" as const };
}
