# Section video source audit — 2026-10-14

## Primary source

The public YouTube playlist captured from its rendered UI is **شرح أقسام المفكر (١٢٠ قسم)** by **تقفيلة-TAQFYLH**:

https://www.youtube.com/playlist?list=PLCe8IJ4a9HTM

The channel returned by every official YouTube oEmbed response is:

https://www.youtube.com/@taqfylh-100

## Checks completed

The 37 video IDs in `section-video-source-list.json` were checked against the official public YouTube oEmbed endpoint on 2026-10-14. Results are stored in `section-video-oembed-audit.json`.

- Metadata available: 37/37.
- Captured title matches official title after normalizing whitespace: 37/37.
- YouTube offers iframe embedding markup containing the exact video ID: 37/37.
- All 37 responses identify the same channel.

The 36 section-numbered videos collectively advertise sections 1–120 in their titles. The additional video `J0UC3rmP1NM` is titled **شرح أقسام المفكر الي تغيرت** and must remain a separate updates item. No section range may be inferred for that update video from its title.

## What this check does not prove

An oEmbed response is not a playback test. This audit does not prove actual player playback, availability in every country or browser, exact question-by-question correspondence, or matching the latest edition of the local PDF.

The instructor is a third-party channel explaining Almufakir material. Do not present the channel as the official publisher or convert title metadata into verified question explanations.

The six local tests named القسم 1–القسم 6 are sampled training groups spanning the publisher's source sections. Do not associate videos with those test groups by their display number. Use a separate section-video library, or an independently verified association with a question's original source section.

## Fallbacks

Offer a normal HTTPS YouTube watch link for each video. Keep the full playlist link available. Embed failure or browser restrictions must not leave the learner without a usable link.

No video was downloaded, copied, re-uploaded, or transcribed by this audit. Only public titles and channel metadata were checked.
