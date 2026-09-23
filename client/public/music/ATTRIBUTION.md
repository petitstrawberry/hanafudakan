# 花札館 BGM

Sources and license listings verified 2026-09-23. Licenses apply to each
track separately; these recordings are not covered by the game's code license.

## Normal game: Michikusa3 — PeriTune / むつき醒 (Sei Mutsuki)

- Copyright: © PeriTune
- Source: https://peritune.com/blog/2019/11/05/michikusa3/
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- License URL: https://creativecommons.org/licenses/by/4.0/
- Legal code: https://creativecommons.org/licenses/by/4.0/legalcode
- License applicability: https://peritune.com/about/ explicitly retains CC BY 4.0
  for works published before March 2026. This track was published 2019-11-05;
  its individual page also expressly identifies CC BY 4.0.
- Download: https://peritune.com/loop/PerituneMaterial_Michikusa3_loop.zip
- Archive entry: PerituneMaterial_Michikusa3_loop.mp3
- Bundled: michikusa3-loop.mp3 (68.87 seconds, 115 BPM)
- Change: filename only; author's looping version, unchanged audio bytes.
  Runtime volume and fades applied; no composition edits.
- SHA-256: 561276b836a8e0fa932c8777a95318c2e48ecaf7c24c96dc2a637f78f44edc72
- No endorsement by the author is implied. Music supplied without warranties;
  see the linked license and source terms.

## Hyper game: JRPG Epic Rock Battle Theme #1 — HydroGene

- License: CC0 1.0 Universal
- License URL: https://creativecommons.org/publicdomain/zero/1.0/
- Source: https://opengameart.org/content/jrpg-epic-rock-battle-theme-1
- Original: https://opengameart.org/sites/default/files/jrpg_battle_loop.mp3
- Bundled: jrpg-battle-loop.mp3 (113.67 seconds)
- Change: filename only; author's looping version, unchanged audio bytes.
- SHA-256: 006be3310cb9a2612384b99d8087035904eaad45f285a4f74170ff7ec6ca7f81

## Normal game: Michikusa2 — PeriTune / むつき醒 (Sei Mutsuki)

- Copyright: © PeriTune
- Source: https://peritune.com/blog/2016/04/19/michikusa2/
- License: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
- Download: https://peritune.com/loop/PerituneMaterial_Michikusa2_loop.zip
- Archive entry: PerituneMaterial_Michikusa2_loop.mp3
- Bundled: michikusa2-loop.mp3 (63.75 seconds, 128 BPM)
- Change: filename only; original loop audio unchanged, runtime gain/fades.
- SHA-256: 1d126ccd3b94619511d7bca7c3cc0d42b8fdc13ac96350e4ea7e95ba97f0116b

## Normal game: RetroRoman_Koharu — PeriTune / むつき醒 (Sei Mutsuki)

- Copyright: © PeriTune
- Source: https://peritune.com/blog/2022/03/02/retroroman_koharu/
- License: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
- Applicability: https://peritune.com/about/ retains CC BY 4.0 for tracks
  published before March 2026; this track was published 2022-03-02.
- Download: https://peritune.com/loop/PerituneMaterial_RetroRoman_Koharu_loop.zip
- Archive entry: PerituneMaterial_RetroRoman_Koharu_loop.mp3
- Bundled: koharu-loop.mp3 (72 seconds, 120 BPM)
- Change: filename only; original loop audio unchanged, runtime gain/fades.
- SHA-256: 5a5c4e20a40e61b6200674e51f7925440ced11b2b244c0ec24c05009e55652f5

## Hyper game: Cynic Battle Loop — cynicmusic / Ferk

- Composer: Alex Smith (cynicmusic), cynicmusic.com, pixelsphere.org
- Loop adaptation: Ferk
- Source: https://opengameart.org/content/cynic-battle-loop
- Original composition: https://opengameart.org/content/battle-theme-a
- Both source listings: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/
- Download: https://opengameart.org/sites/default/files/cynicbattleloop_0.ogg
- Bundled: cynic-battle-loop.mp3 (92.08 seconds)
- Change: Ogg converted to MP3 with FFmpeg, `-map_metadata -1 -codec:a libmp3lame -q:a 3`;
  composition unchanged, runtime gain/fades. Original credits preserved here.
- SHA-256: 53e560cf1a14bf87d5bea9ada836e4d50aec10b87165209c041dcfb1ad881a13

## Playback and attribution

Normal playlist: Michikusa3, Michikusa2, RetroRoman_Koharu.
Hyper playlist: JRPG Epic Rock Battle Theme #1, Cynic Battle Loop.
First song and subsequent selections are random. The current song is excluded
from the next selection (intentional repetitions within a song are separate).
Under 45 seconds: 3 loops; under 90 seconds: 2 loops; otherwise: 1 loop.
Crossfade: 1200 ms in / 800 ms out; previous music continues if loading is slow.
Pause/round-end preserves each playlist's playback position in the session.
Only three decoded buffers are cached; the next song is preloaded.

Track gains: Michikusa3 0.24, Michikusa2 0.24, Koharu 0.30,
JRPG Battle 0.24, Cynic Battle 0.31. Measured source RMS levels respectively:
-12.5, -12.4, -14.5, -10.8, -13.0 dBFS. These gains approximately match
normal tracks, with hyper tracks approximately 1.7 dB louder.
The existing master volume/mute applies to both music and effects.
Files are self-hosted; gameplay makes no requests to the authors' sites.
Failed tracks are skipped; if no alternative loads, synthesized music is used.
Normal-track attribution is required by CC BY 4.0; hyper credits are voluntary
under CC0. The in-game footer always identifies the playing song and author,
and links to credits.html. No endorsement by the authors is implied.
