# Content Direction

The complete campaign targets this editorial mix:

| Primary tone | Target | Purpose |
| --- | ---: | --- |
| Non-sequitur humor | 30% | Earnest reactions to absurd objects, bureaucracy, side remarks, and consequences that do not behave quite normally. |
| Dark-future post-apocalypse | 30% | Collapsed infrastructure, scarcity, damaged communities, dangerous technology, and meaningful choices without making the world emotionally flat. |
| Pop-culture homage and memes | 10% | Brief, transformed genre jokes or cultural echoes that reward recognition without becoming the game's whole voice. |
| Heart-warming retro-game nostalgia | 30% | Affection for old games through mechanics, sounds, visual rhythms, shared memories, and characters finding comfort in obsolete technology. |

These percentages apply to weighted authored beats across the campaign, not to every scene or every line. A bleak story scene can remain bleak, and a sincere scene does not need a joke inserted into it. The mix should become visible when reviewing an act and should meet the target across the complete release.

## Tagging Beats

Every meaningful dialogue exchange, environment story, encounter premise, item description, mission beat, and outcome receives one `primaryTone` in its content definition. Give it a weight based on prominence:

- `1`: incidental line, prop, description, or background detail
- `2`: substantial exchange, room, objective, or recurring element
- `3`: major scene, encounter premise, outcome, or act-defining moment

The validator in `src/content/tone.ts` reports the weighted distribution. The release target allows a tolerance of five percentage points per tone while content is being authored. Acts should be reviewed separately for pacing, but only the whole campaign must hit the final 30/30/10/30 contract.

## Voice Rules

- Let humor come from character, situation, mechanics, and consequences. Do not turn every sentence into a punchline.
- Keep the apocalypse materially present: repairs matter, resources have histories, and communities respond to what the player changes.
- Use retro warmth as more than decoration. Old-game memories should help characters connect, teach mechanics, or give broken technology emotional meaning.
- Keep pop-culture references short, original, and transformed. Do not copy dialogue, characters, logos, music, artwork, distinctive fictional items, or branded interfaces.
- Prefer broad genre parody, unexpected combinations, and affectionate mechanical callbacks over direct quotation.
- Record a `referenceNote` for every `pop-culture-homage` beat explaining the transformation and why it belongs in the scene.
- Consequences should carry tone forward. A joke, loss, repair, or remembered game can change later dialogue, encounters, and overworld details.

## Example Distribution

Ten equally weighted beats can satisfy the target with three non-sequitur beats, three dark-future beats, one pop-culture homage, and three retro-heart beats. Larger scenes can instead use weights `3`, `3`, `1`, and `3` to produce the same distribution.