# Proposed Changes

This document lists the changes @tschai-yim (the initial maintainer of this repository) wanted to but didn't get around to implementing during his tenure. Each list is subjectively sorted from most important to least important.

## Site

### 1. Multi-Channel Support

- **Current State:** The chart exclusively displays the combined, cleaned, long channel. While the backend and database already support multiple channels, the data isn't accessible through the API yet.
- **Problem:** The lack of access to other channels limits the tool's utility. For scientists, the short channel is very useful (it's also displayed on the [SWPC site](https://www.swpc.noaa.gov/products/goes-x-ray-flux)). In general, users should be able to view the raw data to see the ground truth or in case the cleaning or combine algorithms fail.
- **Proposed Solution:** Add a selector dropdown in the chart header to allow the user to enable the appropriate channels.

### 2. Custom Context Menu

- **Current State:** It is hard to copy the date or value of a measurement from the chart.
- **Problem:** Users cannot easily extract data or visuals for their own use, limiting the chart's practicality.
- **Proposed Solution:** Add a custom context menu to copy a measurement's date or value. An option to download the current view as a CSV or SVG/PNG would also be useful.

### 3. DNS Cleanup

- **Current State:** The following old DNS entries still point to `heliotime.org`'s server:
  - `hespe.cs.technik.fhnw.ch`
  - `app.heliotime.org`
  - `wp.heliotime.org`
- **Problem:** These DNS entries are unnecessary and appear in search engine results.
- **Proposed Solution:** Remove the outdated DNS entries.

### 4. "No Data" Notification

- **Current State:** If the current view has no measurements, the chart is simply blank.
- **Problem:** A blank chart is ambiguous and could be interpreted as an application error.
- **Proposed Solution:** Add a "No data" label inside the blank chart area.

### 5. Flux Fetching Optimization

- **Current State:** The flux data is fetched using a single `@tanstack/react-query` query which is grid-aligned and debounced, as seen in [`useFlux.ts`](https://github.com/i4Ds/heliotime-v2/blob/988681e8c37dfb8b13a679803d72797b53cf1516/site/src/api/flux/useFlux.ts).
- **Problem:** The current fetching strategy is inefficient and can feel sluggish. Because the [entire query input is debounced](https://github.com/i4Ds/heliotime-v2/blob/988681e8c37dfb8b13a679803d72797b53cf1516/site/src/api/flux/useFlux.ts#L87), cache usage is not optimal, making zooming and panning feel less responsive than they could be. Small view changes can produce the same large, grid-aligned request, leading to redundant data fetching.
- **Proposed Solution:**
  - Request each grid chunk separately to reduce data transfer volumes while panning and to allow a partially loaded chart to be displayed faster.
  - Debounce only the API calls, not the entire query input, to allow for better cache utilization and a smoother user experience.
  - Prefetch data on initial page load to reduce the time to first contentful paint.
  - It will likely be necessary to ditch `@tanstack/react-query` or use its `QueryClient` directly to implement these optimizations, as the current implementation already uses small hacks to work around limitations in its hooks.

### 6. Mobile Axis Layout Optimization

- **Current State:** A lot of width on mobile devices is used by the axes themselves instead of the chart content.
- **Problem:** The chart content area is unnecessarily small on mobile devices, impacting usability.
- **Proposed Solution:** Explore space-saving options like moving the axis labels above the chart (written horizontally), making tick markings smaller, or moving the axes (especially the flare classes) inside the chart itself.

### 7. Zoomable Overview

- **Current State:** Any view smaller than a month appears as just a line on the 45-year overview, making it impossible to get an overview of the local region and jump to nearby dates.
- **Problem:** The overview is not useful for navigating within zoomed-in timeframes.
- **Proposed Solution:** The overview could loosely follow the zoom of the main view to keep the brush at a minimum usable width.
  - **Note:** It needs to be determined if users should be able to control the zoom in the overview or how the overview's "view" should behave when the brush is dragged.

### 8. Over-fetching to Prevent Gaps

- **Current State:** The charts request their exact view, as seen in [`MainChart.tsx`](https://github.com/i4Ds/heliotime-v2/blob/988681e8c37dfb8b13a679803d72797b53cf1516/site/src/components/player/chart/MainChart.tsx#L94).
- **Problem:** This causes bordering lines (to the next measurement outside the view) to not be drawn, which is especially noticeable in zoomed-in views.
- **Proposed Solution:** Fetch more than the view and clip the generated line using SVG operations. Applying the same grid-alignment idea from flux fetching to chart rendering could also avoid expensive React rerenders of the flux line, instead transforming the entire line with a small CSS property during panning.

### 9. Axis Tick Labeling

- **Current State:** There are several cases where the axis ticks are not positioned usefully (e.g., only covers half the axis, only a single tick). The labeling is also often too detailed (too many decimal points on the watt scale) or not detailed enough (missing date on all time ticks). Their render is also currently the most expensive part during panning and zooming.
- **Problem:** Poorly positioned and labeled ticks detract from the chart's readability.
- **Proposed Solution:** These problems probably require better implementations of the Axis components inside `@visx/axis`.

### 10. Removal of `@visx/*` Dependencies

- **Current State:** Visx is used to create the SVG charts.
- **Problem:** While Visx is still [maintained](https://github.com/airbnb/visx/discussions/1908#discussioncomment-13233511), its development has considerably stalled, to the point that [forking it](https://github.com/i4Ds/visx) became [necessary](https://github.com/airbnb/visx/pull/1861) for Heliotime. This dramatically increases the build-time of Heliotime. Furthermore, Visx makes up a big chunk of the bundle size, and certain optimizations would require deeper changes inside the library itself.
- **Proposed Solution:** As Visx is essentially a fancy D3.js wrapper, it might be wise to use D3.js directly to improve rendering performance, reduce bundle size, and gain more customizability. Heliotime's SVG rendering isn't too complicated in the first place.

### 11. Light Mode

- **Current State:** The application only supports dark mode.
- **Problem:** The absence of a light mode is an accessibility issue.
- **Proposed Solution:** Add a light mode option.

### 12. Intuitive History Recording

- **Current State:** Panning and zooming using gestures or the mouse wheel do not create history snapshots, making the history feature less intuitive. Additionally, the URL reflects the last [history-recorded state](https://github.com/i4Ds/heliotime-v2/blob/988681e8c37dfb8b13a679803d72797b53cf1516/site/src/components/player/state/state.tsx#L149), not the current one.
- **Problem:** We cannot use [`History.replaceState()`](https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState) because the replaced state still gets recorded in the global browser history, spamming it during panning. The current share button creates a new history record to force a URL update, which is also unintuitive.
- **Proposed Solution:** A better solution needs to be designed. One option could be to remove the URL parameters entirely once loaded, forcing the user to use the share button which should always use the correct URL.

### 13. Local Storage for Settings

- **Current State:** The settings are only stored inside the URL, as seen in [`settings.tsx`](https://github.com/i4Ds/heliotime-v2/blob/988681e8c37dfb8b13a679803d72797b53cf1516/site/src/components/player/state/settings.tsx).
- **Problem:** Visiting `https://heliotime.org/` gives you the default settings, not the last-used ones.
- **Proposed Solution:** Store the last used settings in `localStorage` so the user doesn't need to set them up every time.

## Server

### 1. Channel Selection for `/flux` Endpoint

- **Current State:** The endpoint [`/flux`](https://github.com/i4Ds/heliotime-v2/blob/988681e8c37dfb8b13a679803d72797b53cf1516/server/main.py#L20) always returns the combined, cleaned, long channel.
- **Problem:** The API needs to serve different channels to enable multi-channel support on the site.
- **Proposed Solution:** Add channel selection support to the `/flux` endpoint.

### 2. Configurable CORS

- **Current State:** The server currently [allows all origins](https://github.com/i4Ds/heliotime-v2/blob/988681e8c37dfb8b13a679803d72797b53cf1516/server/main.py#L57).
- **Problem:** A hardcoded "allow all" CORS policy is insecure and not suitable for all environments.
- **Proposed Solution:** Make CORS configurable via environment variables.

### 3. Response Compression for `/flux`

- **Current State:** The [`/flux` endpoint](https://github.com/i4Ds/heliotime-v2/blob/988681e8c37dfb8b13a679803d72797b53cf1516/server/main.py#L86) returns an uncompressed JSON matrix (lists in lists).
- **Problem:** The response accounts for 15% of the data transferred during the initial cold-cache page load and needs to be called constantly while panning and zooming.
- **Proposed Solution:** Enabling gzip would be a big improvement. For even higher throughput (e.g., for multi-channel support), the data could be encoded in binary, while keeping a normal JSON API available for other API users.

### 4. Import Progress Endpoint

- **Current State:** The [`/status` endpoint](https://github.com/i4Ds/heliotime-v2/blob/988681e8c37dfb8b13a679803d72797b53cf1516/server/main.py#L95) only includes the total range of the entire combined data.
- **Problem:** The frontend doesn't know what channel starts and ends where, or if it is currently importing.
- **Proposed Solution:** Create an endpoint that helps the frontend determine whether to ask for data, how often to re-request it, and helps the user know where the more precise archive data ends.

### 5. Removal of Cleaning Artifacts

- **Current State:** As seen in [this example](https://heliotime.org/?view=2007-10-06~2010-01-21), the cleaning process sometimes leaves tiny measurement groups between huge data gaps.
- **Problem:** The validity of these patches is questionable, as they are often residue from removed corrupted regions.
- **Proposed Solution:** Remove these tiny data patches during the cleaning process.

### 6. Archive Import Performance

- **Current State:** A full archive import takes around 4 days. The process is mainly bottle-necked by Python's slow iteration speed during the `COPY FROM` database insert (~15k rows per second) and is memory intensive (two worker processes each use up to 6GB of memory).
- **Problem:** The archive import is extremely slow and memory-inefficient.
- **Proposed Solution:** A benchmark shows that copying directly from a CSV using `psql` can reach speeds of 250k rows/sec, making a theoretical 6-hour import possible. Better speed and memory efficiency can likely only be achieved by avoiding pure Python (e.g., using Cython).
  - **Note:** As this import only needs to run once per deployment, it would be a "nice to have," and simply allocating more memory during deployment is probably the overall cheaper option.
