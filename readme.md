# Priva Extractor

Vidstuck API adapter and HTML HLS/MP4 player. Node.js 20+ required.

```sh
npm ci
npm test
npm start
# open http://localhost:3000
```

Paste a Vidstuck embed URL (`/embed/movie/TMDB_ID` or `/embed/tv/TMDB_ID/SEASON/EPISODE`), or enter a TMDB ID. Optional title, release date, year and IMDb ID are forwarded as metadata. Choose a returned server to play.

## Reference and protocol

Studied [Zenda-Cross/vega-providers](https://github.com/Zenda-Cross/vega-providers), commit `9b41e2752d481d181afe7bd585eca1a5d51ddac6`, particularly `providers/extractors/vidstuck.ts`, `providers/autoEmbed/stream.ts` and `providers/types.ts`.

The adapter follows that reference's protocol, not a newly verified scrape:

1. Build movie/TV embed referer.
2. POST the reference's obfuscated parameter keys to `/backend/vidstuck` for a token and timestamp per server.
3. GET `/backend/servers/{orion,andromeda,atlas,daedalus,ursa}` with that authorization and metadata, concurrently.
4. Decode `Salted__` Base64 envelopes using the reference passphrase, MD5 EVP_BytesToKey derivation, and AES-256-CBC. Node crypto replaces the reference's sandbox-compatible cryptography implementation.
5. Fetch subtitle metadata separately; preserve individual server errors rather than silently hiding them.
6. Return normalized streams. The player relays HLS manifests, child playlists, keys and media segments with the provider's Origin/Referer headers. MP4 supports byte-range requests. Hls.js is served locally, not from a CDN.

## Verification and limitations

**Live Vidstuck extraction/playback is not verified.** This sandbox only permits outbound traffic to GitHub and package registries; a direct HTTPS connection to Vidstuck failed. Run on a network that can reach Vidstuck and its media hosts. No successful live stream is claimed. The API's keys, passphrase and endpoints come from the reference and may change. Tests use synthetic encrypted links and mocked API responses, not captured production responses.

DASH streams are returned for inspection but disabled in this HLS/MP4 player. Subtitle metadata is listed in extraction details; subtitle rendering and SRT conversion are not implemented. Multi-audio availability depends on the returned HLS manifest. Codec compatibility depends on the browser. No DRM, CAPTCHA, or access-control bypass is implemented. Only access content you are authorized to play.

Media relay URLs are signed and expire after two hours (and on restart). The relay checks signatures, permits HTTP(S) on standard ports, blocks private/reserved DNS results on the actual connection, validates redirects, and limits playlist size. It does not forward user-supplied cookies or authorization. The extraction endpoint limits concurrent work per IP but has **no authentication**: this is a local development tool, not a production public proxy. Add authentication, rate limits and a deployment-specific host allowlist before publishing. Required provider headers are fixed by the relay. No tokens or media URLs are logged intentionally.

`PORT` defaults to 3000. Server binds to `0.0.0.0` for preview use. All browser requests use same-origin URLs.
