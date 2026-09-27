# NDAWX v5 — Non-Discretion WX

Static HTML/CSS/JavaScript for GitHub Pages, plus JavaScript Cloudflare Workers. No Python, AI service, build step, or project Actions workflow is required.

## Upload the update

Unzip this package. Upload `index.html`, `admin.html`, and the complete `assets/cloud-guide/` folder to the root of `NDAWX2K/NDAWX2`, preserving the folders. Keep this README and backend files for setup. If you previously configured `DEFAULT_RELAY`, preserve its deployed weather Worker origin in the new HTML. The package leaves connection URLs blank because no deployed URLs were supplied.

For GitHub Pages, choose the existing publishing branch and root folder under Settings → Pages. The footer should say NDAWX v5 after publishing and a hard refresh. This package has not been deployed to your accounts.

## Guest forum: no visitor account or approval queue

Visitors choose a display name and complete a Cloudflare Turnstile spam check. Posts and single-level replies publish immediately; the owner can remove posts afterward. Names are unverified. Shared comments need server storage: GitHub Pages alone cannot save everyone's comments.

The guest frontend and backend are included, but **posting remains disabled until you deploy and connect the backend**. There are no pretend browser-only shared comments. A site owner needs a Cloudflare account for this one-time setup; visitors do not need Cloudflare or GitHub accounts.

### One-time Cloudflare setup

1. Create a D1 database named `ndawx-forum`. Run the contents of `forum-schema.sql` in its SQL console.
2. Create a separate Worker named `ndawx-forum`, replace its starter code with `forum-worker.js`, and add a D1 binding named exactly `DB` pointing to the database.
3. Create a managed Turnstile widget for your website hostname, normally `ndawx2k.github.io`. Copy its public site key and secret key.
4. Add these Worker settings, then redeploy:

| Setting | Type | Value |
| --- | --- | --- |
| `ALLOWED_ORIGIN` | Variable | `https://ndawx2k.github.io` (origin only; no `/NDAWX2` path or trailing slash) |
| `TURNSTILE_SITE_KEY` | Variable | Public Turnstile site key |
| `TURNSTILE_SECRET_KEY` | Secret | Turnstile secret key |
| `ADMIN_TOKEN` | Secret | A unique random owner password, at least 32 characters |
| `RATE_LIMIT_SALT` | Secret | A different random value, at least 32 characters |

Generate both random values with a password manager. Keep the owner key privately. Never put either secret in HTML, source control, or the public repository.

5. Find `const COMMENTS_API = '';` near the end of `index.html`. Set it to the deployed HTTPS Worker origin, for example `https://ndawx-forum.YOUR-SUBDOMAIN.workers.dev`, without a trailing slash. Commit the HTML.
6. Open the deployed website, complete the spam check and publish a real test comment. It should appear immediately in another browser without owner approval.
7. To remove that comment, open `admin.html` on the same website, enter the Worker origin and owner key, and choose Remove. Removing a root discussion also hides its replies from public readers. Restore brings the root back. Lock clears the key from tab memory; closing the tab also discards it.

For a custom domain, change `ALLOWED_ORIGIN` and the Turnstile hostname to the actual domain. The moderation page must be served from that same allowed origin. Do not configure secrets in the weather Worker: the forum is a separate deployment.

The backend enforces server-side Turnstile verification, hostname/action checks, exact-origin checks for writes, bounded JSON and text length, prepared SQL, ten submission attempts per hour per network, and owner-key authorization for removal. Requests use retry identifiers to avoid duplicate posts. Text is displayed literally rather than executed as HTML. An HMAC-derived network identifier is retained with comments for abuse prevention; raw addresses and emails are not stored in D1. Cloudflare still processes the network request and spam check. Rate-limit rows expire after 24 hours and are removed on subsequent attempts; an optional scheduled trigger also runs cleanup. This small forum is not a complete abuse-management service; monitor storage and traffic quotas.

Existing Giscus comments are not imported. Legacy `pending` rows in this backend can be published from the owner page, but all new posts explicitly use published status even if an older table default was pending.

## HRRR cloud overlay and profile

Clouds load automatically from NOAA HRRR through Open-Meteo's explicit `ncep_hrrr_conus` model. Controls provide total, low, middle and high cloud fraction, opacity, and a potential-icing screen at a selected pressure level. White shading increases with cloud fraction. Amber indicates the selected-level screening conditions. Radar is drawn above clouds; disable radar to inspect clouds clearly.

The map samples 132 points on a 0.6° lattice, approximately 55–67 km, with bilinear interpolation. This is **not the native 3 km HRRR GRIB grid**. No fabricated model values are substituted when data fail. Model fields refresh hourly, display their valid time in Arizona MST, and expire 90 minutes from that valid time. New pressure selections require an additional grid request. Provider quotas can limit frequent use or many visitors.

