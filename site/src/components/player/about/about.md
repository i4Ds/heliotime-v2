# About Heliotime

[Heliotime](https://heliotime.org/) is a fast and interactive tool for exploring 1-8 Ångstrom solar X-ray flux data from [GOES satellites](https://www.swpc.noaa.gov/products/goes-x-ray-flux). It is designed for anyone interested in solar activity and for scientists to orient themselves.

## Key Features

- **Instant Exploration:** Quickly view and share solar activity across 40+ years.
- **Flexible Zoom:** Zoom in from a 40-year overview to a detailed 5-minute view with
  second-by-second data.
- **Helioviewer Integration:** Compare with solar images from [SDO](https://sdo.gsfc.nasa.gov/) and
  [SOHO](https://soho.nascom.nasa.gov/).
- **Live Mode:** Follow the latest solar activity in real time.
- **Mobile-Friendly:** Works seamlessly on phones and touch devices.

*Note:* Zoomed-out views display maximum values to help you quickly spot solar flares.

## Data Sources and Quality

Heliotime uses reliable data from official NOAA archives and live feeds:

- **Historic Data:** High-resolution data from NOAA's
  [GOES satellite archives](https://www.ngdc.noaa.gov/stp/satellite/goes-r.html), retrieved using
  [SunPy](https://docs.sunpy.org/en/stable/).
- **Live Data:** 1-minute averages from the
  [SWPC live endpoint](https://www.swpc.noaa.gov/products/goes-x-ray-flux) for recent days.

*Important:* To improve clarity, the tool:

- Removes obvious outliers.
- Smooths extremely noisy sections.

This may introduce slight but visually negligible deviations from the original data, especially in older data. If you're
curious about the process, check the
[source code](https://github.com/i4Ds/heliotime-v2/blob/main/server/importer/_clean.py). Viewing
raw, unprocessed data isn't currently supported.

## Helioviewer Integration

The [Helioviewer](https://helioviewer.ias.u-psud.fr/) preview shows 171 Ångstrom images of the Sun, sourced from:

- **SDO (Solar Dynamics Observatory):** From June 2010 to now.
- **SOHO (Solar and Heliospheric Observatory):** From January 1996 to June 2010.

Images before 1996 aren’t available via Helioviewer.

## Feedback and Support

Got questions or found an issue? Share your feedback on our
[GitHub issue tracker](https://github.com/i4Ds/heliotime-v2/issues).

Heliotime is developed and operated by the
[Institute for Data Science](https://www.fhnw.ch/en/about-fhnw/schools/school-of-engineering/institutes/institute-for-data-science/astroinformatics-and-space-sciences)
(FHNW) in Switzerland.
