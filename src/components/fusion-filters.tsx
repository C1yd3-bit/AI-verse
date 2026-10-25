import { genreSlugs, regionSlugs } from "@/features/preferences/schema";
import { languageSlugs, type DiscoveryQuery } from "@/features/discovery/query";
import { label } from "@/features/discovery/catalog";
export function FusionFilters({ query }: { query: DiscoveryQuery }) {
  return (
    <details
      className="fusion-options"
      open={[query.regions, query.genres, query.formats, query.languages].some(
        (values) => values.length > 1,
      )}
    >
      <summary>Combine more interests</summary>
      <p className="supporting-note">
        Choose several options in each list. Films can match any selected option within a list and
        must match every list you use. Leave a list empty for any. On a computer, hold Ctrl or
        Command while choosing several options.
      </p>
      <form action="/fusion" className="advanced-fusion">
        <label>
          Content inspiration
          <select name="region" multiple size={5} defaultValue={query.regions}>
            {regionSlugs
              .filter((value) => value !== "global")
              .map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
          </select>
        </label>
        <label>
          Genres
          <select name="genre" multiple size={5} defaultValue={query.genres}>
            {genreSlugs.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Languages
          <select name="language" multiple size={5} defaultValue={query.languages}>
            {languageSlugs.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Format
          <select name="format" multiple size={2} defaultValue={query.formats}>
            <option value="reel">Reels</option>
            <option value="movie">Short films</option>
          </select>
        </label>
        <label>
          Maximum length in seconds
          <input
            type="number"
            name="maxDuration"
            min={1}
            max={10800}
            defaultValue={query.maxDurationSeconds}
          />
        </label>
        <button className="button primary" type="submit">
          Find this combination
        </button>
      </form>
    </details>
  );
}