Click the map while clouds are enabled, or select an airport in the cloud inspector. A separate profile retrieves temperatures, relative humidity and geopotential heights at 18 pressure samples between 1000 and 200 hPa, plus model surface pressure, elevation, cloud bands and CAPE. Below-ground samples are excluded. Heights and boundaries are MSL; height above model terrain is used only for broad family selection.

### Estimation method and limits

- Adjacent profile samples with RH ≥85% define a heuristic moist layer; threshold boundaries are linearly interpolated. Missing samples and vertical gaps over 4 km are not bridged. Thickness is the resolved moist-layer depth, not a measured cloud base, ceiling or top. Layers reaching the sampled profile edge have unresolved boundaries.
- Total cloud cover ≥20% provides broad cloud support; it does not prove cloud exists at every humid level. Low, middle and high base heights suggest candidate families from the supplied guide. A moist depth ≥3 km plus CAPE ≥1000 J/kg adds a TCu/Cb candidate. These rules do not identify visual morphology, precipitation, storm severity or actual convection.
- The amber map screen requires total cover ≥20%, selected-level RH ≥85%, and temperature inclusively between **0 and −22°C**, above the modeled ground. A profile layer is flagged when its modeled temperature range overlaps that interval and cover supports clouds.
- **Potential icing conditions are not confirmed icing.** This API supplies no supercooled-liquid-water, droplet-size or icing-severity field. The page does not assign rime/clear/mixed icing or operational aircraft limitations. No flag does not mean icing-free; other temperature ranges, ice crystals and unresolved layers can still matter. Use official AWC guidance and PIREPs for flight decisions.
- Surface METARs remain visible but are not used to fabricate vertical cloud structure. Pressure-level model interpolation and the coarse map sampling can miss thin layers and terrain effects.

All 15 user-provided slides are included unchanged under `assets/cloud-guide`. They can be paged through and opened full-size. Their broad cloud families inform candidate labels, but operational assertions are not treated as validated flight guidance. This is an experimental educational display, not an official aviation briefing.

## Existing weather features

- Airport dots and METAR watch list: KLUF, KPHX, KIWA, KGYR, KDVT, KSDL, KTUS, KDMA, KFLG, KGXF, KNYL, KPRC. Dots remain visible when a station lacks a report. Gusts are shown when reported; missing gusts do not mean zero.
- Default METAR fallback: Iowa Environmental Mesonet, then NWS. For AWC priority, deploy `worker.js` separately and set `DEFAULT_RELAY` to its HTTPS origin or save the connection through the site's setup panel. AWC browser cross-origin restrictions require this relay.
- HRRR surface temperature and sustained wind can be adjusted by recent observation residuals within 100 km. Gust shading remains model-only. Wind particles include speed and pause controls and respect reduced-motion settings.
- Composite radar: NOAA MRMS SeamlessHSR hybrid-scan reflectivity via IEM, timestamp-pinned tiles, five-minute refresh and opacity control. Scans expire after 20 minutes. This is not maximum reflectivity across the full atmospheric column; missing pixels do not imply clear skies.
- FAA Class B/C/D, optional E, special-use and special-rule plan-view boundaries. These are not altitude-filtered clearance, activation, TFR or NOTAM products.
- NWS Phoenix forecast discussion refreshes every ten minutes. METARs refresh every five minutes. Airspace refreshes daily while the page is open.

## Validation and troubleshooting

JavaScript syntax and unique element IDs were checked. The guest Worker was exercised against an in-memory SQLite database: immediate publication, replies, duplicate retries, invalid challenge rejection, origin checks, owner permissions, removal/hiding of replies, rate limits and private-field exclusion. Cloud screening tests cover temperature endpoints, terrain masking, missing values and interpolated layer depth. No comments were posted to a live account during development. A full browser rendering test was unavailable in this environment; verify the deployed map and Turnstile widget in your browser.

If comments say not connected, set `COMMENTS_API` and check `/config` on the Worker returns `ready: true`. A 403 usually means `ALLOWED_ORIGIN` does not match your actual site origin. Turnstile failures can mean the wrong widget hostname or secret. The cloud panel reports API failures instead of supplying synthetic forecasts. Missing slideshow images mean the `assets/cloud-guide` folder was not uploaded beside the HTML. Use HTTPS hosting rather than opening the HTML as a local file.

Official references:
- https://developers.cloudflare.com/d1/
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://open-meteo.com/en/docs/gfs-api
- https://rapidrefresh.noaa.gov/hrrr/
- https://www.weather.gov/source/zhu/ZHU_Training_Page/icing_stuff/icing/icing.htm
- https://aviationweather.gov/gfa/#icing

Open-Meteo data require attribution (included in the page). Its free service is subject to non-commercial usage conditions and limits; review current terms before public production use at scale. Other source services can change availability independently.
